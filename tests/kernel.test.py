"""The server's kernel (server/stilo/kernel) and the Transport module. The
browser's kernel has the same rules (tests/kernel.test.mjs)."""
import io, json, sys, types, unittest
from contextlib import redirect_stdout
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.kernel import Emitter, Module, Registry, start_modules  # noqa: E402
from stilo.kernel.log import best_effort, ignore  # noqa: E402
from stilo.modules import transport  # noqa: E402
from stilo.modules.transport.model.routes import match  # noqa: E402


def mod(name, level, uses, start=lambda ctx: {}):
    return Module(name, level, uses, {}, start)


class KernelTests(unittest.TestCase):
    def test_every_module_reads_the_same_config_and_cannot_change_it(self):
        seen = []
        def start(ctx):
            seen.append((ctx.name, ctx.config.get("data_dir"), ctx.config.get("missing")))
            with self.assertRaises(TypeError):
                ctx.config["data_dir"] = "elsewhere"
            return {}
        start_modules([mod("a", 1, [], start), mod("b", 2, ["a"], start)], config={"data_dir": "/srv"})
        self.assertEqual(seen, [("a", "/srv", None), ("b", "/srv", None)])
        start_modules([mod("c", 1, [], lambda ctx: seen.append(dict(ctx.config)) or {})])
        self.assertEqual(seen[-1], {}, "no config: an empty one")

    def test_lowest_level_first_and_only_declared_uses(self):
        order = []
        apis = start_modules([
            mod("top", 2, ["base"], lambda ctx: order.append("top") or {"sum": ctx.use("base")["one"] + 1}),
            mod("base", 1, [], lambda ctx: order.append("base") or {"one": 1}),
            mod("other", 1, [], lambda ctx: order.append("other") or {}),
        ])
        self.assertEqual(order, ["base", "other", "top"])
        self.assertEqual(apis["top"]["sum"], 2)
        with self.assertRaises(TypeError):
            apis["top"] = {}

    def test_undeclared_missing_same_level_and_duplicate_are_refused(self):
        with self.assertRaisesRegex(LookupError, "did not declare"):
            start_modules([mod("a", 1, []), mod("b", 2, [], lambda ctx: ctx.use("a"))])
        with self.assertRaisesRegex(LookupError, "not being started"):
            start_modules([mod("b", 2, ["a"])])
        with self.assertRaisesRegex(ValueError, "may not use"):
            start_modules([mod("a", 1, ["b"]), mod("b", 1, [])])
        with self.assertRaisesRegex(ValueError, "Two modules"):
            start_modules([mod("a", 1, []), mod("a", 2, [])])
        with self.assertRaisesRegex(ValueError, "Bad module name"):
            mod("Bad-Name", 1, [])

    def test_registry_and_emitter(self):
        registry = Registry(validate=lambda e: None if e.get("run") else (_ for _ in ()).throw(ValueError("needs run")), owner="t")
        changes = []
        registry.on_change(lambda: changes.append(1))
        remove = registry.add({"id": "one", "run": print})
        with self.assertRaisesRegex(ValueError, "already registered"):
            registry.add({"id": "one", "run": print})
        with self.assertRaisesRegex(ValueError, "needs run"):
            registry.add({"id": "two"})
        with self.assertRaises(TypeError):
            registry.get("one")["id"] = "changed"
        remove(); remove()
        self.assertFalse(registry.has("one"))
        self.assertEqual(len(changes), 2)
        logged, seen = [], []
        events = Emitter("t", lambda *parts: logged.append(" ".join(map(str, parts))))
        events.on("x", lambda value: 1 / 0)
        off = events.on("x", seen.append)
        events.emit("x", 1); off(); events.emit("x", 2)
        self.assertEqual(seen, [1])
        self.assertTrue(any("ZeroDivisionError" in line or "division" in line for line in logged))


class IgnoreTests(unittest.TestCase):
    def test_ignore_logs_the_reason_the_error_and_where(self):
        out = io.StringIO()
        with redirect_stdout(out):
            try:
                int("x")
            except ValueError as error:
                ignore(error, "a broken number")
        line = out.getvalue()
        self.assertIn("[ignored] a broken number", line)
        self.assertIn("ValueError", line)
        self.assertRegex(line, r"at='tests/kernel\.test\.py:\d+'")

    def test_best_effort_reports_once_then_stops(self):
        calls = []

        def gone(event):
            calls.append(event)
            raise BrokenPipeError("the stream is gone")
        out = io.StringIO()
        with redirect_stdout(out):
            emit = best_effort(gone, "the stream went away")
            emit(1); emit(2); emit(3)
            best_effort(None, "nothing to call")(4)
        self.assertEqual(calls, [1])
        self.assertEqual(out.getvalue().count("[ignored] the stream went away"), 1)


class FakeHandler:
    def __init__(self, body=b""):
        self.headers = {"content-length": str(len(body))}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.status = None
        self.sent = {}

    def send_response(self, status):
        self.status = int(status)

    def send_header(self, name, value):
        self.sent[name] = value

    def end_headers(self):
        pass

    def json(self):
        return json.loads(self.wfile.getvalue())


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.t = start_modules([transport.MODULE])["transport"]

    def test_exact_routes_beat_prefixes_and_the_longest_prefix_wins(self):
        routes = [{"method": "GET", "path": "/api/chats", "prefix": True}, {"method": "GET", "path": "/api/chats/x", "prefix": True},
                  {"method": "GET", "path": "/api/chats/x/y", "prefix": False}]
        self.assertEqual(match(routes, "GET", "/api/chats/x/y")["prefix"], False)
        self.assertEqual(match(routes, "GET", "/api/chats/x/z")["path"], "/api/chats/x")
        self.assertIsNone(match(routes, "POST", "/api/chats"))

    def test_data_routes_map_errors_to_status_codes(self):
        def run(request):
            kind = request.query("fail")
            errors = {"perm": PermissionError("no"), "missing": LookupError("gone"), "bad": ValueError("bad"), "bug": KeyError("x")}
            if kind:
                raise errors[kind]
            return {"echo": request.json().get("value")}
        self.t.add_route("POST", "/api/echo", run)
        for query, status in (("", 200), ("fail=perm", 403), ("fail=missing", 404), ("fail=bad", 400), ("fail=bug", 500)):
            handler = FakeHandler(b'{"value": 7}')
            self.assertTrue(self.t.handle(handler, "POST", urlparse(f"/api/echo?{query}")))
            self.assertEqual(handler.status, status, query)
        self.assertEqual(handler.json(), {"message": "Server error"}, "a bug never leaks its details")
        ok = FakeHandler(b'{"value": 7}')
        self.t.handle(ok, "POST", urlparse("/api/echo"))
        self.assertEqual(ok.json(), {"echo": 7})
        self.assertFalse(self.t.handle(FakeHandler(), "GET", urlparse("/api/echo")))

    def test_cors_headers_follow_the_route(self):
        self.t.add_legacy_route("POST", "/api/chat/mcp", lambda h, p: None, allow_headers=("Authorization",))
        handler = FakeHandler()
        self.t.send_cors(handler, "/api/chat/mcp")
        self.assertEqual(handler.sent["Access-Control-Allow-Headers"], "Content-Type, Authorization")
        self.t.send_cors(handler, "/api/other")
        self.assertEqual(handler.sent["Access-Control-Allow-Headers"], "Content-Type")

    def test_the_server_registers_every_route_once(self):
        spec = __import__("importlib.util").util.spec_from_file_location("mdnotes_server", ROOT / "server/mdnotes_server.py")
        server = __import__("importlib.util").util.module_from_spec(spec)
        spec.loader.exec_module(server)
        keys = [(m, p, prefix) for m, p, prefix, _ in server.LEGACY_ROUTES]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertIn(("POST", "/api/chat", False), keys)
        self.assertFalse([p for _, p, _ in keys if p.startswith(("/api/chats", "/api/session", "/api/comments"))],
                         "routes that moved into modules are no longer legacy")
        self.assertNotIn("/api/ping", [p for _, p, _ in keys], "ping is a data route")


if __name__ == "__main__":
    unittest.main()
