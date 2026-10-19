"""The teams' projects as callers ask for them: every request names the
account (its token), and is answered only within that account's teams and
the projects it may open (Identity's rules, over the project's access file).

Listing a folder (its folders, and the projects the caller may open), making
a folder, each account's open files in a project, the flat workspaces from
before folders (the team's index), and the questions other modules ask about
a place: where it is, whether an account may open or edit it, who may.
Bookkeeping files other modules keep in a project are never listed as
entries: their owners name them (reserve)."""
import threading
import time

from stilo.kernel.log import log as _log
from stilo.modules.identity import ACCESS_FILE
from stilo.modules.workspace import MANIFEST
from ..adapters.team_folders import INDEX_FILE, USER_STATE_FILE
from ..model.paths import safe_component, safe_relpath


class Projects:
    def __init__(self, identity, folders):
        self.identity, self.folders = identity, folders
        self._index_lock = threading.Lock()  # the team index is read, changed and written whole
        self._reserved = {INDEX_FILE, MANIFEST, USER_STATE_FILE, ACCESS_FILE}

    def reserve(self, *names):
        """Names of bookkeeping files kept in a project or a team's folder."""
        self._reserved.update(names)

    def is_reserved(self, name: str) -> bool:
        return name in self._reserved

    # ---- where a project is, and what its access file says ------------------
    def legacy_meta(self, team: str, relpath: str):
        """The index entry of a flat workspace from before folders
        (workspaces/<name>), or None."""
        parts = relpath.split("/")
        if len(parts) != 2 or parts[0] != "workspaces":
            return None
        try:
            index = self.folders.read_index(team)
        except (ValueError, PermissionError):
            return None
        return index["workspaces"].get(parts[1])

    def project(self, team: str, path: str, must_exist: bool = False):
        """(the project's folder, its legacy meta getter) for the access routes."""
        relpath = safe_relpath(path)
        project_dir = self.folders.under_team(safe_component(team), relpath)
        if must_exist and not self.folders.is_project(project_dir):
            raise ValueError("Not a project directory")
        return project_dir, lambda: self.legacy_meta(team, relpath)

    def read_access(self, team: str, relpath: str) -> dict:
        project_dir, legacy = self.project(team, relpath)
        return self.identity.access(project_dir, legacy)

    def role_for(self, identity: dict, team: str, relpath: str) -> str:
        return self.identity.role(identity, self.read_access(team, relpath))

    def can_access(self, identity: dict, team: str, relpath: str) -> bool:
        return self.identity.may_open(identity, team, self.read_access(team, relpath))

    def get_access(self, token: str, team: str, path: str) -> dict:
        """The project's access file (who may open it, in what role)."""
        identity = self.identity.require(token)
        project_dir, legacy = self.project(self.identity.require_team(identity, team), path)
        return self.identity.access(project_dir, legacy)

    def set_access(self, token: str, team: str, path: str, whitelist: list, blacklist: list, readers: list | None = None) -> dict:
        """Change it (Identity's rules say who may)."""
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        project_dir, legacy = self.project(team, path, must_exist=True)
        return self.identity.set_access(identity, team, project_dir, whitelist, blacklist, readers, legacy)

    def may_edit(self, identity, team, relpath) -> bool:
        return self.identity.can(identity, "edit", team, self.read_access(team, relpath))

    def project_dir(self, team, relpath):
        return self.folders.under_team(team, relpath)

    def folder(self, team: str, relpath: str):
        """Where a project lives (or would): History's trash restores there."""
        return self.folders.under_team(safe_component(team), safe_relpath(relpath))

    def people(self, team: str, relpath: str) -> list[str]:
        """Everyone in the team who may open this project (Chats' contacts)."""
        return [name for name in self.identity.team_members(team)
                if self.can_access(self.identity.member(name), team, relpath)]

    def authorize_project(self, token, team, path):
        """(identity, team, relpath) when the account may open the project there."""
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        relpath = safe_relpath(path)
        if not relpath:
            raise ValueError("A project path is required")
        if not self.folders.is_project(self.folders.under_team(team, relpath)):
            raise ValueError("Not a project")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that project")
        return identity, team, relpath

    def authorize_open(self, token, team, path):
        """Joining a project live: (identity, team, relpath, its folder, the
        account's role there). A flat workspace from before folders opens too."""
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        relpath = safe_relpath(path)
        project_dir = self.folders.under_team(team, relpath)
        if not self.folders.is_project(project_dir) and self.legacy_meta(team, relpath) is None:
            raise PermissionError("Unknown workspace")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that workspace")
        return identity, team, relpath, project_dir, self.role_for(identity, team, relpath)

    # ---- each account's open files ---------------------------------------------
    def read_user_state(self, team: str, relpath: str, username: str) -> dict:
        """The account's open files in this project, or none."""
        return self.folders.read_user_state(self.folders.under_team(team, relpath), username)

    def write_user_state(self, token: str, team: str, path: str, open_files: list, active_file) -> dict:
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        relpath = safe_relpath(path)
        project_dir = self.folders.under_team(team, relpath)
        if not self.folders.is_project(project_dir):
            raise ValueError("Not a project directory")
        if not self.can_access(identity, team, relpath):
            raise PermissionError("You do not have access to that workspace")
        self.folders.write_user_state(project_dir, identity["username"], open_files, active_file)
        return {"ok": True}

    # ---- the file browser ------------------------------------------------------
    def browse(self, token: str, team: str = "", path: str = "") -> dict:
        """No team: the caller's teams. A team: the folders at path, and the
        projects there the caller may open; each with when it last changed."""
        identity = self.identity.require(token)
        if not team:
            teams = []
            for name in identity["teams"]:
                try:
                    modified = self.folders.modified(self.folders.team_root(name))
                except (ValueError, PermissionError):
                    modified = None
                teams.append({"name": name, "modified": modified})
            return {"teams": teams}
        team = self.identity.require_team(identity, team)
        relpath = safe_relpath(path)
        base = self.folders.under_team(team, relpath)
        if not base.is_dir():
            # A team with no content yet browses as an empty root, not an error.
            if not relpath:
                return {"team": team, "path": "", "entries": []}
            raise ValueError("No such directory")
        if relpath and self.folders.is_project(base):
            raise ValueError("That is a project — open it instead")
        entries = []
        for child in sorted(base.iterdir(), key=lambda p: p.name.lower()):
            name = child.name
            if not child.is_dir() or self.is_reserved(name):
                continue
            child_rel = f"{relpath}/{name}" if relpath else name
            if self.folders.is_project(child):
                if not self.can_access(identity, team, child_rel):
                    continue
                owner = self.read_access(team, child_rel).get("createdBy")
                entries.append({"name": name, "kind": "project", "path": child_rel, "createdBy": owner,
                                "canEdit": owner in (None, identity["username"]), "modified": self.folders.modified(child)})
            else:
                entries.append({"name": name, "kind": "folder", "path": child_rel, "modified": self.folders.modified(child)})
        return {"team": team, "path": relpath, "entries": entries}

    def make_folder(self, token: str, team: str, path: str, name: str) -> dict:
        """A folder (not a project) at path."""
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        relpath = safe_relpath(path)
        name = safe_component(name)
        parent = self.folders.under_team(team, relpath)
        if relpath and parent.exists() and self.folders.is_project(parent):
            raise ValueError("Cannot create folders inside a project")
        parent.mkdir(parents=True, exist_ok=True)  # every segment is checked
        target = parent / name
        if target.exists():
            raise ValueError("A file or folder with that name already exists")
        target.mkdir(parents=True)
        new_rel = f"{relpath}/{name}" if relpath else name
        _log("WORKSPACE", f"{identity['username']} mkdir {team}/{new_rel}")
        return {"team": team, "path": new_rel, "name": name, "kind": "folder"}

    # ---- the flat workspaces from before folders (the team's index) ------------
    # Opened as workspaces/<name> (legacy_meta); none are made any more, except
    # by tests building that layout.
    def create_workspace(self, token: str, team: str, name: str, share_team: bool = False) -> dict:
        identity = self.identity.require(token)
        team = self.identity.require_team(identity, team)
        name = safe_component(name)
        with self._index_lock:
            index = self.folders.read_index(team)
            if name in index["workspaces"]:
                raise ValueError("A workspace with that name already exists")
            members = list(self.identity.team_members(team)) if share_team else [identity["username"]]
            if identity["username"] not in members:
                members.append(identity["username"])
            index["workspaces"][name] = {"members": members, "createdBy": identity["username"], "createdAt": time.time()}
            self.folders.write_index(team, index)
        _log("WORKSPACE", f"{identity['username']} created {team}/{name}", members=members)
        return {"team": team, "name": name, "id": f"{team}/{name}", "members": members, "createdBy": identity["username"]}
