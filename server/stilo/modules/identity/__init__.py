"""Identity and access (server): accounts and their teams (the account file),
signed-in account tokens, who may open a project and in what role, and the
per-account preferences kept on the server. The browser's half is
app/modules/identity.

Static, for code from before the restructure:
    Identity, AccountStore, UserPrefs, open_identity(account_file, data_dir)
    ACCOUNT_FILE, ACCESS_FILE, PREFS_FILE
    ROLES, can(role, action)

API (started by the kernel):
    serve(identity)   adds the sign-in route for that Identity (who may open a
                      project is read and set through Projects' routes)
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters import access_file
from .adapters.access_file import ACCESS_FILE  # noqa: F401
from .adapters.account_file import ACCOUNT_FILE, AccountStore  # noqa: F401
from .adapters.prefs_file import PREFS_FILE, UserPrefs  # noqa: F401
from .adapters.routes import add_routes
from .model.access import ROLES, can  # noqa: F401
from .service.identity import Identity

_ACCESS_STORE = SimpleNamespace(read=access_file.read_access, write=access_file.write_access, projects_in=access_file.projects_in)


def open_identity(accounts: AccountStore | None = None, data_dir=None) -> Identity:
    """An Identity over an account store (None: no accounts) and the data folder
    that keeps per-account preferences (None: none kept)."""
    return Identity(accounts or AccountStore(None), UserPrefs(data_dir), _ACCESS_STORE)


def start(ctx):
    transport = ctx.use("transport")
    return SimpleNamespace(serve=lambda identity: add_routes(transport, identity))


MODULE = define_module(__file__, start)
