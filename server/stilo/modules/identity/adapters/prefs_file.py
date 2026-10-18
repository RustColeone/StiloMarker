"""Per-account preferences kept on the server (user-prefs.json in the data
folder), so any device can offer to resume the workspace an account last
opened. Without a data folder nothing is kept."""
import json
import time
from pathlib import Path
from stilo.kernel.log import ignore

PREFS_FILE = "user-prefs.json"


class UserPrefs:
    def __init__(self, data_dir: Path | None):
        self.path = (Path(data_dir) / PREFS_FILE) if data_dir else None

    def _all(self) -> dict:
        if not self.path or not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError) as error:
            ignore(error, f"{self.path} is unreadable; no account remembers its last workspace")
            return {}

    def get(self, username: str) -> dict:
        entry = self._all().get(username)
        return entry if isinstance(entry, dict) else {}

    def set_last_workspace(self, username: str, team: str, path: str) -> None:
        if not self.path:
            return
        try:
            data = self._all()
            data[username] = {"lastWorkspace": {"team": team, "path": path}, "updatedAt": time.time()}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(data, indent=2), encoding="utf-8")
        except OSError as error:
            ignore(error, f"remembering {username}'s last workspace failed")
