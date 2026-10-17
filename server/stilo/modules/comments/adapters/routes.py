"""Comments' HTTP routes (protocol/comments.contract.json)."""


def add_routes(transport, comments):
    def token_of(request) -> str:
        token = request.query("token")
        if not token:
            raise PermissionError("Missing session token")
        return token

    def sent(request):
        payload = request.json()
        return token_of(request), str(payload.get("team", "")), str(payload.get("path", "")), payload

    def save(request):
        token, team, path, payload = sent(request)
        return comments.save(token, team, path, payload)

    def delete(request):
        token, team, path, payload = sent(request)
        return comments.delete(token, team, path, str(payload.get("id", "")))

    def reanchor(request):
        token, team, path, payload = sent(request)
        return comments.reanchor(token, team, path, str(payload.get("file", "")), payload.get("moves", []))

    transport.add_route("GET", "/api/comments", lambda r: comments.list(token_of(r), r.query("team"), r.query("path")))
    transport.add_route("POST", "/api/comments", save)
    transport.add_route("POST", "/api/comments/delete", delete)
    transport.add_route("POST", "/api/comments/reanchor", reanchor)
