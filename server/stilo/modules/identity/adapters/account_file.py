"""The account file: a hand-edited JSON list of accounts and their teams,
re-read when it changes. The rest of the server never reads it."""
import json
import time
from pathlib import Path

from stilo.kernel.log import log as _log

ACCOUNT_FILE = "whitelist.json"


class AccountStore:
    """Whitelist of accounts loaded from a JSON file.

    Passwords are PLAINTEXT by deployment choice (single trusted admin, behind
    TLS, and the file is kept out of the web-served set: the server's static
    file denylist names ACCOUNT_FILE). The file is hand-editable:

        { "users": [ { "username": "alice", "password": "pw", "teams": ["red"] } ] }

    When the file is absent, the accounts feature is simply disabled and the app
    keeps working in PIN-only / local modes.
    """

    def __init__(self, path: Path | None):
        self.path = path
        self.users: dict[str, dict] = {}  # username -> {"password", "teams": [...]}
        self._signature = None  # (mtime_ns, size) of the file last read
        self._checked = 0.0
        self._load()

    @property
    def enabled(self) -> bool:
        self.refresh()
        return bool(self.users)

    def refresh(self, interval: float = 2.0) -> None:
        """Re-read the file when it changed (checked at most every `interval`
        seconds), so adding or removing an account needs no restart."""
        now = time.monotonic()
        if not self.path or now - self._checked < interval:
            return
        self._checked = now
        try:
            stat = self.path.stat()
        except OSError:
            return  # a missing file keeps the accounts already loaded
        if (stat.st_mtime_ns, stat.st_size) != self._signature:
            self._load()

    def _load(self) -> None:
        """Read the file. A file that cannot be parsed keeps the last good
        accounts (so a typo never locks everyone out) and is reported once."""
        if not self.path or not self.path.exists():
            return
        try:
            stat = self.path.stat()
            self._signature = (stat.st_mtime_ns, stat.st_size)
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("users", []), list):
                raise ValueError('expected {"users": [...]}')
        except (json.JSONDecodeError, OSError, ValueError) as error:
            kept = f"; keeping the {len(self.users)} account(s) already loaded" if self.users else "; no accounts are loaded"
            _log("AUTH", f"WARNING: cannot read whitelist {self.path}: {error}{kept}. Fix the file; it is re-read when it changes.")
            return
        users = {}
        for entry in data.get("users", []):
            if not isinstance(entry, dict):
                continue
            username = str(entry.get("username", "")).strip()
            if not username:
                continue
            teams = [str(t).strip() for t in entry.get("teams", []) if str(t).strip()]
            users[username] = {"password": str(entry.get("password", "")), "teams": teams}
        self.users = users
        _log("AUTH", f"Loaded {len(self.users)} account(s) from {self.path}")

    def authenticate(self, username: str, password: str) -> dict | None:
        self.refresh()
        user = self.users.get(username)
        if user is None or not password or user["password"] != password:
            return None
        return {"username": username, "teams": list(user["teams"])}

    def teams_for(self, username: str) -> list[str]:
        self.refresh()
        return list(self.users.get(username, {}).get("teams", []))

    def team_members(self, team: str) -> list[str]:
        self.refresh()
        return [name for name, user in self.users.items() if team in user.get("teams", [])]
