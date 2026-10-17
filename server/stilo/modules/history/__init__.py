"""History (server): snapshots of files (taken by hand, or migrated from a
browser's store) and backups of whole workspaces (daily on days they changed,
a safety copy before anything destructive, or by hand), each in a
content-addressed store beside the project data. The browser's half is
app/modules/history.

Static, for code from before the restructure:
    open_history(data_dir, places) -> HistoryDesk (see service/desk.py for `places`)
    POLICY, MAX_PER_FILE (snapshot retention)

API (started by the kernel):
    serve(desk)   adds History's routes for that desk
"""
from pathlib import Path
from types import SimpleNamespace

from stilo.kernel import define_module
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.workspace import node_id_by_path, path_of
from .adapters.blob_store import BlobStore
from .adapters.images import image_bytes
from .adapters.routes import add_routes
from .model.retention import POLICY  # noqa: F401
from .service.backups import Backups
from .service.desk import HistoryDesk
from .service.snapshots import MAX_PER_FILE, Snapshots  # noqa: F401


def _folder(root: Path, team: str, relpath: str) -> Path:
    """A project's folder under a history root, never outside it."""
    base = (root / str(team)).resolve()
    target = (base / relpath).resolve()
    if base not in target.parents:
        raise PermissionError("Path escapes the history folder")
    return target


def _node_paths(project):
    return [(node_id, path_of(project, node_id), node)
            for node_id, node in project.get("nodes", {}).items() if node_id != project.get("rootId")]


def _counters(places):
    """The file's S.E.N counters now (under the live workspace's lock), or {}."""
    def read(team, relpath, file_path):
        workspace = places.live(team, relpath)
        if workspace is None:
            return {}
        with workspace.lock:
            node_id = node_id_by_path(workspace.project, str(file_path))
            node = workspace.project["nodes"].get(node_id) if node_id else None
            if not node or node.get("kind") != "file":
                return {}
            return {key: int(node.get(key, 0) or 0) for key in ("editSessions", "sessionEdits", "sourceVersion")}
    return read


def open_history(data_dir, places) -> HistoryDesk:
    data_dir = Path(data_dir) if data_dir is not None else None

    def store(root_name, empty):
        def store_for(team, relpath):
            if data_dir is None:
                raise PermissionError("Cloud storage is not enabled on this server")
            return BlobStore(_folder(data_dir / root_name, team, relpath), empty)
        return store_for

    snapshots = Snapshots(store("_snapshots", {"files": {}}), _counters(places))
    backups = Backups(store("_backups", {"backups": []}), FILE_TYPES, _node_paths, image_bytes)
    return HistoryDesk(snapshots, backups, places)


def start(ctx):
    transport = ctx.use("transport")
    ctx.use("workspace")
    return SimpleNamespace(serve=lambda desk: add_routes(transport, desk))


MODULE = define_module(__file__, start)
