"""Sync's HTTP routes (protocol/sync.contract.json): joining, state, presence,
leases, changes, the event stream, and a folder workspace's images (served
by path, uploaded in pieces). The shared workspaces are the directory's
(service/directory.py)."""
import json
import mimetypes
import os
import queue
from pathlib import Path

from stilo.kernel.log import log as _log

CONTRACT = Path(__file__).resolve().parents[5] / "protocol" / "sync.contract.json"


def load_version() -> int:
    """The sync compatibility level: the contract's, unless the server is told
    to demand a newer one (MDNOTES_MIN_CLIENT_VERSION)."""
    version = int(json.loads(CONTRACT.read_text(encoding="utf-8"))["version"])
    try:
        return max(version, int(os.environ.get("MDNOTES_MIN_CLIENT_VERSION", "")))
    except ValueError:
        return version


def add_routes(transport, directory, version: int):
    Refusal = transport.Refusal

    def token_of(request) -> str:
        token = request.query("token")
        if not token:
            raise PermissionError("Missing session token")
        return token

    def current(payload=None, request=None) -> None:
        """Refuse an out-of-date tab (426) before it can write or rejoin."""
        raw = payload.get("version") if payload is not None else request.query("v", "0")
        try:
            sent = int(raw)
        except (TypeError, ValueError):
            sent = 0
        if sent < version:
            _log("SYNC", f"refused an out-of-date tab (sync {sent} < {version})")
            raise Refusal(426, {"message": "This tab uses an older sync implementation. Reload to update Stilo Marker.",
                                "upgradeRequired": True, "minVersion": version})

    def changing(run):
        """A change: a conflict is 409 (the client must pull the newer copy, not
        drop its change), storage trouble is 503."""
        def route(request):
            try:
                return run(request)
            except ValueError as error:
                if "conflict" in str(error).lower():
                    raise Refusal(409, {"message": str(error)}) from error
                raise
            except PermissionError:
                raise  # an OSError too, but a refusal (403), not storage trouble
            except OSError as error:
                _log("SYNC", f"storage unavailable: {error}")
                raise Refusal(503, {"message": "Workspace storage is unavailable; changes are not yet confirmed."}) from error
        return route

    def connect(request):
        payload = request.json()
        session = directory.connect(payload.get("workspace") or None, str(payload.get("pin", "")),
                                    str(payload.get("displayName", "")), leased=payload.get("lease") is True)
        _log("SYNC", f"connect role={session['role']} name={session['displayName']!r} ws={session['workspace']}")
        return session

    def host(request):
        payload = request.json()
        session = directory.host(str(payload.get("displayName", "")), leased=payload.get("lease") is True)
        _log("SYNC", f"host {session['workspace']}")
        return session

    def open_workspace(request):
        account = token_of(request)
        payload = request.json()
        current(payload)
        # A bare name (an older client's {team, name}) still opens workspaces/<name>.
        path = str(payload.get("path", "")).strip() or (f"workspaces/{payload['name']}" if payload.get("name") else "")
        device = str(payload.get("device") or "").strip()[:64] or None
        session = directory.open_workspace(account, str(payload.get("team", "")), path, device,
                                           leased=payload.get("lease") is True)
        # pageId tells "the page keeps reloading" (many ids) from "one tab keeps
        # reconnecting" (one id); reason names the code path that asked.
        _log("SYNC", f"opened {session['workspace']} as {session['displayName']!r}  "
                     f"why={str(payload.get('reason') or 'unspecified')[:40]} page={str(payload.get('pageId') or '?')[:24]} "
                     f"dev={device or '-'}")
        return session

    def get_state(request):
        token = token_of(request)
        return directory.broker_for_token(token).get_state(token)

    def set_state(request):
        token = token_of(request)
        payload = request.json()
        current(payload)
        if not isinstance(payload.get("project"), dict):
            raise ValueError("Project payload is required")
        event = directory.broker_for_token(token).set_state(token, payload["project"], payload.get("baseRevision"))
        return {"message": "state stored", "revision": event["revision"]}

    def get_presence(request):
        token = token_of(request)
        workspace = directory.broker_for_token(token)
        workspace.authorize(token)
        return {"presence": workspace.get_presence(), "revision": workspace.revision}

    def cursor(request):
        token = token_of(request)
        payload = request.json()
        try:
            start, end = int(payload.get("selStart", 0)), int(payload.get("selEnd", 0))
        except (TypeError, ValueError) as error:
            raise ValueError(str(error)) from error
        directory.broker_for_token(token).broadcast_cursor(token, str(payload.get("fileId", "")), start, end)
        return {"message": "cursor broadcast"}

    def expired(run):
        def route(request):
            try:
                return run(request)
            except PermissionError as error:
                raise PermissionError("Session expired") from error
        return route

    def lease(request):
        token = token_of(request)
        directory.broker_for_token(token).renew_lease(token)
        return {"message": "session active"}

    def leave(request):
        directory.close_session(token_of(request))
        return {"message": "session closed"}

    def operation(request):
        token = token_of(request)
        payload = request.json()
        current(payload)
        if not isinstance(payload.get("operation"), dict):
            raise ValueError("Operation payload is required")
        event = directory.broker_for_token(token).apply_operation(token, payload["operation"])
        ack = {**event, "message": "operation stored"}
        counters = (event.get("operation") or {}).get("counters")
        if counters:
            ack["counters"] = counters
            ack["path"] = event["operation"].get("path")
        return ack

    def asset(request):
        token = token_of(request)
        workspace = directory.broker_for_token(token)
        workspace.authorize(token)
        path = workspace.resolve_asset(request.query("path"))
        if path is None:
            raise LookupError("Asset not found")
        return transport.File(path.read_bytes(), mimetypes.guess_type(str(path))[0] or "application/octet-stream")

    def upload_asset(request):
        token = token_of(request)
        workspace = directory.broker_for_token(token)
        workspace.authorize(token)
        path = request.query("path")
        if not path:
            raise ValueError("Asset path is required")
        offset = int(request.query("offset", "0"))
        return {"ok": True, "size": workspace.write_asset_chunk(token, path, offset, request.body())}

    def stream(request):
        token = token_of(request)
        workspace = directory.broker_for_token(token)
        return EventStream(workspace, token, directory, leased=request.query("lease") == "1")

    transport.add_route("POST", "/api/session/connect", connect)
    transport.add_route("POST", "/api/session/host", host)
    transport.add_route("POST", "/api/workspaces/open", open_workspace)
    transport.add_route("GET", "/api/session/state", changing(get_state))
    transport.add_route("POST", "/api/session/state", changing(set_state))
    transport.add_route("GET", "/api/session/presence", get_presence)
    transport.add_route("POST", "/api/session/presence", cursor)
    transport.add_route("POST", "/api/session/lease", expired(lease))
    transport.add_route("POST", "/api/session/leave", expired(leave))
    transport.add_route("POST", "/api/operations", changing(operation))
    transport.add_stream_route("GET", "/api/events/stream", stream)
    transport.add_route("GET", "/api/workspaces/asset", asset)
    transport.add_route("POST", "/api/workspaces/asset", upload_asset)


class EventStream:
    """One open event stream: the workspace's events for one session. When it
    ends, the session's presence goes; a session that ended for good (its
    token revoked or replaced) tells the directory."""

    def __init__(self, workspace, token, directory, leased=False):
        self.workspace, self.token, self.directory = workspace, token, directory
        self.events = workspace.subscribe(token, leased=leased)
        self.name = workspace.sessions.presence.get(token, {}).get("displayName", "?")
        _log("SSE", f"Stream opened ({len(workspace.sessions.subscribers)} subscriber(s))", client=self.name)

    def next(self, timeout):
        try:
            event = self.events.get(timeout=timeout)
        except queue.Empty:
            return None
        event_type = event.get("type")
        if event_type == "operation":
            op = event.get("operation", {})
            _log("SSE→", f"[{self.name}]  op={op.get('type')}  path={op.get('path')!r}  rev={event.get('revision')}")
        elif event_type in ("state", "ready"):
            _log("SSE→", f"[{self.name}]  {event_type}  rev={event.get('revision')}")
        return event

    def should_close(self):
        return self.workspace.session_should_close(self.token)

    def close(self):
        ended = self.workspace.unsubscribe(self.token, expected_queue=self.events)
        # A replaced stream may no longer own this token: its cleanup must not
        # close a newer stream using the same token.
        with self.workspace.lock:
            revoked = self.token not in self.workspace.sessions.tokens
        _log("SSE", "Stream closed", client=self.name)
        if ended or revoked:
            self.directory.on_disconnect(self.token)
