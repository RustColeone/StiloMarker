"""Projects (server): where the teams' projects are kept and who may open
them. A team's folder (data/team_<team>/) holds folders at any depth; a
folder with Workspace's manifest is a project. Names and paths are checked
so a request never leaves the data folder; the project's access file is
read with Identity's rules. Also each account's open files in a project, and
the flat workspaces from before folders. The browser's half is the Cloud
module's file browser (app/modules/cloud).

Static, for code from before the restructure:
    open_projects(identity, data_dir) -> Projects (service/projects.py)
    safe_component(name), safe_relpath(path)

API (started by the kernel):
    serve(projects)   adds the browsing, new-folder, open-files and access
                      routes (adapters/routes.py, protocol/projects.contract.json)
"""
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters.routes import add_routes
from .adapters.team_folders import TeamFolders
from .model.paths import safe_component, safe_relpath  # noqa: F401
from .service.projects import Projects


def open_projects(identity, data_dir=None) -> Projects:
    return Projects(identity, TeamFolders(data_dir))


def start(ctx):
    transport = ctx.use("transport")
    ctx.use("workspace")
    ctx.use("identity")
    return SimpleNamespace(serve=lambda projects: add_routes(transport, projects))


MODULE = define_module(__file__, start)
