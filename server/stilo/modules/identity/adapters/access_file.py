"""A project's access record, kept as access.json inside the project folder
so it travels with the project."""
import json
from pathlib import Path

from ..model.access import clean_access, from_legacy_members
from stilo.kernel.log import ignore

ACCESS_FILE = "access.json"


def read_access(project_dir: Path, legacy=lambda: None) -> dict:
    """The record, cleaned. With no file yet, `legacy()` may give the meta of
    a project from before access files; its members list becomes the
    whitelist, written down the first time so the gate stays the same."""
    path = Path(project_dir) / ACCESS_FILE
    if path.exists():
        try:
            return clean_access(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError) as error:
            ignore(error, f"{path} is unreadable; treating the project as open to its whole team")
            return clean_access(None)
    meta = legacy()
    if meta is None:
        return clean_access(None)
    data = from_legacy_members(meta)
    if Path(project_dir).is_dir():
        try:
            write_access(project_dir, data)
        except OSError as error:
            ignore(error, "writing down the access list taken from the old member list failed; it is used anyway")
    return data


def projects_in(folder: Path) -> tuple:
    """(whether `folder` is itself a project, the project folders it holds).
    A project is a folder with a manifest.json."""
    folder = Path(folder)
    if (folder / "manifest.json").is_file():
        return True, [folder]
    return False, [manifest.parent for manifest in folder.rglob("manifest.json")]


def write_access(project_dir: Path, data: dict) -> None:
    project_dir = Path(project_dir)
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / ACCESS_FILE).write_text(json.dumps(data, indent=2), encoding="utf-8")
