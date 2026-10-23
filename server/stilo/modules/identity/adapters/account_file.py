"""The account file: a JSON list of accounts, their teams and who is an
admin, re-read when it changes. The rest of the server never reads it.

    { "users": [ { "username": "alice", "password": "scrypt$...", "teams": ["red"], "admin": true } ] }

Passwords are kept as salted scrypt hashes (model/passwords.py). A file from
before hashing keeps them as they are typed; they still sign in, the server
says at every load that the file needs converting, and
`python3 server/accounts.py convert --admin <name>` hashes them all once.
The file is never served (the server's static denylist names ACCOUNT_FILE).
When the file is absent at start, the accounts feature is simply disabled and
the app keeps working in PIN-only / local modes. A file deleted while the
server runs keeps the accounts it had (as a file that does not read does)
until the server restarts; to remove an account, remove it from the file.
"""
import json
import os
import time
from pathlib import Path

from stilo.kernel.log import log as _log
from ..model.passwords import hash_password, is_hashed, verify_password

ACCOUNT_FILE = "whitelist.json"
_DECOY = []


def _decoy() -> str:
    """A hash checked for a name with no account, made once."""
    if not _DECOY:
        _DECOY.append(hash_password("no account has this password"))
    return _DECOY[0]


def read_accounts(path: Path) -> dict:
    """username -> {"password", "teams", "admin"}, as the file has them. Raises
    ValueError (or OSError) for a file that is not an account file."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("users", []), list):
        raise ValueError('expected {"users": [...]}')
    users = {}
    for entry in data.get("users", []):
        if not isinstance(entry, dict) or not isinstance(entry.get("username"), str):
            continue
        username = entry["username"].strip()
        if not username:
            continue
        # Only what reads as it should: teams a list of names (a string is not
        # split into letters), a password a string (anything else signs no one in).
        raw_teams = entry.get("teams", [])
        teams = [t.strip() for t in raw_teams if isinstance(t, str) and t.strip()] if isinstance(raw_teams, list) else []
        password = entry.get("password") if isinstance(entry.get("password"), str) else ""
        users[username] = {"password": password, "teams": teams, "admin": entry.get("admin") is True}
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
        self.broken = False     # the file did not read at its last change (the accounts before it are kept)
        self.listeners = []     # listener(username, change): change is None (gone), "password", or the teams now
        self._signature = None  # (mtime_ns, size) of the file last read
        self._checked = 0.0
        self._load()

    def _changed(self, before: dict, after: dict) -> None:
        """Tell the listeners what changed for each account (a hand edit, the
        command line, the admin page): gone, a new password, other teams."""
        for username, user in before.items():
            now = after.get(username)
            change = None if now is None else "password" if now["password"] != user["password"] \
                else list(now["teams"]) if now["teams"] != user["teams"] else ...
            if change is ...:
                continue
            for listener in list(self.listeners):
                listener(username, change)

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
        except (json.JSONDecodeError, OSError, ValueError, TypeError) as error:
            self.broken = True
            kept = f"; keeping the {len(self.users)} account(s) already loaded" if self.users else "; no accounts are loaded"
            _log("AUTH", f"WARNING: cannot read the account file {self.path}: {error}{kept}. Fix the file; it is re-read when it changes.")
            return
        self.broken = False
        before, self.users = self.users, users
        self._changed(before, users)
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
        if self.broken:
            raise ValueError("The account file does not read: fix it by hand, or with server/accounts.py, first "
                             "(a change here would write the accounts from before over it)")
        write_accounts(self.path, users)
        before = self.users
        self.users = {name: {**user, "teams": list(user["teams"])} for name, user in users.items()}
        stat = self.path.stat()
        self._signature = (stat.st_mtime_ns, stat.st_size)
        self._changed(before, self.users)

    def authenticate(self, username: str, password: str) -> dict | None:
        self.refresh()
        user = self.users.get(username)
        if user is None:
            verify_password(_decoy(), password)  # as long as a real check: no telling which names exist
            return None
        if not verify_password(user["password"], password):
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
