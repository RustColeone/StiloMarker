"""Cloud's HTTP routes (protocol/cloud.contract.json; the browser's Cloud calls
them): creating, deleting, exporting and importing a project."""


def _token(request) -> str:
    token = request.query("token")
    if not token:
        raise PermissionError("Missing session token")
    return token


def add_routes(transport, cloud):
    def create(request):
        token, payload = _token(request), request.json()
        return cloud.create_project(token, str(payload.get("team", "")), str(payload.get("path", "")), str(payload.get("name", "")))

    def delete(request):
        token, payload = _token(request), request.json()
        return cloud.delete_entry(token, str(payload.get("team", "")), str(payload.get("path", "")))

    def export(request):
        return cloud.export_project(_token(request), request.query("team"), request.query("path"))

    def bring_in(request):
        token, payload = _token(request), request.json()
        return cloud.import_project(token, str(payload.get("team", "")), str(payload.get("path", "")),
                                    str(payload.get("name", "")), payload.get("project") or {})

    transport.add_route("POST", "/api/workspaces/create", create)
    transport.add_route("POST", "/api/workspaces/delete", delete)
    transport.add_route("GET", "/api/workspaces/export", export)
    transport.add_route("POST", "/api/workspaces/import", bring_in)
