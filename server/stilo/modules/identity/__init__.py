"""Identity and access (server): accounts and their teams (the account file),
signed-in account tokens, who may open a project and in what role, and the
per-account preferences kept on the server. The browser's half is
app/modules/identity.

Static, for code from before the restructure:
    Identity, AccountStore, UserPrefs, open_identity(account_file, data_dir)
    ACCOUNT_FILE, ACCESS_FILE, PREFS_FILE
    ROLES, can(role, action)

API (started by the kernel; config: accounts (an AccountStore), data_dir):
    the Identity (service/identity.py): require(token), require_team(...),
    access(...), may_open(...), role(...), can(...), claim(...), team_members(team)...
    It serves the sign-in route (and the ping says whether there are accounts);
    who may open a project is read and set through Projects' routes.
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters import access_file
from .adapters.access_file import ACCESS_FILE  # noqa: F401
from .adapters.account_file import ACCOUNT_FILE, AccountStore  # noqa: F401
from .adapters.prefs_file import PREFS_FILE, UserPrefs  # noqa: F401
from .adapters.routes import add_routes
from .model.access import ROLES, can, refusal  # noqa: F401
from .service.identity import Identity

_ACCESS_STORE = SimpleNamespace(read=access_file.read_access, write=access_file.write_access, projects_in=access_file.projects_in)


def open_identity(accounts: AccountStore | None = None, data_dir=None) -> Identity:
    """An Identity over an account store (None: no accounts) and the data folder
    that keeps per-account preferences (None: none kept)."""
    return Identity(accounts or AccountStore(None), UserPrefs(data_dir), _ACCESS_STORE)


def start(ctx):
    identity = open_identity(ctx.config.get("accounts"), ctx.config.get("data_dir"))
    transport = ctx.use("transport")
    add_routes(transport, identity)
    transport.keep_private(ACCOUNT_FILE)  # passwords: never served, wherever it lies
    # The ping says whether this server has accounts (the browser shows sign-in).
    transport.ping.add({"id": "identity", "fields": lambda: {"accounts": identity.enabled}})
    return identity


MODULE = define_module(__file__, start)
