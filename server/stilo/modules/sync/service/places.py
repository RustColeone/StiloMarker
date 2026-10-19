"""Where a team's project is, who may see it, and whether it is open now: the
questions History, Comments and Chats ask about a project, answered by
Projects (where, who) and the directory (what is open)."""
import copy


class Places:
    def __init__(self, projects, directory):
        self._projects, self._directory = projects, directory

    # ---- Projects' ---------------------------------------------------------------
    def authorize_project(self, token, team, path):
        """(identity, team, relpath) when the account may open the project there."""
        return self._projects.authorize_project(token, team, path)

    def project_dir(self, team, relpath):
        return self._projects.project_dir(team, relpath)

    def may_edit(self, identity, team, relpath) -> bool:
        return self._projects.may_edit(identity, team, relpath)

    def folder(self, team, relpath):
        """Where a project lives (or would)."""
        return self._projects.folder(team, relpath)

    def people(self, team, relpath) -> list[str]:
        return self._projects.people(team, relpath)

    # ---- the directory's ---------------------------------------------------------
    def live(self, team, relpath):
        return self._directory.live(team, relpath)

    def live_workspaces(self):
        return self._directory.live_workspaces()

    def place_of(self, workspace):
        return self._directory.place_of(workspace)

    def project_copy(self, team, relpath) -> dict:
        """A copy of the project: the live one, or read from its folder."""
        workspace = self._directory.read(team, relpath, self._projects.project_dir(team, relpath))
        with workspace.lock:
            return copy.deepcopy(workspace.project)
