"""Writing project files safely: atomic replace with fsync, a file that no
longer reads set aside before it is replaced, and image bytes from data: URLs."""
import base64
import json
import os
import tempfile
import time
from pathlib import Path

from stilo.kernel.log import ignore, log


def fsync_directory(path: Path):
    if os.name == "nt":
        return  # Windows does not expose directory fsync through os.open.
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def set_aside_unreadable(path: Path, valid=lambda data: True) -> Path | None:
    """A JSON file about to be replaced that does not read as it should (cut
    short, edited by hand): renamed <name>.unreadable-<time><suffix> and kept,
    so writing the new one loses nothing; the log names it. Returns where it
    went, or None when it read well (or was not there)."""
    path = Path(path)
    if not path.exists():
        return None
    try:
        if valid(json.loads(path.read_text(encoding="utf-8"))):
            return None
    except (OSError, ValueError) as error:
        ignore(error, f"{path} does not read; it is set aside before it is replaced")
    kept = path.with_name(f"{path.stem}.unreadable-{time.strftime('%Y%m%dT%H%M%S')}{path.suffix}")
    os.replace(path, kept)
    log("kept", f"{path.name} did not read; set aside before a new one was written", kept=str(kept))
    return kept


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
