"""Writing project files safely: atomic replace with fsync, and image bytes
from data: URLs."""
import base64
import os
import tempfile
from pathlib import Path


def fsync_directory(path: Path):
    if os.name == "nt":
        return  # Windows does not expose directory fsync through os.open.
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write(path: Path, data: bytes):
    """Flush a sibling temporary file, then replace the destination atomically."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            if path.exists():
                os.chmod(name, path.stat().st_mode & 0o777)
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
        fsync_directory(path.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def decode_data_url(url: str) -> bytes | None:
    """The bytes of a base64 data: URL; None if it isn't one."""
    value = str(url or "")
    if not value.startswith("data:") or ";base64," not in value:
        return None
    try:
        return base64.b64decode(value.split(";base64,", 1)[1])
    except (ValueError, base64.binascii.Error):
        return None
