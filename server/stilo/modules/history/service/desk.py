"""History as callers ask for it: every request names the account (its
token) and the project, and is answered only if that account may open it.
Also the two hooks the server calls: a safety backup before a destructive
change, and the daily sweep.

places (today the server's WorkspaceRegistry):
    authorize_project(token, team, path) -> (identity, team, relpath)
    may_edit(identity, team, relpath) -> bool
    live(team, relpath) -> the open shared workspace, or None
    live_workspaces() -> [(team, relpath, workspace)] backed by a folder
    place_of(workspace) -> (team, relpath), or None for a temporary session
"""


class HistoryDesk:
    def __init__(self, snapshots, backups, places):
        self.snapshots, self.backups, self._places = snapshots, backups, places

    def _project(self, token, team, path):
        return self._places.authorize_project(token, team, path)

    # ---- snapshots ------------------------------------------------------------

    def create_snapshot(self, token, team, path, file_path, content, label="", created_at=None):
        identity, team, relpath = self._project(token, team, path)
        return self.snapshots.create(identity["username"], team, relpath, file_path, content, label, created_at)

    def list_snapshot_paths(self, token, team, path):
        _, team, relpath = self._project(token, team, path)
        return self.snapshots.paths(team, relpath)

    def list_snapshot_versions(self, token, team, path, file_path):
        _, team, relpath = self._project(token, team, path)
        return self.snapshots.versions(team, relpath, file_path)

    def get_snapshot_content(self, token, team, path, version_id):
        _, team, relpath = self._project(token, team, path)
        return self.snapshots.content(team, relpath, version_id)

    def delete_snapshot(self, token, team, path, version_id):
        _, team, relpath = self._project(token, team, path)
        return self.snapshots.delete(team, relpath, version_id)

    # ---- backups --------------------------------------------------------------

    def list_backups(self, token, team, path):
        _, team, relpath = self._project(token, team, path)
        return self.backups.list(team, relpath)

    def list_backup_files(self, token, team, path, backup_id):
        _, team, relpath = self._project(token, team, path)
        return self.backups.files(team, relpath, backup_id)

    def get_backup_content(self, token, team, path, backup_id, file_path):
        _, team, relpath = self._project(token, team, path)
        return self.backups.content(team, relpath, backup_id, file_path)

    def create_backup(self, token, team, path, label=""):
        identity, team, relpath = self._project(token, team, path)
        if not self._places.may_edit(identity, team, relpath):
            raise PermissionError("You have read-only access to this project")
        workspace = self._places.live(team, relpath)
        if workspace is None:
            raise ValueError("Open the workspace first")
        result = self.backups.back_up(workspace, team, relpath, kind="manual", label=label or "Manual backup")
        return {"created": result is not None, "backup": result}

    def backup_workspace(self, team, relpath, kind="daily", label="", now=None):
        workspace = self._places.live(team, relpath)
        if workspace is None or not hasattr(workspace.live.store, "resolve_asset"):
            return None
        return self.backups.back_up(workspace, team, relpath, kind, label, now)

    # ---- hooks ------------------------------------------------------------------

    def before_destructive(self, workspace, reason: str) -> None:
        place = self._places.place_of(workspace)
        if place is not None:
            self.backups.before_destructive(workspace, *place, reason)

    def sweep(self, now=None) -> int:
        return self.backups.sweep(self._places.live_workspaces(), now)
