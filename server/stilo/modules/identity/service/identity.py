"""Signed-in accounts and the access questions about them. One per server
(tests make several). The account file, the access records and the
preferences are reached through the stores it is given."""
import secrets
import threading

from stilo.kernel.log import log as _log
from ..model import accounts as account_rules
from ..model.access import can, changed_access, may_open, owned_by_other, owner_record, require_owner, role_of


class Identity:
    def __init__(self, accounts, prefs, access_store):
        self.accounts = accounts          # the account file (adapters/account_file.py)
        self.prefs = prefs                # adapters/prefs_file.py
        self._access = access_store       # read(project_dir, legacy), write(project_dir, data), projects_in(folder)
        self._tokens: dict[str, str] = {}  # account token -> username
        self._lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        """Whether this server has accounts at all (an account file with someone in it)."""
        return self.accounts.enabled

    # ---- signing in --------------------------------------------------------

    def login(self, username: str, password: str) -> dict:
        """Check a password and mint an account token (not a workspace session
        token). The reply also names the workspace the account last opened."""
        identity = self.accounts.authenticate(str(username).strip(), password)
        if identity is None:
            _log("AUTH", f"Rejected login for {username!r}")
            raise PermissionError("Invalid username or password")
        token = secrets.token_urlsafe(24)
        with self._lock:
            self._tokens[token] = identity["username"]
        _log("AUTH", f"{identity['username']} logged in", teams=identity["teams"])
        return {"token": token, "username": identity["username"], "teams": identity["teams"], "admin": identity["admin"],
                "lastWorkspace": self.prefs.get(identity["username"]).get("lastWorkspace")}

    def who(self, token: str) -> dict | None:
        """{username, teams, admin} for an account token, or None. They are read
        from the account file each time, so a change there applies at once, and
        an account removed from it is signed out."""
        with self._lock:
            username = self._tokens.get(token)
        if username is None:
            return None
        if not self.accounts.exists(username):
            with self._lock:
                self._tokens.pop(token, None)
            return None
        return {"username": username, "teams": self.accounts.teams_for(username), "admin": self.accounts.is_admin(username)}

    def require(self, token: str) -> dict:
        identity = self.who(token)
        if identity is None:
            raise PermissionError("Not logged in")
        return identity

    def require_team(self, identity: dict, team: str) -> str:
        team = str(team or "").strip()
        if not team:
            raise ValueError("Invalid name")
        if team not in identity["teams"]:
            raise PermissionError("You are not a member of that team")
        return team

    # ---- the admin page (admins only; the rules are model/accounts.py) -------

    def _require_admin(self, token: str) -> dict:
        identity = self.require(token)
        if not identity["admin"]:
            raise PermissionError("Only an admin can manage accounts")
        return identity

    def accounts_list(self, token: str) -> list[dict]:
        """Every account, its teams and whether it is an admin (never a password)."""
        self._require_admin(token)
        self.accounts.refresh(0)
        return account_rules.listing(self.accounts.users)

    def accounts_change(self, token: str, change: dict) -> list[dict]:
        """One change (add, password, teams, admin, remove), kept in the account
        file; the accounts as they then are. A removed account is signed out."""
        admin = self._require_admin(token)
        action, username = str(change.get("action", "")), str(change.get("username", "")).strip()
        with self._lock:
            self.accounts.refresh(0)  # the file as it is now (server/accounts.py may have changed it)
            users = self.accounts.users
            if action == "add":
                users = account_rules.add_account(users, username, str(change.get("password", "")), change.get("teams") or [], change.get("admin") is True)
            elif action == "password":
                users = account_rules.set_password(users, username, str(change.get("password", "")))
            elif action == "teams":
                users = account_rules.set_teams(users, username, change.get("teams") or [])
            elif action == "admin":
                users = account_rules.set_admin(users, username, change.get("admin") is True)
            elif action == "remove":
                users = account_rules.remove_account(users, username)
            else:
                raise ValueError(f"Unknown change: {action!r}")
            self.accounts.save(users)
            if action == "remove":
                self._tokens = {token: name for token, name in self._tokens.items() if name != username}
        _log("AUTH", f"{admin['username']} changed accounts: {action} {username}")
        return account_rules.listing(self.accounts.users)

    def logout(self, token: str) -> None:
        with self._lock:
            self._tokens.pop(token, None)

    def team_members(self, team: str) -> list[str]:
        return self.accounts.team_members(team)

    def member(self, username: str) -> dict:
        return {"username": username, "teams": self.accounts.teams_for(username), "admin": self.accounts.is_admin(username)}

    def remember_workspace(self, username: str, team: str, path: str) -> None:
        self.prefs.set_last_workspace(username, team, path)

    # ---- projects ------------------------------------------------------------

    def access(self, project_dir, legacy=lambda: None) -> dict:
        return self._access.read(project_dir, legacy)

    def may_open(self, identity: dict, team: str, access: dict) -> bool:
        return may_open(access, identity["username"], identity["teams"], team)

    def role(self, identity: dict, access: dict) -> str:
        return role_of(access, identity["username"])

    def can(self, identity: dict, action: str, team: str, access: dict) -> bool:
        """May this account do `action` (open, edit, replace) on the project
        whose access record is given?"""
        return self.may_open(identity, team, access) and can(self.role(identity, access), action)

    def owned_by_other(self, identity: dict, access: dict) -> bool:
        return owned_by_other(access, identity["username"])

    def require_owner(self, identity: dict, team: str, access: dict, refusal: str) -> None:
        require_owner(access, identity["username"], self.may_open(identity, team, access), refusal)

    def in_team(self, token: str, team: str) -> tuple:
        """(identity, team) for an account token in that team; raises otherwise."""
        identity = self.require(token)
        return identity, self.require_team(identity, team)

    def may_delete(self, identity: dict, team: str, folder, legacy=lambda: None) -> None:
        """A project: only its owner. Another folder: anyone in the team, unless
        it holds projects someone else owns. Reads the access files where the
        folder is now (in the team, or in the trash). Raises PermissionError."""
        is_project, projects = self._access.projects_in(folder)
        if is_project:
            self.require_owner(identity, team, self.access(folder, legacy), "Only the project owner can delete this project")
        elif any(self.owned_by_other(identity, self.access(project)) for project in projects):
            raise PermissionError("This folder contains projects owned by others")

    def claim(self, identity: dict, project_dir) -> None:
        """Record `identity` as the owner of a project they just made or imported."""
        self._access.write(project_dir, owner_record(identity["username"]))

    def set_access(self, identity: dict, team: str, project_dir, whitelist, blacklist, readers=None,
                   legacy=lambda: None) -> dict:
        current = self.access(project_dir, legacy)
        data = changed_access(current, identity["username"], self.may_open(identity, team, current),
                              whitelist, blacklist, readers)
        self._access.write(project_dir, data)
        _log("WORKSPACE", f"{identity['username']} set access on {team}/{getattr(project_dir, 'name', project_dir)}")
        return self.access(project_dir, legacy)
