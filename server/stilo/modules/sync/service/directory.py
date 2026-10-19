"""What is open now: the live shared workspaces, each under an id
("<team>/<relpath>" for a team's project, "temp/default" for the PIN session
from before accounts, "temp/host-…" for one hosted for guests), which
workspace each session token belongs to, joining by PIN, hosting, and
sessions that end (their stream closed, their lease expired, they left).

projects (Projects' API):
    authorize_open(token, team, path) -> (identity, team, relpath, folder, role)
    read_user_state(team, relpath, username) -> the account's open files there
identity (Identity's API): remember_workspace(username, team, relpath)
make(pin, folder=None, state_file=None, master_pin=None) -> a LiveWorkspace
emit(event, payload): "before-destructive" {workspace, reason},
    "paths-moved" {workspace, old, new}, "dropped" {workspace_id}
"""
import secrets
import threading
import time
import uuid

from stilo.kernel.log import log as _log
from .sessions import LEASE_SECONDS

# The team that holds the PIN session from before accounts and the sessions
# hosted for guests. Its workspaces are never an account's.
DEFAULT_TEAM: str = "temp"
DEFAULT_WORKSPACE_ID: str = f"{DEFAULT_TEAM}/default"


class Directory:
    def __init__(self, *, pin, state_file, master_pin, projects, identity, make, emit):
        self.lock = threading.RLock()
        self.pin = pin
        self.master_pin = master_pin or pin
        self._projects, self._identity, self._make, self._emit = projects, identity, make, emit
        self.workspaces = {DEFAULT_WORKSPACE_ID: make(pin, state_file=state_file, master_pin=self.master_pin)}
        self.token_workspace: dict[str, str] = {}
        # Hosted for guests: workspace id -> {ownerToken, guestPin}; in memory,
        # gone when the host's session ends.
        self.hosted: dict[str, dict] = {}

    # ---- the open workspaces --------------------------------------------------
    @property
    def default(self):
        return self.workspaces[DEFAULT_WORKSPACE_ID]

    def get(self, workspace_id: str):
        with self.lock:
            return self.workspaces.get(workspace_id)

    def live(self, team, relpath):
        """A team project's live workspace, or None when nobody has it open."""
        return self.get(f"{team}/{relpath}")

    def live_workspaces(self):
        """[(team, relpath, workspace)] for every open team project (kept in a folder)."""
        with self.lock:
            return [(*workspace_id.split("/", 1), workspace) for workspace_id, workspace in self.workspaces.items()
                    if not workspace_id.startswith(f"{DEFAULT_TEAM}/") and workspace.folder is not None]

    def place_of(self, workspace):
        """(team, relpath) of a live team project, or None (the PIN session, a hosted one)."""
        with self.lock:
            workspace_id = next((key for key, value in self.workspaces.items() if value is workspace), None)
        if not workspace_id or workspace_id.startswith(f"{DEFAULT_TEAM}/"):
            return None
        return tuple(workspace_id.split("/", 1))

    def _team_workspace(self, folder):
        """A team project's workspace: changes announced to the modules above."""
        workspace = self._make(self.pin, folder=folder, master_pin=self.master_pin)
        workspace.on_before_destructive = lambda ws, reason: self._emit("before-destructive", {"workspace": ws, "reason": reason})
        workspace.on_paths_moved = lambda ws, old, new: self._emit("paths-moved", {"workspace": ws, "old": old, "new": new})
        return workspace

    def read(self, team, relpath, folder):
        """The project at a place: the live one, or read from its folder (not kept open)."""
        return self.live(team, relpath) or self._make(self.pin, folder=folder, master_pin=self.master_pin)

    def adopt(self, team, relpath, folder, project, revision=0):
        """A project made or brought in whole: its folder written, and kept open."""
        workspace = self._team_workspace(folder)
        with self.lock:
            workspace.project = project
            workspace.revision = revision
            workspace.adopt_images(project)   # data URLs -> files
            workspace.save()                  # the files and the manifest
            self.workspaces[f"{team}/{relpath}"] = workspace
        return workspace

    def drop(self, team, relpath):
        """A project (or a folder of them) is gone: its live workspaces close, so an
        open session cannot write its files again."""
        workspace_id = f"{team}/{relpath}"
        with self.lock:
            for key in [key for key in self.workspaces if key == workspace_id or key.startswith(workspace_id + "/")]:
                self.workspaces.pop(key, None)
        self._emit("dropped", {"workspace_id": workspace_id})

    # ---- joining ---------------------------------------------------------------
    def _bind(self, workspace_id: str, session: dict) -> dict:
        with self.lock:
            self.token_workspace[session["token"]] = workspace_id
        session["sessionId"] = workspace_id
        session["workspace"] = workspace_id
        return session

    def open_workspace(self, token: str, team: str, path: str, device: str | None = None, leased: bool = False) -> dict:
        """A signed-in account joins a team project (loaded from its folder, or
        already open), in the role its access file gives it."""
        identity, team, relpath, folder, role = self._projects.authorize_open(token, team, path)
        workspace_id = f"{team}/{relpath}"
        with self.lock:
            workspace = self.workspaces.get(workspace_id)
            if workspace is None:
                workspace = self.workspaces[workspace_id] = self._team_workspace(folder)
        # One live session per account per device: a reload on the same device
        # replaces its old session; the same account on another device stays.
        workspace.evict_user(identity["username"], device)
        session = workspace.admit(identity["username"], role, identity=identity["username"], device=device, leased=leased)
        self._identity.remember_workspace(identity["username"], team, relpath)  # resumed on another device
        self._bind(workspace_id, session)
        # Which files this account had open here, so its tabs come back.
        session["resume"] = self._projects.read_user_state(team, relpath, identity["username"])
        return session

    def connect(self, workspace_id: str | None, pin: str, display_name: str = "", leased: bool = False):
        """Joining by PIN. With a workspace, that one; without, the PIN session from
        before accounts, then any session hosted for guests with that PIN."""
        if workspace_id:
            workspace = self.get(workspace_id)
            if workspace is None:
                raise PermissionError("Unknown workspace")
            return self._bind(workspace_id, workspace.connect(pin, display_name, leased=leased))
        try:
            session = self.default.connect(pin, display_name, leased=leased)
        except PermissionError:
            session = None  # not the PIN session's PIN
        if session is not None:
            return self._bind(DEFAULT_WORKSPACE_ID, session)
        with self.lock:
            match = next((key for key, meta in self.hosted.items() if meta["guestPin"] == pin), None)
        if match is None:
            raise PermissionError("Invalid PIN")
        return self._bind(match, self.get(match).connect(pin, display_name, leased=leased))

    def host(self, display_name: str, leased: bool = False) -> dict:
        """A session in memory for a project on the host's device: the host's
        session and a six-digit PIN for guests. It ends when the host leaves."""
        guest_pin = f"{secrets.randbelow(900000) + 100000}"
        workspace_id = f"{DEFAULT_TEAM}/host-{uuid.uuid4().hex[:8]}"
        workspace = self._make(guest_pin, master_pin=secrets.token_urlsafe(16))
        with self.lock:
            self.workspaces[workspace_id] = workspace
        session = workspace.admit(display_name, "master", leased=leased)
        with self.lock:
            self.hosted[workspace_id] = {"ownerToken": session["token"], "guestPin": guest_pin}
        self._bind(workspace_id, session)
        session["guestPin"] = guest_pin
        _log("HOST", f"{session['displayName']} hosting ephemeral {workspace_id}", guestPin=guest_pin)
        return session

    # ---- sessions that end ---------------------------------------------------
    def expire_leases(self) -> int:
        """Close the sessions whose heartbeat stopped; how many."""
        with self.lock:
            workspaces = list(self.workspaces.values())
        expired = 0
        for workspace in workspaces:
            with workspace.lock:
                quiet = [token for token, last in workspace.sessions.leases.items() if time.monotonic() - last > LEASE_SECONDS]
            for token in quiet:
                if workspace.unsubscribe(token, expired_only=True, revoke=True):
                    self.on_disconnect(token, revoke=True)
                    expired += 1
        return expired

    def on_disconnect(self, token: str, revoke: bool = False) -> None:
        """A session's stream closed. The host leaving ends a hosted session."""
        with self.lock:
            workspace_id = self.token_workspace.get(token)
            meta = self.hosted.get(workspace_id) if workspace_id else None
            is_host = bool(meta and meta.get("ownerToken") == token)
        if is_host:
            self._end_hosted(workspace_id)
        elif revoke:
            with self.lock:
                self.token_workspace.pop(token, None)

    def close_session(self, token: str) -> None:
        workspace = self.broker_for_token(token)
        workspace.authorize(token)
        workspace.unsubscribe(token, revoke=True)
        self.on_disconnect(token, revoke=True)

    def _end_hosted(self, workspace_id: str) -> None:
        with self.lock:
            self.hosted.pop(workspace_id, None)
            self.workspaces.pop(workspace_id, None)
            for token in [token for token, key in self.token_workspace.items() if key == workspace_id]:
                self.token_workspace.pop(token, None)
        _log("HOST", f"Evicted ephemeral {workspace_id} (master left)")

    def broker_for_token(self, token: str):
        """The workspace a session belongs to. An unknown token goes to the PIN
        session, whose authorize() refuses it the usual way."""
        with self.lock:
            workspace_id = self.token_workspace.get(token)
        workspace = self.get(workspace_id) if workspace_id else None
        return workspace or self.default

    def forget_token(self, token: str) -> None:
        with self.lock:
            self.token_workspace.pop(token, None)
