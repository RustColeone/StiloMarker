"""History's HTTP routes (protocol/history.contract.json): snapshots of files
and backups of whole workspaces, answered by the HistoryDesk."""


def add_routes(transport, desk):
    def token_of(request) -> str:
        token = request.query("token")
        if not token:
            raise PermissionError("Missing session token")
        return token

    def where(request):
        return token_of(request), request.query("team"), request.query("path")

    def sent(request):
        payload = request.json()
        return token_of(request), str(payload.get("team", "")), str(payload.get("path", "")), payload

    def create_snapshot(request):
        token, team, path, payload = sent(request)
        return desk.create_snapshot(token, team, path, str(payload.get("file", "")), payload.get("content", ""),
                                    payload.get("label", ""), created_at=payload.get("createdAt"))

    def delete_snapshot(request):
        token, team, path, payload = sent(request)
        return desk.delete_snapshot(token, team, path, str(payload.get("id", "")))

    def create_backup(request):
        token, team, path, payload = sent(request)
        return desk.create_backup(token, team, path, str(payload.get("label", "")))

    transport.add_route("GET", "/api/snapshots", lambda r: desk.list_snapshot_paths(*where(r)))
    transport.add_route("GET", "/api/snapshots/versions", lambda r: desk.list_snapshot_versions(*where(r), r.query("file")))
    transport.add_route("GET", "/api/snapshots/content", lambda r: desk.get_snapshot_content(*where(r), r.query("id")))
    transport.add_route("POST", "/api/snapshots", create_snapshot)
    transport.add_route("POST", "/api/snapshots/delete", delete_snapshot)
    transport.add_route("GET", "/api/backups", lambda r: desk.list_backups(*where(r)))
    transport.add_route("GET", "/api/backups/files", lambda r: desk.list_backup_files(*where(r), r.query("id")))
    transport.add_route("GET", "/api/backups/content", lambda r: desk.get_backup_content(*where(r), r.query("id"), r.query("file")))
    transport.add_route("POST", "/api/backups", create_backup)
