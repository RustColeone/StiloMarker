"""A project kept as one JSON file (the PIN session from before team
workspaces): {project, revision}, replaced atomically on each commit."""
import json
from pathlib import Path

from ..model.tree import default_project
from .files import atomic_write


class StateFile:
    def __init__(self, path: Path):
        self.path = Path(path)

    def load(self):
        if not self.path.exists():
            return None
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return data.get("project") or default_project(), int(data.get("revision", 0))

    def save(self, project: dict, revision: int, previous=None) -> dict:
        atomic_write(self.path, json.dumps({"project": project, "revision": revision}, ensure_ascii=False).encode("utf-8"))
        return project
