"""Which route answers a request. Pure, so it is tested without a server.

A route is a dict: method, path, prefix (bool). An exact path wins over a
prefix; among prefixes the longest wins.
"""

METHODS = ("GET", "POST", "PUT", "DELETE")


def route_key(method: str, path: str, prefix: bool = False) -> str:
    return f"{method} {path}{'*' if prefix else ''}"


def check_route(route: dict) -> None:
    if route.get("method") not in METHODS:
        raise ValueError(f"route method must be one of {', '.join(METHODS)}: {route.get('method')!r}")
    path = route.get("path")
    if not isinstance(path, str) or not path.startswith("/"):
        raise ValueError(f"route path must start with '/': {path!r}")


def match(routes, method: str, path: str):
    exact = None
    best = None
    for route in routes:
        if route["method"] != method:
            continue
        if not route.get("prefix") and route["path"] == path:
            exact = route
            break
        if route.get("prefix") and path.startswith(route["path"]):
            if best is None or len(route["path"]) > len(best["path"]):
                best = route
    return exact or best
