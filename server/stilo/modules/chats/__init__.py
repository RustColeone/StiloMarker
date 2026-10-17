"""Chats (server): conversations between a project's people and its
characters, one SQLite database per project (members, messages, private
notes, search), characters' replies (run on the server, or claimed and
written by a member's own browser), and the live events that go only to a
conversation's members. The browser's half is app/modules/chats (step 7f-2).

Static, for code from before the restructure:
    open_chats(places) -> ChatsDesk (see service/desk.py for `places` and `runner`)
    DB_FILES     the database and its write-ahead files, kept in the project folder
    ProjectChats, ReplyQueue, user_key, char_key, responders

API (started by the kernel):
    serve(desk)   adds the chat routes
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters.routes import add_routes
from .adapters.store import SIDE_FILES as DB_FILES, ProjectChats  # noqa: F401
from .model.members import char_key, responders, user_key  # noqa: F401
from .service.desk import ChatsDesk
from .service.replies import ReplyQueue  # noqa: F401


def open_chats(places) -> ChatsDesk:
    return ChatsDesk(places)


def start(ctx):
    transport = ctx.use("transport")
    for used in ("file_types", "workspace", "characters"):
        ctx.use(used)
    return SimpleNamespace(serve=lambda desk: add_routes(transport, desk))


MODULE = define_module(__file__, start)
