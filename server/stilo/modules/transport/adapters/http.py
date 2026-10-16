"""Writing HTTP responses for routes: JSON bodies, CORS headers, and turning a
data route's errors into status codes. Only this layer sees the request."""
import json
from http import HTTPStatus
from urllib.parse import parse_qs

ALLOWED_METHODS = "GET, POST, OPTIONS"


def send_cors(handler, allow_headers=()):
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", ", ".join(("Content-Type", *allow_headers)))
    handler.send_header("Access-Control-Allow-Methods", ALLOWED_METHODS)


def write_json(handler, status, payload, allow_headers=()):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    send_cors(handler, allow_headers)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class Request:
    """What a data route sees of a request: its query and its JSON body."""

    def __init__(self, handler, parsed):
        self._handler = handler
        self.path = parsed.path
        self._query = parse_qs(parsed.query)
        self.headers = handler.headers

    def query(self, name, default=""):
        return self._query.get(name, [default])[0]

    def json(self):
        length = int(self.headers.get("content-length", "0"))
        body = self._handler.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            raise ValueError("Invalid JSON payload")


# Errors a data route raises on purpose, and the status each becomes.
# KeyError and IndexError are LookupErrors too, but they mean a bug, not
# "not found", so they stay server errors. Anything else: 500, and logged.
ERROR_STATUS = ((PermissionError, HTTPStatus.FORBIDDEN), (LookupError, HTTPStatus.NOT_FOUND), (ValueError, HTTPStatus.BAD_REQUEST))
BUGS = (KeyError, IndexError)


def status_for(error):
    if isinstance(error, BUGS):
        return None
    return next((status for kind, status in ERROR_STATUS if isinstance(error, kind)), None)


def run_data_route(handler, parsed, route, log):
    allow = route.get("allow_headers", ())
    try:
        payload = route["run"](Request(handler, parsed))
    except Exception as error:  # noqa: BLE001 - mapped to a status, or reported as a server error
        status = status_for(error)
        if status is not None:
            return write_json(handler, status, {"message": str(error)}, allow)
        log(f"{route['method']} {route['path']} failed: {error!r}")
        return write_json(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"message": "Server error"}, allow)
    write_json(handler, HTTPStatus.OK, payload, allow)
