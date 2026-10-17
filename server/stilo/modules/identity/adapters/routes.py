"""Identity's HTTP routes: signing in, and reading or setting who may open a
project. Where a project's folder is comes from the `places` port:

    places.project(team, path, must_exist=False) -> (project_dir, legacy)
        legacy() gives the meta of a project from before access files, or None.
"""


def _token(request) -> str:
    token = request.query("token")
    if not token:
        raise PermissionError("Missing session token")
    return token


def add_routes(transport, identity, places):
    def login(request):
        payload = request.json()
        return identity.login(str(payload.get("username", "")), str(payload.get("password", "")))

    def get_access(request):
        account = identity.require(_token(request))
        team = identity.require_team(account, request.query("team"))
        project_dir, legacy = places.project(team, request.query("path"))
        return identity.access(project_dir, legacy)

    def set_access(request):
        account = identity.require(_token(request))
        payload = request.json()
        team = identity.require_team(account, str(payload.get("team", "")))
        project_dir, legacy = places.project(team, str(payload.get("path", "")), must_exist=True)
        return identity.set_access(account, team, project_dir, payload.get("whitelist", []),
                                   payload.get("blacklist", []), payload.get("readers"), legacy)

    transport.add_route("POST", "/api/auth/login", login)
    transport.add_route("GET", "/api/workspaces/access", get_access)
    transport.add_route("POST", "/api/workspaces/access", set_access)
