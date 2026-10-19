"""The Stilo Marker server: read the settings (command line and environment),
start the modules (server/stilo/modules; docs/ARCHITECTURE.md) and listen.
Everything the server does is a module's."""
import argparse
import json
import os
import sys
from pathlib import Path

# Support both the standalone server and importlib-based test runners.
_SERVER_DIR = str(Path(__file__).resolve().parent)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)
from stilo.kernel import start_modules  # noqa: E402
from stilo.kernel.log import log as _log  # noqa: E402
from stilo.modules import (assistant, characters, chats, cloud, comments, file_types, history, identity, models,  # noqa: E402
                           projects, sync, transport, workspace)
from stilo.modules.identity import ACCOUNT_FILE, AccountStore  # noqa: E402

MODULES = [transport, file_types, workspace, identity, models, projects, sync, characters, history, comments, chats, assistant, cloud]
ROOT = Path(__file__).resolve().parents[1]   # the app's files, served as they are


def _read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, value))


# The release, from the package manifest (the sync level is Sync's).
APP_VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]

# How often the open projects that changed are backed up (History's sweep).
BACKUP_SWEEP_SECONDS = _read_int_env("MDNOTES_BACKUP_SWEEP_SECONDS", 15 * 60, 60, 24 * 3600)

# A writing "sitting": edits to one file less than this apart are one session
# (the E in the S.E.N version label). The host of the document counts them,
# so everyone in the room shares one number.
EDIT_SESSION_GAP_SECONDS = _read_int_env("MDNOTES_EDIT_SESSION_GAP", 600, 30, 86_400)


def settings(pin, state_file, master_pin=None, accounts=None, data_dir=None, trash_days=30, static_root=ROOT, agent=None) -> dict:
    """What the modules are started with (ctx.config)."""
    return {"pin": pin, "master_pin": master_pin, "state_file": state_file, "accounts": accounts, "data_dir": data_dir,
            "trash_days": trash_days, "edit_gap": EDIT_SESSION_GAP_SECONDS, "backup_sweep_seconds": BACKUP_SWEEP_SECONDS,
            "static_root": static_root, "app_version": APP_VERSION, "agent": agent}


def start_server_modules(config=None):
    """The server's modules, started with these settings: their APIs by name, and stop()."""
    return start_modules([module.MODULE for module in MODULES], config=config,
                         log=lambda owner, *parts: _log("MODULE", f"{owner}: {' '.join(map(str, parts))}"))


def build_server(host: str, port: int, pin: str, static_root: Path, state_file: Path, master_pin: str | None = None, agent=None,
                 whitelist_file: Path | None = None, data_dir: Path | None = None, trash_days: int = 30):
    """The modules started and listening: serve_forever(), shutdown(), server_close()
    (which stops the modules first: the last backups, their timers), .modules."""
    modules = start_server_modules(settings(pin, state_file, master_pin, AccountStore(whitelist_file), data_dir, trash_days,
                                            static_root, agent))
    server = modules["transport"].listen(host, port, on_close=modules.stop)
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