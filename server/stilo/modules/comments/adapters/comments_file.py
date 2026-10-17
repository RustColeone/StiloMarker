"""A project's comments, kept as comments.json inside the project folder so
they travel with it; replaced atomically."""
import json
from pathlib import Path

from stilo.modules.workspace import atomic_write
from ..model.comments import empty

COMMENTS_FILE = "comments.json"


def read_comments(project_dir: Path) -> dict:
    path = Path(project_dir) / COMMENTS_FILE
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("files"), dict):
                return data
        except (OSError, json.JSONDecodeError):
            pass
    return empty()


def write_comments(project_dir: Path, data: dict) -> None:
    atomic_write(Path(project_dir) / COMMENTS_FILE, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
