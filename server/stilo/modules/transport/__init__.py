"""Transport: the server's HTTP side. Owns the listener, the route table, CORS
headers, JSON responses, the mapping from errors to status codes, and the
app's files (served from config static_root, gzipped). Other modules add
routes; nothing else writes HTTP.

API:
    add_route(method, path, run, prefix=False, allow_headers=())
        A data route: run(request) returns the JSON payload, or a File(data,
        content_type, cache) to answer with bytes. request.query(name),
        request.json(), request.body() (the raw bytes). Raise
        PermissionError (403), LookupError (404) or ValueError (400).
    add_stream_route(method, path, run, allow_headers=())
        A server-sent event stream; see adapters/http.py run_stream_route.
    add_line_stream_route(method, path, run, allow_headers=())
        A long answer streamed as lines of JSON, with heartbeats; see
        adapters/http.py run_line_stream_route.
    Refusal(status, payload)  raise from a route to answer with that status
    keep_private(*names)       files never handed out, whatever folder they are in
    ping.add({id, fields()})   what /api/ping says about a module (its capabilities)
    listen(host, port, on_close) -> the HTTP server (serve_forever, shutdown,
        server_close; on_close runs first: the modules stop)
    find(method, path)              -> the route, or None
    handle(handler, method, parsed) -> True when a route answered
    send_cors(handler, path)        CORS headers for a response to path
    write_json(handler, status, payload, path="")
"""
from stilo.kernel import define_module
from .adapters import http
from .adapters.web import make_listener
from .adapters.http import File, Refusal  # noqa: F401
from .model.routes import check_route, match, route_key


def start(ctx):
    routes = ctx.registry(key="key", validate=check_route)

    def _add(method, path, kind, run, prefix, allow_headers):
        return routes.add({"key": route_key(method, path, prefix), "method": method, "path": path, "kind": kind,
                           "run": run, "prefix": bool(prefix), "allow_headers": tuple(allow_headers)})

    def add_route(method, path, run, prefix=False, allow_headers=()):
        return _add(method, path, "data", run, prefix, allow_headers)

    def add_stream_route(method, path, run, allow_headers=()):
        return _add(method, path, "stream", run, False, allow_headers)

    def add_line_stream_route(method, path, run, allow_headers=()):
        return _add(method, path, "lines", run, False, allow_headers)

    def find(method, path):
        return match(routes.all(), method, path)

    def handle(handler, method, parsed):
        route = find(method, parsed.path)
        if route is None:
            return False
        if route["kind"] == "stream":
            http.run_stream_route(handler, parsed, route, ctx.log)
        elif route["kind"] == "lines":
            http.run_line_stream_route(handler, parsed, route, ctx.log)
        else:
            http.run_data_route(handler, parsed, route, ctx.log)
        return True

    def allowed_headers(path):
        route = find("POST", path) or find("GET", path)
        return route["allow_headers"] if route else ()

    # Files never handed out (the account file, a session's state file).
    private_names = set()

    def keep_private(*names):
        private_names.update(names)

    # The server's ping: who it is, and what each module says it can do.
    def check_ping(entry):
        if not callable(entry.get("fields")):
            raise ValueError(f"ping entry {entry.get('id')!r} needs fields()")
    ping = ctx.registry(validate=check_ping)

    def answer_ping(request):
        answer = {"message": "pong", "server": "mdnotes", "appVersion": ctx.config.get("app_version")}
        for entry in ping.all():
            answer.update(entry["fields"]())
        return answer
    add_route("GET", "/api/ping", answer_ping)

    def listen(host, port, on_close=lambda: None):
        return make_listener(host, port, handle=handle, send_cors=lambda handler, path: http.send_cors(handler, allowed_headers(path)),
                             write_json=lambda handler, status, payload, path: http.write_json(handler, status, payload, allowed_headers(path)),
                             static_root=ctx.config.get("static_root", "."), private_names=private_names, on_close=on_close)

    return type("Transport", (), {
        "add_route": staticmethod(add_route),
        "add_stream_route": staticmethod(add_stream_route),
        "add_line_stream_route": staticmethod(add_line_stream_route),
        "Refusal": Refusal,
        "File": File,
        "find": staticmethod(find),
        "handle": staticmethod(handle),
        "send_cors": staticmethod(lambda handler, path: http.send_cors(handler, allowed_headers(path))),
        "write_json": staticmethod(lambda handler, status, payload, path="": http.write_json(handler, status, payload, allowed_headers(path))),
        "routes": staticmethod(routes.all),
        "keep_private": staticmethod(keep_private),
        "ping": type("Ping", (), {"add": staticmethod(ping.add)})(),
        "listen": staticmethod(listen),
    })()


MODULE = define_module(__file__, start)
