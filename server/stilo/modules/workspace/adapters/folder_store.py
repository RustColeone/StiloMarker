"""A project kept as a real folder: one file per text file (images as their
bytes), and manifest.json for the tree. Changes are crash-safe: a write-ahead
record (.pending-state.json) is made durable before any project file
changes, and an interrupted commit is finished on the next load.

Moved from CollaborationBroker unchanged in behaviour; it works on the
project it is given and holds no state but its folder.
"""
import base64
import copy
import json
import shutil
from pathlib import Path

from stilo.modules.file_types import BUILTIN as FILE_TYPES
from ..model.tree import default_project, path_of
from .files import atomic_write, decode_data_url, fsync_directory
from stilo.kernel.log import ignore

JOURNAL = ".pending-state.json"
MANIFEST = "manifest.json"


class FolderStore:
    def __init__(self, folder: Path):
        self.folder = Path(folder)

    def file_path(self, project: dict, node_id: str) -> Path:
        """Where a node lives on disk, mirroring its place in the tree."""
        return self.folder / path_of(project, node_id, strict=True)

    def write_node_file(self, project: dict, node_id: str) -> None:
        """Write one file node. An image's data URL becomes bytes on disk and
        its content in memory is emptied (it is served by URL)."""
        node = project["nodes"].get(node_id)
        if not node or node.get("kind") != "file":
            return
        path = self.file_path(project, node_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        if FILE_TYPES.is_image(node.get("name", "")):
            data = decode_data_url(node.get("content", ""))
            if data is not None:
                atomic_write(path, data)
                node["content"] = ""
            elif not path.exists():
                atomic_write(path, b"")
        else:
            atomic_write(path, str(node.get("content", "")).encode("utf-8"))

    @staticmethod
    def remove(path: Path) -> None:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            elif path.exists():
                path.unlink()
        except OSError as error:
            ignore(error, f"removing {path} failed; it stays on disk")

    def externalize_images(self, project: dict) -> None:
        """Every image's data URL out to a real file (when a whole project is adopted)."""
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") == "file" and FILE_TYPES.is_image(node.get("name", "")):
                data = decode_data_url(node.get("content", ""))
                if data is not None:
                    dest = self.folder / path_of(project, node_id)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(dest, data)
                    node["content"] = ""

    # ---- images uploaded by URL -------------------------------------------

    def resolve_asset(self, rel_path: str) -> Path | None:
        """The file at a project-relative path, refusing any path that escapes the folder."""
        if not rel_path:
            return None
        base = self.folder.resolve()
        candidate = (self.folder / rel_path).resolve()
        if not str(candidate).startswith(str(base)) or not candidate.is_file():
            return None
        return candidate

    def asset_dest(self, rel_path: str) -> Path:
        base = self.folder.resolve()
        dest = (self.folder / rel_path).resolve()
        if not str(dest).startswith(str(base)):
            raise PermissionError("Invalid asset path")
        return dest

    def write_asset_chunk(self, rel_path: str, offset: int, data: bytes) -> int:
        """Write one chunk of an image at a byte offset; returns the file's size."""
        dest = self.asset_dest(rel_path)
        dest.parent.mkdir(parents=True, exist_ok=True)
        with open(dest, "wb" if offset == 0 else "r+b") as handle:
            handle.seek(offset)
            handle.write(data)
        return dest.stat().st_size

    # ---- the whole project --------------------------------------------------

    def load(self):
        """(project, revision) from the folder, finishing an interrupted commit
        first; None when the folder holds no project yet. Text files are read
        back from disk; images stay empty (served by URL)."""
        journal = self.folder / JOURNAL
        if journal.exists():
            self.finish_commit(json.loads(journal.read_text(encoding="utf-8")))
        manifest = self.folder / MANIFEST
        if not manifest.exists():
            return None
        data = json.loads(manifest.read_text(encoding="utf-8"))
        project = data.get("project") or default_project()
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") != "file" or FILE_TYPES.is_image(node.get("name", "")):
                continue
            path = self.file_path(project, node_id)
            node["content"] = path.read_text(encoding="utf-8") if path.exists() else ""
        return project, int(data.get("revision", 0))

    def save(self, project: dict, revision: int, previous: dict | None) -> dict:
        """Commit the project to the folder; returns the project as kept in
        memory afterwards (image bytes moved to disk)."""
        self.folder.mkdir(parents=True, exist_ok=True)
        project = copy.deepcopy(project)
        previous = previous or default_project()
        # Capture moved images before any destination is replaced: the redo
        # record must hold their bytes too, so a crash halfway through a rename
        # never makes recovery depend on an already-deleted source.
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") != "file" or not FILE_TYPES.is_image(node.get("name", "")):
                continue
            if decode_data_url(node.get("content", "")) is not None:
                continue
            old = previous.get("nodes", {}).get(node_id)
            if old and path_of(previous, node_id) != path_of(project, node_id):
                source = self.folder / path_of(previous, node_id)
                if source.is_file():
                    node["content"] = "data:application/octet-stream;base64," + base64.b64encode(source.read_bytes()).decode("ascii")
        payload = {"project": project, "revision": revision, "previousProject": previous}
        # Write-ahead redo record: durable BEFORE changing any project files.
        atomic_write(self.folder / JOURNAL, json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        self.finish_commit(payload, skip_unchanged=True)
        return payload["project"]

    def finish_commit(self, payload: dict, skip_unchanged: bool = False) -> None:
        project = payload["project"]
        previous = payload.get("previousProject") or default_project()
        old_files = {path_of(previous, node_id): node
                     for node_id, node in previous.get("nodes", {}).items() if node.get("kind") == "file"}
        paths = set()
        for node_id, node in project.get("nodes", {}).items():
            if node_id == project.get("rootId"):
                continue
            rel = path_of(project, node_id)
            paths.add(rel)
            dest = self.folder / rel
            if node.get("kind") == "folder":
                dest.mkdir(parents=True, exist_ok=True)
                fsync_directory(dest.parent)
                continue
            if FILE_TYPES.is_image(node.get("name", "")):
                data = decode_data_url(node.get("content", ""))
                if data is not None:
                    atomic_write(dest, data)
                elif not dest.exists():
                    atomic_write(dest, b"")
                node["content"] = ""
            else:
                content = str(node.get("content", ""))
                old = old_files.get(rel)
                if not (skip_unchanged and old and old.get("content") == content and dest.is_file()):
                    atomic_write(dest, content.encode("utf-8"))
        old_paths = {path_of(previous, node_id) for node_id in previous.get("nodes", {}) if node_id != previous.get("rootId")}
        for rel in sorted(old_paths - paths, key=lambda value: value.count("/"), reverse=True):
            dest = self.folder / rel
            if dest.is_dir():
                shutil.rmtree(dest)  # explicit deletion of a removed project folder
            elif dest.exists():
                dest.unlink()
            if dest.parent.exists():
                fsync_directory(dest.parent)
        manifest_project = copy.deepcopy(project)
        for node in manifest_project.get("nodes", {}).values():
            if node.get("kind") == "file":
                node["content"] = ""
        atomic_write(self.folder / MANIFEST, json.dumps({"project": manifest_project, "revision": payload["revision"]},
                                                        ensure_ascii=False).encode("utf-8"))
        journal = self.folder / JOURNAL
        if journal.exists():
            journal.unlink()
            fsync_directory(self.folder)
