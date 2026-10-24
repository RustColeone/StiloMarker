"""Identity's HTTP routes: signing in (with a password, or again with the
token a page kept) and out, and the admin page's accounts. (Who
may open a project is asked through Projects' access routes, which know where
the project is.)"""


def _token(request) -> str:
    token = request.query("token")
    if not token:
        raise PermissionError("Missing session token")
    return token


def add_routes(transport, identity):
    def login(request):
        payload = request.json()
        return identity.login(str(payload.get("username", "")), str(payload.get("password", "")))

    def signed_in(request):
        return identity.signed_in(_token(request))

    def logout(request):
        identity.logout(_token(request))
        return {"message": "Signed out"}

    def list_accounts(request):
        return {"accounts": identity.accounts_list(_token(request))}

    def change_account(request):
        token, payload = _token(request), request.json()
        return {"accounts": identity.accounts_change(token, payload if isinstance(payload, dict) else {})}

    transport.add_route("POST", "/api/auth/login", login)
    transport.add_route("GET", "/api/auth/me", signed_in)
    transport.add_route("POST", "/api/auth/logout", logout)
    transport.add_route("GET", "/api/accounts", list_accounts)
    transport.add_route("POST", "/api/accounts", change_account)
