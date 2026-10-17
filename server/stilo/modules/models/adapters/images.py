"""Generated images kept on the server until the user keeps or drops the
edit that proposed them; the proposal carries only their id, so chat history
and sync never carry the bytes."""
import json
import re
import threading
import time
import uuid
from pathlib import Path


class GeneratedImages:
    """Generated images awaiting (or recently past) the user's Keep/Drop. Each
    belongs to the account that asked for it; old ones are removed."""

    ID = re.compile(r"^[0-9a-f]{32}$")

    def __init__(self, root: Path, ttl_seconds: float = 14 * 24 * 3600):
        self.root = Path(root)
        self.ttl = ttl_seconds
        self.lock = threading.Lock()

    def store(self, data: bytes, mime: str, extension: str, owner: str, prompt: str) -> str:
        image_id = uuid.uuid4().hex
        meta = {"owner": owner, "mime": mime, "extension": extension,
                "prompt": prompt[:2000], "created": time.time(), "bytes": len(data)}
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            self._purge()
            (self.root / f"{image_id}{extension}").write_bytes(data)
            (self.root / f"{image_id}.json").write_text(json.dumps(meta), encoding="utf-8")
        return image_id

    def load(self, image_id: str, owner: str):
        """(bytes, mime) for the owner, else None."""
        if not self.ID.match(str(image_id or "")):
            return None
        try:
            meta = json.loads((self.root / f"{image_id}.json").read_text(encoding="utf-8"))
            if meta.get("owner") != owner:
                return None
            return (self.root / f"{image_id}{meta['extension']}").read_bytes(), meta["mime"]
        except (OSError, ValueError, KeyError):
            return None

    def _purge(self) -> None:
        cutoff = time.time() - self.ttl
        for meta_path in self.root.glob("*.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if meta.get("created", 0) >= cutoff:
                    continue
                (self.root / f"{meta_path.stem}{meta.get('extension', '')}").unlink(missing_ok=True)
                meta_path.unlink(missing_ok=True)
            except (OSError, ValueError):
                continue
