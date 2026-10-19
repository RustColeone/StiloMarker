"""A module's routes without a server: FakeTransport collects what a module's
add_routes registers, and call() answers a route the way Transport does (the
same error-to-status mapping), so a test sees (status, body)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "server"))
from stilo.modules.transport.adapters.http import File, Refusal, status_for  # noqa: E402


class FakeTransport:
    Refusal, File = Refusal, File

    def __init__(self):
        self.routes = {}

    def add_route(self, method, path, run, prefix=False, allow_headers=()):
        self.routes[(method, path)] = run

    add_stream_route = add_line_stream_route = add_route


class FakeRequest:
    def __init__(self, body=None, query=None, headers=None, client_ip="127.0.0.1"):
        self._body, self._query, self._headers, self.client_ip = body, query or {}, headers or {}, client_ip

    def query(self, name, default=""):
        return self._query.get(name, default)

    def json(self):
        return json.loads(json.dumps(self._body if self._body is not None else {}))

    def body(self):
        return self._body if isinstance(self._body, bytes) else b""

    def header(self, name, default=""):
        return self._headers.get(name, default)


def call(transport, method, path, request):
    """(status, body): body is the JSON payload, a File, or what a line route's
    run(emit, cancelled) produced."""
    try:
        answer = transport.routes[(method, path)](request)
    except Refusal as refusal:
        return refusal.status, refusal.payload
    except Exception as error:  # noqa: BLE001 - mapped like Transport, else a bug
        status = status_for(error)
        if status is None:
            raise
        return int(status), {"message": str(error)}
    if callable(answer):
        return 200, answer(lambda event: None, lambda: False)
    return 200, answer
