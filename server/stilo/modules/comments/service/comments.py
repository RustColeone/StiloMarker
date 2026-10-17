"""Line comments as callers ask for them: every request names the account
(its token) and the project. A change is told at once to everyone in the
project's live workspace (a "comments" event with the whole list: it is
small, and the server's copy is the truth).

places (today the server's WorkspaceRegistry):
    authorize_project(token, team, path) -> (identity, team, relpath)
    project_dir(team, relpath) -> the project's folder
    live(team, relpath) -> the open shared workspace, or None
"""
import secrets
import threading
import time

from stilo.kernel.log import log as _log
from stilo.modules.workspace import file_key
from ..model import comments as rules


class Comments:
    def __init__(self, places, store):
        """store: read(project_dir) and write(project_dir, data) (adapters/comments_file.py)."""
        self._places, self._store = places, store
        self._lock = threading.Lock()

    def _changed(self, team, relpath, data):
        workspace = self._places.live(team, relpath)
        if workspace is None:
            return
        try:
            workspace.broadcast({"type": "comments", "files": data.get("files", {}), "serverTime": time.time()})
        except Exception as error:  # noqa: BLE001 - telling others never fails the change itself
            _log("COMMENTS", f"broadcast failed: {error}")

    def _edit(self, token, team, path, change):
        identity, team, relpath = self._places.authorize_project(token, team, path)
        folder = self._places.project_dir(team, relpath)
        with self._lock:
            data = self._store.read(folder)
            result, changed = change(data, identity)
            if changed:
                self._store.write(folder, data)
        if changed:
            self._changed(team, relpath, data)
        return result

    def list(self, token, team, path) -> dict:
        _, team, relpath = self._places.authorize_project(token, team, path)
        return self._store.read(self._places.project_dir(team, relpath))

    def save(self, token, team, path, payload: dict) -> dict:
        file = file_key(payload.get("file"))

        def change(data, identity):
            now = int(time.time() * 1000)
            return {"comment": rules.save(data, file, payload, identity["username"], now, f"{now}-{secrets.token_hex(4)}")}, True
        return self._edit(token, team, path, change)

    def delete(self, token, team, path, comment_id) -> dict:
        def change(data, _):
            removed = rules.delete(data, str(comment_id))
            return {"deleted": removed}, removed
        return self._edit(token, team, path, change)

    def reanchor(self, token, team, path, file, moves) -> dict:
        key = file_key(file)

        def change(data, _):
            moved = rules.reanchor(data, key, moves)
            return {"updated": moved}, moved
        return self._edit(token, team, path, change)
