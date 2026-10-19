"""The agent's conversations a live workspace shares (Settings → Agent's
threads, synced between a project's people and their devices)."""
import copy
import json
import threading
import time
import weakref

from stilo.modules.workspace import atomic_write

THREADS_FILE = "chat.json"


class AgentThreads:
    """The agent's shared conversations of each live workspace (chat.json beside
    its project, or beside the PIN session's file): read and saved whole, against
    the revision they were read at, and told to the workspace's other sessions."""

    def __init__(self):
        self._by_workspace = weakref.WeakKeyDictionary()
        self._lock = threading.Lock()

    @staticmethod
    def _file(workspace):
        if workspace.folder is not None:
            return workspace.folder / THREADS_FILE
        return workspace.state_file.with_suffix(".chat.json") if workspace.state_file is not None else None

    def current(self, workspace) -> dict:
        """The workspace's conversations as kept (not a copy)."""
        with self._lock:
            if workspace not in self._by_workspace:
                path = self._file(workspace)
                self._by_workspace[workspace] = (json.loads(path.read_text(encoding="utf-8")) if path is not None and path.exists()
                                                 else {"threads": [], "revision": 0})
            return self._by_workspace[workspace]

    def get(self, workspace, token: str) -> dict:
        workspace.authorize(token)
        with workspace.lock:
            return copy.deepcopy(self.current(workspace))

    def set(self, workspace, token: str, payload: dict) -> dict:
        client_id = workspace.sessions.authorize(token)
        threads = payload.get("threads")
        if not isinstance(threads, list):
            raise ValueError("threads must be a list")
        # IDs are merge keys, not optional display metadata.
        seen = set()
        for thread in threads:
            if not isinstance(thread, dict) or not isinstance(thread.get("id"), str) or not thread["id"] or thread["id"] in seen:
                raise ValueError("Each chat thread requires a unique ID")
            seen.add(thread["id"])
            messages = thread.get("messages")
            if not isinstance(messages, list):
                raise ValueError("Chat messages must be a list")
            ids = set()
            for message in messages:
                if not isinstance(message, dict) or not isinstance(message.get("id"), str) or not message["id"] or message["id"] in ids:
                    raise ValueError("Each chat message requires a unique ID")
                ids.add(message["id"])
        with workspace.lock:
            revision = self.current(workspace)["revision"]
            if payload.get("baseRevision") != revision:
                raise ValueError("Chat conflict: reload the conversation before saving")
            snapshot = {"threads": copy.deepcopy(threads), "revision": revision + 1}
            path = self._file(workspace)
            if path is not None:
                atomic_write(path, json.dumps(snapshot, ensure_ascii=False).encode("utf-8"))
            with self._lock:
                self._by_workspace[workspace] = snapshot
            workspace.sessions.broadcast({"type": "chat-workspace-update", "workspace": copy.deepcopy(snapshot),
                                          "clientId": client_id, "serverTime": time.time()}, exclude_token=token)
            return copy.deepcopy(snapshot)
