"""One shared workspace: the project everyone in it edits (Workspace's
LiveProject), who is in it (Sessions), and the rules that keep their edits
apart (RebaseLog). Every change goes through apply_operation: checked
against the sender's role and the revision it was made at, applied
(Workspace), committed, then broadcast."""
import copy
import threading
import time

from stilo.kernel.log import log as _log
from stilo.modules.workspace import PATCH_FILE, REPLACE_PROJECT, UPDATE_FILE
from ..model.rebase import RebaseLog
from .sessions import Sessions


class SharedWorkspace:
    def __init__(self, live, pin: str, master_pin: str | None = None, *, workspace, types, edit_gap: float):
        """live: Workspace's LiveProject; workspace: the Workspace API
        (apply_operation, utf16_length); types: File types."""
        self.pin = pin
        self.master_pin = master_pin or pin   # grants replacing the whole project
        self.live = live
        self._workspace = workspace
        self._types = types
        self._edit_gap = edit_gap
        self.lock = threading.RLock()
        self.rebase = RebaseLog(floor=live.revision)
        self.sessions = Sessions(self.lock, lambda: self.live.revision)
        self.on_before_destructive = None   # (workspace, reason): a safety backup
        self.on_paths_moved = None          # (workspace, old, new): things that name files by path follow

    # The project and its revision live in the LiveProject.
    project = property(lambda self: self.live.project, lambda self, value: setattr(self.live, "project", value))
    revision = property(lambda self: self.live.revision, lambda self, value: setattr(self.live, "revision", value))

    @property
    def images_on_disk(self) -> bool:
        """Images are kept as files and served by URL (a folder store), not inlined."""
        return hasattr(self.live.store, "resolve_asset")

    def ensure_persisted(self) -> None:
        """A failed commit is finished (or the last committed copy reloaded)
        before anything else is served or accepted; never acknowledge unsaved RAM."""
        if self.live.recover():
            self.rebase.reset(self.revision)
            self.sessions.broadcast({"type": "state", "revision": self.revision,
                                     "project": copy.deepcopy(self.project), "serverTime": time.time()})

    def _hook(self, hook, *args, tag: str) -> None:
        if hook is None:
            return
        try:
            hook(self, *args)
        except Exception as error:  # noqa: BLE001 - a hook never blocks or fails the change itself
            _log(tag, f"hook failed: {error}")

    # ---- joining ------------------------------------------------------------------

    def connect(self, pin: str, display_name: str = "", leased: bool = False) -> dict:
        if pin == self.master_pin:
            role = "master"
        elif pin == self.pin:
            role = "client"
        else:
            _log("AUTH", "Rejected connect — wrong PIN")
            raise PermissionError("Invalid PIN")
        return self.admit(display_name, role, leased=leased)

    def admit(self, display_name: str, role: str, identity: str | None = None, device: str | None = None,
              leased: bool = False) -> dict:
        with self.lock:
            self.ensure_persisted()
        return self.sessions.admit(display_name, role, identity, device, leased)

    def subscribe(self, token: str, leased: bool = False):
        with self.lock:
            self.ensure_persisted()
            return self.sessions.subscribe(token, leased)

    def get_state(self, token: str) -> dict:
        self.sessions.authorize(token)
        with self.lock:
            self.ensure_persisted()
            return {"project": copy.deepcopy(self.project), "revision": self.revision,
                    "presence": self.sessions.get_presence(), "sessionId": "default"}

    # ---- changes ------------------------------------------------------------------

    def set_state(self, token: str, project: dict, base_revision=None) -> dict:
        """Replace the whole project (the owner publishing). Based on the current
        revision, or refused: this wipes everything anyone else did."""
        client_id = self.sessions.authorize(token)
        with self.lock:
            if self.sessions.role(token) != "master":
                raise PermissionError("Only the session master can replace the project state")
            self.ensure_persisted()
            if base_revision is None or int(base_revision) != int(self.revision):
                raise ValueError(f"replace conflict: this client is based on revision {base_revision} but the server is at "
                                 f"{self.revision} — reload to get the newer copy before replacing it")
            self._hook(self.on_before_destructive, "replacing the whole project", tag="BACKUP")
            self.project = project
            self.revision += 1
            self.rebase.reset(self.revision)
            self.live.save()
            event = {"type": "state", "clientId": client_id, "revision": self.revision,
                     "project": copy.deepcopy(self.project), "serverTime": time.time()}
            self.sessions.broadcast(event)
        return event

    def _apply_operation(self, operation: dict) -> dict:
        """Check an operation against the revision it was made at, rebase a text
        patch over the patches since, and apply it (Workspace). Returns what
        Workspace reported (moved paths, counters)."""
        kind = operation.get("type")
        if kind == REPLACE_PROJECT:
            base = operation.get("baseRevision")
            if base is None or int(base) != int(self.revision):
                raise ValueError(f"replace-project conflict: based on revision {base} but the server is at "
                                 f"{self.revision} — reload before publishing over it")
            self.project = operation["project"]
            return {}
        if kind == UPDATE_FILE:
            # A whole-file write is precondition-checked on the revision, so an old
            # tab can never replace newer work it has not seen.
            base = operation.get("baseRevision")
            if base is None:
                raise ValueError("update-file conflict: the client did not say which revision it is based on "
                                 "(reload to update this tab)")
            changed_at = self.rebase.last_change(operation["path"])
            if int(base) < changed_at or int(base) > self.revision:
                raise ValueError(f"update-file conflict on {operation['path']!r}: this client is based on revision "
                                 f"{int(base)} but that file changed at revision {changed_at} — reload to get the newer copy")
        if kind == PATCH_FILE:
            base = operation.get("baseRevision")
            if base is None or int(base) < 0 or int(base) > self.revision:
                raise ValueError("patch conflict: invalid or missing base revision")
            start, end = int(operation.get("start", -1)), int(operation.get("end", -1))
            if start < 0 or end < start:
                raise ValueError("Invalid text patch range")
            rebased = self.rebase.rebase(str(operation.get("path", "")), start, end, int(base), self.revision)
            if rebased != (start, end):
                _log("OT", f"Rebased {operation.get('path')!r}  {start}–{end} → {rebased[0]}–{rebased[1]}",
                     baseRev=int(base), currentRev=self.revision)
            # Peers receive the positions actually applied, not the ones sent.
            operation["start"], operation["end"] = rebased
        result = self._workspace.apply_operation(self.project, operation, self._types, self._edit_gap)
        if "counters" in result:
            operation["counters"] = result["counters"]
        if kind in ("create-file", UPDATE_FILE) and self.images_on_disk and self._types.is_image(self._file_name(operation)):
            operation["content"] = ""   # peers fetch the bytes by URL
        if kind == PATCH_FILE:
            self.rebase.record_patch(self.revision + 1, str(operation.get("path", "")), operation["start"], operation["end"],
                                     self._workspace.utf16_length(str(operation.get("text", ""))))
        return result

    @staticmethod
    def _file_name(operation: dict) -> str:
        return str(operation.get("name") or str(operation.get("path", "")).rsplit("/", 1)[-1])

    def _moved(self, operation: dict):
        """(old, new) path of a rename or move, else None."""
        kind = operation.get("type")
        if kind not in ("rename-node", "move-node"):
            return None
        old = str(operation.get("path", "")).strip("/")
        if kind == "rename-node":
            parent, name = (old.rsplit("/", 1)[0] if "/" in old else ""), str(operation.get("name", ""))
        else:
            parent, name = str(operation.get("parentPath", "")).strip("/"), old.rsplit("/", 1)[-1]
        new = f"{parent}/{name}" if parent else name
        return (old, new) if old and name and old != new else None

    def apply_operation(self, token: str, operation: dict) -> dict:
        client_id = self.sessions.authorize(token)
        with self.lock:
            self.ensure_persisted()
            kind, path = operation.get("type"), operation.get("path", "")
            if "expectedRevision" in operation and operation["expectedRevision"] != self.revision:
                raise ValueError("Edit conflict: the workspace changed since this change was prepared")
            role = self.sessions.role(token)
            if role == "reader":
                raise PermissionError("You have read-only access to this project")
            if kind == REPLACE_PROJECT and role != "master":
                raise PermissionError("Only the session master can replace the project")
            if kind in ("delete-node", REPLACE_PROJECT):
                self._hook(self.on_before_destructive, f"deleting {path}" if kind == "delete-node" else "replacing the project",
                           tag="BACKUP")
            sent = (operation.get("start"), operation.get("end"))
            result = self._apply_operation(operation)
            self.revision += 1
            if kind == REPLACE_PROJECT:
                self.rebase.reset(self.revision)
            self.rebase.note(self._workspace.touched_paths(operation, result.get("moved", ())), self.revision,
                             text_only=kind == PATCH_FILE)
            moved = self._moved(operation)
            if moved:
                self._hook(self.on_paths_moved, *moved, tag="CHATS")
            self.live.save()
            event = {"type": "operation", "clientId": client_id, "revision": self.revision,
                     "operation": operation, "serverTime": time.time()}
            sender = self.sessions.name_of(token, client_id)
            listeners = self.sessions.listeners(token)
            self.sessions.broadcast(copy.deepcopy(event))
        self._log_operation(operation, sent, sender, listeners)
        return event

    def _log_operation(self, operation, sent, sender, listeners) -> None:
        kind, path = operation.get("type"), operation.get("path", "")
        to = ", ".join(listeners) if listeners else "(no other peers)"
        if kind == PATCH_FILE:
            applied = (operation.get("start"), operation.get("end"))
            moved = f"  [OT: {sent[0]}–{sent[1]} → {applied[0]}–{applied[1]}]" if applied != sent else ""
            _log("PATCH", f"{path!r}  {applied[0]}–{applied[1]}{moved}  text={str(operation.get('text', ''))[:30]!r}",
                 from_=sender, baseRev=operation.get("baseRevision"), revision=self.revision)
            _log("BROADCAST", f"{kind}  rev={self.revision}  start={applied[0]}  end={applied[1]}  to=[{to}]")
        else:
            _log("OP", kind, from_=sender, path=path or None, revision=self.revision)
            if listeners:
                _log("BROADCAST", f"{kind}  rev={self.revision}  to=[{to}]")

    # ---- sessions, passed through ---------------------------------------------------

    def authorize(self, token: str) -> str:
        return self.sessions.authorize(token)

    def get_presence(self) -> list[dict]:
        return self.sessions.get_presence()

    def evict_user(self, identity: str, device: str | None = None) -> None:
        self.sessions.evict(identity, device)

    def renew_lease(self, token: str) -> None:
        self.sessions.renew_lease(token)

    def session_should_close(self, token: str) -> bool:
        return self.sessions.should_close(token)

    def unsubscribe(self, token: str, expected_queue=None, expired_only=False, revoke=False) -> bool:
        return self.sessions.unsubscribe(token, expected_queue, expired_only, revoke)

    def broadcast_cursor(self, token: str, file_id: str, sel_start: int, sel_end: int) -> None:
        self.sessions.cursor(token, file_id, sel_start, sel_end)

    def broadcast(self, event: dict, exclude_token: str | None = None) -> None:
        self.sessions.broadcast(event, exclude_token)

    def broadcast_to_users(self, usernames, event: dict) -> None:
        self.sessions.broadcast_to_users(usernames, event)
