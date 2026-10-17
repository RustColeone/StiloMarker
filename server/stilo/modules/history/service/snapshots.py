"""Snapshots: saved versions of one file, taken by hand (or migrated from a
browser's own store), newest first, within a per-file count and a per-project
size budget. Taking one never touches the project: no revision, no path
marked changed (snapshotting a file you are editing must not make your own
next write conflict)."""
import hashlib
import secrets
import threading
import time

from stilo.modules.workspace import file_key
from ..model.retention import over_budget

MAX_PER_FILE = 30
BUDGET_BYTES = 50 * 1024 * 1024  # compressed, per project
MAX_CONTENT_BYTES = 5 * 1024 * 1024


class Snapshots:
    def __init__(self, store_for, counters, limits=None):
        """store_for(team, relpath) -> a BlobStore for that project's snapshots;
        counters(team, relpath, file) -> the file's S.E.N counters now, or {}."""
        self.store = store_for
        self.counters = counters
        self.limits = {"per_file": MAX_PER_FILE, "budget": BUDGET_BYTES, "max_bytes": MAX_CONTENT_BYTES, **(limits or {})}
        self.lock = threading.Lock()

    def create(self, author: str, team: str, relpath: str, file_path, content, label="", created_at=None) -> dict:
        key = file_key(file_path)
        raw = (content if isinstance(content, str) else "").encode("utf-8")
        if len(raw) > self.limits["max_bytes"]:
            raise ValueError("File is too large to snapshot")
        store = self.store(team, relpath)
        # Read before taking this lock: the counters are read under the live
        # workspace's lock, and holding both would invent a lock order.
        baseline = self.counters(team, relpath, file_path)
        with self.lock:
            index = store.load()
            versions = index["files"].setdefault(key, [])
            importing = isinstance(created_at, (int, float)) and not isinstance(created_at, bool) and created_at > 0
            blob_id = hashlib.sha256(raw).hexdigest()
            if importing:
                # A migrated snapshot keeps its time; uploading it again is a no-op
                # (matched on time and content, not on "same as newest").
                stamp = int(created_at)
                duplicate = next((v for v in versions if v.get("createdAt") == stamp and v.get("blob") == blob_id), None)
                if duplicate:
                    return {"created": False, "version": duplicate}
            else:
                if versions and versions[0].get("blob") == blob_id:
                    return {"created": False, "version": versions[0]}
                stamp = int(time.time() * 1000)
            version = {"id": f"{stamp}-{secrets.token_hex(4)}", "blob": store.put(index, raw), "createdAt": stamp,
                       "byteSize": len(raw), "label": str(label or "")[:200], "author": author,
                       **baseline}  # the S.E.N baseline: E is the file's editSessions minus this
            versions.append(version)
            versions.sort(key=lambda v: v.get("createdAt", 0), reverse=True)
            while len(versions) > self.limits["per_file"]:
                store.release(index, versions.pop()["blob"])
            for file, old in over_budget(index["files"], keep_id=version["id"]):
                if index["bytes"] <= self.limits["budget"]:
                    break
                self._remove(store, index, file, old)
            store.save(index)
        return {"created": True, "version": version}

    @staticmethod
    def _remove(store, index, file, version):
        index["files"][file] = [v for v in index["files"].get(file, []) if v["id"] != version["id"]]
        if not index["files"][file]:
            index["files"].pop(file, None)
        store.release(index, version["blob"])

    @staticmethod
    def _find(index, version_id):
        for key, versions in index["files"].items():
            for version in versions:
                if version.get("id") == version_id:
                    return key, version
        return None, None

    def paths(self, team: str, relpath: str) -> dict:
        with self.lock:
            index = self.store(team, relpath).load()
        baselines = {key: {"count": len(versions), "editSessions": int(versions[0].get("editSessions", 0) or 0),
                           "sessionEdits": int(versions[0].get("sessionEdits", 0) or 0)}
                     for key, versions in index["files"].items() if versions}
        return {"paths": sorted(baselines), "bytes": index["bytes"], "baselines": baselines}

    def versions(self, team: str, relpath: str, file_path) -> dict:
        key = file_key(file_path)
        with self.lock:
            index = self.store(team, relpath).load()
        return {"versions": index["files"].get(key, [])}

    def content(self, team: str, relpath: str, version_id) -> dict:
        store = self.store(team, relpath)
        with self.lock:
            index = store.load()
            key, version = self._find(index, str(version_id))
            if version is None:
                raise ValueError("That snapshot no longer exists")
            try:
                text = store.read(version["blob"]).decode("utf-8")
            except (OSError, EOFError, UnicodeDecodeError):
                raise ValueError("Snapshot data is missing or damaged")
        return {"content": text, "file": key, "version": version}

    def delete(self, team: str, relpath: str, version_id) -> dict:
        store = self.store(team, relpath)
        with self.lock:
            index = store.load()
            key, version = self._find(index, str(version_id))
            if version is None:
                return {"deleted": False}
            self._remove(store, index, key, version)
            store.save(index)
        return {"deleted": True}
