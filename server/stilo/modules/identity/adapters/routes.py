"""Identity's HTTP route: signing in. (Who may open a project is asked
through Projects' access routes, which know where the project is.)"""


def add_routes(transport, identity):
    def login(request):
        payload = request.json()
        return identity.login(str(payload.get("username", "")), str(payload.get("password", "")))

    transport.add_route("POST", "/api/auth/login", login)
