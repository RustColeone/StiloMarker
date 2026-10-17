"""Chats' HTTP routes (protocol/chats.contract.json). A value may come in the
JSON body or the query; the token is always in the query."""


def add_routes(transport, desk):
    def call(run):
        def route(request):
            token = request.query("token")
            if not token:
                raise PermissionError("Missing session token")
            body = request.json()  # {} when there is none
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object")
            arg = lambda key, default=None: body[key] if key in body else request.query(key, default)
            try:
                return run(token, str(arg("team", "")), str(arg("path", "")), arg)
            except TypeError as error:  # a value of the wrong kind is the caller's mistake, not ours
                raise ValueError(str(error)) from error
        return route

    def number(arg, key):
        return int(arg(key, 0) or 0)

    transport.add_route("GET", "/api/chats", call(lambda t, team, path, arg: desk.overview(t, team, path)))
    transport.add_route("GET", "/api/chats/messages", call(lambda t, team, path, arg: desk.messages(t, team, path, arg("id"), before=arg("before"), after=arg("after"))))
    transport.add_route("GET", "/api/chats/search", call(lambda t, team, path, arg: desk.search(t, team, path, arg("id"), str(arg("q", "")))))
    transport.add_route("GET", "/api/chats/note", call(lambda t, team, path, arg: desk.note(t, team, path, str(arg("contact", "")))))
    transport.add_route("POST", "/api/chats/note", call(lambda t, team, path, arg: desk.note(t, team, path, str(arg("contact", "")), str(arg("alias", "")), str(arg("note", "")))))
    transport.add_route("POST", "/api/chats/start", call(lambda t, team, path, arg: desk.start(t, team, path, arg("members") or [])))
    transport.add_route("POST", "/api/chats/send", call(lambda t, team, path, arg: desk.send(t, team, path, arg("id"), str(arg("content", "")), arg("contextPaths") or [],
                                                                       {"model": arg("model"), "runner": arg("runner"), "accountToken": t})))
    transport.add_route("POST", "/api/chats/invite", call(lambda t, team, path, arg: desk.invite(t, team, path, arg("id"), arg("members") or [])))
    transport.add_route("POST", "/api/chats/leave", call(lambda t, team, path, arg: desk.leave(t, team, path, arg("id"))))
    transport.add_route("POST", "/api/chats/rename", call(lambda t, team, path, arg: desk.rename(t, team, path, arg("id"), str(arg("title", "")))))
    transport.add_route("POST", "/api/chats/read", call(lambda t, team, path, arg: desk.read(t, team, path, arg("id"), number(arg, "messageId"))))
    transport.add_route("POST", "/api/chats/stop", call(lambda t, team, path, arg: desk.stop(t, team, path, arg("id"))))
    transport.add_route("POST", "/api/chats/import", call(lambda t, team, path, arg: desk.import_group(t, team, path, arg("title", ""), arg("characters") or [], arg("messages") or [])))
    transport.add_route("POST", "/api/chats/prompt", call(lambda t, team, path, arg: desk.prompt(t, team, path, arg("id"), str(arg("character", "")), number(arg, "trigger"))))
    transport.add_route("POST", "/api/chats/typing", call(lambda t, team, path, arg: desk.typing(t, team, path, arg("id"), str(arg("character", "")), number(arg, "trigger"),
                                                                           str(arg("text", "")), str(arg("state", "writing")))))
    transport.add_route("POST", "/api/chats/reply", call(lambda t, team, path, arg: desk.reply(t, team, path, arg("id"), str(arg("character", "")), number(arg, "trigger"),
                                                                         str(arg("content", "")), str(arg("state", "done")))))
