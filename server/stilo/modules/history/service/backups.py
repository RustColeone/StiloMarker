"""Backups: whole-workspace history, so a bad day (everything deleted, a
chapter overwritten) can be undone to an earlier state. A workspace is backed
up only on days it changed (one "daily" copy per active day, refreshed to the
day's latest state), and just before anything destructive (a "safety" copy),
or by hand. Unchanged files are shared between backups, so a day's backup
costs roughly what changed."""
import base64
import copy
import mimetypes
import secrets
import threading
import time

from stilo.kernel.log import log as _log
from stilo.modules.workspace import file_key
from ..model.retention import POLICY, backup_summary, backups_to_drop, skip_backup

MAX_FILE_BYTES = 25 * 1024 * 1024


class Backups:
    def __init__(self, store_for, types, paths, image_bytes, policy=POLICY):
        """store_for(team, relpath) -> a BlobStore for that project's backups;
        types: File types; paths(project) -> [(node_id, path, node)] but the
        root; image_bytes(workspace, path, node) -> bytes (adapters/images.py)."""
        self.store = store_for
        self._types = types
        self._paths = paths
        self._image_bytes = image_bytes
        self.policy = policy
        self.lock = threading.RLock()

    def _capture(self, workspace):
        """(revision, folders, files) of a live workspace, read under its lock.
        Text comes from memory; images kept as files are read from disk."""
        with workspace.lock:
            project = copy.deepcopy(workspace.project)
            revision = workspace.revision
        folders, files = [], []
        for _, path, node in self._paths(project):
            if node.get("kind") == "folder":
                folders.append(path)
                continue
            image = self._types.is_image(node.get("name", ""))
            raw = self._image_bytes(workspace, path, node) if image else str(node.get("content") or "").encode("utf-8")
            if len(raw) <= MAX_FILE_BYTES:
                files.append((path, raw, image))
        return revision, sorted(folders), sorted(files, key=lambda item: item[0])

    def back_up(self, workspace, team: str, relpath: str, kind="daily", label="", now=None) -> dict | None:
        """Back up one live workspace; its summary, or None when there was nothing to do."""
        stamp = int((time.time() if now is None else now) * 1000)
        day = time.strftime("%Y-%m-%d", time.gmtime(stamp / 1000))
        store = self.store(team, relpath)
        with self.lock:
            index = store.load()
            backups = index["backups"]
            if skip_backup(backups[-1] if backups else None, kind, workspace.revision, stamp, self.policy):
                return None
            revision, folders, files = self._capture(workspace)
            entries = [{"path": path, "blob": store.put(index, raw), "size": len(raw), **({"image": True} if image else {})}
                       for path, raw, image in files]
            backup = {"id": f"{stamp}-{secrets.token_hex(4)}", "createdAt": stamp, "day": day, "kind": kind,
                      "label": str(label or "")[:200], "revision": revision, "folders": folders, "files": entries,
                      "size": sum(entry["size"] for entry in entries)}
            if kind == "daily":  # one per active day: the day's latest state
                for old in [b for b in backups if b.get("kind") == "daily" and b.get("day") == day]:
                    self._drop(store, index, old)
            backups.append(backup)
            backups.sort(key=lambda b: b.get("createdAt", 0))
            for old in backups_to_drop(backups, stamp, self.policy):
                self._drop(store, index, old)
            store.save(index)
        return backup_summary(backup)

    @staticmethod
    def _drop(store, index, backup):
        index["backups"].remove(backup)
        for entry in backup.get("files", []):
            store.release(index, entry["blob"])

    def before_destructive(self, workspace, team: str, relpath: str, reason: str) -> None:
        """A safety copy just before a destructive change; never blocks the change."""
        try:
            self.back_up(workspace, team, relpath, kind="safety", label=f"Before {reason}")
        except Exception as error:  # noqa: BLE001
            _log("BACKUP", f"safety backup failed for {team}/{relpath}: {error}")

    def sweep(self, live, now=None) -> int:
        """Daily backups of every live workspace ((team, relpath, workspace), ...) that changed."""
        made = 0
        for team, relpath, workspace in live:
            try:
                if self.back_up(workspace, team, relpath, kind="daily", now=now):
                    made += 1
            except Exception as error:  # noqa: BLE001 - one workspace must not stop the others
                _log("BACKUP", f"daily backup failed for {team}/{relpath}: {error}")
        return made

    def _find(self, team, relpath, backup_id):
        index = self.store(team, relpath).load()
        backup = next((b for b in index["backups"] if b.get("id") == str(backup_id)), None)
        if backup is None:
            raise ValueError("That backup no longer exists")
        return backup

    def list(self, team: str, relpath: str) -> dict:
        with self.lock:
            index = self.store(team, relpath).load()
        return {"backups": [backup_summary(b) for b in sorted(index["backups"], key=lambda b: -b.get("createdAt", 0))]}

    def files(self, team: str, relpath: str, backup_id) -> dict:
        with self.lock:
            backup = self._find(team, relpath, backup_id)
        return {"backup": backup_summary(backup), "folders": backup.get("folders", []),
                "files": [{"path": e["path"], "size": e["size"], "image": bool(e.get("image")), "blob": e["blob"]}
                          for e in backup.get("files", [])]}

    def content(self, team: str, relpath: str, backup_id, file_path) -> dict:
        key = file_key(file_path)
        store = self.store(team, relpath)
        with self.lock:
            backup = self._find(team, relpath, backup_id)
            entry = next((e for e in backup.get("files", []) if e["path"] == key), None)
            if entry is None:
                raise ValueError("That file is not in this backup")
            raw = store.read(entry["blob"])
        if entry.get("image"):
            mime = self._types.mime_of(key) or mimetypes.guess_type(key)[0] or "application/octet-stream"
            return {"path": key, "image": True, "content": f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"}
        return {"path": key, "image": False, "content": raw.decode("utf-8", errors="replace")}
