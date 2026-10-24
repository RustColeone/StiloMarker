"""Identity and access (server): accounts and their teams (the account file),
signed-in account tokens, who may open a project and in what role, and the
per-account preferences kept on the server. The browser's half is
app/modules/identity.

Static, for code from before the restructure:
    Identity, AccountStore, UserPrefs, open_identity(account_file, data_dir)
    ACCOUNT_FILE, ACCESS_FILE, PREFS_FILE, SIGN_INS_FILE (the sign-ins kept, as hashes of their tokens)
    ROLES, can(role, action)
    read_accounts(path), write_accounts(path, users), accounts (the rules for
    changing them, model/accounts.py): for server/accounts.py

API (started by the kernel; config: accounts (an AccountStore), data_dir):
    the Identity (service/identity.py): require(token), require_team(...),
    access(...), may_open(...), role(...), can(...), claim(...), team_members(team)...,
    accounts_list(token), accounts_change(token, change) (admins only),
    on_change(listener(username, change)): an account removed (change None),
    given a new password ("password") or other teams (the list): Sync ends
    the sessions it may no longer have. Its sign-ins end on removal and on a
    new password. Sign-ins are kept in the data folder (sign-ins.json, hashes
    only), so a restart signs no one out; one IDLE_DAYS unused ends.
    It serves signing in again with a kept token (/api/auth/me) and signing
    out (/api/auth/logout, the token ends).
    It serves the sign-in and accounts routes (and the ping says whether there are accounts);
    who may open a project is read and set through Projects' routes.
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters import access_file
from .adapters.access_file import ACCESS_FILE  # noqa: F401
from .adapters.account_file import ACCOUNT_FILE, AccountStore, read_accounts, write_accounts  # noqa: F401
from .model import accounts  # noqa: F401
from .adapters.prefs_file import PREFS_FILE, UserPrefs  # noqa: F401
from .adapters.sign_ins_file import SIGN_INS_FILE, SignIns, token_key  # noqa: F401
from .adapters.routes import add_routes
from .model.access import ROLES, can, refusal  # noqa: F401
from .service.identity import Identity

ACCOUNTS_CHECK_SECONDS = 15
_ACCESS_STORE = SimpleNamespace(read=access_file.read_access, write=access_file.write_access, projects_in=access_file.projects_in)


def open_identity(accounts: AccountStore | None = None, data_dir=None) -> Identity:
    """An Identity over an account store (None: no accounts) and the data folder
    that keeps per-account preferences and the sign-ins (None: none kept; sign-ins
    last until the server stops)."""
    return Identity(accounts or AccountStore(None), UserPrefs(data_dir), _ACCESS_STORE, SignIns(data_dir))


def start(ctx):
    identity = open_identity(ctx.config.get("accounts"), ctx.config.get("data_dir"))
    transport = ctx.use("transport")
    add_routes(transport, identity)
    # Passwords: never served, wherever it lies, under whatever name it was given.
    transport.keep_private(ACCOUNT_FILE, SIGN_INS_FILE, *([identity.accounts.path.name] if identity.accounts.path else []))
    # The file read again now and then even when no one signs in, so an account
    # removed by hand loses what it has open within seconds.
    ctx.every(ACCOUNTS_CHECK_SECONDS, identity.accounts.refresh)
    # The ping says whether this server has accounts (the browser shows sign-in).
    transport.ping.add({"id": "identity", "fields": lambda: {"accounts": identity.enabled}})
    return identity


MODULE = define_module(__file__, start)
