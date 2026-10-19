"""Projects' HTTP routes (protocol/projects.contract.json; the browser's Cloud
calls them): the file browser's listing and new folder, each account's open
files, and who may open a project (its access file: Identity's rules)."""


def _token(request) -> str:
    token = request.query("token")
    if not token:
        raise PermissionError("Missing session token")
    return token


def add_routes(transport, projects):
    def browse(request):
        return projects.browse(_token(request), request.query("team"), request.query("path"))

    def make_folder(request):
        token, payload = _token(request), request.json()
        return projects.make_folder(token, str(payload.get("team", "")), str(payload.get("path", "")), str(payload.get("name", "")))

    def user_state(request):
        token, payload = _token(request), request.json()
        return projects.write_user_state(token, str(payload.get("team", "")), str(payload.get("path", "")),
                                         payload.get("openFiles", []), payload.get("activeFile"), payload.get("groups"))

    def get_access(request):
        return projects.get_access(_token(request), request.query("team"), request.query("path"))

    def set_access(request):
        token, payload = _token(request), request.json()
        return projects.set_access(token, str(payload.get("team", "")), str(payload.get("path", "")),
                                   payload.get("whitelist", []), payload.get("blacklist", []), payload.get("readers"))

    transport.add_route("GET", "/api/workspaces/browse", browse)
    transport.add_route("POST", "/api/workspaces/mkdir", make_folder)
    transport.add_route("POST", "/api/workspaces/user-state", user_state)
    transport.add_route("GET", "/api/workspaces/access", get_access)
    transport.add_route("POST", "/api/workspaces/access", set_access)
