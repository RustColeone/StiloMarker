"""The Assistant's HTTP routes (protocol/assistant.contract.json): an agent turn
(its progress streamed as lines), the agent's status, connected tools (MCP),
a character's request built for a browser that runs the model itself, Quick
Generate, a generated image, and the agent's conversations a workspace shares.

Spending the server's keys needs a signed-in account when the server has
accounts, and (unless MDNOTES_CHAT_ALLOW_REMOTE) a browser on this machine;
a request bringing its own key needs neither."""


def add_routes(transport, *, agent, threads, identity, directory, version):
    Refusal = transport.Refusal

    def token_of(request) -> str:
        token = request.query("token")
        if not token:
            raise PermissionError("Missing session token")
        return token

    def account_for(token: str, own_key: bool):
        """The account behind an agent request, or None; refused when the server's
        keys would be spent without one."""
        account = identity.who(token) if token else None
        if not own_key and identity.enabled and account is None:
            raise PermissionError("Sign in to use the agent (Settings → Collaboration → Account). "
                                  "If you are signed in, reload the page.")
        return account

    def status(request):
        # Public (no key leaves the server), even to remote browsers: they weigh
        # `localOnly` against their own key instead of getting an opaque 403.
        return {**agent.public_status(), "requiresAccount": identity.enabled}

    def connections(request):
        try:
            return connections_for(request)
        except PermissionError as error:
            raise PermissionError("Sign in with an account that can use these connections.") from error

    def connections_for(request):
        authorization = request.header("Authorization")
        token = authorization[7:] if authorization.startswith("Bearer ") else ""
        account = identity.require(token)
        payload = request.json()
        if not isinstance(payload, dict):
            raise ValueError("Expected a connection request object.")
        action = payload.get("action", "list")
        if action == "list":
            return {"servers": [{"id": config["id"], "label": config["label"]} for config in agent.mcp.visible(account)],
                    "message": agent.mcp.error}
        if action == "check":
            return {"servers": agent.check_connections(payload.get("servers", []), account)}
        raise ValueError("Unknown connection action.")

    def turn(request):
        payload = request.json()
        # A browser bringing its own key may use the agent from anywhere; the
        # server's key only from this machine (unless the server allows remote).
        override = {"apiKey": str(payload.get("apiKey") or "").strip(), "apiUrl": str(payload.get("apiUrl") or "").strip(),
                    "model": str(payload.get("apiModel") or "").strip()}
        account = account_for(str(payload.get("accountToken") or ""), bool(override["apiKey"]))
        if not override["apiKey"]:
            agent.authorize_client(request.client_ip)
        messages = payload.get("messages")
        context_files = payload.get("contextFiles") or []
        project = payload.get("project")
        connection_ids = payload.get("mcpServers", [])
        configs = []
        if connection_ids:
            account = identity.require(str(payload.get("accountToken", "")))
            configs = agent.mcp.select(connection_ids, account)
        elif not isinstance(connection_ids, list):
            raise ValueError("MCP connections must be a list.")
        model = str(payload.get("model")).strip() if payload.get("model") else None
        # A character's reply (Chats): characters never use connected tools.
        persona = payload.get("persona") if payload.get("mode") == "persona" else None
        cast = payload.get("cast") if persona is not None else None
        if persona is not None:
            if not isinstance(persona, dict):
                raise ValueError("Persona must be an object.")
            configs = []
        if not isinstance(messages, list):
            raise ValueError("Messages payload is required.")
        if not isinstance(context_files, list):
            raise ValueError("Context files payload must be a list.")
        if project is not None and not isinstance(project, dict):
            project = None

        def run(emit, cancelled):
            return agent.chat(messages, context_files, str(payload.get("projectName", "Workspace")), project,
                              progress=emit, model=model, override=override, mcp_configs=configs, cancelled=cancelled,
                              persona=persona, cast=cast, identity=account)
        return run

    def character_prompt(request):
        """A character's request, built but not sent: for a browser that runs the
        model itself. It spends no key, so it needs no sign-in."""
        payload = request.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("persona"), dict):
            raise ValueError("A character is required")
        project = payload.get("project") if isinstance(payload.get("project"), dict) else None
        try:
            built, _ = agent.build_persona_payload(payload.get("messages") or [], payload.get("contextFiles") or [],
                                                   str(payload.get("projectName", "")), project, payload["persona"],
                                                   payload.get("cast") or [], "")
        except TypeError as error:
            raise ValueError(str(error)) from error
        for key in ("model", "thinking", "reasoning_effort"):
            built.pop(key, None)
        return {"payload": built}

    def generate(request):
        payload = request.json()
        account_for(str(payload.get("accountToken") or ""), own_key=False)
        agent.authorize_client(request.client_ip)
        context_files = payload.get("contextFiles") or []
        if not isinstance(context_files, list):
            raise ValueError("Context files payload must be a list.")
        overview = payload.get("overview") if isinstance(payload.get("overview"), dict) else {}
        try:
            return agent.generate(str(payload.get("subject", "")), str(payload.get("instructions", "")), context_files,
                                  {"title": str(overview.get("title") or ""), "text": str(overview.get("text") or "")},
                                  str(payload.get("projectName", "Workspace")))
        except RuntimeError as error:
            raise Refusal(502, {"message": str(error)}) from error

    def generated(request):
        """A generated image, to the account that asked for it."""
        try:
            account = identity.require(token_of(request))
        except PermissionError as error:
            raise PermissionError("Sign in to see generated images.") from error
        found = agent.generated.load(request.query("id"), account["username"]) if agent.generated is not None else None
        if found is None:
            raise LookupError("Image not found (generated images are kept for 14 days).")
        data, content_type = found
        return transport.File(data, content_type, cache="private, max-age=86400")

    def read_threads(request):
        token = token_of(request)
        return threads.get(directory.broker_for_token(token), token)

    def save_threads(request):
        token = token_of(request)
        payload = request.json()
        try:
            sent = int(payload.get("version"))
        except (TypeError, ValueError):
            sent = 0
        if sent < version:
            raise Refusal(426, {"message": "This tab uses an older sync implementation. Reload to update Stilo Marker.",
                                "upgradeRequired": True, "minVersion": version})
        try:
            return threads.set(directory.broker_for_token(token), token, payload)
        except ValueError as error:
            if "conflict" in str(error).lower():
                raise Refusal(409, {"message": str(error)}) from error
            raise
        except PermissionError:
            raise  # an OSError too, but a refusal (403), not storage trouble
        except OSError as error:
            raise Refusal(503, {"message": "Chat storage is unavailable; your local conversation is kept."}) from error

    transport.add_line_stream_route("POST", "/api/chat", turn)
    transport.add_route("GET", "/api/chat/status", status)
    transport.add_route("POST", "/api/chat/mcp", connections, allow_headers=("Authorization",))
    transport.add_route("POST", "/api/chat/prompt", character_prompt)
    transport.add_route("POST", "/api/generate", generate)
    transport.add_route("GET", "/api/generated", generated)
    transport.add_route("GET", "/api/chat/workspace", read_threads)
    transport.add_route("POST", "/api/chat/workspace", save_threads)
