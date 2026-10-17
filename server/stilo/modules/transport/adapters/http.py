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


class Refusal(Exception):
    """A route's answer with a status of its own choosing (a conflict, an
    out-of-date client, storage unavailable) and the JSON body to send."""

    def __init__(self, status: int, payload: dict):
        super().__init__(payload.get("message", ""))
        self.status = int(status)
        self.payload = payload


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
    except Refusal as refusal:
        return write_json(handler, refusal.status, refusal.payload, allow)
    except Exception as error:  # noqa: BLE001 - mapped to a status, or reported as a server error
        status = status_for(error)
        if status is not None:
            return write_json(handler, status, {"message": str(error)}, allow)
        log(f"{route['method']} {route['path']} failed: {error!r}")
        return write_json(handler, HTTPStatus.INTERNAL_SERVER_ERROR, {"message": "Server error"}, allow)
    write_json(handler, HTTPStatus.OK, payload, allow)


def run_stream_route(handler, parsed, route, log):
    """A server-sent event stream. route["run"](request) opens it (raising like a
    data route when refused) and returns an object with:
        next(timeout) -> the next event (a dict), or None after `timeout` seconds
        should_close() -> True when the stream must end
        close()        called once the stream has ended, however it ended
    A keep-alive comment goes out whenever no event came for 15 seconds."""
    allow = route.get("allow_headers", ())
    try:
        stream = route["run"](Request(handler, parsed))
    except Refusal as refusal:
        return write_json(handler, refusal.status, refusal.payload, allow)
    except Exception as error:  # noqa: BLE001
        status = status_for(error)
        if status is None:
            log(f"{route['method']} {route['path']} failed: {error!r}")
            status = HTTPStatus.INTERNAL_SERVER_ERROR
        return write_json(handler, status, {"message": str(error) if status != HTTPStatus.INTERNAL_SERVER_ERROR else "Server error"}, allow)
    handler.send_response(HTTPStatus.OK)
    send_cors(handler, allow)
    handler.send_header("Content-Type", "text/event-stream; charset=utf-8")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    # Without this a reverse proxy (nginx) buffers the stream and events stop
    # arriving live.
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()
    try:
        while not stream.should_close():
            event = stream.next(15)
            if event is None:
                handler.wfile.write(b": keepalive\n\n")
            elif not stream.should_close():
                handler.wfile.write(f"data: {json.dumps(event)}\n\n".encode("utf-8"))
            handler.wfile.flush()
    except OSError:  # the client went away (BrokenPipe, ConnectionReset, ...)
        pass
    finally:
        stream.close()
