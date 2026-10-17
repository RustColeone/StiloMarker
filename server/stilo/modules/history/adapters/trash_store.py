"""The trash on disk: data/_trash/<team>/<entry id>/ holds a deleted project
or folder exactly as it was (files/), its snapshots and backups (_snapshots/,
_backups/, moved out of their roots) and a record (trash.json). Restoring
moves everything back; nothing is copied, so nothing is lost on the way."""
import json
import secrets
import shutil
import time
from pathlib import Path

from stilo.modules.workspace import atomic_write

RECORD = "trash.json"


class TrashStore:
    def __init__(self, root: Path, history_roots: dict):
        """root: data/_trash; history_roots: {"_snapshots": data/_snapshots, ...}."""
        self.root = Path(root)
        self.history_roots = {name: Path(path) for name, path in history_roots.items()}

    def _entry_dir(self, team: str, entry_id: str) -> Path:
        base = (self.root / team).resolve()
        target = (base / entry_id).resolve()
        if target.parent != base:
            raise PermissionError("Not a trash entry")
        return target

    def put(self, team: str, relpath: str, folder: Path | None, record: dict) -> dict:
        """Move `folder` (None: history only) and the history kept for `relpath` into a new entry."""
        entry_id = f"{int(time.time() * 1000)}-{secrets.token_hex(4)}"
        entry_dir = self._entry_dir(team, entry_id)
        entry_dir.mkdir(parents=True)
        record = {**record, "id": entry_id, "team": team, "path": relpath}
        atomic_write(entry_dir / RECORD, json.dumps(record, ensure_ascii=False).encode("utf-8"))
        if folder is not None:
            shutil.move(str(folder), str(entry_dir / "files"))
        for name, root in self.history_roots.items():
            source = root / team / relpath
            if source.is_dir():
                shutil.move(str(source), str(entry_dir / name))
        return record

    def entries(self, team: str) -> list:
        out = []
        base = self.root / team
        for entry_dir in sorted(base.iterdir()) if base.is_dir() else []:
            try:
                out.append(json.loads((entry_dir / RECORD).read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        return out

    def get(self, team: str, entry_id: str) -> dict:
        try:
            return json.loads((self._entry_dir(team, entry_id) / RECORD).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise LookupError("That item is no longer in the trash") from None

    def files(self, team: str, entry_id: str) -> Path | None:
        """The deleted project or folder inside an entry (None for history only)."""
        folder = self._entry_dir(team, entry_id) / "files"
        return folder if folder.is_dir() else None

    def history_at(self, team: str, relpath: str) -> bool:
        return any((root / team / relpath).exists() for root in self.history_roots.values())

    def restore(self, team: str, entry_id: str, relpath: str, target: Path) -> None:
        entry_dir = self._entry_dir(team, entry_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(entry_dir / "files"), str(target))
        for name, root in self.history_roots.items():
            if (entry_dir / name).is_dir():
                (root / team / relpath).parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(entry_dir / name), str(root / team / relpath))
        shutil.rmtree(entry_dir)

    def remove(self, team: str, entry_id: str) -> None:
        shutil.rmtree(self._entry_dir(team, entry_id))

    def teams(self) -> list:
        names = set()
        for root in [self.root, *self.history_roots.values()]:
            if root.is_dir():
                names.update(path.name for path in root.iterdir() if path.is_dir())
        return sorted(names)

    def kept_paths(self, team: str) -> list:
        """Every project path some history root keeps something for (a folder with an index)."""
        out = set()
        for root in self.history_roots.values():
            base = root / team
            if base.is_dir():
                out.update(index.parent.relative_to(base).as_posix() for index in base.rglob("index.json"))
        return sorted(path for path in out if not any(path.startswith(f"{other}/") for other in out))
