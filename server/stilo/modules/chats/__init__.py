"""Chats (server): conversations between a project's people and its
characters, one SQLite database per project (members, messages, private
notes, search), characters' replies (run on the server, or claimed and
written by a member's own browser), and the live events that go only to a
conversation's members. The browser's half is app/modules/chats (step 7f-2).

Static, for code from before the restructure:
    open_chats(places) -> ChatsDesk (see service/desk.py for `places` and `runner`)
    DB_FILES     the database and its write-ahead files, kept in the project folder
    ProjectChats, ReplyQueue, user_key, char_key, responders

API (started by the kernel): the ChatsDesk (service/desk.py), serving the chat
routes. It follows a moved character file and closes a deleted project's
databases (Sync's events), names its database files to Projects (never
listed), and keeps a daily copy of each database beside the project's
backups (History's also_back_up). Its `runner` (the agent) is set once the
agent exists.
"""
from stilo.kernel import define_module
from .adapters.routes import add_routes
from .adapters.store import SIDE_FILES as DB_FILES, ProjectChats  # noqa: F401
from .model.members import char_key, responders, user_key  # noqa: F401
from .service.desk import ChatsDesk
from .service.replies import ReplyQueue  # noqa: F401


def open_chats(places) -> ChatsDesk:
    return ChatsDesk(places)


def start(ctx):
    for used in ("file_types", "workspace", "characters"):
        ctx.use(used)
    sync = ctx.use("sync")
    desk = open_chats(sync.places)
    add_routes(ctx.use("transport"), desk)
    ctx.use("projects").reserve(*DB_FILES)
    sync.events.on("paths-moved", lambda move: desk.paths_moved(move["workspace"], move["old"], move["new"]))
    sync.events.on("dropped", lambda gone: desk.close(gone["workspace_id"]))
    ctx.use("history").also_back_up(lambda folder_of, now: desk.backup(lambda team, relpath: folder_of(team, relpath, "chats"), now))
    return desk


MODULE = define_module(__file__, start)
