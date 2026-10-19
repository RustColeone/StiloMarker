"""Comments (server): line comments, notes anchored to a line of a file and
never in its text, kept in the project folder (comments.json) so they travel
with it, and told at once to everyone in the live workspace. Anchoring them
to moved lines happens in the browser, which has the live text. The
browser's half is app/modules/comments.

Static, for code from before the restructure:
    open_comments(places) -> Comments (see service/comments.py for `places`)
    COMMENTS_FILE

API (started by the kernel): the Comments (service/comments.py), serving the
comment routes; it names its file to Projects (never listed as an entry).
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters import comments_file
from .adapters.comments_file import COMMENTS_FILE  # noqa: F401
from .adapters.routes import add_routes
from .service.comments import Comments


def open_comments(places) -> Comments:
    return Comments(places, SimpleNamespace(read=comments_file.read_comments, write=comments_file.write_comments))


def start(ctx):
    ctx.use("workspace")
    comments = open_comments(ctx.use("sync").places)
    add_routes(ctx.use("transport"), comments)
    ctx.use("projects").reserve(COMMENTS_FILE)
    return comments


MODULE = define_module(__file__, start)
