"""The server's modules started for a test, without a listener, with the
names tests have used since before the restructure (they were the old
WorkspaceRegistry's): app.projects, app.history, app.chats, app.cloud...,
and the live sessions' shortcuts (open_workspace, connect, brokers...)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
import mdnotes_server as server  # noqa: E402


class App:
    def __init__(self, pin, state_file, master_pin=None, accounts=None, data_dir=None, trash_days=30, agent=None):
        self.modules = server.start_server_modules(server.settings(pin=pin, state_file=state_file, master_pin=master_pin,
                                                                   accounts=accounts, data_dir=data_dir, trash_days=trash_days,
                                                                   agent=agent))
        for name in ("identity", "projects", "history", "comments", "chats", "cloud", "assistant"):
            setattr(self, name, self.modules[name])
        self.directory = self.modules["sync"].directory
        self.data_dir = data_dir

    def backup_sweep(self, now=None):
        return self.history.sweep(now)

    brokers = property(lambda self: self.directory.workspaces)
    token_workspace = property(lambda self: self.directory.token_workspace)
    default_broker = property(lambda self: self.directory.default)

    def open_workspace(self, *args, **kwargs):
        return self.directory.open_workspace(*args, **kwargs)

    def connect(self, *args, **kwargs):
        return self.directory.connect(*args, **kwargs)

    def expire_leases(self):
        return self.directory.expire_leases()

    def close_session(self, token):
        self.directory.close_session(token)

    def broker_for_token(self, token):
        return self.directory.broker_for_token(token)

    def stop(self):
        self.modules.stop()
