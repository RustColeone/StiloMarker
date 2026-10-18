"""A content-addressed store of gzip-compressed blobs with reference counts,
plus the JSON index that names them: one folder per project, for snapshots
(data/_snapshots/<team>/<project>) and for backups (data/_backups/...). A blob
shared by many versions is kept once and deleted with its last reference."""
import gzip
import hashlib
import json
from pathlib import Path

from stilo.modules.workspace import atomic_write
from stilo.kernel.log import ignore


class BlobStore:
    def __init__(self, folder: Path, empty: dict):
        """empty: what the index holds before anything is stored (its lists)."""
        self.folder = Path(folder)
        self._empty = empty

    def load(self) -> dict:
        path = self.folder / "index.json"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for key, value in self._empty.items():
                        data.setdefault(key, type(value)())
                    data.setdefault("refs", {})
                    data.setdefault("bytes", 0)
                    return data
            except (OSError, json.JSONDecodeError) as error:
                ignore(error, f"{path} is unreadable; starting an empty index")
        return {**{key: type(value)() for key, value in self._empty.items()}, "refs": {}, "bytes": 0}

    def save(self, index: dict) -> None:
        self.folder.mkdir(parents=True, exist_ok=True)
        atomic_write(self.folder / "index.json", json.dumps(index, ensure_ascii=False).encode("utf-8"))

    def _path(self, blob: str) -> Path:
        return self.folder / "blobs" / f"{blob}.gz"

    def put(self, index: dict, raw: bytes) -> str:
        """Store bytes (once) and count one more reference; returns the blob id."""
        blob = hashlib.sha256(raw).hexdigest()
        path = self._path(blob)
        if not path.exists():
            packed = gzip.compress(raw, mtime=0)
            atomic_write(path, packed)
            index["bytes"] += len(packed)
        index["refs"][blob] = index["refs"].get(blob, 0) + 1
        return blob

    def release(self, index: dict, blob: str) -> None:
        """One reference fewer; the blob goes with its last one."""
        refs = index["refs"]
        refs[blob] = refs.get(blob, 1) - 1
        if refs[blob] > 0:
            return
        refs.pop(blob, None)
        try:
            index["bytes"] = max(0, index["bytes"] - self._path(blob).stat().st_size)
            self._path(blob).unlink()
        except OSError as error:
            ignore(error, f"removing the unused blob {blob} failed")

    def read(self, blob: str) -> bytes:
        return gzip.decompress(self._path(blob).read_bytes())
