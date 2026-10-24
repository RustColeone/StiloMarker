"""A team's projects made, deleted, copied out and brought in whole. Every
request names the account (its token) and is answered within its teams:
a new project is its maker's; only its owner deletes it (Identity's rule),
and it waits in History's trash; anyone who may open it may export it.

identity (Identity), projects (Projects), directory (Sync's: what is open),
trash (History's, or None without a data folder)."""
import base64
import copy
import mimetypes

from stilo.kernel.log import log as _log
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.projects import safe_component, safe_relpath
from stilo.modules.workspace import default_project, path_of, tree_problem


class Cloud:
    def __init__(self, identity, projects, directory, trash):
        self.identity, self.projects, self.directory, self.trash = identity, projects, directory, trash

    def _where(self, token, team, path):
        identity = self.identity.require(token)
        return identity, self.identity.require_team(identity, team), safe_relpath(path)

    def _new_place(self, team, relpath):
        """The folder a new project goes in (never inside another project)."""
        parent = self.projects.folders.under_team(team, relpath)
        if relpath and parent.exists() and self.projects.folders.is_project(parent):
            raise ValueError("Cannot nest a project inside another project")
        parent.mkdir(parents=True, exist_ok=True)  # every segment is checked
        return parent

    def create_project(self, token: str, team: str, path: str, name: str) -> dict:
        """An empty project (its files and manifest) at path. A publish fills it
        afterwards through the usual changes."""
        identity, team, relpath = self._where(token, team, path)
        name = safe_component(name)
        parent = self._new_place(team, relpath)
        project_dir = parent / name
        if project_dir.exists():
            raise ValueError("A file or folder with that name already exists")
        new_rel = f"{relpath}/{name}" if relpath else name
        self.directory.adopt(team, new_rel, project_dir, default_project(name))
        self.identity.claim(identity, project_dir)
        _log("WORKSPACE", f"{identity['username']} created project {team}/{new_rel}")
        return {"team": team, "path": new_rel, "name": name, "kind": "project", "id": f"{team}/{new_rel}",
                "createdBy": identity["username"]}

    def delete_entry(self, token: str, team: str, path: str) -> dict:
        """A project or a folder into the trash. A project only by its owner; a
        folder by anyone in the team, unless it holds someone else's project.
        Never the team's root."""
        identity, team, relpath = self._where(token, team, path)
        if not relpath:
            raise ValueError("Cannot delete the team root")
        target = self.projects.folders.under_team(team, relpath)
        if not target.is_dir():
            raise ValueError("No such folder or project")
        if self.projects.is_reserved(target.name):
            raise ValueError("Cannot delete a reserved entry")
        if self.trash is None:
            raise PermissionError("Cloud storage is not enabled on this server")
        self.identity.may_delete(identity, team, target, lambda: self.projects.legacy_meta(team, relpath))
        # Its live workspaces (and nested projects') close first, so an open
        # session cannot write files again after the tree is gone.
        self.directory.drop(team, relpath)
        kind = "project" if self.projects.folders.is_project(target) else "folder"
        self.trash.put(identity["username"], team, relpath, target, kind)
        _log("WORKSPACE", f"{identity['username']} deleted {team}/{relpath} (kept in the trash)")
        return {"team": team, "path": relpath, "deleted": True, "trashDays": self.trash.days}

    def export_project(self, token: str, team: str, path: str) -> dict:
        """{name, project}: the whole project with its text, and its images as
        data URLs, so the copy stands on its own."""
        identity, team, relpath = self._where(token, team, path)
        if not relpath:
            raise ValueError("Not a project")
        project_dir = self.projects.folders.under_team(team, relpath)
        if not self.projects.folders.is_project(project_dir):
            raise ValueError("Not a project directory")
        if not self.projects.can_access(identity, team, relpath):
            raise PermissionError(self.projects.refusal(team, relpath, "You do not have access to that project"))
        workspace = self.directory.read(team, relpath, project_dir)  # a live one is fresher than its folder
        with workspace.lock:
            project = copy.deepcopy(workspace.project)
        for node_id, node in project.get("nodes", {}).items():
            if node.get("kind") == "file" and FILE_TYPES.is_image(node.get("name", "")):
                rel = path_of(project, node_id)
                file = (project_dir / rel) if rel else None
                if file and file.is_file():
                    mime = mimetypes.guess_type(node.get("name", ""))[0] or "application/octet-stream"
                    node["content"] = f"data:{mime};base64,{base64.b64encode(file.read_bytes()).decode('ascii')}"
                else:
                    node["content"] = ""
        return {"team": team, "path": relpath, "name": project_dir.name, "project": project}

    def import_project(self, token: str, team: str, path: str, name: str, project: dict) -> dict:
        """A new project at path from an exported {name, project}: images become
        files, the importer its owner, and a name already taken gets -2, -3...
        Names inside are checked so a crafted copy cannot leave its folder."""
        identity, team, relpath = self._where(token, team, path)
        name = safe_component(name)
        if not isinstance(project, dict) or not isinstance(project.get("nodes"), dict):
            raise ValueError("Invalid project payload")
        root_id = project.get("rootId")
        for node in project["nodes"].values():
            if node.get("id") == root_id:
                continue
            node_name = str(node.get("name", ""))
            if "/" in node_name or "\\" in node_name or node_name in ("", ".", ".."):
                raise ValueError("Invalid file or folder name in payload")
        problem = tree_problem(project, FILE_TYPES)
        if problem:
            raise ValueError(problem)
        parent = self._new_place(team, relpath)
        final, counter = name, 2
        while (parent / final).exists():
            final, counter = f"{name}-{counter}", counter + 1
        new_rel = f"{relpath}/{final}" if relpath else final
        model = copy.deepcopy(project)
        model["sourceMode"] = "memory"
        if root_id and root_id in model.get("nodes", {}):
            model["nodes"][root_id]["name"] = final
        model["name"] = final
        self.directory.adopt(team, new_rel, parent / final, model)
        self.identity.claim(identity, parent / final)
        _log("WORKSPACE", f"{identity['username']} imported project {team}/{new_rel}")
        return {"team": team, "path": new_rel, "name": final, "kind": "project", "id": f"{team}/{new_rel}",
                "createdBy": identity["username"]}
