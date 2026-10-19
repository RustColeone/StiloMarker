"""A project kept as one JSON file (a team's flat workspace from before
folders: workspaces/<name>.json) moved into a folder of real files the first
time it opens. The file is kept beside it as <name>.json.bak."""
from pathlib import Path

from .folder_store import FolderStore
from .state_file import StateFile


def migrate_state_file(state_file: Path, folder: Path) -> None:
    """Raises OSError or ValueError (the JSON) when it cannot; nothing is renamed then."""
    project, revision = StateFile(state_file).load()
    store = FolderStore(folder)
    store.externalize_images(project)   # images become files, not data URLs
    store.save(project, revision, None)
    state_file.rename(state_file.with_suffix(".json.bak"))
