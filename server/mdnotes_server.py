import argparse
import gzip
import json
import mimetypes
import os
import posixpath
import threading
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


# Support both the standalone server and importlib-based test runners.
import sys
_mcp_module_dir = str(Path(__file__).resolve().parent)
if _mcp_module_dir not in sys.path:
    sys.path.insert(0, _mcp_module_dir)
from stilo.kernel import start_modules
from stilo.modules import (assistant as assistant_module, characters as characters_module, cloud as cloud_module, file_types as file_types_module,
                           identity as identity_module, models as models_module, projects as projects_module, sync as sync_module, history as history_module, comments as comments_module, chats as chats_module, transport as transport_module, workspace as workspace_module)
from stilo.kernel.log import log as _log
from stilo.modules.sync import announce as sync_announce
from stilo.modules.identity import ACCOUNT_FILE, AccountStore


def start_server_modules(config=None):
    """The server's modules (docs/ARCHITECTURE.md), started with the server's
    settings (config); more join as the restructure moves code."""
    return start_modules([transport_module.MODULE, file_types_module.MODULE, workspace_module.MODULE, identity_module.MODULE, models_module.MODULE, projects_module.MODULE, sync_module.MODULE, characters_module.MODULE, history_module.MODULE, comments_module.MODULE, chats_module.MODULE, assistant_module.MODULE, cloud_module.MODULE], log=lambda owner, *parts: _log("MODULE", f"{owner}: {' '.join(map(str, parts))}"), config=config)



def _read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, "")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


# Human-facing release version comes from the package manifest. The sync
# compatibility level is Sync's (protocol/sync.contract.json).
APP_VERSION = json.loads((Path(__file__).resolve().parents[1] / "package.json").read_text(encoding="utf-8"))["version"]

# How often live workspaces that changed are backed up (see WorkspaceRegistry
# backups). Each active day keeps one daily backup, refreshed on each sweep.
BACKUP_SWEEP_SECONDS = _read_int_env("MDNOTES_BACKUP_SWEEP_SECONDS", 15 * 60, 60, 24 * 3600)

# A writing "sitting": edits to one file separated by less than this gap belong
# to the same session. It is the E in the S.E.N version label — snapshots you
# cut, sittings since then, edits in this sitting. Owned by whoever hosts the
# document (this server, or the sharer in a guest-hosted session) so everyone in
# the room shares one session number instead of each peer counting its own.
EDIT_SESSION_GAP_SECONDS = _read_int_env("MDNOTES_EDIT_SESSION_GAP", 600, 30, 86_400)


class WorkspaceRegistry:
    """The server's modules, started together with the server's settings, as code
    and tests from before the restructure reach them. Goes in step S4s-6
    (docs/ARCHITECTURE.md)."""

    def __init__(self, pin: str, legacy_state_file: Path, master_pin: str | None = None,
                 accounts: "AccountStore | None" = None, data_dir: Path | None = None, trash_days: int = 30, agent=None):
        self.modules = start_server_modules({"pin": pin, "master_pin": master_pin, "state_file": legacy_state_file,
                                             "accounts": accounts, "data_dir": data_dir, "trash_days": trash_days,
                                             "edit_gap": EDIT_SESSION_GAP_SECONDS, "backup_sweep_seconds": BACKUP_SWEEP_SECONDS,
                                             "agent": agent})
        self.identity = self.modules["identity"]
        self.projects = self.modules["projects"]
        self.directory = self.modules["sync"].directory
        self.history = self.modules["history"]
        self.comments = self.modules["comments"]
        self.chats = self.modules["chats"]
        self.cloud = self.modules["cloud"]
        self.assistant = self.modules["assistant"]
        self.data_dir = data_dir

    def backup_sweep(self, now=None):
        """Daily backups for every live workspace that changed since its last one (History's)."""
        return self.history.sweep(now)

    # ---- Sync's directory, as code and tests from before the move call it ------
    brokers = property(lambda self: self.directory.workspaces)
    token_workspace = property(lambda self: self.directory.token_workspace)
    default_broker = property(lambda self: self.directory.default)

    def open_workspace(self, *args, **kwargs):
        return self.directory.open_workspace(*args, **kwargs)

    def connect(self, *args, **kwargs):
        return self.directory.connect(*args, **kwargs)

    def expire_leases(self) -> int:
        return self.directory.expire_leases()

    def close_session(self, token: str) -> None:
        self.directory.close_session(token)

    def broker_for_token(self, token: str):
        return self.directory.broker_for_token(token)



# Compressed static files, keyed by path and invalidated when the file changes
# on disk, so a release is never served stale bytes. Bounded: it only ever holds
# the app shell (~1MB raw), but a stray tree of text files must not grow it.
_GZIP_CACHE: dict[str, tuple[int, int, bytes]] = {}
_GZIP_CACHE_LOCK = threading.Lock()
_GZIP_CACHE_MAX = 256


def _gzip_static(path: Path, content: bytes) -> bytes:
    try:
        stat = path.stat()
        key, stamp = str(path), (stat.st_mtime_ns, stat.st_size)
    except OSError:
        return gzip.compress(content, compresslevel=6, mtime=0)
    with _GZIP_CACHE_LOCK:
        hit = _GZIP_CACHE.get(key)
        if hit and (hit[0], hit[1]) == stamp:
            return hit[2]
    # mtime=0: identical bytes for identical files, whichever worker compressed them.
    packed = gzip.compress(content, compresslevel=6, mtime=0)
    with _GZIP_CACHE_LOCK:
        if len(_GZIP_CACHE) >= _GZIP_CACHE_MAX:
            _GZIP_CACHE.clear()
        _GZIP_CACHE[key] = (stamp[0], stamp[1], packed)
    return packed


class MDNotesRequestHandler(BaseHTTPRequestHandler):
    server_version = "MDNotesServer/0.1"

    def __init__(self, *args, registry: WorkspaceRegistry, static_root: Path, transport, **kwargs):
        self.transport = transport
        self.registry = registry
        self.static_root = static_root
        super().__init__(*args, **kwargs)

    def log_message(self, format, *args):
        return

    def _log_request(self, status: int, detail: str = ""):
        """Log HTTP requests with method, path, status and optional detail."""
        indicator = "✓" if status < 400 else "✗"
        tag = "HTTP"
        line = f"{indicator} {self.command} {self.path}  →  {status}"
        if detail:
            line += f"  ({detail})"
        _log(tag, line)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if not self.transport.handle(self, "GET", parsed):
            return self._serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if not self.transport.handle(self, "POST", parsed):
            self._write_json(HTTPStatus.NOT_FOUND, {"message": "Not found"})

    def _send_cors_headers(self):
        self.transport.send_cors(self, urlparse(self.path).path)

    def _write_json(self, status, payload):
        self.transport.write_json(self, status, payload, urlparse(self.path).path)

    # Server-side files that live under the repo (== static root) but must never
    # be handed out over HTTP: collaboration state, account whitelist, secrets,
    # the Python source, the virtualenv and any dotfiles. Matched on the first
    # path segment or the basename so both dirs and specific files are covered.
    _STATIC_DENY_SEGMENTS = frozenset({"server", "data", "venv", ".git", "__pycache__"})
    _STATIC_DENY_SUFFIXES = (".env", ".py", ".pyc")
    _STATIC_DENY_NAMES = frozenset({ACCOUNT_FILE, "session-state.json", "test-session-state.json"})

    def _is_denied_static(self, safe_path: str) -> bool:
        if not safe_path:
            return False
        segments = safe_path.split("/")
        if segments[0] in self._STATIC_DENY_SEGMENTS or any(seg.startswith(".") for seg in segments):
            return True
        base = segments[-1]
        return base in self._STATIC_DENY_NAMES or base.endswith(self._STATIC_DENY_SUFFIXES)

    def _serve_static(self, request_path: str):
        relative = request_path or "/"
        if relative == "/":
            relative = "/index.html"

        safe_path = posixpath.normpath(relative).lstrip("/")
        # Block sensitive server-side files before touching the filesystem. Fall
        # back to index.html (SPA behaviour) rather than confirming existence.
        if self._is_denied_static(safe_path):
            safe_path = "index.html"
        candidate = (self.static_root / safe_path).resolve()
        if not str(candidate).startswith(str(self.static_root.resolve())) or not candidate.exists() or candidate.is_dir():
            candidate = self.static_root / "index.html"

        content = candidate.read_bytes()
        content_type, _ = mimetypes.guess_type(str(candidate))
        content_type = content_type or "application/octet-stream"
        # Text assets were sent raw: ~930KB of JavaScript per first load or per
        # release, ~4x what gzip makes it. Compress when the browser accepts it.
        encoded = None
        if self._is_compressible(content_type, len(content)) and self._accepts_gzip():
            encoded = _gzip_static(candidate, content)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Vary", "Accept-Encoding")  # caches must keep the variants apart
        if encoded is not None:
            content = encoded
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    _COMPRESSIBLE_TYPES = ("text/", "application/javascript", "application/json", "application/manifest+json", "image/svg+xml")

    @classmethod
    def _is_compressible(cls, content_type: str, size: int) -> bool:
        # Tiny files gain nothing; images, fonts and archives are compressed already.
        return size >= 1024 and content_type.startswith(cls._COMPRESSIBLE_TYPES)

    def _accepts_gzip(self) -> bool:
        """True when Accept-Encoding allows gzip (an explicit q=0 refuses it)."""
        for part in (self.headers.get("Accept-Encoding") or "").split(","):
            name, _, params = part.strip().partition(";")
            if name.strip().lower() not in ("gzip", "*"):
                continue
            quality = 1.0
            for param in params.split(";"):
                key, _, value = param.strip().partition("=")
                if key.strip().lower() == "q":
                    try:
                        quality = float(value)
                    except ValueError:
                        quality = 0.0
            return quality > 0
        return False


# Routes from before the restructure, in the order the if-chains checked them.
# Each writes its own response; Transport only finds it. Modules take theirs
# over as they move, and this list shrinks (docs/ARCHITECTURE.md).


def build_server(host: str, port: int, pin: str, static_root: Path, state_file: Path, master_pin: str | None = None, agent=None, whitelist_file: Path | None = None, data_dir: Path | None = None, trash_days: int = 30):
    accounts = AccountStore(whitelist_file)
    registry = WorkspaceRegistry(pin, state_file, master_pin=master_pin, accounts=accounts, data_dir=data_dir, trash_days=trash_days,
                                 agent=agent)
    modules = registry.modules
    transport = modules["transport"]
    transport.add_route("GET", "/api/ping", lambda request: {
            "message": "pong",
            "server": "mdnotes",
            "appVersion": APP_VERSION,
            **sync_announce(),
            "accounts": registry.identity.enabled,  # capability flag for the Login UI
            "hosting": True,  # this backend supports ephemeral guest-PIN hosting
        })
    handler = partial(MDNotesRequestHandler, registry=registry, static_root=static_root, transport=transport)

    class QuietThreadingHTTPServer(ThreadingHTTPServer):
        """Suppress noisy client-disconnect tracebacks on Windows."""
        def handle_error(self, request, client_address):
            import sys
            exc = sys.exc_info()[1]
            if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError)):
                return
            super().handle_error(request, client_address)

    class ServerWithModules(QuietThreadingHTTPServer):
        def server_close(self):
            # The modules stop: the last backups (a restart must not lose the
            # day's state), Chats' last copies, their timers.
            registry.modules.stop()
            super().server_close()

    server = ServerWithModules((host, port), handler)
    server.modules = modules
    return server


def main():
    parser = argparse.ArgumentParser(description="MDNotes collaboration server")
    parser.add_argument("--host", default=os.environ.get("MDNOTES_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MDNOTES_PORT", "8000")))
    parser.add_argument("--pin", default=os.environ.get("MDNOTES_PIN", "2468"))
    parser.add_argument("--master-pin", default=os.environ.get("MDNOTES_MASTER_PIN", "1367"),
                        help="Secret PIN for the session master (project owner). Defaults to --pin.")
    parser.add_argument("--static-dir", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--state-file", default=str(Path(__file__).resolve().parent / "session-state.json"))
    parser.add_argument("--whitelist", default=os.environ.get("MDNOTES_WHITELIST", str(Path(__file__).resolve().parent / ACCOUNT_FILE)),
                        help="Account whitelist JSON (accounts mode). Kept out of the web-served set. Absent ⇒ accounts disabled.")
    parser.add_argument("--data-dir", default=os.environ.get("MDNOTES_DATA_DIR", str(Path(__file__).resolve().parent / "data")),
                        help="Directory for persistent per-team cloud workspaces. Kept out of the web-served set.")
    parser.add_argument("--trash-days", type=int, default=int(os.environ.get("MDNOTES_TRASH_DAYS", "30")),
                        help="Days a deleted project stays in its team's trash before it is removed for good (1 to 30).")
    args = parser.parse_args()

    static_root = Path(args.static_dir).resolve()
    state_file = Path(args.state_file).resolve()
    whitelist_file = Path(args.whitelist).resolve() if args.whitelist else None
    data_dir = Path(args.data_dir).resolve() if args.data_dir else None
    server = build_server(args.host, args.port, args.pin, static_root, state_file, master_pin=args.master_pin, whitelist_file=whitelist_file, data_dir=data_dir, trash_days=args.trash_days)
    agent = server.modules["assistant"].agent
    accounts_enabled = whitelist_file is not None and whitelist_file.exists()
    print(f"MDNotes collaboration server running at http://{args.host}:{args.port}")
    print(f"Serving static files from {static_root}")
    print(f"Persisting collaborative state to {state_file}")
    print("Configured transport: HTTP + SSE file-operation sync")
    print(f"Accounts mode: {'enabled — ' + str(whitelist_file) if accounts_enabled else 'disabled (no whitelist file)'}")
    print(f"Master PIN configured: {'yes (separate)' if args.master_pin and args.master_pin != args.pin else 'same as session PIN'}")
    print(f"Chat proxy configured: {'yes' if agent.is_configured() else 'no'}")
    if agent.is_configured():
        print(f"Chat provider: {agent.providers.label} ({agent.providers.default_model})")
        print(f"Chat access: {'local browser only' if not agent.allow_remote else 'remote clients allowed'}")
    else:
        print("Set DEEPSEEK_API_KEY or MDNOTES_CHAT_API_KEY in the server environment to enable chat.")
    print(f"OpenAI: {'key found — reading its model list' if agent.openai.configured else 'not configured (OPENAI_API_KEY)'}")
    print(f"Agent access: {'signed-in accounts only (or a user’s own key)' if accounts_enabled else 'no accounts on this server'}")
    print("─" * 60)
    agent.start_providers()
    # systemd stops the service with SIGTERM, which by default kills Python on
    # the spot and skips server_close(), so the shutdown backup sweep never ran.
    # Treat it like Ctrl+C. Every write is already journaled and atomic.
    import signal
    def _stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, _stop)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _log("server", "stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()