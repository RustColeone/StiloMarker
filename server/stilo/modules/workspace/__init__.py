"""Workspace (server): owns the project tree and how it is kept on disk. The
project's pure tree and text rules are in model/, the disk work in adapters/;
CollaborationBroker in mdnotes_server.py is moving here piece by piece
(docs/ARCHITECTURE.md). The browser half is app/modules/workspace.

Static, for code from before the restructure: the tree functions
(default_project, node_id_by_path, path_of, ...), the UTF-16 helpers, the
safe file writes, and FolderStore (a project kept as a real folder).
"""
from stilo.kernel import define_module
from .adapters.files import atomic_write, decode_data_url, fsync_directory  # noqa: F401
from .adapters.folder_store import FolderStore  # noqa: F401
from .model.text import utf16_index, utf16_length  # noqa: F401
from .model.tree import (append_node, create_id, default_project, find_child_by_name,  # noqa: F401
                         node_id_by_path, path_of, remove_node_recursive, subtree_paths, update_file_operation)


def start(ctx):
    ctx.use("file_types")
    return {"node_id_by_path": node_id_by_path, "path_of": path_of}


MODULE = define_module(__file__, start)
