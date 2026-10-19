"""Workspace (server): owns the project tree and how it is kept on disk. The
project's pure tree and text rules are in model/, the disk work in adapters/;
sharing it live is Sync's. The browser half is app/modules/workspace.

Static, for code from before the restructure: the tree functions
(default_project, node_id_by_path, path_of, ...), the UTF-16 helpers, the
safe file writes, FolderStore (a project kept as a real folder, marked by its
MANIFEST file) and StateFile, migrate_state_file (one file into a folder)
(one JSON file), LiveProject (an open project: its tree, revision and store),
and apply_operation (one operation applied to a tree; the browser's twin is
applySyncOperation).
"""
from stilo.kernel import define_module
from .adapters.files import atomic_write, decode_data_url, fsync_directory  # noqa: F401
from .adapters.folder_store import MANIFEST, FolderStore  # noqa: F401
from .adapters.migrate import migrate_state_file  # noqa: F401
from .adapters.state_file import StateFile  # noqa: F401
from .model.operations import (EDIT_SESSION_GAP_SECONDS, PATCH_FILE, REPLACE_PROJECT, UPDATE_FILE, apply_operation,  # noqa: F401
                               bump_edit_counters, patch_text, touched_paths)
from .model.text import utf16_index, utf16_length  # noqa: F401
from .model.tree import (append_node, create_id, default_project, file_key, find_child_by_name,  # noqa: F401
                         node_id_by_path, path_of, remove_node_recursive, subtree_paths, update_file_operation)
from .service.live import LiveProject  # noqa: F401


def start(ctx):
    ctx.use("file_types")
    return {"node_id_by_path": node_id_by_path, "path_of": path_of}


MODULE = define_module(__file__, start)
