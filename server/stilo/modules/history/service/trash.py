"""The trash: a deleted project or folder is kept, with its history, for a
number of days (at most 30), then removed for good by the daily sweep. Its
owner can restore it or remove it sooner. History left behind by projects
deleted before the trash existed is found by the sweep and expires the same
way (it can be removed, not restored: only its history is left).

Who may do what is Identity's (in_team, may_delete: the same rule as deleting);
where a project lives comes from the `places` port (the server's registry):

    places.folder(team, relpath) -> Path                 where a project lives (or would)
"""
import time
from pathlib import PurePosixPath

from stilo.kernel.log import log as _log
from ..model.trash import expired, expires_at, free_name


class Trash:
    def __init__(self, store, identity, places, days: int, lock):
        """store: adapters/trash_store.py; lock: shared with backups, so a
        backup never writes into a project's history while it moves."""
        self.store = store
        self._identity = identity
        self._places = places
        self.days = days
        self.lock = lock

    def put(self, username: str, team: str, relpath: str, folder, kind: str) -> dict:
        """Called by the delete itself, which has checked who may delete."""
        with self.lock:
            record = self.store.put(team, relpath, folder, {
                "name": PurePosixPath(relpath).name, "kind": kind,
                "deletedBy": username, "deletedAt": int(time.time() * 1000)})
        _log("TRASH", f"{username} moved {team}/{relpath} to the trash")
        return record

    def _check(self, identity, team, entry):
        folder = self.store.files(team, entry["id"])
        if folder is not None:
            self._identity.may_delete(identity, team, folder)

    def _summary(self, identity, team, entry) -> dict:
        try:
            self._check(identity, team, entry)
            allowed = True
        except PermissionError:
            allowed = False
        restorable = allowed and self.store.files(team, entry["id"]) is not None
        return {key: entry.get(key) for key in ("id", "path", "name", "kind", "deletedBy", "deletedAt")} | {
            "expiresAt": expires_at(entry, self.days), "restorable": restorable, "removable": allowed}

    def list(self, token: str, team: str) -> dict:
        identity, team = self._identity.in_team(token, team)
        entries = sorted(self.store.entries(team), key=lambda entry: entry.get("deletedAt", 0), reverse=True)
        return {"days": self.days, "entries": [self._summary(identity, team, entry) for entry in entries]}

    def restore(self, token: str, team: str, entry_id: str) -> dict:
        identity, team = self._identity.in_team(token, team)
        with self.lock:
            entry = self.store.get(team, entry_id)
            if self.store.files(team, entry_id) is None:
                raise ValueError("Only the history of this project was kept; it cannot be restored")
            self._check(identity, team, entry)
            original = PurePosixPath(entry["path"])
            parent = "" if str(original.parent) == "." else str(original.parent)
            def taken(name):
                rel = f"{parent}/{name}" if parent else name
                return self._places.folder(team, rel).exists() or self.store.history_at(team, rel)
            name = free_name(original.name, taken)
            relpath = f"{parent}/{name}" if parent else name
            self.store.restore(team, entry_id, relpath, self._places.folder(team, relpath))
        _log("TRASH", f"{identity['username']} restored {team}/{entry['path']} as {relpath}")
        return {"team": team, "path": relpath, "name": name, "kind": entry.get("kind")}

    def delete(self, token: str, team: str, entry_id: str) -> dict:
        identity, team = self._identity.in_team(token, team)
        with self.lock:
            entry = self.store.get(team, entry_id)
            self._check(identity, team, entry)
            self.store.remove(team, entry_id)
        _log("TRASH", f"{identity['username']} removed {team}/{entry['path']} from the trash")
        return {"deleted": True}

    def sweep(self, now=None) -> int:
        """Adopt history whose project is gone; remove what has expired. Returns how many went."""
        now_ms = int((time.time() if now is None else now) * 1000)
        removed = 0
        with self.lock:
            for team in self.store.teams():
                for relpath in self.store.kept_paths(team):
                    if not self._places.folder(team, relpath).exists():
                        self.store.put(team, relpath, None, {"name": PurePosixPath(relpath).name, "kind": "history",
                                                             "deletedBy": "", "deletedAt": now_ms})
                        _log("TRASH", f"history of {team}/{relpath}, whose project is gone, moved to the trash")
                for entry in expired(self.store.entries(team), now_ms, self.days):
                    self.store.remove(team, entry["id"])
                    removed += 1
                    _log("TRASH", f"{team}/{entry['path']} left the trash for good after {self.days} days")
        return removed
