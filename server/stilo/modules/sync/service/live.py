"""One shared workspace over its storage: a team's project kept as a folder of
real files (Workspace's FolderStore), the PIN session from before accounts
kept in one JSON file (StateFile), or a guest-hosted session in memory only.
Images of a folder are files: served by path and uploaded in pieces."""
from pathlib import Path

from stilo.modules.workspace import FolderStore, LiveProject, StateFile, name_problem, node_id_by_path
from .shared import SharedWorkspace


class LiveWorkspace(SharedWorkspace):
    def __init__(self, pin: str, *, folder: Path | None = None, state_file: Path | None = None,
                 master_pin: str | None = None, parts: dict, edit_gap: float):
        self.folder = folder
        self.state_file = state_file
        self.store = (FolderStore(folder) if folder is not None
                      else StateFile(state_file) if state_file is not None else None)
        super().__init__(LiveProject(self.store), pin, master_pin, **parts, edit_gap=edit_gap)

    def save(self) -> None:
        """Commit the tree as it is now (a project made or adopted whole)."""
        self.live.save()

    def resolve_asset(self, rel_path: str) -> Path | None:
        """The file at a workspace-relative path (by path, so every peer agrees on
        the URL), or None: only a file of the workspace (never the server's own
        files beside them), never outside the folder."""
        if self.folder is None or not node_id_by_path(self.project, str(rel_path or "")):
            return None
        return self.store.resolve_asset(rel_path)

    def write_asset_chunk(self, token: str, rel_path: str, offset: int, data: bytes) -> int:
        """One piece of an image (large images upload in pieces, not through the
        operation stream, before the content-less create-file that makes its
        node): by someone who may edit, an image by name, every name in its path
        one a file or folder may have, nothing the server keeps at the top."""
        if self.folder is None:
            raise PermissionError("This workspace does not store server assets")
        if self.sessions.role(token) == "reader":
            raise PermissionError("You have read-only access to this project")
        segments = str(rel_path or "").split("/")
        if any(name_problem(segment) for segment in segments) or not self._types.is_image(segments[-1]):
            raise PermissionError("Only an image can be uploaded, at a path a file may have")
        if self._types.is_reserved(segments[0]):
            raise PermissionError("That name is kept for the app's own file")
        return self.store.write_asset_chunk(rel_path, offset, data)

    def adopt_images(self, project: dict) -> None:
        """A whole project's images (data URLs) out to files in the folder."""
        self.store.externalize_images(project)
