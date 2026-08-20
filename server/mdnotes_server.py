import argparse
import base64
import copy
import json
import mimetypes
import os
import posixpath
import queue
import re
import secrets
import shutil
import threading
import time
import uuid
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _log(tag: str, message: str, **fields):
    """Print a timestamped log line to stdout."""
    ts = time.strftime("%H:%M:%S", time.localtime())
    extras = "  " + "  ".join(f"{k}={v!r}" for k, v in fields.items()) if fields else ""
    print(f"[{ts}] [{tag}] {message}{extras}", flush=True)


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


class ChatProxy:
    def __init__(self):
        self.api_key = (
            os.environ.get("MDNOTES_CHAT_API_KEY", "").strip()
            or os.environ.get("DEEPSEEK_API_KEY", "").strip()
        )
        self.api_url = (
            os.environ.get("MDNOTES_CHAT_API_URL", "").strip()
            or os.environ.get("DEEPSEEK_API_URL", "").strip()
            or "https://api.deepseek.com/chat/completions"
        )
        self.model = (
            os.environ.get("MDNOTES_CHAT_MODEL", "").strip()
            or os.environ.get("DEEPSEEK_MODEL", "").strip()
            or "deepseek-v4-flash"
        )
        # Optional list of models the client may pick from (comma-separated).
        # Defaults to just the configured model. The default model is always
        # offered and listed first; client-supplied overrides are validated
        # against this allowlist so an arbitrary model name can't be injected.
        extra_models = [
            name.strip()
            for name in os.environ.get("MDNOTES_CHAT_MODELS", "").split(",")
            if name.strip()
        ]
        self.models = [self.model] + [m for m in extra_models if m != self.model]
        self.organization = os.environ.get("MDNOTES_CHAT_ORGANIZATION", "").strip()
        self.provider_label = os.environ.get("MDNOTES_CHAT_PROVIDER", "DeepSeek").strip() or "DeepSeek"
        self.allow_remote = _truthy(os.environ.get("MDNOTES_CHAT_ALLOW_REMOTE"))
        self.max_context_chars = _read_int_env("MDNOTES_CHAT_MAX_CONTEXT_CHARS", 60000, 4000, 250000)
        self.max_messages = _read_int_env("MDNOTES_CHAT_MAX_MESSAGES", 24, 2, 100)
        self.timeout_seconds = _read_int_env("MDNOTES_CHAT_TIMEOUT", 60, 5, 180)
        self.reasoning_effort = os.environ.get("DEEPSEEK_REASONING_EFFORT", "high").strip().lower() or "high"
        self.enable_thinking = _truthy(os.environ.get("DEEPSEEK_ENABLE_THINKING"))
        self.broker = None  # wired in build_server after construction
        # Per-request key/URL override (a client bringing its own key). Stored on a
        # thread-local because each request runs on its own ThreadingHTTPServer
        # worker, so overrides never leak between concurrent requests.
        self._req = threading.local()
        self.max_tool_iterations = 6   # read-then-edit needs headroom; agent often explores first (Q2)
        self.max_ops_per_turn = 20
        manual_path = os.path.join(os.path.dirname(__file__), "MANUAL.md")
        try:
            with open(manual_path, encoding="utf-8") as _f:
                self.manual_content = _f.read()
        except OSError:
            self.manual_content = ""

    def is_configured(self) -> bool:
        return bool(self.api_key and self.model and self.api_url)

    # Effective key/URL for the request in flight: a client-supplied key (own-key
    # mode) takes precedence over the server's own credentials.
    def _eff_key(self) -> str:
        return getattr(self._req, "api_key", "") or self.api_key

    def _eff_url(self) -> str:
        return getattr(self._req, "api_url", "") or self.api_url

    def public_status(self) -> dict:
        if not self.is_configured():
            message = "Set DEEPSEEK_API_KEY or MDNOTES_CHAT_API_KEY on the server to enable chat."
        elif self.allow_remote:
            message = "Chat proxy is configured for this server."
        else:
            message = "Chat proxy is configured for local browser sessions on this machine."
        return {
            "configured": self.is_configured(),
            "provider": self.provider_label,
            "model": self.model or None,
            "models": list(self.models),
            "localOnly": not self.allow_remote,
            "message": message,
        }

    def authorize_client(self, client_ip: str):
        if self.allow_remote:
            return
        normalized = (client_ip or "").split("%", 1)[0]
        if normalized in {"127.0.0.1", "::1", "::ffff:127.0.0.1"}:
            return
        raise PermissionError("Chat endpoint is restricted to local browser sessions. Set MDNOTES_CHAT_ALLOW_REMOTE=1 to override.")

    def _serialize_context(self, context_files: list[dict]) -> tuple[str, list[str]]:
        sections = []
        used_paths = []
        remaining = self.max_context_chars

        for entry in context_files:
            if remaining <= 0:
                break
            if not isinstance(entry, dict):
                continue
            path = str(entry.get("path", "")).strip()
            if not path:
                continue

            kind = str(entry.get("kind", "text")).strip().lower() or "text"
            if kind == "image":
                body = "[Image file omitted from text context.]"
            else:
                body = str(entry.get("content", ""))

            chunk = f"File: {path}\nKind: {kind}\n```\n{body}\n```\n"
            if len(chunk) > remaining:
                chunk = chunk[:remaining]
            sections.append(chunk)
            used_paths.append(path)
            remaining -= len(chunk)

        return "\n".join(sections).strip(), used_paths

    # ------------------------------------------------------------------
    # Agentic tool helpers (Phase 1)
    # ------------------------------------------------------------------

    @staticmethod
    def _get_tool_schemas() -> list:
        """OpenAI function-calling tool definitions for the agent."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "List all files and folders in the workspace with their paths and types.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read the full content of a file at the given path.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Path to the file, e.g. 'folder/notes.md'"},
                        },
                        "required": ["path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_file",
                    "description": "Propose creating a new file with the given content.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "parentPath": {"type": "string", "description": "Parent folder path; empty string for root."},
                            "name": {"type": "string", "description": "File name including extension."},
                            "content": {"type": "string", "description": "Initial file content."},
                        },
                        "required": ["name", "content"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "update_file",
                    "description": "Propose replacing the entire content of an existing file.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Path to the file."},
                            "content": {"type": "string", "description": "New full content for the file."},
                        },
                        "required": ["path", "content"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "rename_node",
                    "description": "Propose renaming a file or folder.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Current path of the file or folder."},
                            "name": {"type": "string", "description": "New name."},
                        },
                        "required": ["path", "name"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_node",
                    "description": "Propose deleting a file or folder (recursive for folders).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Path of the file or folder to delete."},
                        },
                        "required": ["path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "create_folder",
                    "description": "Propose creating a new folder.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "parentPath": {"type": "string", "description": "Parent folder path; empty string for root."},
                            "name": {"type": "string", "description": "Folder name."},
                        },
                        "required": ["name"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "move_node",
                    "description": "Propose moving a file or folder to a different parent.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "Current path of the item."},
                            "parentPath": {"type": "string", "description": "Destination parent folder path; empty for root."},
                            "index": {"type": "integer", "description": "Optional insertion index within the new parent."},
                        },
                        "required": ["path", "parentPath"],
                    },
                },
            },
        ]

    @staticmethod
    def _walk_project_tree(project: dict) -> list:
        """Return [(path, kind), ...] for every non-root node in depth-first order."""
        nodes = project.get("nodes", {})
        root_id = project.get("rootId", "root")
        results = []

        def _walk(node_id: str, prefix: str):
            node = nodes.get(node_id)
            if not node:
                return
            is_root = node.get("parentId") is None
            if is_root:
                node_path = ""
            else:
                node_path = f"{prefix}/{node['name']}" if prefix else node["name"]
                results.append((node_path, node.get("kind", "file")))
            for child_id in node.get("children", []):
                _walk(child_id, node_path)

        _walk(root_id, "")
        return results

    def _build_project_tree(self, project: dict) -> str:
        """Return a compact text tree listing paths and kinds."""
        entries = self._walk_project_tree(project)
        if not entries:
            return ""
        return "\n".join(
            f"folder: {path}" if kind == "folder" else f"file: {path}"
            for path, kind in entries
        )

    @staticmethod
    def _get_node_id_by_path_in(project: dict, path: str):
        """Resolve a slash-separated path string to a node id within the given project snapshot."""
        nodes = project.get("nodes", {})
        root_id = project.get("rootId", "root")
        segments = [s for s in path.split("/") if s]
        current_id = root_id
        for segment in segments:
            parent = nodes.get(current_id, {})
            found = None
            for child_id in parent.get("children", []):
                child = nodes.get(child_id, {})
                if child.get("name") == segment:
                    found = child_id
                    break
            if not found:
                return None
            current_id = found
        return current_id

    def _extract_tool_calls(self, response_payload: dict) -> list:
        """Extract the tool_calls list from a chat completion response, or [] if none."""
        choices = response_payload.get("choices") or []
        if not choices:
            return []
        message = choices[0].get("message") or {}
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or not tool_calls:
            return []
        return tool_calls

    def _stream_completion(self, base_payload: dict, headers: dict, emit) -> dict:
        """Call the chat completion endpoint in streaming mode, surfacing live
        progress via `emit`, and return a reconstructed non-streaming response
        payload (same shape `_extract_tool_calls` / `_extract_message_text` expect).

        The slow part of an agent turn is the model generating a long file body,
        which arrives as tool-call *argument* fragments — so without streaming
        the user just sees a spinner. Streaming surfaces the assistant's text
        token-by-token and a live byte count while a file is being written, and
        keeps bytes flowing so the connection never idles into a timeout.
        """
        payload = dict(base_payload)
        payload["stream"] = True
        request = Request(
            self._eff_url(),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        content_parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        finish_reason = None
        last_emit = 0.0

        try:
            response = urlopen(request, timeout=self.timeout_seconds)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                error_payload = json.loads(detail)
            except json.JSONDecodeError:
                error_payload = None
            err_msg = error_payload.get("error", {}).get("message") if isinstance(error_payload, dict) else None
            raise RuntimeError(err_msg or detail or f"Chat provider returned HTTP {error.code}.") from error
        except URLError as error:
            raise RuntimeError(f"Chat provider is unreachable: {error.reason}.") from error

        with response:
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                delta = choice.get("delta") or {}
                if choice.get("finish_reason"):
                    finish_reason = choice.get("finish_reason")

                text = delta.get("content")
                if isinstance(text, str) and text:
                    content_parts.append(text)
                    emit({"type": "delta", "text": text})

                # Reasoning-model chain-of-thought arrives as a separate field
                # (reasoning_content). Surface it live so the UI can show what the
                # agent is thinking, without mixing it into the committed answer.
                reasoning = delta.get("reasoning_content")
                if isinstance(reasoning, str) and reasoning:
                    emit({"type": "reasoning", "text": reasoning})

                for tc in (delta.get("tool_calls") or []):
                    idx = tc.get("index", 0)
                    slot = tool_acc.setdefault(idx, {
                        "id": "", "type": "function",
                        "function": {"name": "", "arguments": ""},
                    })
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        slot["function"]["name"] = fn["name"]
                    if fn.get("arguments"):
                        slot["function"]["arguments"] += fn["arguments"]

                # Throttled progress while a long tool argument streams in.
                now = time.time()
                if tool_acc and now - last_emit > 0.4:
                    last_emit = now
                    for slot in tool_acc.values():
                        name = slot["function"]["name"]
                        if name:
                            emit({"type": "writing", "name": name,
                                  "chars": len(slot["function"]["arguments"])})

        message: dict = {"role": "assistant", "content": "".join(content_parts)}
        if tool_acc:
            message["tool_calls"] = [tool_acc[i] for i in sorted(tool_acc)]
        return {"choices": [{"message": message, "finish_reason": finish_reason}]}

    def _describe_tool_call(self, tc: dict) -> dict:
        """Build a small, UI-friendly summary of a tool call for progress streaming."""
        fn = tc.get("function") or {}
        name = str(fn.get("name", "") or "")
        try:
            args = json.loads(fn.get("arguments", "{}") or "{}")
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        target = str(args.get("path", "") or args.get("name", "") or args.get("parentPath", "")).strip()
        return {"name": name, "target": target}

    def _execute_tool_call(self, tc: dict, project_snapshot: dict, proposed_operations: list) -> dict:
        """
        Execute one tool call against the project snapshot.
        Read tools return their result immediately.
        Write tools are collected into proposed_operations and return a synthetic ack.
        """
        fn = tc.get("function") or {}
        name = fn.get("name", "")
        try:
            args = json.loads(fn.get("arguments", "{}") or "{}")
        except json.JSONDecodeError:
            args = {}

        proposal_id = f"op-{uuid.uuid4().hex[:8]}"

        # --- Read tools ---
        if name == "list_files":
            entries = self._walk_project_tree(project_snapshot)
            return {"files": [{"path": p, "kind": k} for p, k in entries]}

        if name == "read_file":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            if not node_id:
                return {"error": f"File not found: {path}"}
            node = project_snapshot["nodes"].get(node_id, {})
            if node.get("kind") != "file":
                return {"error": f"Not a file: {path}"}
            return {"content": node.get("content", "")}

        # --- Write tools — collected as proposals, never applied here ---
        if name == "create_file":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "create-file",
                "parentPath": str(args.get("parentPath", "")),
                "name": str(args.get("name", "")),
                "content": str(args.get("content", "")),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "update_file":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            pre_image = ""
            if node_id:
                pre_image = project_snapshot["nodes"].get(node_id, {}).get("content", "")
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "update-file",
                "path": path,
                "content": str(args.get("content", "")),
                "preImage": pre_image,
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "rename_node":
            path = str(args.get("path", "")).strip()
            node_id = self._get_node_id_by_path_in(project_snapshot, path)
            pre_image = ""
            if node_id:
                pre_image = project_snapshot["nodes"].get(node_id, {}).get("name", "")
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "rename-node",
                "path": path,
                "name": str(args.get("name", "")),
                "preImage": pre_image,
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "delete_node":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "delete-node",
                "path": str(args.get("path", "")).strip(),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "create_folder":
            proposed_operations.append({
                "proposalId": proposal_id,
                "type": "create-folder",
                "parentPath": str(args.get("parentPath", "")),
                "name": str(args.get("name", "")),
            })
            return {"status": "proposed", "proposalId": proposal_id}

        if name == "move_node":
            op: dict = {
                "proposalId": proposal_id,
                "type": "move-node",
                "path": str(args.get("path", "")).strip(),
                "parentPath": str(args.get("parentPath", "")),
            }
            if "index" in args:
                try:
                    op["index"] = int(args["index"])
                except (TypeError, ValueError):
                    pass
            proposed_operations.append(op)
            return {"status": "proposed", "proposalId": proposal_id}

        return {"error": f"Unknown tool: {name}"}

    @staticmethod
    def _extract_message_text(payload: dict) -> str:
        choices = payload.get("choices") or []
        if not choices:
            return ""
        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str):
                        parts.append(text)
                        continue
                    if isinstance(part.get("content"), str):
                        parts.append(part["content"])
                        continue
                elif isinstance(part, str):
                    parts.append(part)
            return "".join(parts).strip()
        return str(content or "").strip()

    def chat(self, messages: list[dict], context_files: list[dict], project_name: str,
             client_project: dict | None = None, progress=None, model: str | None = None,
             override: dict | None = None) -> dict:
        # A client bringing its own key overrides the server's for THIS request
        # only (thread-local, cleared in finally). When own-key mode is used the
        # client also picks the model freely (its key, its allowlist).
        override = override or {}
        own_key = str(override.get("apiKey") or "").strip()
        own_url = str(override.get("apiUrl") or "").strip()
        own_model = str(override.get("model") or "").strip()
        self._req.api_key = own_key
        self._req.api_url = own_url
        try:
            return self._chat_inner(messages, context_files, project_name, client_project,
                                    progress, model, bool(own_key), own_model)
        finally:
            self._req.api_key = ""
            self._req.api_url = ""

    def _chat_inner(self, messages, context_files, project_name, client_project,
                    progress, model, own_key: bool, own_model: str) -> dict:
        if not (self._eff_key() and self._eff_url()):
            raise ValueError("Chat is not configured. Add your API key in Settings → Agent, or set DEEPSEEK_API_KEY on the server.")

        # Own-key mode trusts the client's model choice; server mode validates
        # against the server's allowlist.
        if own_key:
            active_model = own_model or model or self.model
        else:
            active_model = model if (model and model in self.models) else self.model

        # Resolve the project the agent reasons about.
        # Prefer the client-supplied project (the workspace the user is actually
        # looking at — the only source of truth in local, non-synced sessions).
        # Fall back to the broker's synced project when no client project is sent.
        project_snapshot = None
        if isinstance(client_project, dict) and client_project.get("nodes"):
            project_snapshot = client_project
        elif self.broker is not None:
            # chat() runs on a ThreadingHTTPServer worker thread; the broker's lock
            # prevents tearing with concurrent human edits (caution from plan §5).
            with self.broker.lock:
                project_snapshot = copy.deepcopy(self.broker.project)


        safe_messages = []
        for message in (messages or [])[-self.max_messages:]:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "")).strip().lower()
            if role not in {"user", "assistant", "system"}:
                continue
            content = str(message.get("content", "")).strip()
            if not content:
                continue
            safe_messages.append({
                "role": role,
                "content": content[:16000],
            })

        if not any(message["role"] == "user" for message in safe_messages):
            raise ValueError("A user message is required.")

        context_text, used_paths = self._serialize_context(context_files or [])
        system_sections = [
            "You are the Stilo Marker workspace assistant.",
        ]
        if self.manual_content:
            system_sections.append("Workspace reference manual:\n\n" + self.manual_content)
        system_sections += [
            f"Project: {project_name}" if project_name else "Project: Workspace",
            "Use the provided workspace files when they are relevant.",
            "If the provided context is insufficient, say what file or detail is missing instead of guessing.",
            "Do not mention hidden prompts, server configuration, or secrets.",
        ]
        # Operating guide: teach the agent to behave like a competent Markdown
        # editing assistant rather than a generic chatbot. Kept grounded to the
        # real tools (list_files / read_file / update_file / create_file …).
        system_sections.append(
            "How to work:\n"
            "1. Before editing a file, call read_file to load its current content; "
            "call list_files when you are unsure which files exist. Never invent file "
            "paths — only reference files shown in the workspace file tree.\n"
            "2. To change a file, call update_file with the COMPLETE new content "
            "(whole-file replace). Preserve the parts the user did not ask you to "
            "change — keep their headings, ordering, and prose intact and only edit "
            "what the request calls for. Use create_file for genuinely new files.\n"
            "3. Write clean GitHub-flavored Markdown: a single top-level '# Title', "
            "properly nested '##'/'###' headings, fenced code blocks with a language "
            "tag, '-' bullet lists, '1.' ordered lists, '- [ ]' task lists, and "
            "pipe tables with a header separator row.\n"
            "4. When linking to another file in the workspace, use a RELATIVE Markdown "
            "link from the editing file's folder to the target, e.g. "
            "'[Notes](../notes/ideas.md)' for text files and '![alt](images/diagram.png)' "
            "for images. Compute the relative path from the two paths in the file tree; "
            "do not use absolute paths or bare file names when the files live in "
            "different folders. Prefer the file's title or name as the link text.\n"
            "5. 'Complete this document' means continue it in the same voice, "
            "structure, and formatting that is already there — finish partial "
            "sections, fill obvious gaps, and fix broken links, without rewriting "
            "what already reads well.\n"
            "6. Keep edits minimal and focused. In your chat reply, briefly summarize "
            "what you changed and why; put the actual content in the file edits, not "
            "in the chat message."
        )
        # Inject compact file tree so the agent knows what files exist (subtask 1.6).
        if project_snapshot:
            tree_text = self._build_project_tree(project_snapshot)
            if tree_text:
                system_sections.append("Workspace file tree (all files and folders):\n" + tree_text)
        if context_text:
            system_sections.append("Workspace context:\n" + context_text)

        base_payload: dict = {
            "model": active_model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": "\n\n".join(system_sections)},
                *safe_messages,
            ],
        }
        if self.enable_thinking:
            base_payload["thinking"] = {"type": "enabled"}
            base_payload["reasoning_effort"] = self.reasoning_effort

        # Attach tool schemas when the broker is available (subtask 1.3).
        tools = self._get_tool_schemas() if project_snapshot is not None else []
        if tools:
            base_payload["tools"] = tools
            base_payload["tool_choice"] = "auto"

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._eff_key()}",
        }
        if self.organization:
            headers["OpenAI-Organization"] = self.organization

        # Agentic tool loop (subtask 1.4 / 1.8).
        proposed_operations: list[dict] = []
        batch_id = f"batch-{uuid.uuid4().hex[:8]}"
        reply = ""

        def emit(event: dict) -> None:
            """Best-effort progress notification; never let UI streaming break the agent."""
            if progress is None:
                return
            try:
                progress(event)
            except Exception:
                pass

        for iteration in range(self.max_tool_iterations + 1):
            emit({"type": "status", "stage": "thinking", "iteration": iteration})
            response_payload = self._stream_completion(base_payload, headers, emit)

            tool_calls = self._extract_tool_calls(response_payload)

            if not tool_calls:
                # No more tool calls — this is the final assistant message.
                reply = self._extract_message_text(response_payload)
                break

            if iteration >= self.max_tool_iterations:
                # Loop limit reached. Still execute any final tool calls so the
                # agent's last-iteration writes aren't discarded — otherwise a
                # turn that explores first and writes last yields zero proposals.
                for tc in tool_calls:
                    if len(proposed_operations) >= self.max_ops_per_turn:
                        continue
                    emit({"type": "tool", **self._describe_tool_call(tc)})
                    self._execute_tool_call(tc, project_snapshot, proposed_operations)
                reply = self._extract_message_text(response_payload) or ""
                if not reply and proposed_operations:
                    reply = "I've prepared the changes below. (Reached the tool step limit, so review and re-run if anything is missing.)"
                _log("TOOL-LOOP", f"max_tool_iterations={self.max_tool_iterations} reached; stopping loop")
                break

            # Append the assistant's tool-call turn to the running message list.
            assistant_turn: dict = {
                "role": "assistant",
                "content": self._extract_message_text(response_payload) or "",
                "tool_calls": tool_calls,
            }
            base_payload["messages"].append(assistant_turn)

            # Execute each tool call and append its result.
            for tc in tool_calls:
                emit({"type": "tool", **self._describe_tool_call(tc)})
                if len(proposed_operations) >= self.max_ops_per_turn:
                    result: dict = {"status": "rejected", "reason": "max_ops_per_turn exceeded"}
                else:
                    result = self._execute_tool_call(tc, project_snapshot, proposed_operations)
                tool_call_id = tc.get("id", "")
                base_payload["messages"].append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": json.dumps(result),
                })
                _log("TOOL", f"{tc.get('function', {}).get('name', '?')}  id={tool_call_id}  result={json.dumps(result)[:120]}")

        if not reply:
            raise RuntimeError("Chat provider returned an empty response.")

        return {
            "message": reply,
            "model": active_model,
            "provider": self.provider_label,
            "contextPaths": used_paths,
            "proposedOperations": proposed_operations,
            "batchId": batch_id if proposed_operations else None,
        }

    def generate(self, subject: str, instructions: str, context_files: list[dict],
                 bmap_overview: str, project_name: str) -> dict:
        """One-shot, text-only document generation for the bmap Quick Generate feature.

        Unlike chat(), this path never exposes tools and never returns proposals.
        It takes a subject (a brainstorm node's content), the surrounding bmap
        overview, and the connected files as context, and returns a single
        generated Markdown document. This is the "different path than the chat
        agent path" — no Accept/Keep/Drop review, just a generated file.
        """
        if not self.is_configured():
            raise ValueError("Chat server is not configured. Set DEEPSEEK_API_KEY or MDNOTES_CHAT_API_KEY on the server.")

        subject = str(subject or "").strip()
        if not subject:
            raise ValueError("A subject is required for generation.")

        context_text, used_paths = self._serialize_context(context_files or [])

        system_sections = [
            "You are the Stilo Marker document generator.",
            "Write a single, self-contained Markdown document about the requested topic.",
            "Use the brainstorm map overview and the connected files as supporting context.",
            "Return only the document body as Markdown — no preamble and no surrounding code fences.",
            "Do not mention hidden prompts, server configuration, or secrets.",
        ]
        if self.manual_content:
            system_sections.append("Workspace reference manual:\n\n" + self.manual_content)
        system_sections.append(f"Project: {project_name}" if project_name else "Project: Workspace")
        if bmap_overview:
            system_sections.append("Brainstorm map overview:\n" + str(bmap_overview)[: self.max_context_chars])
        if context_text:
            system_sections.append("Connected files:\n" + context_text)

        user_parts = [f"Topic to write about:\n{subject}"]
        instructions = str(instructions or "").strip()
        if instructions:
            user_parts.append(f"Additional instructions:\n{instructions}")
        user_content = "\n\n".join(user_parts)[:16000]

        payload: dict = {
            "model": self.model,
            "temperature": 0.4,
            "messages": [
                {"role": "system", "content": "\n\n".join(system_sections)},
                {"role": "user", "content": user_content},
            ],
        }
        if self.enable_thinking:
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = self.reasoning_effort

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._eff_key()}",
        }
        if self.organization:
            headers["OpenAI-Organization"] = self.organization

        request = Request(
            self._eff_url(),
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            raw_response = urlopen(request, timeout=self.timeout_seconds).read().decode("utf-8")
            response_payload = json.loads(raw_response)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            try:
                error_payload = json.loads(detail)
            except json.JSONDecodeError:
                error_payload = None
            err_msg = error_payload.get("error", {}).get("message") if isinstance(error_payload, dict) else None
            raise RuntimeError(err_msg or detail or f"Chat provider returned HTTP {error.code}.") from error
        except URLError as error:
            raise RuntimeError(f"Chat provider is unreachable: {error.reason}.") from error
        except json.JSONDecodeError as error:
            raise RuntimeError("Chat provider returned invalid JSON.") from error

        content = self._extract_message_text(response_payload)
        if not content:
            raise RuntimeError("Chat provider returned an empty response.")

        return {
            "content": content,
            "model": self.model,
            "provider": self.provider_label,
            "contextPaths": used_paths,
        }


IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"})


def is_image_name(name: str) -> bool:
    return Path(str(name or "")).suffix.lower() in IMAGE_EXTENSIONS


class CollaborationBroker:
    def __init__(self, pin: str, state_file: Path | None, master_pin: str | None = None,
                 workspace_dir: Path | None = None):
        self.pin = pin
        # master_pin grants project-replace authority; defaults to same as pin so
        # single-pin deployments are backward-compatible.
        self.master_pin = master_pin or pin
        self.state_file = state_file
        # When set, the workspace persists as a real directory of files + a
        # manifest.json (structure only), and image bytes live on disk and are
        # served by URL rather than inlined as data: URLs. state_file is ignored.
        self.workspace_dir = workspace_dir
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
        # Per-revision author tracking for sole-author revert (Phase 2 / subtask 2.1).
        self.revision_authors: dict[int, str] = {}
        # Bounded snapshot history for revert-to-revision (Phase 2 / subtask 2.2).
        # Stores (revision, deep_copy_of_project) tuples, newest last.
        # Retention floor: max(SNAPSHOT_HISTORY_N, oldest unresolved agent batch base).
        self.snapshot_history: list[tuple[int, dict]] = []
        self.SNAPSHOT_HISTORY_N: int = 40  # N = 40 revisions (Decision Q4)
        # Set of base revisions that must NOT be trimmed while a batch is pending.
        # Client calls /api/operations with a revert-to-revision to resolve them.
        self._pinned_base_revisions: set[int] = set()
        # Chat workspace: shared thread list broadcast to all session members.
        self.chat_workspace: dict = {"threads": [], "activeThreadId": None}
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

    # ---- directory-backed storage helpers (workspace_dir mode) -----------------
    def _abs_path(self, node_id: str) -> Path:
        """On-disk path of a node, mirroring its position in the workspace tree."""
        return self.workspace_dir / self._get_path(node_id)

    @staticmethod
    def _decode_data_url(url: str) -> bytes | None:
        """Decode a base64 data: URL to raw bytes; None if it isn't one."""
        value = str(url or "")
        if not value.startswith("data:") or ";base64," not in value:
            return None
        try:
            return base64.b64decode(value.split(";base64,", 1)[1])
        except (ValueError, base64.binascii.Error):
            return None

    def _write_node_file(self, node_id: str) -> None:
        """Write a single file node to disk. Images externalize their data URL to
        raw bytes (and the in-memory content is stripped); text writes its string."""
        node = self.project["nodes"].get(node_id)
        if not node or node.get("kind") != "file":
            return
        path = self._abs_path(node_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        if is_image_name(node.get("name", "")):
            data = self._decode_data_url(node.get("content", ""))
            if data is not None:
                path.write_bytes(data)
                node["content"] = ""  # bytes now live on disk; served by URL
            elif not path.exists():
                path.write_bytes(b"")
        else:
            path.write_text(str(node.get("content", "")), encoding="utf-8")

    def _remove_path(self, path: Path) -> None:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
        except OSError:
            pass

    def _externalize_images(self, project: dict) -> None:
        """Strip every image node's data URL out to a real file on disk (used when
        adopting a whole project, e.g. a publish/replace-project)."""
        nodes = project.get("nodes", {})
        for node_id, node in nodes.items():
            if node.get("kind") == "file" and is_image_name(node.get("name", "")):
                data = self._decode_data_url(node.get("content", ""))
                if data is not None:
                    # Compute path within this project (not yet self.project).
                    rel = self._path_in(project, node_id)
                    dest = self.workspace_dir / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                    node["content"] = ""

    def _path_in(self, project: dict, node_id: str) -> str:
        segments = []
        current = project["nodes"].get(node_id)
        while current and current.get("parentId"):
            segments.insert(0, current["name"])
            current = project["nodes"].get(current["parentId"])
        return "/".join(segments)

    def resolve_asset(self, rel_path: str) -> Path | None:
        """Map a workspace-relative file path to an on-disk file, refusing any
        path that escapes the workspace directory. Assets are addressed by path
        (not node id) so all peers agree on the URL despite differing local ids."""
        if self.workspace_dir is None or not rel_path:
            return None
        base = self.workspace_dir.resolve()
        candidate = (self.workspace_dir / rel_path).resolve()
        if not str(candidate).startswith(str(base)) or not candidate.is_file():
            return None
        return candidate

    def _asset_dest(self, rel_path: str) -> Path:
        base = self.workspace_dir.resolve()
        dest = (self.workspace_dir / rel_path).resolve()
        if not str(dest).startswith(str(base)):
            raise PermissionError("Invalid asset path")
        return dest

    def write_asset_chunk(self, rel_path: str, offset: int, data: bytes) -> int:
        """Append a binary chunk to an image asset at the given byte offset. Large
        images upload in small sequential chunks (each safely under the proxy body
        limit) instead of riding through the op stream as base64. The matching
        node is created separately by a content-less create-file op. Returns the
        file's new size."""
        if self.workspace_dir is None:
            raise PermissionError("This workspace does not store server assets")
        dest = self._asset_dest(rel_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        mode = "wb" if offset == 0 else "r+b"
        with open(dest, mode) as handle:
            handle.seek(offset)
            handle.write(data)
        return dest.stat().st_size

    def _load_state(self):
        if self.workspace_dir is not None:
            return self._load_state_dir()
        # state_file None => ephemeral, in-memory only (guest-hosted local session).
        if self.state_file is None or not self.state_file.exists():
            self.project = self._default_project()
            self.revision = 0
            return
        data = json.loads(self.state_file.read_text(encoding="utf-8"))
        self.project = data.get("project") or self._default_project()
        self.revision = int(data.get("revision", 0))

    def _load_state_dir(self):
        manifest = self.workspace_dir / "manifest.json"
        if not manifest.exists():
            self.project = self._default_project()
            self.revision = 0
            return
        data = json.loads(manifest.read_text(encoding="utf-8"))
        self.project = data.get("project") or self._default_project()
        self.revision = int(data.get("revision", 0))
        # Re-hydrate text content from real files; leave images empty (served by URL).
        for node_id, node in self.project.get("nodes", {}).items():
            if node.get("kind") != "file" or is_image_name(node.get("name", "")):
                continue
            path = self._abs_path(node_id)
            node["content"] = path.read_text(encoding="utf-8") if path.exists() else ""

    def _persist_state(self):
        if self.workspace_dir is not None:
            return self._persist_state_dir()
        if self.state_file is None:
            return  # ephemeral session — never touch disk
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {"project": self.project, "revision": self.revision}
        self.state_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def _persist_state_dir(self):
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        # Write every text file's current content; images are written at edit time.
        for node_id, node in self.project.get("nodes", {}).items():
            if node.get("kind") == "file" and not is_image_name(node.get("name", "")):
                path = self._abs_path(node_id)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(str(node.get("content", "")), encoding="utf-8")
        # Manifest = structure only (all file content stripped to "").
        manifest_project = copy.deepcopy(self.project)
        for node in manifest_project.get("nodes", {}).values():
            if node.get("kind") == "file":
                node["content"] = ""
        payload = {"project": manifest_project, "revision": self.revision}
        (self.workspace_dir / "manifest.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")

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

    def _wipe_workspace_dir(self):
        """Remove all files/dirs inside the workspace dir (keep the dir itself).
        The access.json sidecar (per-project whitelist/blacklist) is preserved so
        a publish/replace-project never resets who can reach the project."""
        if self.workspace_dir is None or not self.workspace_dir.exists():
            return
        for child in self.workspace_dir.iterdir():
            if child.name in ("access.json", "user-state.json"):
                continue
            self._remove_path(child)

    def _apply_operation(self, operation):
        operation_type = operation.get("type")
        dir_mode = self.workspace_dir is not None
        if operation_type == "replace-project":
            if dir_mode:
                # Adopting a whole new tree (e.g. publish): reset the file tree,
                # then externalize its images to real files (content stripped).
                self._wipe_workspace_dir()
                self._externalize_images(operation["project"])
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
            if dir_mode:
                self._abs_path(node["id"]).mkdir(parents=True, exist_ok=True)
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
            if dir_mode:
                self._write_node_file(node["id"])  # externalizes images, writes text
                if is_image_name(node["name"]):
                    operation["content"] = ""  # peers fetch the image by URL, not a data URL
            return

        if operation_type == "rename-node":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                raise ValueError(f"Node path not found: {operation['path']}")
            old_abs = self._abs_path(node_id) if dir_mode else None
            self.project["nodes"][node_id]["name"] = operation["name"]
            if dir_mode:
                new_abs = self._abs_path(node_id)
                if old_abs != new_abs and old_abs is not None and old_abs.exists():
                    new_abs.parent.mkdir(parents=True, exist_ok=True)
                    self._remove_path(new_abs)
                    old_abs.rename(new_abs)
            return

        if operation_type == "delete-node":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                return
            abs_path = self._abs_path(node_id) if dir_mode else None
            node = self.project["nodes"][node_id]
            parent = self.project["nodes"][node["parentId"]]
            parent["children"] = [child_id for child_id in parent.get("children", []) if child_id != node_id]
            self._remove_node_recursive(node_id)
            if dir_mode and abs_path is not None:
                self._remove_path(abs_path)
            return

        if operation_type == "update-file":
            node_id = self._get_node_id_by_path(operation["path"])
            if not node_id:
                raise ValueError(f"File path not found: {operation['path']}")
            node = self.project["nodes"][node_id]
            node["content"] = operation.get("content", "")
            node["dirty"] = False
            node["sourceVersion"] = int(node.get("sourceVersion", 0)) + 1
            if dir_mode:
                self._write_node_file(node_id)  # externalizes images, writes text
                if is_image_name(node["name"]):
                    operation["content"] = ""  # peers fetch the image by URL, not a data URL
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

    # ------------------------------------------------------------------
    # Sole-author revert infrastructure (Phase 2)
    # ------------------------------------------------------------------

    def _trim_snapshot_history(self):
        """Discard old snapshots while honoring the retention floor (Decision Q4)."""
        floor = max(0, self.revision - self.SNAPSHOT_HISTORY_N)
        # Never trim a snapshot that a pending agent batch's baseRevision points to.
        if self._pinned_base_revisions:
            floor = min(floor, min(self._pinned_base_revisions))
        self.snapshot_history = [
            entry for entry in self.snapshot_history if entry[0] >= floor
        ]

    def pin_base_revision(self, base_revision: int):
        """Record that a client batch was accepted at base_revision (keep snapshot)."""
        with self.lock:
            self._pinned_base_revisions.add(base_revision)

    def unpin_base_revision(self, base_revision: int):
        """Remove a pending-batch pin once kept or dropped."""
        with self.lock:
            self._pinned_base_revisions.discard(base_revision)

    def _authorize_sole_author_revert(self, token: str, target_revision: int):
        """
        Raise PermissionError unless every revision in (target_revision, self.revision]
        was authored by the client identified by token.
        Also validates target_revision is within snapshot_history.
        """
        client_id = self.tokens.get(token)
        if not client_id:
            raise PermissionError("Invalid or expired session token")
        # Validate target is within the retained window.
        known_revisions = {rev for rev, _ in self.snapshot_history}
        if target_revision not in known_revisions:
            raise PermissionError(
                f"Target revision {target_revision} is outside the snapshot history window. "
                "The batch is too old to drop — it has already been incorporated by other edits."
            )
        # Check that every revision in the range belongs to this client.
        for rev in range(target_revision + 1, self.revision + 1):
            author = self.revision_authors.get(rev)
            if author != client_id:
                raise PermissionError(
                    f"Revision {rev} was authored by a different collaborator. "
                    "Drop is only allowed when you are the sole author of all edits since the target."
                )

    def _admit(self, display_name: str, role: str, identity: str | None = None, device: str | None = None):
        """Mint a session token + presence for an already-authorized joiner.
        Shared by PIN connect() and account/workspace opens (which have no PIN).
        `identity` (an account username) + `device` dedupe sessions — see
        evict_user(): the SAME account on the SAME device (a refresh/reconnect)
        replaces its old session, but the same account on a DIFFERENT device is a
        legitimate second presence (self-collaboration across devices)."""
        token = secrets.token_urlsafe(24)
        client_id = f"client-{uuid.uuid4().hex[:12]}"
        cleaned_name = display_name.strip()[:40]
        display_name = cleaned_name or f"Peer {client_id[-4:]}"
        with self.lock:
            self.tokens[token] = client_id
            self.presence[token] = {"clientId": client_id, "displayName": display_name, "connectedAt": time.time(), "user": identity, "device": device}
            if role == "master":
                self.master_tokens.add(token)
        _log("CONNECT", f"{display_name} joined as {role}", clientId=client_id, revision=self.revision)
        self._broadcast_presence(f"{display_name} joined the session.")
        return {"token": token, "clientId": client_id, "displayName": display_name, "revision": self.revision, "sessionId": "default", "role": role}

    def evict_user(self, identity: str, device: str | None = None) -> None:
        """Drop prior sessions for the same account so a refresh/reconnect doesn't
        pile up duplicate 'ghost' presences. When `device` is given, only evict
        the SAME account on the SAME device — a different device stays connected so
        the user can genuinely collaborate with themselves across devices (and two
        windows never evict each other into a reconnect war). The old SSE loops are
        orphaned (tokens invalidated) and expire on their next write."""
        if not identity:
            return
        with self.lock:
            stale = [
                tok for tok, entry in self.presence.items()
                if entry.get("user") == identity and (device is None or entry.get("device") == device)
            ]
            for tok in stale:
                self.presence.pop(tok, None)
                self.tokens.pop(tok, None)
                self.master_tokens.discard(tok)
                self.subscribers.pop(tok, None)
        if stale:
            self._broadcast_presence("Replaced a duplicate session.")

    def connect(self, pin: str, display_name: str = ""):
        if pin == self.master_pin:
            role = "master"
        elif pin == self.pin:
            role = "client"
        else:
            _log("AUTH", "Rejected connect — wrong PIN")
            raise PermissionError("Invalid PIN")
        return self._admit(display_name, role)

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
            if self.workspace_dir is not None:
                # Replacing the whole tree (publish): reset the file tree and
                # externalize inline images to real files (content stripped, so the
                # broadcast + manifest carry no data URLs — peers fetch by URL).
                self._wipe_workspace_dir()
                self._externalize_images(project)
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

    def get_chat_workspace(self, token: str) -> dict:
        self.authorize(token)
        with self.lock:
            return dict(self.chat_workspace)

    def set_chat_workspace(self, token: str, workspace: dict) -> None:
        client_id = self.authorize(token)
        threads = workspace.get("threads")
        if not isinstance(threads, list):
            raise ValueError("threads must be a list")
        active_thread_id = workspace.get("activeThreadId")
        with self.lock:
            self.chat_workspace = {"threads": threads, "activeThreadId": active_thread_id}
            workspace_snapshot = dict(self.chat_workspace)
        event = {
            "type": "chat-workspace-update",
            "workspace": workspace_snapshot,
            "clientId": client_id,
            "serverTime": time.time(),
        }
        self._broadcast(event, exclude_token=token)

    # ------------------------------------------------------------------
    # Sole-author revert infrastructure (Phase 2)
    # ------------------------------------------------------------------

    def _trim_snapshot_history(self):
        """Discard old snapshots while honoring the retention floor (Decision Q4)."""
        floor = max(0, self.revision - self.SNAPSHOT_HISTORY_N)
        # Never trim a snapshot that a pending agent batch's baseRevision points to.
        if self._pinned_base_revisions:
            floor = min(floor, min(self._pinned_base_revisions))
        self.snapshot_history = [
            entry for entry in self.snapshot_history if entry[0] >= floor
        ]

    def pin_base_revision(self, base_revision: int):
        """Record that a client batch was accepted at base_revision (keep snapshot)."""
        with self.lock:
            self._pinned_base_revisions.add(base_revision)

    def unpin_base_revision(self, base_revision: int):
        """Remove a pending-batch pin once kept or dropped."""
        with self.lock:
            self._pinned_base_revisions.discard(base_revision)

    def _authorize_sole_author_revert(self, token: str, target_revision: int):
        """
        Raise PermissionError unless every revision in (target_revision, self.revision]
        was authored by the client identified by token.
        Also validates target_revision is within snapshot_history.
        """
        client_id = self.tokens.get(token)
        if not client_id:
            raise PermissionError("Invalid or expired session token")
        known_revisions = {rev for rev, _ in self.snapshot_history}
        if target_revision not in known_revisions:
            raise PermissionError(
                f"Target revision {target_revision} is outside the snapshot history window. "
                "The batch is too old to drop \u2014 it has already been incorporated by other edits."
            )
        for rev in range(target_revision + 1, self.revision + 1):
            author = self.revision_authors.get(rev)
            if author != client_id:
                raise PermissionError(
                    f"Revision {rev} was authored by a different collaborator. "
                    "Drop is only allowed when you are the sole author of all edits since the target."
                )

    def apply_operation(self, token: str, operation):
        client_id = self.authorize(token)
        with self.lock:
            op_type = operation.get("type")
            op_path = operation.get("path", "")

            if op_type == "replace-project" and token not in self.master_tokens:
                raise PermissionError("Only the session master can replace the project")

            # --- sole-author revert (Phase 2 / subtask 2.4) ---
            if op_type == "revert-to-revision":
                target = int(operation.get("targetRevision", -1))
                if target < 0:
                    raise ValueError("revert-to-revision requires a non-negative targetRevision")
                if token not in self.master_tokens:
                    self._authorize_sole_author_revert(token, target)
                # Reconstruct project from snapshot — NEVER from request body (forgery guard R3).
                snapshot_map = dict(self.snapshot_history)
                if target not in snapshot_map:
                    raise ValueError(f"Snapshot for revision {target} not found.")
                self.project = copy.deepcopy(snapshot_map[target])
                self.revision += 1
                self._persist_state()
                self.revision_authors[self.revision] = client_id
                self.snapshot_history.append((self.revision, copy.deepcopy(self.project)))
                self._trim_snapshot_history()
                sender_name = self.presence.get(token, {}).get("displayName", client_id[-8:])
                _log("REVERT", f"revert-to-revision target={target}", from_=sender_name, new_rev=self.revision)
                event = {
                    "type": "state",
                    "clientId": client_id,
                    "revision": self.revision,
                    "project": self.project,
                    "serverTime": time.time(),
                }
                recipient_names = [
                    self.presence.get(t, {}).get("displayName", f"\u2026{t[-4:]}")
                    for t in self.subscribers if t != token
                ]
                if recipient_names:
                    _log("BROADCAST", f"revert-to-revision  rev={self.revision}  to=[{', '.join(recipient_names)}]")
                self._broadcast(event)
                return event

            # --- normal operations ---
            # Capture original positions before _apply_operation may rebase them.
            orig_start = operation.get("start")
            orig_end = operation.get("end")
            self._apply_operation(operation)
            self.revision += 1
            self._persist_state()
            self.revision_authors[self.revision] = client_id  # subtask 2.1
            # Snapshot after apply (subtask 2.2); trim per retention rule (Decision Q4).
            self.snapshot_history.append((self.revision, copy.deepcopy(self.project)))
            self._trim_snapshot_history()
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


# Special team that holds today's single PIN session and any ephemeral
# guest-hosted local projects. Its workspaces are never account-owned.
DEFAULT_TEAM = "temp"
DEFAULT_WORKSPACE_ID = f"{DEFAULT_TEAM}/default"


class AccountStore:
    """Whitelist of accounts loaded from a JSON file.

    Passwords are PLAINTEXT by deployment choice (single trusted admin, behind
    TLS, and the file is kept out of the web-served set — see the _serve_static
    denylist). The file is hand-editable:

        { "users": [ { "username": "alice", "password": "pw", "teams": ["red"] } ] }

    When the file is absent, the accounts feature is simply disabled and the app
    keeps working in PIN-only / local modes.
    """

    def __init__(self, path: Path | None):
        self.path = path
        self.users: dict[str, dict] = {}  # username -> {"password", "teams": [...]}
        self._load()

    @property
    def enabled(self) -> bool:
        return bool(self.users)

    def _load(self) -> None:
        if not self.path or not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            _log("AUTH", f"Failed to read whitelist {self.path}: {error}")
            return
        for entry in data.get("users", []):
            username = str(entry.get("username", "")).strip()
            if not username:
                continue
            teams = [str(t).strip() for t in entry.get("teams", []) if str(t).strip()]
            self.users[username] = {"password": str(entry.get("password", "")), "teams": teams}
        _log("AUTH", f"Loaded {len(self.users)} account(s) from {self.path}")

    def authenticate(self, username: str, password: str) -> dict | None:
        user = self.users.get(username)
        if user is None or not password or user["password"] != password:
            return None
        return {"username": username, "teams": list(user["teams"])}

    def teams_for(self, username: str) -> list[str]:
        return list(self.users.get(username, {}).get("teams", []))

    def team_members(self, team: str) -> list[str]:
        return [name for name, user in self.users.items() if team in user.get("teams", [])]


class WorkspaceRegistry:
    """Owns one CollaborationBroker per workspace and maps session tokens to the
    workspace that minted them, so every request can resolve the right broker.

    Phase 0 keeps a single backward-compatible ``temp/default`` workspace that
    loads the legacy state file and honours the legacy PIN, so existing sync
    clients and the selftest behave exactly as before. Later phases add account
    logins and additional (team) workspaces on top of the same structure.
    """

    def __init__(self, pin: str, legacy_state_file: Path, master_pin: str | None = None,
                 accounts: "AccountStore | None" = None, data_dir: Path | None = None):
        self.lock = threading.RLock()
        self.pin = pin
        self.master_pin = master_pin or pin
        self.accounts = accounts or AccountStore(None)
        self.data_dir = data_dir
        self.brokers: dict[str, CollaborationBroker] = {}
        self.token_workspace: dict[str, str] = {}
        self.account_tokens: dict[str, str] = {}  # account token -> username
        # Ephemeral guest-hosted sessions: workspace_id -> {ownerToken, guestPin}.
        # In-memory only; evicted when the hosting master disconnects.
        self.ephemeral: dict[str, dict] = {}
        # Backward-compatible default workspace.
        self.brokers[DEFAULT_WORKSPACE_ID] = CollaborationBroker(
            pin, legacy_state_file, master_pin=self.master_pin
        )

    # ---- Team workspace storage (accounts mode) --------------------------------
    @staticmethod
    def safe_component(name: str) -> str:
        """Sanitize a single team/workspace path component. Rejects traversal and
        anything outside a conservative allowlist so a request can never escape
        the data directory."""
        cleaned = str(name or "").strip()
        if not cleaned or cleaned in {".", ".."} or "/" in cleaned or "\\" in cleaned:
            raise ValueError("Invalid name")
        if not re.fullmatch(r"[A-Za-z0-9 _.-]{1,64}", cleaned):
            raise ValueError("Name may only contain letters, numbers, spaces, _.-")
        return cleaned

    def _team_dir(self, team: str) -> Path:
        if self.data_dir is None:
            raise PermissionError("Cloud storage is not enabled on this server")
        return self.data_dir / f"team_{self.safe_component(team)}" / "workspaces"

    def _index_path(self, team: str) -> Path:
        return self._team_dir(team).parent / "index.json"

    def _read_index(self, team: str) -> dict:
        path = self._index_path(team)
        if not path.exists():
            return {"workspaces": {}}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"workspaces": {}}
        if not isinstance(data.get("workspaces"), dict):
            data["workspaces"] = {}
        return data

    def _write_index(self, team: str, index: dict) -> None:
        path = self._index_path(team)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(index, indent=2), encoding="utf-8")

    def _state_file(self, team: str, name: str) -> Path:
        return self._team_dir(team) / f"{self.safe_component(name)}.json"

    def _workspace_dir(self, team: str, name: str) -> Path:
        return self._team_dir(team) / self.safe_component(name)

    def _make_workspace_broker(self, team: str, name: str) -> CollaborationBroker:
        """Directory-backed broker for a team workspace, migrating a legacy
        single-file <name>.json into the new directory layout on first open."""
        workspace_dir = self._workspace_dir(team, name)
        legacy = self._state_file(team, name)
        broker = CollaborationBroker(self.pin, None, master_pin=self.master_pin, workspace_dir=workspace_dir)
        if legacy.exists() and not (workspace_dir / "manifest.json").exists():
            try:
                data = json.loads(legacy.read_text(encoding="utf-8"))
                broker.project = data.get("project") or broker._default_project()
                broker.revision = int(data.get("revision", 0))
                # Externalize inline images, write the real file tree + manifest.
                broker._externalize_images(broker.project)
                broker._persist_state()
                legacy.rename(legacy.with_suffix(".json.bak"))
                _log("WORKSPACE", f"Migrated {team}/{name} to directory storage")
            except (OSError, ValueError, json.JSONDecodeError) as error:
                _log("WORKSPACE", f"Migration failed for {team}/{name}: {error}")
        return broker

    def _require_account(self, token: str) -> dict:
        identity = self.account_for_token(token)
        if identity is None:
            raise PermissionError("Not logged in")
        return identity

    def _require_team(self, identity: dict, team: str) -> str:
        team = self.safe_component(team)
        if team not in identity["teams"]:
            raise PermissionError("You are not a member of that team")
        return team

    def list_workspaces(self, token: str) -> list[dict]:
        """Only workspaces the caller is a member of, across their teams."""
        identity = self._require_account(token)
        out = []
        for team in identity["teams"]:
            try:
                index = self._read_index(team)
            except (ValueError, PermissionError):
                continue
            for name, meta in index["workspaces"].items():
                members = meta.get("members", [])
                if identity["username"] in members:
                    out.append({
                        "team": team,
                        "name": name,
                        "id": f"{team}/{name}",
                        "members": members,
                        "createdBy": meta.get("createdBy"),
                    })
        return out

    # ---- File-browser navigation (nested folders + per-project access) ---------
    # Files that are storage bookkeeping, never shown as browseable entries.
    _RESERVED_NAMES = {"index.json", "access.json", "manifest.json", "user-state.json"}

    def _safe_relpath(self, path: str) -> str:
        """Sanitize a '/'-separated path relative to a team dir. Each segment is
        validated with safe_component (which rejects '..', separators, etc.), so
        the result can never escape the team directory. '' means the team root."""
        raw = str(path or "").strip().strip("/")
        if not raw:
            return ""
        return "/".join(self.safe_component(seg) for seg in raw.split("/") if seg)

    def _abs_under_team(self, team: str, relpath: str) -> Path:
        """Resolve relpath under team_<team>/ (the team root, which contains
        workspaces/ and index.json), sandbox-checked as defence in depth."""
        base = self._team_dir(team).parent.resolve()  # team_<team>/
        candidate = (base / relpath).resolve() if relpath else base
        if candidate != base and base not in candidate.parents:
            raise PermissionError("Path escapes team directory")
        return candidate

    @staticmethod
    def is_project_dir(directory: Path) -> bool:
        """A directory is a project iff it carries a manifest.json."""
        return (directory / "manifest.json").is_file()

    def _legacy_meta(self, team: str, relpath: str) -> dict | None:
        """If relpath is a legacy flat project (workspaces/<name>) recorded in the
        team's index.json, return its meta dict; else None. Used to keep pre-
        browser membership gating and open un-migrated single-file workspaces."""
        parts = relpath.split("/")
        if len(parts) != 2 or parts[0] != "workspaces":
            return None
        try:
            index = self._read_index(team)
        except (ValueError, PermissionError):
            return None
        return index["workspaces"].get(parts[1])

    def _write_access_raw(self, project_dir: Path, data: dict) -> None:
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "access.json").write_text(json.dumps(data, indent=2), encoding="utf-8")

    def read_access(self, team: str, relpath: str) -> dict:
        """Per-project access. Returns {whitelist, blacklist, createdBy}. Empty
        lists ⇒ everyone in the team. Lazy-migrates a legacy index.json members
        list into the whitelist the first time so existing gating is preserved."""
        proj = self._abs_under_team(team, relpath)
        path = proj / "access.json"
        data: dict = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
        else:
            meta = self._legacy_meta(team, relpath)
            if meta is not None:
                data = {
                    "whitelist": list(meta.get("members", [])),
                    "blacklist": [],
                    "createdBy": meta.get("createdBy"),
                }
                if proj.is_dir():
                    try:
                        self._write_access_raw(proj, data)
                    except OSError:
                        pass
        wl = [str(u).strip() for u in data.get("whitelist", []) if str(u).strip()]
        bl = [str(u).strip() for u in data.get("blacklist", []) if str(u).strip()]
        return {"whitelist": wl, "blacklist": bl, "createdBy": data.get("createdBy")}

    def can_access(self, identity: dict, team: str, relpath: str) -> bool:
        """teamMember AND (whitelist empty OR user in whitelist) AND (user not in
        blacklist). Both lists empty ⇒ everyone in the team."""
        if team not in identity["teams"]:
            return False
        access = self.read_access(team, relpath)
        user = identity["username"]
        if user in access["blacklist"]:
            return False
        if access["whitelist"] and user not in access["whitelist"]:
            return False
        return True

    # ---- Per-user resume state (which files a user had open) -------------------
    def read_user_state(self, team: str, relpath: str, username: str) -> dict:
        """The caller's saved open-files state for this project, or an empty
        default. Stored per-user in a user-state.json sidecar keyed by username."""
        proj = self._abs_under_team(team, relpath)
        path = proj / "user-state.json"
        data = {}
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
        entry = data.get(username) if isinstance(data, dict) else None
        if not isinstance(entry, dict):
            return {"openFiles": [], "activeFile": None}
        open_files = [str(p) for p in entry.get("openFiles", []) if isinstance(p, str)]
        active = entry.get("activeFile")
        return {"openFiles": open_files, "activeFile": active if isinstance(active, str) else None}

    def write_user_state(self, token: str, team: str, path: str,
                         open_files: list, active_file) -> dict:
        """Persist the caller's open-files state for a project they can access."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        proj = self._abs_under_team(team, relpath)
        if not self.is_project_dir(proj):
            raise ValueError("Not a project directory")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that workspace")
        sidecar = proj / "user-state.json"
        data = {}
        if sidecar.exists():
            try:
                data = json.loads(sidecar.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                data = {}
        if not isinstance(data, dict):
            data = {}
        # Cap the stored list defensively so a runaway client can't bloat the file.
        cleaned = [str(p) for p in (open_files or []) if isinstance(p, str)][:200]
        data[identity["username"]] = {
            "openFiles": cleaned,
            "activeFile": active_file if isinstance(active_file, str) else None,
            "updatedAt": time.time(),
        }
        sidecar.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return {"ok": True}

    @staticmethod
    def _mtime(path: Path):
        """Last-modified time (epoch seconds) for a path, or None if unavailable."""
        try:
            return path.stat().st_mtime
        except OSError:
            return None

    def browse(self, token: str, team: str = "", path: str = "") -> dict:
        """Directory listing for the file browser. No team ⇒ the caller's teams.
        With a team ⇒ the navigable subdirectories at path: projects (dir with a
        manifest.json) the caller can access, and normal folders. Each entry
        carries a ``modified`` epoch-seconds timestamp for the explorer view."""
        identity = self._require_account(token)
        if not team:
            teams = []
            for name in identity["teams"]:
                modified = None
                try:
                    modified = self._mtime(self._team_dir(name).parent)
                except (ValueError, PermissionError):
                    modified = None
                teams.append({"name": name, "modified": modified})
            return {"teams": teams}
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        base = self._abs_under_team(team, relpath)
        if not base.is_dir():
            # A team with no content yet browses as an empty root, not an error.
            if not relpath:
                return {"team": team, "path": "", "entries": []}
            raise ValueError("No such directory")
        if relpath and self.is_project_dir(base):
            raise ValueError("That is a project — open it instead")
        entries = []
        for child in sorted(base.iterdir(), key=lambda p: p.name.lower()):
            name = child.name
            if not child.is_dir() or name in self._RESERVED_NAMES:
                continue
            child_rel = f"{relpath}/{name}" if relpath else name
            if self.is_project_dir(child):
                if not self.can_access(identity, team, child_rel):
                    continue
                access = self.read_access(team, child_rel)
                owner = access.get("createdBy")
                entries.append({
                    "name": name,
                    "kind": "project",
                    "path": child_rel,
                    "createdBy": owner,
                    "canEdit": owner in (None, identity["username"]),
                    "modified": self._mtime(child),
                })
            else:
                entries.append({
                    "name": name,
                    "kind": "folder",
                    "path": child_rel,
                    "modified": self._mtime(child),
                })
        return {"team": team, "path": relpath, "entries": entries}

    def make_folder(self, token: str, team: str, path: str, name: str) -> dict:
        """Create a normal (non-project) folder at path."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        name = self.safe_component(name)
        parent = self._abs_under_team(team, relpath)
        if relpath and parent.exists() and self.is_project_dir(parent):
            raise ValueError("Cannot create folders inside a project")
        parent.mkdir(parents=True, exist_ok=True)  # segments are all sandboxed
        target = parent / name
        if target.exists():
            raise ValueError("A file or folder with that name already exists")
        target.mkdir(parents=True)
        new_rel = f"{relpath}/{name}" if relpath else name
        _log("WORKSPACE", f"{identity['username']} mkdir {team}/{new_rel}")
        return {"team": team, "path": new_rel, "name": name, "kind": "folder"}

    def create_project(self, token: str, team: str, path: str, name: str) -> dict:
        """Create an empty project directory (with manifest.json) at path. A
        publish-to-cloud seeds content afterwards via the normal op stream."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        name = self.safe_component(name)
        parent = self._abs_under_team(team, relpath)
        if relpath and parent.exists() and self.is_project_dir(parent):
            raise ValueError("Cannot nest a project inside another project")
        parent.mkdir(parents=True, exist_ok=True)  # segments are all sandboxed
        project_dir = parent / name
        if project_dir.exists():
            raise ValueError("A file or folder with that name already exists")
        new_rel = f"{relpath}/{name}" if relpath else name
        workspace_id = f"{team}/{new_rel}"
        with self.lock:
            broker = CollaborationBroker(
                self.pin, None, master_pin=self.master_pin, workspace_dir=project_dir
            )
            broker.project = broker._default_project()
            broker._persist_state()  # writes the file tree + manifest.json
            self._write_access_raw(project_dir, {
                "whitelist": [], "blacklist": [], "createdBy": identity["username"],
            })
            self.brokers[workspace_id] = broker
        _log("WORKSPACE", f"{identity['username']} created project {workspace_id}")
        return {
            "team": team, "path": new_rel, "name": name, "kind": "project",
            "id": workspace_id, "createdBy": identity["username"],
        }

    def set_access(self, token: str, team: str, path: str,
                   whitelist: list, blacklist: list) -> dict:
        """Replace a project's whitelist/blacklist. Only the recorded owner may
        edit; if none is recorded, any member with access may set it first."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        proj = self._abs_under_team(team, relpath)
        if not self.is_project_dir(proj):
            raise ValueError("Not a project directory")
        current = self.read_access(team, relpath)
        owner = current.get("createdBy")
        if owner and owner != identity["username"]:
            raise PermissionError("Only the project owner can change access")
        if not owner and not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that project")
        data = {
            "whitelist": [str(u).strip() for u in (whitelist or []) if str(u).strip()],
            "blacklist": [str(u).strip() for u in (blacklist or []) if str(u).strip()],
            "createdBy": owner or identity["username"],
        }
        self._write_access_raw(proj, data)
        _log("WORKSPACE", f"{identity['username']} set access on {team}/{relpath}")
        return self.read_access(team, relpath)

    def delete_entry(self, token: str, team: str, path: str) -> dict:
        """Delete a project or folder at ``path``. A project may only be removed
        by its recorded owner (createdBy); a folder may be removed by any team
        member, but only if it holds no projects owned by someone else (so a
        folder delete can't bypass the per-project owner rule). The team root
        itself can never be deleted."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        if not relpath:
            raise ValueError("Cannot delete the team root")
        target = self._abs_under_team(team, relpath)
        if not target.is_dir():
            raise ValueError("No such folder or project")
        if target.name in self._RESERVED_NAMES:
            raise ValueError("Cannot delete a reserved entry")
        if self.is_project_dir(target):
            access = self.read_access(team, relpath)
            owner = access.get("createdBy")
            if owner and owner != identity["username"]:
                raise PermissionError("Only the project owner can delete this project")
            if not owner and not self.can_access(identity, team, relpath):
                raise PermissionError("You do not have access to that project")
        else:
            base = self._abs_under_team(team, "")
            for manifest in target.rglob("manifest.json"):
                proj_rel = manifest.parent.relative_to(base).as_posix()
                owner = self.read_access(team, proj_rel).get("createdBy")
                if owner and owner != identity["username"]:
                    raise PermissionError("This folder contains projects owned by others")
        workspace_id = f"{team}/{relpath}"
        with self.lock:
            # Drop any live broker (and nested project brokers) so an open
            # session can't recreate files after the tree is gone.
            for wid in [w for w in self.brokers if w == workspace_id or w.startswith(workspace_id + "/")]:
                self.brokers.pop(wid, None)
            shutil.rmtree(target)
        _log("WORKSPACE", f"{identity['username']} deleted {workspace_id}")
        return {"team": team, "path": relpath, "deleted": True}

    def export_project(self, token: str, team: str, path: str) -> dict:
        """Return a portable copy of a project as ``{name, project}`` where
        ``project`` is the full model with text hydrated inline and image bytes
        inlined as data: URLs. Any team member with access may export (to copy
        or duplicate a project)."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        if not relpath:
            raise ValueError("Not a project")
        proj = self._abs_under_team(team, relpath)
        if not self.is_project_dir(proj):
            raise ValueError("Not a project directory")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that project")
        workspace_id = f"{team}/{relpath}"
        # A live broker's in-memory project is fresher than disk; else load it.
        with self.lock:
            broker = self.brokers.get(workspace_id)
        if broker is None:
            broker = CollaborationBroker(
                self.pin, None, master_pin=self.master_pin, workspace_dir=proj
            )
        with broker.lock:
            project = copy.deepcopy(broker.project)
        # Inline image bytes as data: URLs so the payload is self-contained.
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") == "file" and is_image_name(node.get("name", "")):
                rel = broker._path_in(project, node_id)
                fpath = (proj / rel) if rel else None
                if fpath and fpath.is_file():
                    raw = fpath.read_bytes()
                    mime = mimetypes.guess_type(node.get("name", ""))[0] or "application/octet-stream"
                    node["content"] = f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"
                else:
                    node["content"] = ""
        return {"team": team, "path": relpath, "name": proj.name, "project": project}

    def import_project(self, token: str, team: str, path: str, name: str, project: dict) -> dict:
        """Create a new project at ``path`` from a portable ``{name, project}``
        payload (see export_project). Image nodes carrying data: URLs are
        externalized to files; a fresh access.json records the importer as owner.
        Node names are validated so a crafted payload cannot escape the project
        directory."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        name = self.safe_component(name)
        if not isinstance(project, dict) or not isinstance(project.get("nodes"), dict):
            raise ValueError("Invalid project payload")
        root_id = project.get("rootId")
        for node in project["nodes"].values():
            if node.get("id") == root_id:
                continue
            nm = str(node.get("name", ""))
            if "/" in nm or "\\" in nm or nm in ("", ".", ".."):
                raise ValueError("Invalid file or folder name in payload")
        parent = self._abs_under_team(team, relpath)
        if relpath and parent.exists() and self.is_project_dir(parent):
            raise ValueError("Cannot nest a project inside another project")
        parent.mkdir(parents=True, exist_ok=True)
        final = name
        counter = 2
        while (parent / final).exists():
            final = f"{name}-{counter}"
            counter += 1
        project_dir = parent / final
        new_rel = f"{relpath}/{final}" if relpath else final
        workspace_id = f"{team}/{new_rel}"
        model = copy.deepcopy(project)
        model["sourceMode"] = "memory"
        if root_id and root_id in model.get("nodes", {}):
            model["nodes"][root_id]["name"] = final
        model["name"] = final
        with self.lock:
            broker = CollaborationBroker(
                self.pin, None, master_pin=self.master_pin, workspace_dir=project_dir
            )
            broker.project = model
            broker.revision = 0
            broker._externalize_images(model)   # data: URLs -> files, content stripped
            broker._persist_state()             # writes text files + manifest.json
            self._write_access_raw(project_dir, {
                "whitelist": [], "blacklist": [], "createdBy": identity["username"],
            })
            self.brokers[workspace_id] = broker
        _log("WORKSPACE", f"{identity['username']} imported project {workspace_id}")
        return {
            "team": team, "path": new_rel, "name": final, "kind": "project",
            "id": workspace_id, "createdBy": identity["username"],
        }

    def _make_workspace_broker_path(self, team: str, relpath: str) -> CollaborationBroker:
        """Directory-backed broker for a project at an arbitrary path. Reuses the
        legacy single-file migration for flat workspaces/<name> projects."""
        parts = relpath.split("/")
        if len(parts) == 2 and parts[0] == "workspaces":
            return self._make_workspace_broker(team, parts[1])
        workspace_dir = self._abs_under_team(team, relpath)
        return CollaborationBroker(
            self.pin, None, master_pin=self.master_pin, workspace_dir=workspace_dir
        )

    def create_workspace(self, token: str, team: str, name: str, share_team: bool = False) -> dict:
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        name = self.safe_component(name)
        with self.lock:
            index = self._read_index(team)
            if name in index["workspaces"]:
                raise ValueError("A workspace with that name already exists")
            members = list(self.accounts.team_members(team)) if share_team else [identity["username"]]
            if identity["username"] not in members:
                members.append(identity["username"])
            index["workspaces"][name] = {
                "members": members,
                "createdBy": identity["username"],
                "createdAt": time.time(),
            }
            self._write_index(team, index)
        _log("WORKSPACE", f"{identity['username']} created {team}/{name}", members=members)
        return {"team": team, "name": name, "id": f"{team}/{name}", "members": members, "createdBy": identity["username"]}

    def open_workspace(self, token: str, team: str, path: str, device: str | None = None) -> dict:
        """Admit a logged-in account into a team project (role master), loading
        or creating its persisted broker. ``path`` points at a project directory
        relative to the team root (e.g. ``workspaces/WorkNotes``)."""
        identity = self._require_account(token)
        team = self._require_team(identity, team)
        relpath = self._safe_relpath(path)
        project_dir = self._abs_under_team(team, relpath)
        if not self.is_project_dir(project_dir) and self._legacy_meta(team, relpath) is None:
            raise PermissionError("Unknown workspace")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that workspace")
        workspace_id = f"{team}/{relpath}"
        with self.lock:
            broker = self.brokers.get(workspace_id)
            if broker is None:
                broker = self._make_workspace_broker_path(team, relpath)
                self.brokers[workspace_id] = broker
        # One live session per account PER DEVICE — a refresh/reconnect on the same
        # device replaces its old session, but the same account on another device
        # stays connected (self-collaboration across devices; no reconnect war).
        broker.evict_user(identity["username"], device)
        session = broker._admit(identity["username"], "master", identity=identity["username"], device=device)
        self.set_last_workspace(identity["username"], team, relpath)  # cross-device resume
        with self.lock:
            self.token_workspace[session["token"]] = workspace_id
        session["sessionId"] = workspace_id
        session["workspace"] = workspace_id
        # Resume state: which files this user had open here last time, so the
        # client can restore their tabs on open/reconnect.
        session["resume"] = self.read_user_state(team, relpath, identity["username"])
        return session

    # ---- Per-user global prefs (last workspace, for cross-device resume) -------
    def _user_prefs_path(self) -> Path | None:
        return (self.data_dir / "user-prefs.json") if self.data_dir else None

    def _read_user_prefs_all(self) -> dict:
        path = self._user_prefs_path()
        if not path or not path.exists():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}

    def user_prefs(self, username: str) -> dict:
        entry = self._read_user_prefs_all().get(username)
        return entry if isinstance(entry, dict) else {}

    def set_last_workspace(self, username: str, team: str, path: str) -> None:
        """Remember the workspace this account last opened, so ANY device can
        offer to resume it on next login (client localStorage is per-browser)."""
        prefs_path = self._user_prefs_path()
        if not prefs_path:
            return
        try:
            data = self._read_user_prefs_all()
            data[username] = {"lastWorkspace": {"team": team, "path": path}, "updatedAt": time.time()}
            prefs_path.parent.mkdir(parents=True, exist_ok=True)
            prefs_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except OSError:
            pass

    def login(self, username: str, password: str) -> dict:
        """Authenticate an account and mint an *account* token (distinct from a
        workspace session token). Used to list/open team workspaces later."""
        identity = self.accounts.authenticate(username.strip(), password)
        if identity is None:
            _log("AUTH", f"Rejected login for {username!r}")
            raise PermissionError("Invalid username or password")
        token = secrets.token_urlsafe(24)
        with self.lock:
            self.account_tokens[token] = identity["username"]
        _log("AUTH", f"{identity['username']} logged in", teams=identity["teams"])
        return {
            "token": token,
            "username": identity["username"],
            "teams": identity["teams"],
            # Cross-device resume: the last workspace this account opened anywhere.
            "lastWorkspace": self.user_prefs(identity["username"]).get("lastWorkspace"),
        }

    def account_for_token(self, token: str) -> dict | None:
        with self.lock:
            username = self.account_tokens.get(token)
        if username is None:
            return None
        return {"username": username, "teams": self.accounts.teams_for(username)}

    def logout(self, token: str) -> None:
        with self.lock:
            self.account_tokens.pop(token, None)

    @property
    def default_broker(self) -> CollaborationBroker:
        return self.brokers[DEFAULT_WORKSPACE_ID]

    def get_broker(self, workspace_id: str) -> CollaborationBroker | None:
        with self.lock:
            return self.brokers.get(workspace_id)

    def _bind_session(self, workspace_id: str, session: dict) -> dict:
        with self.lock:
            self.token_workspace[session["token"]] = workspace_id
        session["sessionId"] = workspace_id
        session["workspace"] = workspace_id
        return session

    def connect(self, workspace_id: str | None, pin: str, display_name: str = ""):
        """Guest-PIN connect. With an explicit workspace, joins it; otherwise the
        PIN is resolved — first against the default workspace, then against any
        ephemeral guest-hosted session — so a guest only needs the shared PIN."""
        if workspace_id:
            broker = self.get_broker(workspace_id)
            if broker is None:
                raise PermissionError("Unknown workspace")
            return self._bind_session(workspace_id, broker.connect(pin, display_name))
        # No workspace given: try the legacy default session first.
        try:
            return self._bind_session(DEFAULT_WORKSPACE_ID, self.default_broker.connect(pin, display_name))
        except PermissionError:
            pass
        # Then any ephemeral host whose guest PIN matches.
        with self.lock:
            match = next((wid for wid, meta in self.ephemeral.items() if meta["guestPin"] == pin), None)
        if match is None:
            raise PermissionError("Invalid PIN")
        broker = self.get_broker(match)
        return self._bind_session(match, broker.connect(pin, display_name))

    def host_ephemeral(self, display_name: str) -> dict:
        """Create an in-memory guest-hosted session for a local project. Returns a
        master session + the generated guest PIN. Evicted when the master leaves."""
        guest_pin = f"{secrets.randbelow(900000) + 100000}"  # 6-digit shareable PIN
        workspace_id = f"{DEFAULT_TEAM}/host-{uuid.uuid4().hex[:8]}"
        broker = CollaborationBroker(guest_pin, None, master_pin=secrets.token_urlsafe(16))
        with self.lock:
            self.brokers[workspace_id] = broker
        session = broker._admit(display_name, "master")
        with self.lock:
            self.ephemeral[workspace_id] = {"ownerToken": session["token"], "guestPin": guest_pin}
        self._bind_session(workspace_id, session)
        session["guestPin"] = guest_pin
        _log("HOST", f"{session['displayName']} hosting ephemeral {workspace_id}", guestPin=guest_pin)
        return session

    def on_disconnect(self, token: str) -> None:
        """Called when a session's SSE stream closes. If the departing token owns
        an ephemeral workspace, evict it (in-memory state discarded)."""
        with self.lock:
            workspace_id = self.token_workspace.get(token)
            meta = self.ephemeral.get(workspace_id) if workspace_id else None
            is_owner = bool(meta and meta.get("ownerToken") == token)
        if is_owner:
            self._evict_ephemeral(workspace_id)

    def _evict_ephemeral(self, workspace_id: str) -> None:
        with self.lock:
            self.ephemeral.pop(workspace_id, None)
            self.brokers.pop(workspace_id, None)
            stale = [tok for tok, wid in self.token_workspace.items() if wid == workspace_id]
            for tok in stale:
                self.token_workspace.pop(tok, None)
        _log("HOST", f"Evicted ephemeral {workspace_id} (master left)")

    def broker_for_token(self, token: str) -> CollaborationBroker:
        with self.lock:
            workspace_id = self.token_workspace.get(token)
        # Unknown token → route to the default broker, whose authorize() will
        # raise the standard "invalid/expired token" error. (Every token minted
        # through connect() is recorded, so this only hits genuinely bad tokens.)
        broker = self.get_broker(workspace_id) if workspace_id else None
        return broker or self.default_broker

    def forget_token(self, token: str) -> None:
        with self.lock:
            self.token_workspace.pop(token, None)


class MDNotesRequestHandler(BaseHTTPRequestHandler):
    server_version = "MDNotesServer/0.1"

    def __init__(self, *args, registry: WorkspaceRegistry, static_root: Path, chat_proxy: ChatProxy, **kwargs):
        self.registry = registry
        self.static_root = static_root
        self.chat_proxy = chat_proxy
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
            return self._write_json(HTTPStatus.OK, {
                "message": "pong",
                "server": "mdnotes",
                "transport": "sse-text-ops",
                "accounts": self.registry.accounts.enabled,  # capability flag for the Login UI
                "hosting": True,  # this backend supports ephemeral guest-PIN hosting
            })
        if parsed.path == "/api/chat/status":
            return self._handle_chat_status()
        if parsed.path == "/api/chat/workspace":
            return self._handle_get_chat_workspace(parsed)
        if parsed.path == "/api/session/state":
            return self._handle_get_state(parsed)
        if parsed.path == "/api/session/presence":
            return self._handle_get_presence(parsed)
        if parsed.path == "/api/workspaces":
            return self._handle_list_workspaces(parsed)
        if parsed.path == "/api/workspaces/browse":
            return self._handle_browse(parsed)
        if parsed.path == "/api/workspaces/access":
            return self._handle_get_access(parsed)
        if parsed.path == "/api/workspaces/export":
            return self._handle_export_project(parsed)
        if parsed.path == "/api/workspaces/asset":
            return self._handle_asset(parsed)
        if parsed.path == "/api/events/stream":
            return self._handle_event_stream(parsed)
        return self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/chat":
            return self._handle_chat()
        if parsed.path == "/api/generate":
            return self._handle_generate()
        if parsed.path == "/api/chat/workspace":
            return self._handle_post_chat_workspace(parsed)
        if parsed.path == "/api/auth/login":
            return self._handle_login()
        if parsed.path == "/api/workspaces":
            return self._handle_create_workspace(parsed)
        if parsed.path == "/api/workspaces/mkdir":
            return self._handle_mkdir(parsed)
        if parsed.path == "/api/workspaces/create":
            return self._handle_create_project(parsed)
        if parsed.path == "/api/workspaces/delete":
            return self._handle_delete(parsed)
        if parsed.path == "/api/workspaces/import":
            return self._handle_import_project(parsed)
        if parsed.path == "/api/workspaces/access":
            return self._handle_set_access(parsed)
        if parsed.path == "/api/workspaces/user-state":
            return self._handle_set_user_state(parsed)
        if parsed.path == "/api/workspaces/open":
            return self._handle_open_workspace(parsed)
        if parsed.path == "/api/workspaces/asset":
            return self._handle_asset_upload(parsed)
        if parsed.path == "/api/session/host":
            return self._handle_host()
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

    def _handle_login(self):
        try:
            payload = self._read_json()
            result = self.registry.login(str(payload.get("username", "")), str(payload.get("password", "")))
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"login user={result['username']!r} teams={result['teams']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_list_workspaces(self, parsed):
        try:
            token = self._extract_token(parsed)
            self._write_json(HTTPStatus.OK, {"workspaces": self.registry.list_workspaces(token)})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

    def _handle_asset_upload(self, parsed):
        """Receive one binary chunk of an image asset (see write_asset_chunk)."""
        try:
            token = self._extract_token(parsed)
            broker = self.registry.broker_for_token(token)
            broker.authorize(token)
            query = parse_qs(parsed.query)
            rel_path = query.get("path", [""])[0]
            offset = int(query.get("offset", ["0"])[0])
            if not rel_path:
                raise ValueError("Asset path is required")
            length = int(self.headers.get("content-length", "0"))
            data = self.rfile.read(length) if length > 0 else b""
            size = broker.write_asset_chunk(rel_path, offset, data)
            self._write_json(HTTPStatus.OK, {"ok": True, "size": size})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        except (ValueError, TypeError) as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _handle_asset(self, parsed):
        """Serve a directory-backed workspace's binary asset (image) by its
        workspace-relative path, to a member of that workspace's session."""
        try:
            token = self._extract_token(parsed)
            broker = self.registry.broker_for_token(token)
            broker.authorize(token)
            rel_path = parse_qs(parsed.query).get("path", [""])[0]
            path = broker.resolve_asset(rel_path)
        except PermissionError as error:
            return self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        if path is None:
            return self._write_json(HTTPStatus.NOT_FOUND, {"message": "Asset not found"})
        data = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def _handle_create_workspace(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.create_workspace(
                token,
                str(payload.get("team", "")),
                str(payload.get("name", "")),
                share_team=bool(payload.get("shareTeam", False)),
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"created {result['id']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_open_workspace(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            # Prefer the new (team, path) signature; fall back to a bare name so a
            # migrating client's {team, name} still opens workspaces/<name>.
            path = str(payload.get("path", "")).strip()
            if not path and payload.get("name"):
                path = f"workspaces/{payload.get('name')}"
            device = str(payload.get("device") or "").strip()[:64] or None
            session = self.registry.open_workspace(token, str(payload.get("team", "")), path, device)
            self._write_json(HTTPStatus.OK, session)
            self._log_request(200, f"opened {session['workspace']} as {session['displayName']!r}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_browse(self, parsed):
        try:
            token = self._extract_token(parsed)
            query = parse_qs(parsed.query)
            team = query.get("team", [""])[0]
            path = query.get("path", [""])[0]
            self._write_json(HTTPStatus.OK, self.registry.browse(token, team, path))
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _handle_mkdir(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.make_folder(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
                str(payload.get("name", "")),
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"mkdir {result['team']}/{result['path']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_create_project(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.create_project(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
                str(payload.get("name", "")),
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"created project {result['id']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_get_access(self, parsed):
        try:
            token = self._extract_token(parsed)
            identity = self.registry._require_account(token)
            query = parse_qs(parsed.query)
            team = self.registry._require_team(identity, query.get("team", [""])[0])
            path = self.registry._safe_relpath(query.get("path", [""])[0])
            self._write_json(HTTPStatus.OK, self.registry.read_access(team, path))
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _handle_set_access(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.set_access(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
                payload.get("whitelist", []),
                payload.get("blacklist", []),
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, "set access")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_set_user_state(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.write_user_state(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
                payload.get("openFiles", []),
                payload.get("activeFile"),
            )
            self._write_json(HTTPStatus.OK, result)
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})

    def _handle_delete(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.delete_entry(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"deleted {result['team']}/{result['path']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_export_project(self, parsed):
        try:
            token = self._extract_token(parsed)
            query = parse_qs(parsed.query)
            team = query.get("team", [""])[0]
            path = query.get("path", [""])[0]
            self._write_json(HTTPStatus.OK, self.registry.export_project(token, team, path))
            self._log_request(200, f"exported {team}/{path}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_import_project(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            result = self.registry.import_project(
                token,
                str(payload.get("team", "")),
                str(payload.get("path", "")),
                str(payload.get("name", "")),
                payload.get("project") or {},
            )
            self._write_json(HTTPStatus.OK, result)
            self._log_request(200, f"imported project {result['id']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_host(self):
        try:
            payload = self._read_json()
            session = self.registry.host_ephemeral(str(payload.get("displayName", "")))
            self._write_json(HTTPStatus.OK, session)
            self._log_request(200, f"host {session['workspace']} pin={session['guestPin']}")
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_connect(self):
        try:
            payload = self._read_json()
            workspace = payload.get("workspace") or None
            session = self.registry.connect(
                workspace,
                str(payload.get("pin", "")),
                str(payload.get("displayName", "")),
            )
            self._write_json(HTTPStatus.OK, session)
            self._log_request(200, f"role={session['role']}  name={session['displayName']!r}  ws={session['workspace']}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_chat_status(self):
        # Status is public info (no key leaves the server). Report it even to
        # remote clients — they combine `localOnly` with their own-key setting to
        # decide availability, instead of getting an opaque 403.
        self._write_json(HTTPStatus.OK, self.chat_proxy.public_status())
        self._log_request(200, "chat status")

    def _handle_chat(self):
        # Streams NDJSON progress events over a chunked response so (a) the user
        # sees the agent's live activity, and (b) nginx's proxy_read_timeout keeps
        # resetting on each chunk/heartbeat — without this a multi-minute agent turn
        # returns a 504 even though the backend is still working.
        try:
            payload = self._read_json()
            # A client bringing its own key may use the agent from anywhere; only
            # when relying on the SERVER's key do we enforce the localhost gate
            # (which protects the server's key from arbitrary remote callers).
            override = {
                "apiKey": str(payload.get("apiKey") or "").strip(),
                "apiUrl": str(payload.get("apiUrl") or "").strip(),
                "model": str(payload.get("apiModel") or "").strip(),
            }
            if not override["apiKey"]:
                self.chat_proxy.authorize_client(self.client_address[0])
            messages = payload.get("messages")
            context_files = payload.get("contextFiles") or []
            project_name = str(payload.get("projectName", "Workspace"))
            client_project = payload.get("project")
            requested_model = payload.get("model")
            requested_model = str(requested_model).strip() if requested_model else None
            if not isinstance(messages, list):
                raise ValueError("Messages payload is required.")
            if not isinstance(context_files, list):
                raise ValueError("Context files payload must be a list.")
            if client_project is not None and not isinstance(client_project, dict):
                client_project = None
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
            return
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))
            return

        # Begin the NDJSON stream. We mirror the existing SSE pattern (raw,
        # newline-delimited writes, no Content-Length, connection-close to mark
        # the end) because that is already proven to proxy correctly through the
        # deployment's nginx. We deliberately do NOT use Transfer-Encoding:
        # chunked: BaseHTTPRequestHandler defaults to HTTP/1.0, under which
        # chunked is invalid and nginx mangles the body (hex frame markers leak
        # in), which silently breaks the client parser → "agent replies nothing".
        # X-Accel-Buffering:no asks nginx not to buffer; the 15s heartbeat keeps
        # bytes flowing so proxy_read_timeout never fires on a long turn.
        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True  # body is delimited by connection close

        write_lock = threading.Lock()
        closed = threading.Event()

        def write_event(event: dict) -> None:
            data = (json.dumps(event) + "\n").encode("utf-8")
            with write_lock:
                if closed.is_set():
                    return
                try:
                    self.wfile.write(data)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    closed.set()

        # Heartbeat thread: emit a keepalive at least every 15s so nginx never
        # hits its read timeout during a long blocking model call.
        def heartbeat() -> None:
            while not closed.wait(15):
                write_event({"type": "heartbeat"})

        hb = threading.Thread(target=heartbeat, daemon=True)
        hb.start()

        try:
            response = self.chat_proxy.chat(
                messages, context_files, project_name, client_project,
                progress=write_event, model=requested_model, override=override
            )
            write_event({"type": "result", "response": response})
            self._log_request(200, f"chat messages={len(messages)} context={len(response['contextPaths'])} (stream)")
        except ValueError as error:
            write_event({"type": "error", "status": 400, "message": str(error)})
            self._log_request(400, str(error))
        except RuntimeError as error:
            write_event({"type": "error", "status": 502, "message": str(error)})
            self._log_request(502, str(error))
        except Exception as error:  # noqa: BLE001 — last-resort guard so the stream always closes
            write_event({"type": "error", "status": 500, "message": str(error)})
            self._log_request(500, str(error))
        finally:
            closed.set()
            with write_lock:
                try:
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                    pass

    def _handle_generate(self):
        try:
            self.chat_proxy.authorize_client(self.client_address[0])
            payload = self._read_json()
            subject = str(payload.get("subject", ""))
            instructions = str(payload.get("instructions", ""))
            context_files = payload.get("contextFiles") or []
            bmap_overview = str(payload.get("bmapOverview", ""))
            project_name = str(payload.get("projectName", "Workspace"))
            if not isinstance(context_files, list):
                raise ValueError("Context files payload must be a list.")
            response = self.chat_proxy.generate(subject, instructions, context_files, bmap_overview, project_name)
            self._write_json(HTTPStatus.OK, response)
            self._log_request(200, f"generate context={len(response['contextPaths'])}")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))
        except RuntimeError as error:
            self._write_json(HTTPStatus.BAD_GATEWAY, {"message": str(error)})
            self._log_request(502, str(error))

    def _handle_get_chat_workspace(self, parsed):
        try:
            token = self._extract_token(parsed)
            workspace = self.registry.broker_for_token(token).get_chat_workspace(token)
            self._write_json(HTTPStatus.OK, workspace)
            self._log_request(200, "chat workspace read")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))

    def _handle_post_chat_workspace(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            self.registry.broker_for_token(token).set_chat_workspace(token, payload)
            self._write_json(HTTPStatus.OK, {"message": "chat workspace saved"})
            self._log_request(200, "chat workspace updated")
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})
            self._log_request(403, str(error))
        except ValueError as error:
            self._write_json(HTTPStatus.BAD_REQUEST, {"message": str(error)})
            self._log_request(400, str(error))

    def _handle_get_state(self, parsed):
        try:
            token = self._extract_token(parsed)
            self._write_json(HTTPStatus.OK, self.registry.broker_for_token(token).get_state(token))
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

    def _handle_get_presence(self, parsed):
        try:
            token = self._extract_token(parsed)
            broker = self.registry.broker_for_token(token)
            broker.authorize(token)
            self._write_json(HTTPStatus.OK, {"presence": broker.get_presence(), "revision": broker.revision})
        except PermissionError as error:
            self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

    def _handle_post_state(self, parsed):
        try:
            token = self._extract_token(parsed)
            payload = self._read_json()
            project = payload.get("project")
            if not isinstance(project, dict):
                raise ValueError("Project payload is required")
            event = self.registry.broker_for_token(token).set_state(token, project)
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
            self.registry.broker_for_token(token).broadcast_cursor(token, file_id, sel_start, sel_end)
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
            event = self.registry.broker_for_token(token).apply_operation(token, operation)
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
            broker = self.registry.broker_for_token(token)
            events = broker.subscribe(token)
        except PermissionError as error:
            self._log_request(403, str(error))
            return self._write_json(HTTPStatus.FORBIDDEN, {"message": str(error)})

        with broker.lock:
            display_name = broker.presence.get(token, {}).get("displayName", "?")
            sub_count = len(broker.subscribers)

        self.send_response(HTTPStatus.OK)
        self._send_cors_headers()
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        # Critical for remote (reverse-proxied) clients: without this nginx BUFFERS
        # the event stream, so operation/cursor events never arrive in real time —
        # collaboration silently appears "dead" (no live content, no peer cursors)
        # even though the server is broadcasting. The chat stream already sets this.
        self.send_header("X-Accel-Buffering", "no")
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
            broker.unsubscribe(token)
            # Evict an ephemeral guest-hosted session once its master disconnects.
            self.registry.on_disconnect(token)

    # Server-side files that live under the repo (== static root) but must never
    # be handed out over HTTP: collaboration state, account whitelist, secrets,
    # the Python source, the virtualenv and any dotfiles. Matched on the first
    # path segment or the basename so both dirs and specific files are covered.
    _STATIC_DENY_SEGMENTS = frozenset({"server", "data", "venv", ".git", "__pycache__"})
    _STATIC_DENY_SUFFIXES = (".env", ".py", ".pyc")
    _STATIC_DENY_NAMES = frozenset({"whitelist.json", "session-state.json", "test-session-state.json"})

    def _is_denied_static(self, safe_path: str) -> bool:
        if not safe_path:
            return False
        segments = safe_path.split("/")
        if segments[0] in self._STATIC_DENY_SEGMENTS or any(seg.startswith(".") for seg in segments):
            return True
        base = segments[-1]
        return base in self._STATIC_DENY_NAMES or base.endswith(self._STATIC_DENY_SUFFIXES)

    def _serve_static(self, request_path: str):
        relative = request_path or "/"
        if relative == "/":
            relative = "/index.html"

        safe_path = posixpath.normpath(relative).lstrip("/")
        # Block sensitive server-side files before touching the filesystem. Fall
        # back to index.html (SPA behaviour) rather than confirming existence.
        if self._is_denied_static(safe_path):
            safe_path = "index.html"
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


def build_server(host: str, port: int, pin: str, static_root: Path, state_file: Path, master_pin: str | None = None, chat_proxy: ChatProxy | None = None, whitelist_file: Path | None = None, data_dir: Path | None = None):
    accounts = AccountStore(whitelist_file)
    registry = WorkspaceRegistry(pin, state_file, master_pin=master_pin, accounts=accounts, data_dir=data_dir)
    chat_proxy = chat_proxy or ChatProxy()
    # Chat context falls back to the default workspace's project when the client
    # doesn't supply one — same behaviour as the pre-registry single broker.
    chat_proxy.broker = registry.default_broker
    handler = partial(MDNotesRequestHandler, registry=registry, static_root=static_root, chat_proxy=chat_proxy)

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

        chat_status = json.loads(urlopen(f"{base_url}/api/chat/status").read().decode("utf-8"))
        assert "configured" in chat_status
        assert "localOnly" in chat_status

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

        # --- OT rebase test: concurrent edits in DIFFERENT regions must not
        # misplace text. Two clients both branch from the same revision; the
        # second's offsets are STALE relative to the first's insert and MUST be
        # rebased forward, or its text lands in the wrong place (the exact
        # "characters ended up shifted while two devices edited" bug). ---
        create_ot = Request(
            f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "create-file", "parentPath": "", "name": "ot.md", "content": "0123456789"}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST")
        rev0 = json.loads(urlopen(create_ot).read().decode("utf-8"))["revision"]
        # Client A (based on rev0): insert "AAA" at offset 2.
        urlopen(Request(f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "ot.md", "start": 2, "end": 2, "removedText": "", "text": "AAA", "baseRevision": rev0}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST"))
        # Client B (ALSO based on rev0 — never saw A): insert "BBB" at offset 8.
        urlopen(Request(f"{base_url}/api/operations?token={token}",
            data=json.dumps({"operation": {"type": "patch-file", "path": "ot.md", "start": 8, "end": 8, "removedText": "", "text": "BBB", "baseRevision": rev0}}).encode("utf-8"),
            headers={"Content-Type": "application/json"}, method="POST"))
        snap = json.loads(urlopen(f"{base_url}/api/session/state?token={token}").read().decode("utf-8"))
        ot_file = next(n for n in snap["project"]["nodes"].values() if n.get("name") == "ot.md")
        # After A: "01AAA23456789"; B's offset 8 rebases +3 → 11 → "01AAA234567BBB89".
        assert ot_file["content"] == "01AAA234567BBB89", f"OT rebase misplaced text: {ot_file['content']!r}"

        # --- directory-backed workspace: real files + externalized image asset ---
        import base64 as _b64, tempfile as _tf, shutil as _sh
        _dir = Path(_tf.mkdtemp()) / "WorkNotes"
        _b = CollaborationBroker("2468", None, workspace_dir=_dir)
        _png = "data:image/png;base64," + _b64.b64encode(bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000d4944415478da6360000002000154a24f5f0000000049454e44ae426082")).decode()
        _b._apply_operation({"type": "create-file", "parentPath": "", "name": "welcome.md", "content": "# Hi"})
        _img_op = {"type": "create-file", "parentPath": "", "name": "logo.png", "content": _png}
        _b._apply_operation(_img_op)
        _b._persist_state()
        assert (_dir / "welcome.md").read_text(encoding="utf-8") == "# Hi", "text not written as a real file"
        assert (_dir / "logo.png").read_bytes()[:4] == b"\x89PNG", "image not written as real bytes"
        assert _img_op["content"] == "", "image data URL not stripped from the broadcast op"
        assert "data:image" not in (_dir / "manifest.json").read_text(encoding="utf-8"), "manifest still inlines images"
        assert _b.resolve_asset("logo.png") == (_dir / "logo.png").resolve(), "asset path not resolvable"
        assert _b.resolve_asset("../../etc/passwd") is None, "asset path traversal not blocked"
        _b2 = CollaborationBroker("2468", None, workspace_dir=_dir)  # reload
        _reload = {n["name"]: n for n in _b2.project["nodes"].values() if n.get("kind") == "file"}
        assert _reload["welcome.md"]["content"] == "# Hi", "text not re-hydrated on load"
        assert _reload["logo.png"]["content"] == "", "image should stay externalized on load"
        _sh.rmtree(_dir.parent, ignore_errors=True)

        # --- file-browser navigation: nested folders, projects, access rules ----
        _data = Path(_tf.mkdtemp())
        _acct = AccountStore(None)
        _acct.users = {
            "alice": {"password": "pw", "teams": ["qa"]},
            "bob": {"password": "pw", "teams": ["qa"]},
            "carol": {"password": "pw", "teams": ["other"]},
        }
        _reg = WorkspaceRegistry("2468", state_file, master_pin="1367", accounts=_acct, data_dir=_data)
        _alice = _reg.login("alice", "pw")["token"]
        _bob = _reg.login("bob", "pw")["token"]
        _alice_id = {"username": "alice", "teams": ["qa"]}
        _bob_id = {"username": "bob", "teams": ["qa"]}

        # No team → the caller's teams (name + modified); a fresh team is empty.
        assert [t["name"] for t in _reg.browse(_alice)["teams"]] == ["qa"], "browse should list the caller's teams"
        assert _reg.browse(_alice, "qa", "")["entries"] == [], "fresh team should browse empty"

        # Create a normal folder, then a project inside it.
        _reg.make_folder(_alice, "qa", "", "workspaces")
        _created = _reg.create_project(_alice, "qa", "workspaces", "Alpha")
        assert _created["id"] == "qa/workspaces/Alpha"
        _alpha_dir = _data / "team_qa" / "workspaces" / "Alpha"
        assert (_alpha_dir / "manifest.json").is_file(), "project must carry a manifest.json"
        assert (_alpha_dir / "access.json").is_file(), "project must record access.json"

        # Browse classifies dir-with-manifest as project, others as folder.
        _root = {e["name"]: e for e in _reg.browse(_alice, "qa", "")["entries"]}
        assert _root["workspaces"]["kind"] == "folder"
        _ws = {e["name"]: e for e in _reg.browse(_alice, "qa", "workspaces")["entries"]}
        assert _ws["Alpha"]["kind"] == "project" and _ws["Alpha"]["path"] == "workspaces/Alpha"
        # Reserved bookkeeping files never appear as entries.
        assert "manifest.json" not in _ws and "access.json" not in _ws and "index.json" not in _root

        # Browsing into a project is rejected (open it instead).
        try:
            _reg.browse(_alice, "qa", "workspaces/Alpha")
            assert False, "browsing into a project should fail"
        except ValueError:
            pass

        # Open-by-path admits and binds a directory-backed broker.
        _sess = _reg.open_workspace(_alice, "qa", "workspaces/Alpha")
        assert _sess["workspace"] == "qa/workspaces/Alpha"
        assert _reg.brokers["qa/workspaces/Alpha"].workspace_dir is not None, "opened broker not directory-backed"

        # Access: both lists empty ⇒ everyone in the team.
        assert _reg.can_access(_bob_id, "qa", "workspaces/Alpha"), "empty access should allow team members"
        # Whitelist limits to listed members.
        _reg.set_access(_alice, "qa", "workspaces/Alpha", ["alice"], [])
        assert _reg.can_access(_alice_id, "qa", "workspaces/Alpha")
        assert not _reg.can_access(_bob_id, "qa", "workspaces/Alpha"), "whitelist should exclude bob"
        # Blacklist excludes a member even with an empty whitelist.
        _reg.set_access(_alice, "qa", "workspaces/Alpha", [], ["bob"])
        assert _reg.can_access(_alice_id, "qa", "workspaces/Alpha")
        assert not _reg.can_access(_bob_id, "qa", "workspaces/Alpha"), "blacklist should exclude bob"
        # Only the owner may change access.
        try:
            _reg.set_access(_bob, "qa", "workspaces/Alpha", [], [])
            assert False, "non-owner should not edit access"
        except PermissionError:
            pass

        # access.json survives a publish/replace-project wipe.
        _reg.set_access(_alice, "qa", "workspaces/Alpha", ["alice"], [])
        _broker = _reg.brokers["qa/workspaces/Alpha"]
        _broker._apply_operation({"type": "replace-project", "project": _broker._default_project()})
        assert (_alpha_dir / "access.json").is_file(), "access.json must survive replace-project"
        assert _reg.read_access("qa", "workspaces/Alpha")["whitelist"] == ["alice"], "whitelist lost on publish"

        # Lazy-migrate a legacy index.json members list into the whitelist.
        _legacy = _data / "team_qa" / "workspaces" / "Legacy"
        _legacy.mkdir(parents=True, exist_ok=True)
        (_legacy / "manifest.json").write_text('{"project":{},"revision":0}', encoding="utf-8")
        _reg._write_index("qa", {"workspaces": {"Legacy": {"members": ["bob"], "createdBy": "bob"}}})
        _acc = _reg.read_access("qa", "workspaces/Legacy")
        assert _acc["whitelist"] == ["bob"] and _acc["createdBy"] == "bob", "legacy members not migrated"
        assert (_legacy / "access.json").is_file(), "migration should persist access.json"
        assert not _reg.can_access(_alice_id, "qa", "workspaces/Legacy"), "migrated whitelist should gate alice"

        # Path traversal in a browse path is rejected.
        try:
            _reg.browse(_alice, "qa", "../../etc")
            assert False, "path traversal should be rejected"
        except (ValueError, PermissionError):
            pass

        # Per-user resume state: save + read back is per account, and survives a
        # publish (user-state.json is preserved like access.json).
        _alpha_broker = _reg.brokers["qa/workspaces/Alpha"]
        _alpha_broker._persist_state()  # restore manifest.json (an earlier test wiped it)
        assert _reg.read_user_state("qa", "workspaces/Alpha", "alice")["openFiles"] == [], "default resume is empty"
        _reg.write_user_state(_alice, "qa", "workspaces/Alpha", ["welcome.md", "docs/spec.md"], "welcome.md")
        _rs = _reg.read_user_state("qa", "workspaces/Alpha", "alice")
        assert _rs["openFiles"] == ["welcome.md", "docs/spec.md"] and _rs["activeFile"] == "welcome.md", "resume not saved"
        assert _reg.read_user_state("qa", "workspaces/Alpha", "bob")["openFiles"] == [], "resume must be per-user"
        assert (_alpha_dir / "user-state.json").is_file(), "resume sidecar not written"
        # A publish (replace-project + persist) must preserve the resume sidecar.
        _alpha_broker._apply_operation({"type": "replace-project", "project": _alpha_broker._default_project()})
        _alpha_broker._persist_state()
        assert (_alpha_dir / "user-state.json").is_file(), "user-state.json must survive replace-project"
        assert _reg.read_user_state("qa", "workspaces/Alpha", "alice")["activeFile"] == "welcome.md", "resume lost on publish"
        # open_workspace hands the resume state back to the client.
        _sess2 = _reg.open_workspace(_alice, "qa", "workspaces/Alpha")
        assert _sess2.get("resume", {}).get("activeFile") == "welcome.md", "open should return resume state"

        # Cross-device resume: opening records the account's last workspace, and a
        # fresh login (a different device) gets it back.
        _login = _reg.login("alice", "pw")
        assert _login.get("lastWorkspace", {}).get("path") == "workspaces/Alpha", "login should return last workspace"
        assert _login["lastWorkspace"]["team"] == "qa", "last workspace team"

        _sh.rmtree(_data, ignore_errors=True)

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
    parser.add_argument("--whitelist", default=os.environ.get("MDNOTES_WHITELIST", str(Path(__file__).resolve().parent / "whitelist.json")),
                        help="Account whitelist JSON (accounts mode). Kept out of the web-served set. Absent ⇒ accounts disabled.")
    parser.add_argument("--data-dir", default=os.environ.get("MDNOTES_DATA_DIR", str(Path(__file__).resolve().parent / "data")),
                        help="Directory for persistent per-team cloud workspaces. Kept out of the web-served set.")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        run_selftest()
        return

    static_root = Path(args.static_dir).resolve()
    state_file = Path(args.state_file).resolve()
    whitelist_file = Path(args.whitelist).resolve() if args.whitelist else None
    data_dir = Path(args.data_dir).resolve() if args.data_dir else None
    chat_proxy = ChatProxy()
    server = build_server(args.host, args.port, args.pin, static_root, state_file, master_pin=args.master_pin, chat_proxy=chat_proxy, whitelist_file=whitelist_file, data_dir=data_dir)
    accounts_enabled = whitelist_file is not None and whitelist_file.exists()
    print(f"MDNotes collaboration server running at http://{args.host}:{args.port}")
    print(f"Serving static files from {static_root}")
    print(f"Persisting collaborative state to {state_file}")
    print("Configured transport: HTTP + SSE file-operation sync")
    print(f"Accounts mode: {'enabled — ' + str(whitelist_file) if accounts_enabled else 'disabled (no whitelist file)'}")
    print(f"Master PIN configured: {'yes (separate)' if args.master_pin and args.master_pin != args.pin else 'same as session PIN'}")
    print(f"Chat proxy configured: {'yes' if chat_proxy.is_configured() else 'no'}")
    if chat_proxy.is_configured():
        print(f"Chat provider: {chat_proxy.provider_label} ({chat_proxy.model})")
        print(f"Chat access: {'local browser only' if not chat_proxy.allow_remote else 'remote clients allowed'}")
    else:
        print("Set DEEPSEEK_API_KEY or MDNOTES_CHAT_API_KEY in the server environment to enable chat.")
    print("─" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()