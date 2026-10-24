"""The sign-ins this server keeps (sign-ins.json in the data folder, readable
by its owner only), so a restart signs no one out. Only a hash of each token
is kept, so the file itself signs no one in. Without a data folder they are
kept in memory, until the server stops.

    { "signIns": { "<sha-256 of the token>": { "username": "leo", "made": 1761200000.0, "used": 1761210000.0 } } }
"""
import hashlib
import json
import os
from pathlib import Path

from stilo.kernel.log import ignore

SIGN_INS_FILE = "sign-ins.json"


def token_key(token: str) -> str:
    """What the file keeps of a token."""
    return hashlib.sha256(str(token).encode("utf-8")).hexdigest()


class SignIns:
    """token key -> {"username", "made", "used"} (seconds since the epoch)."""

    def __init__(self, data_dir: Path | None):
        self.path = (Path(data_dir) / SIGN_INS_FILE) if data_dir else None
        self.entries: dict[str, dict] = self._read()

    def _read(self) -> dict:
        if not self.path or not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as error:
            ignore(error, f"{self.path} does not read; every account signs in again")
            return {}
        entries = data.get("signIns") if isinstance(data, dict) else None
        if not isinstance(entries, dict):
            return {}
        return {key: {"username": entry["username"], "made": float(entry.get("made", entry["used"])), "used": float(entry["used"])}
                for key, entry in entries.items()
                if isinstance(entry, dict) and isinstance(entry.get("username"), str) and isinstance(entry.get("used"), (int, float))}

    def save(self) -> None:
        """Written whole and at once, readable by its owner only."""
        if not self.path:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_name(f".{self.path.name}.{os.getpid()}.tmp")
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(json.dumps({"signIns": self.entries}, indent=1) + "\n")
            os.replace(temporary, self.path)
        except OSError as error:
            ignore(error, "keeping the sign-ins failed; they last until the server restarts")
