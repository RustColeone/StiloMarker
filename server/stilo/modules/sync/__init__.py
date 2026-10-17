"""Sync (server): sharing one workspace live. Sessions and their roles,
presence and leases, event streams, and every change checked against the
revision it was made at (text patches rebased over the ones since, stale
whole-file writes refused) before Workspace applies it. The browser's half is
app/modules/sync (step 7c-2; today app/services/collaboration-service.js).

Static, for code from before the restructure:
    SharedWorkspace(live, pin, master_pin, **PARTS, edit_gap=...)
    PARTS        the Workspace rules and File types it is built with
    Sessions, RebaseLog, transform_range
    VERSION      the sync compatibility level (protocol/sync.contract.json)
    announce()   what the server's ping says about sync

API (started by the kernel):
    serve(directory)   adds Sync's routes (see adapters/routes.py for `directory`)
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.workspace import apply_operation, touched_paths, utf16_length
from .adapters.routes import add_routes, load_version
from .model.rebase import RebaseLog, transform_range  # noqa: F401
from .service.sessions import Sessions  # noqa: F401
from .service.shared import SharedWorkspace  # noqa: F401

VERSION = load_version()
PARTS = {"workspace": SimpleNamespace(apply_operation=apply_operation, touched_paths=touched_paths, utf16_length=utf16_length), "types": FILE_TYPES}


def announce() -> dict:
    return {"minSyncVersion": VERSION, "transport": "sse-text-ops"}


def start(ctx):
    ctx.use("workspace")
    transport = ctx.use("transport")
    return SimpleNamespace(SharedWorkspace=SharedWorkspace, parts=PARTS,
                           serve=lambda directory: add_routes(transport, directory, VERSION))


MODULE = define_module(__file__, start)
