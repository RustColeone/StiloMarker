"""A project's comments, kept as comments.json inside the project folder so
they travel with it; replaced atomically. One that no longer reads shows no
comments, and is set aside (kept) when the next comment is saved."""
import json
from pathlib import Path

from stilo.modules.workspace import atomic_write, set_aside_unreadable
from ..model.comments import empty
from stilo.kernel.log import ignore

COMMENTS_FILE = "comments.json"


def read_comments(project_dir: Path) -> dict:
    path = Path(project_dir) / COMMENTS_FILE
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("files"), dict):
                return data
        except (OSError, json.JSONDecodeError) as error:
            ignore(error, f"{path} is unreadable; showing no comments (the next comment sets it aside)")
    return empty()


def write_comments(project_dir: Path, data: dict) -> None:
    path = Path(project_dir) / COMMENTS_FILE
    set_aside_unreadable(path, valid=lambda kept: isinstance(kept, dict) and isinstance(kept.get("files"), dict))
    atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
