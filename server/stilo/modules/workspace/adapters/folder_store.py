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
import os
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

    def inside(self, rel_path: str) -> Path | None:
        """Where a project-relative path lives on disk, or None when it would
        leave the folder (or be the folder itself): no write, move or delete
        ever reaches outside it, whatever a tree holds."""
        base = self.folder.resolve()
        candidate = (self.folder / rel_path).resolve()
        return candidate if candidate != base and candidate.is_relative_to(base) else None

    def file_path(self, project: dict, node_id: str) -> Path:
        """Where a node lives on disk, mirroring its place in the tree."""
        path = self.inside(path_of(project, node_id, strict=True))
        if path is None:
            raise PermissionError("That path leaves the workspace's folder")
        return path

    def check_tree(self, project: dict) -> None:
        """Before anything is written: every node stays inside the folder, and
        none at the top is, on this disk, one of the server's own files under
        another spelling (a disk that ignores case or look-alikes)."""
        root_id = project.get("rootId")
        kept = [self.folder / name for name in FILE_TYPES.reserved_names() if (self.folder / name).exists()]
        for node_id, node in project.get("nodes", {}).items():
            if node_id == root_id:
                continue
            path = self.inside(path_of(project, node_id))
            if path is None:
                raise ValueError(f"{node.get('name')!r} leaves the workspace's folder")
            if node.get("parentId") == root_id and path.exists() and any(os.path.samefile(path, own) for own in kept):
                raise ValueError(f"{node.get('name')!r} is one of the app's own files on this disk")

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
                dest = self.inside(path_of(project, node_id))
                if data is not None and dest is not None:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    atomic_write(dest, data)
                    node["content"] = ""

    # ---- images uploaded by URL -------------------------------------------

    def resolve_asset(self, rel_path: str) -> Path | None:
        """The file at a project-relative path, refusing any path that escapes the folder."""
        candidate = self.inside(rel_path) if rel_path else None
        return candidate if candidate is not None and candidate.is_file() else None

    def asset_dest(self, rel_path: str) -> Path:
        dest = self.inside(rel_path) if rel_path else None
        if dest is None:
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
        self.drop_outside(project)
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") != "file" or FILE_TYPES.is_image(node.get("name", "")):
                continue
            path = self.file_path(project, node_id)
            node["content"] = path.read_text(encoding="utf-8") if path.exists() else ""
        return project, int(data.get("revision", 0))

    def drop_outside(self, project: dict) -> None:
        """Nodes kept from before names were checked whose path leaves the
        folder (a folder named ..) are left out of the tree, with what is under
        them, and said: the workspace opens without them."""
        nodes, root_id = project.get("nodes", {}), project.get("rootId")
        gone = {node_id for node_id in nodes if node_id != root_id and self.inside(path_of(project, node_id)) is None}
        if not gone:
            return
        for node_id in list(nodes):
            current = nodes[node_id]
            while current and current.get("parentId") and current["id"] not in gone:
                current = nodes.get(current["parentId"])
            if current and current.get("id") in gone:
                gone.add(node_id)
        for node_id in gone:
            ignore(PermissionError(path_of(project, node_id)), "a node whose path leaves the workspace's folder is left out")
        for node_id in gone:
            nodes.pop(node_id, None)
        for node in nodes.values():
            if node.get("kind") == "folder":
                node["children"] = [child for child in node.get("children", []) if child not in gone]

    def save(self, project: dict, revision: int, previous: dict | None) -> dict:
        """Commit the project to the folder; returns the project as kept in
        memory afterwards (image bytes moved to disk)."""
        self.folder.mkdir(parents=True, exist_ok=True)
        self.check_tree(project)
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
                source = self.inside(path_of(previous, node_id))
                if source is not None and source.is_file():
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
            dest = self.inside(rel)
            if dest is None:
                ignore(PermissionError(rel), "a node outside the workspace's folder is never written")
                continue
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
            dest = self.inside(rel)
            if dest is None:
                ignore(PermissionError(rel), "nothing outside the workspace's folder is ever deleted")
                continue
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
