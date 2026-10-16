"""Transport: the server's HTTP side. Owns the route table, CORS headers, JSON
responses and the mapping from errors to status codes. Other modules add
routes; nothing else writes HTTP.

API:
    add_route(method, path, run, prefix=False, allow_headers=())
        A data route: run(request) returns the JSON payload. Raise
        PermissionError (403), LookupError (404) or ValueError (400).
    add_legacy_route(method, path, run, prefix=False, allow_headers=())
        Code from before the restructure: run(handler, parsed) writes its own
        response. Shrinks as modules move; new code uses add_route.
    find(method, path)              -> the route, or None
    handle(handler, method, parsed) -> True when a route answered
    send_cors(handler, path)        CORS headers for a response to path
    write_json(handler, status, payload, path="")
"""
from stilo.kernel import define_module
from .adapters import http
from .model.routes import check_route, match, route_key


def start(ctx):
    routes = ctx.registry(key="key", validate=check_route)

    def _add(method, path, kind, run, prefix, allow_headers):
        return routes.add({"key": route_key(method, path, prefix), "method": method, "path": path, "kind": kind,
                           "run": run, "prefix": bool(prefix), "allow_headers": tuple(allow_headers)})

    def add_route(method, path, run, prefix=False, allow_headers=()):
        return _add(method, path, "data", run, prefix, allow_headers)

    def add_legacy_route(method, path, run, prefix=False, allow_headers=()):
        return _add(method, path, "legacy", run, prefix, allow_headers)

    def find(method, path):
        return match(routes.all(), method, path)

    def handle(handler, method, parsed):
        route = find(method, parsed.path)
        if route is None:
            return False
        if route["kind"] == "legacy":
            route["run"](handler, parsed)
        else:
            http.run_data_route(handler, parsed, route, ctx.log)
        return True

    def allowed_headers(path):
        route = find("POST", path) or find("GET", path)
        return route["allow_headers"] if route else ()

    return type("Transport", (), {
        "add_route": staticmethod(add_route),
        "add_legacy_route": staticmethod(add_legacy_route),
        "find": staticmethod(find),
        "handle": staticmethod(handle),
        "send_cors": staticmethod(lambda handler, path: http.send_cors(handler, allowed_headers(path))),
        "write_json": staticmethod(lambda handler, status, payload, path="": http.write_json(handler, status, payload, allowed_headers(path))),
        "routes": staticmethod(routes.all),
    })()


MODULE = define_module(__file__, start)
