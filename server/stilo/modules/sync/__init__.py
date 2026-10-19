"""Sync (server): sharing workspaces live. What is open now (the directory:
team projects, the PIN session from before accounts, sessions hosted for
guests), session tokens and their roles, presence and leases, event streams,
and every change checked against the revision it was made at (text patches
rebased over the ones since, stale whole-file writes refused) before
Workspace applies it. The browser's half is app/modules/sync.

Static, for code from before the restructure:
    open_live(pin, folder=None, state_file=None, master_pin=None, edit_gap=...)
                 -> a LiveWorkspace (service/live.py) not in the directory
    SharedWorkspace, PARTS, Sessions, RebaseLog, transform_range
    DEFAULT_TEAM, DEFAULT_WORKSPACE_ID
    VERSION      the sync compatibility level (protocol/sync.contract.json)
    announce()   what the server's ping says about sync

API (started by the kernel; config: pin, master_pin, state_file, edit_gap):
    directory    service/directory.py: open workspaces by id, by session token,
                 by place; adopt(...) a project made whole, drop(team, relpath)
    events.on(name, listener): "before-destructive" {workspace, reason} (just
                 before a change that loses data), "paths-moved" {workspace,
                 old, new}, "dropped" {workspace_id} (a project closed for good)
    open_live    as above
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.workspace import EDIT_SESSION_GAP_SECONDS, apply_operation, touched_paths, utf16_length
from .adapters.routes import add_routes, load_version
from .model.rebase import RebaseLog, transform_range  # noqa: F401
from .service.directory import DEFAULT_TEAM, DEFAULT_WORKSPACE_ID, Directory  # noqa: F401
from .service.live import LiveWorkspace
from .service.sessions import Sessions  # noqa: F401
from .service.shared import SharedWorkspace  # noqa: F401

VERSION = load_version()
PARTS = {"workspace": SimpleNamespace(apply_operation=apply_operation, touched_paths=touched_paths, utf16_length=utf16_length), "types": FILE_TYPES}


def announce() -> dict:
    return {"minSyncVersion": VERSION, "transport": "sse-text-ops"}


def open_live(pin, folder=None, state_file=None, master_pin=None, edit_gap=EDIT_SESSION_GAP_SECONDS) -> LiveWorkspace:
    return LiveWorkspace(pin, folder=folder, state_file=state_file, master_pin=master_pin, parts=PARTS, edit_gap=edit_gap)


def start(ctx):
    ctx.use("workspace")
    transport = ctx.use("transport")
    events = ctx.emitter()
    edit_gap = ctx.config.get("edit_gap", EDIT_SESSION_GAP_SECONDS)

    def make(pin, folder=None, state_file=None, master_pin=None):
        return open_live(pin, folder=folder, state_file=state_file, master_pin=master_pin, edit_gap=edit_gap)

    directory = Directory(pin=ctx.config.get("pin"), state_file=ctx.config.get("state_file"), master_pin=ctx.config.get("master_pin"),
                          projects=ctx.use("projects"), identity=ctx.use("identity"), make=make, emit=events.emit)
    add_routes(transport, directory, VERSION)
    return SimpleNamespace(directory=directory, events=SimpleNamespace(on=events.on), open_live=make)


MODULE = define_module(__file__, start)
