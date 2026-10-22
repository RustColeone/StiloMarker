"""The account file: a JSON list of accounts, their teams and who is an
admin, re-read when it changes. The rest of the server never reads it.

    { "users": [ { "username": "alice", "password": "scrypt$...", "teams": ["red"], "admin": true } ] }

Passwords are kept as salted scrypt hashes (model/passwords.py). A file from
before hashing keeps them as they are typed; they still sign in, the server
says at every load that the file needs converting, and
`python3 server/accounts.py convert --admin <name>` hashes them all once.
The file is never served (the server's static denylist names ACCOUNT_FILE).
When the file is absent, the accounts feature is simply disabled and the app
keeps working in PIN-only / local modes.
"""
import json
import os
import time
from pathlib import Path

from stilo.kernel.log import log as _log
from ..model.passwords import is_hashed, verify_password

ACCOUNT_FILE = "whitelist.json"


def read_accounts(path: Path) -> dict:
    """username -> {"password", "teams", "admin"}, as the file has them. Raises
    ValueError (or OSError) for a file that is not an account file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("users", []), list):
        raise ValueError('expected {"users": [...]}')
    users = {}
    for entry in data.get("users", []):
        if not isinstance(entry, dict):
            continue
        username = str(entry.get("username", "")).strip()
        if not username:
            continue
        teams = [str(t).strip() for t in entry.get("teams", []) if str(t).strip()]
        users[username] = {"password": str(entry.get("password", "")), "teams": teams, "admin": entry.get("admin") is True}
    return users


def write_accounts(path: Path, users: dict) -> None:
    """The file written whole and at once (a reader sees the old file or the new
    one), readable by its owner only."""
    path = Path(path)
    data = {"users": [{"username": name, "password": user["password"], "teams": list(user["teams"]),
                       **({"admin": True} if user.get("admin") else {})} for name, user in users.items()]}
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


class AccountStore:
    """The accounts in the file, kept as it last read well."""

    def __init__(self, path: Path | None):
        self.path = path
        self.users: dict[str, dict] = {}  # username -> {"password", "teams": [...], "admin"}
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
            users = read_accounts(self.path)
        except (json.JSONDecodeError, OSError, ValueError) as error:
            kept = f"; keeping the {len(self.users)} account(s) already loaded" if self.users else "; no accounts are loaded"
            _log("AUTH", f"WARNING: cannot read the account file {self.path}: {error}{kept}. Fix the file; it is re-read when it changes.")
            return
        self.users = users
        plain = [name for name, user in users.items() if not is_hashed(user["password"])]
        _log("AUTH", f"Loaded {len(self.users)} account(s) from {self.path}")
        if plain:
            _log("AUTH", f"WARNING: {len(plain)} account(s) keep their password as typed. Hash them once with "
                         f"`python3 server/accounts.py convert --file {self.path} --admin <name>`.")
        if users and not any(user.get("admin") for user in users.values()):
            _log("AUTH", "No account is an admin: name one with `python3 server/accounts.py admin <name>`.")

    def save(self, users: dict) -> None:
        """Write the accounts (the admin page's changes) and keep them."""
        if not self.path:
            raise ValueError("This server has no account file")
        write_accounts(self.path, users)
        self.users = {name: {**user, "teams": list(user["teams"])} for name, user in users.items()}
        stat = self.path.stat()
        self._signature = (stat.st_mtime_ns, stat.st_size)

    def authenticate(self, username: str, password: str) -> dict | None:
        self.refresh()
        user = self.users.get(username)
        if user is None or not verify_password(user["password"], password):
            return None
        return {"username": username, "teams": list(user["teams"]), "admin": bool(user.get("admin"))}

    def exists(self, username: str) -> bool:
        self.refresh()
        return username in self.users

    def is_admin(self, username: str) -> bool:
        self.refresh()
        return bool(self.users.get(username, {}).get("admin"))

    def teams_for(self, username: str) -> list[str]:
        self.refresh()
        return list(self.users.get(username, {}).get("teams", []))

    def team_members(self, team: str) -> list[str]:
        self.refresh()
        return [name for name, user in self.users.items() if team in user.get("teams", [])]
