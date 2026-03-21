import argparse
import json
import mimetypes
import os
import posixpath
import queue
import secrets
import threading
import time
import uuid
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen


def _log(tag: str, message: str, **fields):
    """Print a timestamped log line to stdout."""
    ts = time.strftime("%H:%M:%S", time.localtime())
    extras = "  " + "  ".join(f"{k}={v!r}" for k, v in fields.items()) if fields else ""
    print(f"[{ts}] [{tag}] {message}{extras}", flush=True)


class CollaborationBroker:
    def __init__(self, pin: str, state_file: Path, master_pin: str | None = None):
        self.pin = pin
        # master_pin grants project-replace authority; defaults to same as pin so
        # single-pin deployments are backward-compatible.
        self.master_pin = master_pin or pin
        self.state_file = state_file
        self.lock = threading.RLock()
        self.project = None
        self.revision = 0
        self.tokens = {}
        self.subscribers = {}
        self.presence = {}
        self.master_tokens: set[str] = set()  # tokens that authenticated with master_pin
        # Ring buffer of applied operations for OT rebase, keyed by revision number.
        # Stores (revision, path, start, end, inserted_length) tuples.
        self.operation_log = []
        self.operation_log_max = 2000
        self._load_state()

    def _default_project(self):
        return {
            "id": "server-project",
            "name": "Workspace",
            "sourceMode": "memory",
            "rootId": "root",
            "activeFileId": None,
            "nodes": {
                "root": {
                    "id": "root",
                    "kind": "folder",
                    "name": "Workspace",
                    "parentId": None,
                    "children": [],
                    "expanded": True,
                }
            },
        }

    def _load_state(self):
        if not self.state_file.exists():
            self.project = self._default_project()
            self.revision = 0
            return
        data = json.loads(self.state_file.read_text(encoding="utf-8"))
        self.project = data.get("project") or self._default_project()
        self.revision = int(data.get("revision", 0))

    def _persist_state(self):
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {"project": self.project, "revision": self.revision}
        self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _broadcast(self, event, exclude_token: str | None = None):
        subscribers = {}
        with self.lock:
            subscribers = dict(self.subscribers)
        for token, subscriber in subscribers.items():
            if token == exclude_token:
                continue
            subscriber.put(event)

    def _broadcast_presence(self, message: str):
        presence_snapshot = self.get_presence()
        self._broadcast({
            "type": "presence",
            "presence": presence_snapshot,
            "message": message,
            "serverTime": time.time(),
            "revision": self.revision,
        })

    def _find_child_by_name(self, parent_id: str, name: str):
        parent = self.project["nodes"][parent_id]
        for child_id in parent.get("children", []):
            child = self.project["nodes"][child_id]
            if child["name"] == name:
                return child
        return None

    def _get_node_id_by_path(self, path: str):
        segments = [segment for segment in path.split("/") if segment]
        current_id = self.project["rootId"]
        for segment in segments:
            child = self._find_child_by_name(current_id, segment)
            if not child:
                return None
            current_id = child["id"]
        return current_id

    def _get_path(self, node_id: str):
        segments = []
        current = self.project["nodes"][node_id]
        while current and current.get("parentId"):
            segments.insert(0, current["name"])
            current = self.project["nodes"][current["parentId"]]
        return "/".join(segments)

    def _create_id(self, prefix: str):
        return f"{prefix}-{uuid.uuid4().hex[:12]}"

    @staticmethod
    def _transform_offset(offset: int, applied_start: int, applied_end: int, inserted_length: int) -> int:
        """Adjust a text offset after a single already-applied operation."""
        removed_length = applied_end - applied_start
        if offset <= applied_start:
            return offset
        if offset <= applied_end:
            # Offset was inside the removed region — snap to the insertion point.
            return applied_start + inserted_length
        return offset + inserted_length - removed_length

    def _rebase_patch(self, path: str, start: int, end: int, base_revision: int) -> tuple[int, int]:
        """
        Transform (start, end) through all operations applied to `path` since
        base_revision, up to (but not including) the current revision.
        Returns the adjusted (start, end).
        """
        for entry in self.operation_log:
            if entry["revision"] <= base_revision:
                continue
            if entry["path"] != path:
                continue
            a_start = entry["start"]
            a_end = entry["end"]
            a_inserted = entry["insertedLength"]
            start = self._transform_offset(start, a_start, a_end, a_inserted)
            end = self._transform_offset(end, a_start, a_end, a_inserted)
        return start, end

    def _record_operation(self, path: str, start: int, end: int, inserted_length: int):
        # revision is incremented in apply_operation after _apply_operation returns,
        # so the entry for this op will carry revision + 1.
        self.operation_log.append({
            "revision": self.revision + 1,
            "path": path,
            "start": start,
            "end": end,
            "insertedLength": inserted_length,
        })
        if len(self.operation_log) > self.operation_log_max:
            self.operation_log = self.operation_log[-self.operation_log_max:]

    def _apply_text_patch(self, content: str, operation: dict, base_revision: int | None = None) -> tuple[str, int, int]:
        """
        Apply a text patch with optional OT rebase.
        Returns (new_content, rebased_start, rebased_end).
        If base_revision is provided and differs from the current revision, the
        patch offsets are transformed through all intermediate operations first
        so concurrent edits converge instead of conflicting.
        """
        start = int(operation.get("start", -1))
        end = int(operation.get("end", -1))
        insert_text = str(operation.get("text", ""))
        removed_text = str(operation.get("removedText", ""))
        path = str(operation.get("path", ""))

        if start < 0 or end < start:
            raise ValueError("Invalid text patch range")

        # If the client sent a baseRevision that is behind the current revision,
        # transform the offsets through the intervening operations.
        if base_revision is not None and base_revision < self.revision:
            orig_start, orig_end = start, end
            start, end = self._rebase_patch(path, start, end, base_revision)
            if start != orig_start or end != orig_end:
                _log("OT", f"Rebased {path!r}  {orig_start}\u2013{orig_end} \u2192 {start}\u2013{end}",
                     baseRev=base_revision, currentRev=self.revision)

        if end > len(content):
            raise ValueError("Text patch range exceeds content length")

        current_slice = content[start:end]
        if removed_text and current_slice != removed_text:
            # After OT transform the removed region may no longer match (e.g. a
            # concurrent delete already erased those chars).  Treat as a pure
            # insertion at the transformed start so the typed text is preserved.
            _log("OT-SNAP", f"removedText mismatch on {path!r} at {start}\u2013{end}  \u2192 snap to insert-only",
                 expected=repr(removed_text[:20]), got=repr(current_slice[:20]))
            end = start

        return f"{content[:start]}{insert_text}{content[end:]}", start, end

    def _append_node(self, parent_id: str, node: dict):
        parent = self.project["nodes"][parent_id]
        parent.setdefault("children", []).append(node["id"])
        self.project["nodes"][node["id"]] = node

    def _remove_node_recursive(self, node_id: str):
        node = self.project["nodes"].get(node_id)
        if not node:
            return
        if node["kind"] == "folder":
            for child_id in list(node.get("children", [])):
                self._remove_node_recursive(child_id)
        del self.project["nodes"][node_id]

    def _apply_operation(self, operation):
        operation_type = operation.get("type")
        if operation_type == "replace-project":
            self.project = operation["project"]
            return

        if operation_type == "create-folder":
            parent_path = operation.get("parentPath", "")
            parent_id = self._get_node_id_by_path(parent_path) if parent_path else self.project["rootId"]
            if not parent_id:
                raise ValueError(f"Parent path not found: {parent_path}")
            node = {
                "id": self._create_id("folder"),
                "kind": "folder",
                "name": operation["name"],
                "parentId": parent_id,
                "children": [],
                "expanded": True,
            }
            self._append_node(parent_id, node)
            return

        if operation_type == "create-file":
            parent_path = operation.get("parentPath", "")
            parent_id = self._get_node_id_by_path(parent_path) if parent_path else self.project["rootId"]
            if not parent_id:
                raise ValueError(f"Parent path not found: {parent_path}")
            node = {
                "id": self._create_id("file"),
                "kind": "file",
                "name": operation["name"],
                "parentId": parent_id,
                "content": operation.get("content", ""),
                "dirty": False,
                "sourceVersion": 0,
            }
            self._append_node(parent_id, node)
            return

        if operation_type == "rename-node":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                raise ValueError(f"Node path not found: {operation['path']}")
            self.project["nodes"][node_id]["name"] = operation["name"]
            return

        if operation_type == "delete-node":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                return
            node = self.project["nodes"][node_id]
            parent = self.project["nodes"][node["parentId"]]
            parent["children"] = [child_id for child_id in parent.get("children", []) if child_id != node_id]
            self._remove_node_recursive(node_id)
            return

        if operation_type == "update-file":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                raise ValueError(f"File path not found: {operation['path']}")
            node = self.project["nodes"][node_id]
            node["content"] = operation.get("content", "")
            node["dirty"] = False
            node["sourceVersion"] = int(node.get("sourceVersion", 0)) + 1
            return

        if operation_type == "patch-file":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                raise ValueError(f"File path not found: {operation['path']}")
            node = self.project["nodes"][node_id]
            if node["kind"] != "file":
                raise ValueError("Only files can receive text patches")
            base_revision = operation.get("baseRevision")
            if base_revision is not None:
                base_revision = int(base_revision)
            new_content, rebased_start, rebased_end = self._apply_text_patch(
                node.get("content", ""), operation, base_revision
            )
            node["content"] = new_content
            node["dirty"] = False
            node["sourceVersion"] = int(node.get("sourceVersion", 0)) + 1
            # Store rebased positions back into the operation dict so that
            # when broadcast to peers they receive the positions actually applied,
            # not the original (pre-OT) positions the sender submitted.
            operation["start"] = rebased_start
            operation["end"] = rebased_end
            # Record the transformed op so later concurrent patches can be rebased.
            inserted_length = len(str(operation.get("text", "")))
            self._record_operation(str(operation.get("path", "")), rebased_start, rebased_end, inserted_length)
            return

        raise ValueError(f"Unsupported operation type: {operation_type}")

    def connect(self, pin: str, display_name: str = ""):
        if pin == self.master_pin:
            role = "master"
        elif pin == self.pin:
            role = "client"
        else:
            _log("AUTH", "Rejected connect — wrong PIN")
            raise PermissionError("Invalid PIN")

        token = secrets.token_urlsafe(24)
        client_id = f"client-{uuid.uuid4().hex[:12]}"
        cleaned_name = display_name.strip()[:40]
        display_name = cleaned_name or f"Peer {client_id[-4:]}"
        with self.lock:
            self.tokens[token] = client_id
            self.presence[token] = {"clientId": client_id, "displayName": display_name, "connectedAt": time.time()}
            if role == "master":
                self.master_tokens.add(token)
        _log("CONNECT", f"{display_name} joined as {role}", clientId=client_id, revision=self.revision)
        self._broadcast_presence(f"{display_name} joined the session.")
        return {"token": token, "clientId": client_id, "displayName": display_name, "revision": self.revision, "sessionId": "default", "role": role}

    def authorize(self, token: str):
        with self.lock:
          client_id = self.tokens.get(token)
        if not client_id:
            raise PermissionError("Invalid or expired session token")
        return client_id

    def get_state(self, token: str):
        self.authorize(token)
        with self.lock:
            return {"project": self.project, "revision": self.revision, "presence": self.get_presence(), "sessionId": "default"}

    def get_presence(self):
        with self.lock:
            return list(self.presence.values())

    def set_state(self, token: str, project):
        client_id = self.authorize(token)
        with self.lock:
            if token not in self.master_tokens:
                raise PermissionError("Only the session master can replace the project state")
        event = None
        with self.lock:
            self.project = project
            self.revision += 1
            self._persist_state()
            event = {
                "type": "state",
                "clientId": client_id,
                "revision": self.revision,
                "project": project,
                "serverTime": time.time()
            }
        self._broadcast(event)

        return event

    def apply_operation(self, token: str, operation):
        client_id = self.authorize(token)
        with self.lock:
            if operation.get("type") == "replace-project" and token not in self.master_tokens:
                raise PermissionError("Only the session master can replace the project")
            # Capture original positions before _apply_operation may rebase them.
            orig_start = operation.get("start")
            orig_end = operation.get("end")
            self._apply_operation(operation)
            self.revision += 1
            self._persist_state()
            op_type = operation.get("type", "?")
            op_path = operation.get("path", "")
            event = {
                "type": "operation",
                "clientId": client_id,
                "revision": self.revision,
                "operation": operation,
                "serverTime": time.time(),
            }
            # Collect sender name and recipient names while still holding the lock.
            sender_name = self.presence.get(token, {}).get("displayName", client_id[-8:])
            recipient_names = [
                self.presence.get(t, {}).get("displayName", f"\u2026{t[-4:]}")
                for t in self.subscribers if t != token
            ]
        if op_type == "patch-file":
            insert_text = str(operation.get("text", ""))
            text_preview = repr(insert_text[:30])
            applied_start = operation.get("start")
            applied_end = operation.get("end")
            ot_detail = (
                f"  [OT: {orig_start}\u2013{orig_end} \u2192 {applied_start}\u2013{applied_end}]"
                if (applied_start != orig_start or applied_end != orig_end) else ""
            )
            _log("PATCH", f"{op_path!r}  {applied_start}\u2013{applied_end}{ot_detail}  text={text_preview}",
                 from_=sender_name,
                 baseRev=operation.get("baseRevision"),
                 revision=self.revision)
            to_str = ", ".join(recipient_names) if recipient_names else "(no other peers)"
            _log("BROADCAST", f"patch-file  rev={self.revision}  start={applied_start}  end={applied_end}  to=[{to_str}]")
        else:
            _log("OP", op_type, from_=sender_name, path=op_path or None, revision=self.revision)
            if recipient_names:
                to_str = ", ".join(recipient_names)
                _log("BROADCAST", f"{op_type}  rev={self.revision}  to=[{to_str}]")
        self._broadcast(event)
        return event

    def broadcast_cursor(self, token: str, file_id: str, sel_start: int, sel_end: int):
        """Broadcast selection/cursor position to all other subscribers."""
        client_id = self.authorize(token)
        with self.lock:
            display_name = self.presence.get(token, {}).get("displayName", "")
            recipient_count = sum(1 for t in self.subscribers if t != token)
        event = {
            "type": "cursor",
            "clientId": client_id,
            "displayName": display_name,
            "fileId": file_id,
            "selStart": int(sel_start),
            "selEnd": int(sel_end),
            "serverTime": time.time(),
        }
        self._broadcast(event, exclude_token=token)
        _log("CURSOR", f"from={display_name!r}  fileId={file_id!r}  sel={sel_start}\u2013{sel_end}  to={recipient_count} peer(s)")

    def subscribe(self, token: str):
        client_id = self.authorize(token)
        event_queue = queue.Queue()
        with self.lock:
            self.subscribers[token] = event_queue
            revision = self.revision
        ready_event = {
            "type": "ready",
            "clientId": client_id,
            "revision": revision,
            "serverTime": time.time()
        }
        event_queue.put(ready_event)
        return event_queue

    def unsubscribe(self, token: str):
        client_id = None
        display_name = None
        with self.lock:
            self.subscribers.pop(token, None)
            self.master_tokens.discard(token)
            presence = self.presence.pop(token, None)
            if presence:
                client_id = presence["clientId"]
                display_name = presence["displayName"]
        if client_id:
            _log("DISCONNECT", f"{display_name} left", clientId=client_id)
            self._broadcast_presence(f"{display_name} left the session.")


class MDNotesRequestHandler(BaseHTTPRequestHandler):
    server_version = "MDNotesServer/0.1"

    def __init__(self, *args, broker: CollaborationBroker, static_root: Path, **kwargs):
        self.broker = broker
        self.static_root = static_root
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        return

    def _log_request(self, status: int, detail: str = ""):
        """Log HTTP requests with method, path, status and optional detail."""
        indicator = "✓" if status < 400 else "✗"
        tag = "HTTP"
        line = f"{indicator} {self.command} {self.path}  →  {status}"
        if detail:
            line += f"  ({detail})"
        _log(tag, line)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/ping":
            return self._write_json(HTTPStatus.OK, {"message": "pong", "server": "mdnotes", "transport": "sse-text-ops"})
        if parsed.path == "/api/session/state":
            return self._handle_get_state(parsed)
        if parsed.path == "/api/session/presence":
            return self._handle_get_presence(parsed)
        if parsed.path == "/api/events/stream":
            return self._handle_event_stream(parsed)
        return self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/session/connect":
            return self._handle_connect()
        if parsed.path == "/api/session/state":
            return self._handle_post_state(parsed)
        if parsed.path == "/api/session/presence":
            return self._handle_post_presence(parsed)
        if parsed.path == "/api/operations":
            return self._handle_operation(parsed)
        self._write_json(HTTPStatus.NOT_FOUND, {"message": "Not found"})

    def _read_json(self):
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON payload")

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _write_json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _extract_token(self, parsed):
        query = parse_qs(parsed.query)
        token = query.get("token", [""])[0]
        if not token:
            raise PermissionError("Missing session token")
        return token

    def _handle_connect(self):
        try:
            payload = self._read_json()
            session = self.broker.connect(str(payload.get("pin", "")), str(payload.get("displayName", "")))
            self._write_json(HTTPStatus.OK, session)
            self._log_request(200, f"role={session['role']}  name={session['displayName']!r}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_get_state(self, parsed):
        try:
            token = self._extract_token(parsed)
            self._write_json(HTTPStatus.OK, self.broker.get_state(token))
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

    def _handle_get_presence(self, parsed):
        try:
            token = self._extract_token(parsed)
            self.broker.authorize(token)
            self._write_json(HTTPStatus.OK, {"presence": self.broker.get_presence(), "revision": self.broker.revision})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

    def _handle_post_state(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            project = payload.get("project")
            if not isinstance(project, dict):
                raise ValueError("Project payload is required")
            event = self.broker.set_state(token, project)
            self._write_json(HTTPStatus.OK, {"message": "state stored", "revision": event["revision"]})
            self._log_request(200, f"revision={event['revision']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            status = HTTPStatus.CONFLICT if "conflict" in str(error).lower() else HTTPStatus.BAD_REQUEST
            self._write_json(status, {"message": str(error)})
            self._log_request(int(status), str(error))

    def _handle_post_presence(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            file_id = str(payload.get("fileId", ""))
            sel_start = int(payload.get("selStart", 0))
            sel_end = int(payload.get("selEnd", 0))
            self.broker.broadcast_cursor(token, file_id, sel_start, sel_end)
            self._write_json(HTTPStatus.OK, {"message": "cursor broadcast"})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        except (ValueError, TypeError) as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _handle_operation(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            operation = payload.get("operation")
            if not isinstance(operation, dict):
                raise ValueError("Operation payload is required")
            event = self.broker.apply_operation(token, operation)
            self._write_json(HTTPStatus.OK, {"message": "operation stored", "revision": event["revision"]})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_event_stream(self, parsed):
        try:
            token = self._extract_token(parsed)
            events = self.broker.subscribe(token)
        except PermissionError as error:
            self._log_request(403, str(error))
            return self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

        with self.broker.lock:
            display_name = self.broker.presence.get(token, {}).get("displayName", "?")
            sub_count = len(self.broker.subscribers)

        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        _log("SSE", f"Stream opened  {self.client_address[0]}  ({sub_count} subscriber(s))", client=display_name)

        try:
            while True:
                try:
                    event = events.get(timeout=15)
                    payload = json.dumps(event)
                    self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                    # Log meaningful events sent to this client (skip noisy cursor/presence/keepalives).
                    evt_type = event.get("type", "?")
                    if evt_type == "operation":
                        op = event.get("operation", {})
                        op_type = op.get("type", "?")
                        if op_type == "patch-file":
                            _log("SSE\u2192", f"[{display_name}]  patch  path={op.get('path')!r}  "
                                           f"start={op.get('start')}  end={op.get('end')}  "
                                           f"text={str(op.get('text', ''))[:20]!r}  rev={event.get('revision')}")
                        else:
                            _log("SSE\u2192", f"[{display_name}]  op={op_type}  path={op.get('path')!r}  rev={event.get('revision')}")
                    elif evt_type == "state":
                        _log("SSE\u2192", f"[{display_name}]  state  rev={event.get('revision')}")
                    elif evt_type == "ready":
                        _log("SSE\u2192", f"[{display_name}]  ready  rev={event.get('revision')}")
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            _log("SSE", f"Stream closed  {self.client_address[0]}", client=display_name)
        finally:
            self.broker.unsubscribe(token)

    def _serve_static(self, request_path: str):
        relative = request_path or "/"
        if relative == "/":
            relative = "/index.html"

        safe_path = posixpath.normpath(relative).lstrip("/")
        candidate = (self.static_root / safe_path).resolve()
        if not str(candidate).startswith(str(self.static_root.resolve())) or not candidate.exists() or candidate.is_dir():
            candidate = self.static_root / "index.html"

        content = candidate.read_bytes()
        content_type, _ = mimetypes.guess_type(str(candidate))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type or 'application/octet-stream'}")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def build_server(host: str, port: int, pin: str, static_root: Path, state_file: Path, master_pin: str | None = None):
    broker = CollaborationBroker(pin, state_file, master_pin=master_pin)
    handler = partial(MDNotesRequestHandler, broker=broker, static_root=static_root)

    class QuietThreadingHTTPServer(ThreadingHTTPServer):
        """Suppress noisy client-disconnect tracebacks on Windows."""
        def handle_error(self, request, client_address):
            import sys
            exc = sys.exc_info()[1]
            if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError)):
                return
            super().handle_error(request, client_address)

    return QuietThreadingHTTPServer((host, port), handler)


def run_selftest():
    static_root = Path(__file__).resolve().parents[1]
    state_file = static_root / "server" / "test-session-state.json"
    if state_file.exists():
        state_file.unlink()
    server = build_server("127.0.0.1", 0, "2468", static_root, state_file)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base_url = f"http://{host}:{port}"

    try:
        ping = json.loads(urlopen(f"{base_url}/api/ping").read().decode("utf-8"))
        assert ping["message"] == "pong"

        connect_request = Request(
            f"{base_url}/api/session/connect",
            data=json.dumps({"pin": "2468", "displayName": "Tester"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        session = json.loads(urlopen(connect_request).read().decode("utf-8"))
        token = session["token"]
        assert session["displayName"] == "Tester"

        state = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        assert state["project"]["name"] == "Workspace"
        assert len(state["presence"]) == 1

        def read_stream(result_container):
            with urlopen(f"{base_url}/api/events/stream?token={token}") as response:
                for raw_line in response:
                    if raw_line.startswith(b"data: "):
                        result_container.append(json.loads(raw_line[6:].decode("utf-8")))
                        if result_container[-1]["type"] == "operation":
                            break

        events = []
        stream_thread = threading.Thread(target=read_stream, args=(events,), daemon=True)
        stream_thread.start()
        time.sleep(0.2)

        state_request = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "create-file", "parentPath": "", "name": "shared.md", "content": "# Shared"}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        update_response = json.loads(urlopen(state_request).read().decode("utf-8"))
        assert update_response["revision"] == 1

        stream_thread.join(timeout=3)
        assert any(event["type"] == "operation" for event in events)
        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        assert any(node["name"] == "shared.md" for node in snapshot["project"]["nodes"].values())

        patch_request = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "shared.md", "start": 8, "end": 8, "removedText": "", "text": " live", "baseRevision": 1}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        patch_response = json.loads(urlopen(patch_request).read().decode("utf-8"))
        assert patch_response["revision"] == 2

        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        shared_file = next(node for node in snapshot["project"]["nodes"].values() if node.get("name") == "shared.md")
        assert shared_file["content"] == "# Shared live"
        persisted = json.loads(state_file.read_text(encoding="utf-8"))
        assert persisted["revision"] == 2

        # --- OT convergence test: two concurrent patches on the same file ---
        # At revision 2.  Client A inserts " A" at offset 13 (after "# Shared live").
        # Client B also sends baseRevision=2 and inserts " B" at offset 13 (same spot).
        # The server should accept both and produce "# Shared live A B"
        # (or "# Shared live B A" depending on scheduling, but both must succeed).
        patch_a = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "shared.md", "start": 13, "end": 13, "removedText": "", "text": " A", "baseRevision": 2}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp_a = json.loads(urlopen(patch_a).read().decode("utf-8"))
        assert resp_a["revision"] == 3

        patch_b = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "shared.md", "start": 13, "end": 13, "removedText": "", "text": " B", "baseRevision": 2}}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp_b = json.loads(urlopen(patch_b).read().decode("utf-8"))
        assert resp_b["revision"] == 4

        snapshot = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        shared_file = next(node for node in snapshot["project"]["nodes"].values() if node.get("name") == "shared.md")
        # Both insertions must be present (order depends on arrival order).
        final_content = shared_file["content"]
        assert " A" in final_content and " B" in final_content, f"OT convergence failed: {final_content!r}"
        persisted = json.loads(state_file.read_text(encoding="utf-8"))
        assert persisted["revision"] == 4
        print("Backend self-test passed.")
    finally:
        server.shutdown()
        server.server_close()
        if state_file.exists():
            state_file.unlink()


def main():
    parser = argparse.ArgumentParser(description="MDNotes collaboration server")
    parser.add_argument("--host", default=os.environ.get("MDNOTES_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MDNOTES_PORT", "8000")))
    parser.add_argument("--pin", default=os.environ.get("MDNOTES_PIN", "2468"))
    parser.add_argument("--master-pin", default=os.environ.get("MDNOTES_MASTER_PIN", "1367"),
                        help="Secret PIN for the session master (project owner). Defaults to --pin.")
    parser.add_argument("--static-dir", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--state-file", default=str(Path(__file__).resolve().parent / "session-state.json"))
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        run_selftest()
        return

    static_root = Path(args.static_dir).resolve()
    state_file = Path(args.state_file).resolve()
    server = build_server(args.host, args.port, args.pin, static_root, state_file, master_pin=args.master_pin)
    print(f"MDNotes collaboration server running at http://{args.host}:{args.port}")
    print(f"Serving static files from {static_root}")
    print(f"Persisting collaborative state to {state_file}")
    print("Configured transport: HTTP + SSE file-operation sync")
    print(f"Master PIN configured: {'yes (separate)' if args.master_pin and args.master_pin != args.pin else 'same as session PIN'}")
    print("─" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()