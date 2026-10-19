"""Sync (server): the shared rebase cases, the rebase log's barriers, sessions
and their roles, and a shared workspace end to end over a store faked in
memory; the directory of open workspaces (hosting, joining by PIN, a
project dropped, the news it tells the modules above)."""
import json, socket, sys, tempfile, threading, unittest, urllib.error, urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import stilo.kernel.log  # noqa: E402,F401
from stilo.modules.sync import DEFAULT_WORKSPACE_ID, PARTS, Directory, RebaseLog, SharedWorkspace, open_live, transform_range  # noqa: E402
from stilo.modules.workspace import LiveProject, default_project  # noqa: E402

CASES = json.loads((ROOT / "spec/sync/rebase.cases.json").read_text(encoding="utf-8"))["cases"]


class RebaseCases(unittest.TestCase):
    def test_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                try:
                    got = list(transform_range(*case["patch"], *case["applied"], case["inserted"]))
                except ValueError:
                    got = "conflict"
                self.assertEqual(got, case["expect"])


class Log(unittest.TestCase):
    def test_patches_rebase_over_later_ones_and_barriers_refuse(self):
        log = RebaseLog(floor=0)
        log.record_patch(1, "a.md", 0, 0, 3)
        self.assertEqual(log.rebase("a.md", 5, 5, 0, 1), (8, 8))
        self.assertEqual(log.rebase("b.md", 5, 5, 0, 1), (5, 5), "other files are not in the way")
        log.note(["a.md", "c.md"], 2, text_only=False)
        with self.assertRaisesRegex(ValueError, "replaced or its path changed"):
            log.rebase("c.md", 0, 0, 1, 2)
        self.assertEqual(log.last_change("a.md"), 2)
        log.note(["Notes", "Notes/x.md", "Old/Notes", "Old/Notes/x.md"], 3, text_only=False)
        self.assertEqual(log.last_change("Old/Notes/x.md"), 3)
        self.assertEqual(log.last_change("Old/Notes/deeper/y.md"), 3, "a folder change covers what is under it")
        log.reset(4)
        with self.assertRaisesRegex(ValueError, "too far behind"):
            log.rebase("b.md", 0, 0, 3, 4)
        self.assertEqual(log.last_change("anything.md"), 4, "after a reset everything older must pull")

    def test_the_log_keeps_its_size(self):
        log = RebaseLog(size=3)
        for revision in range(1, 6):
            log.record_patch(revision, "a.md", 0, 0, 1)
        self.assertEqual([e["revision"] for e in log.entries], [3, 4, 5])


class MemoryStore:
    def __init__(self):
        self.saved, self.fail = None, False

    def load(self):
        return (json.loads(self.saved[0]), self.saved[1]) if self.saved else None

    def save(self, project, revision, previous):
        if self.fail:
            raise OSError("disk full")
        self.saved = (json.dumps(project), revision)
        return project


class Shared(unittest.TestCase):
    def setUp(self):
        logs = patch("stilo.modules.sync.service.shared._log"), patch("stilo.modules.sync.service.sessions._log")
        for p in logs:
            p.start(); self.addCleanup(p.stop)
        self.store = MemoryStore()
        self.ws = SharedWorkspace(LiveProject(self.store), "2468", "1367", **PARTS, edit_gap=600)
        self.amy = self.ws.connect("1367", "Amy")["token"]
        self.ben = self.ws.connect("2468", "Ben")["token"]

    def op(self, token, operation):
        return self.ws.apply_operation(token, operation)

    def text(self, path="a.md"):
        nodes = self.ws.project["nodes"]
        return next(n["content"] for n in nodes.values() if n.get("name") == path)

    def test_concurrent_typing_merges_and_everyone_hears_it(self):
        events = self.ws.subscribe(self.ben)
        self.assertEqual(events.get_nowait()["type"], "ready")
        self.op(self.amy, {"type": "create-file", "parentPath": "", "name": "a.md", "content": "hello world"})
        base = self.ws.revision
        self.op(self.amy, {"type": "patch-file", "path": "a.md", "start": 0, "end": 0, "text": ">> ", "removedText": "", "baseRevision": base})
        event = self.op(self.ben, {"type": "patch-file", "path": "a.md", "start": 11, "end": 11, "text": "!", "removedText": "", "baseRevision": base})
        self.assertEqual(self.text(), ">> hello world!")
        self.assertEqual((event["operation"]["start"], event["operation"]["end"]), (14, 14), "peers get the rebased place")
        self.assertEqual([events.get_nowait()["revision"] for _ in range(3)], [1, 2, 3])
        self.assertEqual(json.loads(self.store.saved[0])["nodes"][self.ws.project["nodes"]["root"]["children"][0]]["content"], ">> hello world!")
        self.assertEqual(event["operation"]["counters"]["sourceVersion"], 2)

    def test_stale_writes_are_refused_and_change_nothing(self):
        self.op(self.amy, {"type": "create-file", "parentPath": "", "name": "a.md", "content": "one"})
        base = self.ws.revision
        self.op(self.amy, {"type": "update-file", "path": "a.md", "content": "two", "baseRevision": base})
        with self.assertRaisesRegex(ValueError, "update-file conflict"):
            self.op(self.ben, {"type": "update-file", "path": "a.md", "content": "old tab", "baseRevision": base})
        with self.assertRaisesRegex(ValueError, "removed text no longer matches"):
            self.op(self.ben, {"type": "patch-file", "path": "a.md", "start": 0, "end": 3, "text": "x", "removedText": "one",
                               "baseRevision": self.ws.revision})
        self.assertEqual((self.text(), self.ws.revision), ("two", 2))

    def test_roles_decide_who_may_write_and_replace(self):
        rita = self.ws.admit("Rita", "reader", identity="rita")["token"]
        events = self.ws.subscribe(rita)
        self.ws.unsubscribe(rita, expected_queue=events)  # a dropped stream keeps the role
        with self.assertRaisesRegex(PermissionError, "read-only"):
            self.op(rita, {"type": "create-folder", "parentPath": "", "name": "x"})
        with self.assertRaisesRegex(PermissionError, "master"):
            self.ws.set_state(self.ben, default_project(), self.ws.revision)
        with self.assertRaisesRegex(ValueError, "replace conflict"):
            self.ws.set_state(self.amy, default_project(), self.ws.revision - 1)
        event = self.ws.set_state(self.amy, default_project("New"), self.ws.revision)
        self.assertEqual((event["type"], self.ws.project["name"]), ("state", "New"))
        with self.assertRaises(PermissionError):
            self.ws.connect("0000", "Mallory")

    def test_hooks_hear_destructive_changes_and_moves(self):
        heard = []
        self.ws.on_before_destructive = lambda ws, reason: heard.append(reason)
        self.ws.on_paths_moved = lambda ws, old, new: heard.append((old, new))
        self.op(self.amy, {"type": "create-folder", "parentPath": "", "name": "Cast"})
        self.op(self.amy, {"type": "create-file", "parentPath": "", "name": "mara.md", "content": ""})
        self.op(self.amy, {"type": "move-node", "path": "mara.md", "parentPath": "Cast"})
        self.op(self.amy, {"type": "rename-node", "path": "Cast/mara.md", "name": "maura.md"})
        self.op(self.amy, {"type": "delete-node", "path": "Cast"})
        self.assertEqual(heard, [("mara.md", "Cast/mara.md"), ("Cast/mara.md", "Cast/maura.md"), "deleting Cast"])

    def test_a_failed_commit_is_undone_before_anything_else(self):
        self.op(self.amy, {"type": "create-file", "parentPath": "", "name": "a.md", "content": "kept"})
        events = self.ws.subscribe(self.ben)
        events.get_nowait()
        self.store.fail = True
        with self.assertRaises(OSError):
            self.op(self.amy, {"type": "update-file", "path": "a.md", "content": "lost", "baseRevision": self.ws.revision})
        self.store.fail = False
        state = self.ws.get_state(self.ben)
        self.assertEqual((state["revision"], self.text()), (1, "kept"), "the last committed copy is back")
        self.assertEqual(events.get_nowait()["type"], "state", "everyone is told to take it")


class Directories(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.heard = []
        folder = Path(self.tmp.name) / "Novel"
        projects = SimpleNamespace(
            authorize_open=lambda token, team, path: ({"username": "amy"}, team, path, folder, "master"),
            read_user_state=lambda team, relpath, username: {"openFiles": ["a.md"], "activeFile": "a.md"})
        identity = SimpleNamespace(remember_workspace=lambda *args: self.heard.append(("remembered", args)))
        self.directory = Directory(pin="2468", state_file=None, master_pin="9999", projects=projects, identity=identity,
                                   make=open_live, emit=lambda event, payload: self.heard.append((event, payload)))

    def test_opening_a_project_by_account_and_its_news(self):
        session = self.directory.open_workspace("account", "red", "Novel")
        self.assertEqual((session["workspace"], session["role"], session["resume"]["activeFile"]), ("red/Novel", "master", "a.md"))
        workspace = self.directory.broker_for_token(session["token"])
        self.assertIs(self.directory.live("red", "Novel"), workspace)
        self.assertEqual(self.directory.place_of(workspace), ("red", "Novel"))
        self.assertEqual([(team, relpath) for team, relpath, _ in self.directory.live_workspaces()], [("red", "Novel")])
        workspace.apply_operation(session["token"], {"type": "create-file", "parentPath": "", "name": "a.md", "content": "x"})
        workspace.apply_operation(session["token"], {"type": "rename-node", "path": "a.md", "name": "b.md"})
        workspace.apply_operation(session["token"], {"type": "delete-node", "path": "b.md"})
        events = [event for event, _ in self.heard]
        self.assertIn("paths-moved", events)
        self.assertIn("before-destructive", events)
        self.directory.drop("red", "Novel")
        self.assertIsNone(self.directory.live("red", "Novel"))
        self.assertEqual(self.heard[-1], ("dropped", {"workspace_id": "red/Novel"}))

    def test_joining_by_pin_and_a_hosted_session_ending_with_its_host(self):
        self.assertEqual(self.directory.connect(None, "2468", "Guest")["workspace"], DEFAULT_WORKSPACE_ID)
        host = self.directory.host("Hana")
        guest = self.directory.connect(None, host["guestPin"], "Gus")
        self.assertEqual(guest["workspace"], host["workspace"])
        with self.assertRaisesRegex(PermissionError, "Invalid PIN"):
            self.directory.connect(None, "000000", "Eve")
        self.directory.on_disconnect(host["token"])
        self.assertIsNone(self.directory.get(host["workspace"]), "the host left: the session is gone")
        self.assertIs(self.directory.broker_for_token(guest["token"]), self.directory.default, "unknown now: the PIN session refuses it")


class ImagesOverHttp(unittest.TestCase):
    def setUp(self):
        import mdnotes_server as server
        self.tmp = tempfile.TemporaryDirectory()
        folder = Path(self.tmp.name)
        (folder / "accounts.json").write_text(json.dumps({"users": [{"username": "amy", "password": "pw", "teams": ["red"]}]}))
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self.httpd = server.build_server("127.0.0.1", self.port, "2468", ROOT, folder / "state.json",
                                         whitelist_file=folder / "accounts.json", data_dir=folder / "data")
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, method, path, body=None, raw=None):
        data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, data=data,
                                         headers={"content-type": "application/octet-stream" if raw is not None else "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, response.headers.get("content-type"), response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers.get("content-type"), error.read()

    def test_an_image_uploads_in_pieces_and_is_served_by_path(self):
        account = json.loads(self.call("POST", "/api/auth/login", {"username": "amy", "password": "pw"})[2])["token"]
        created = json.loads(self.call("POST", f"/api/workspaces/create?token={account}", {"team": "red", "path": "", "name": "Novel", "version": 117})[2])
        session = json.loads(self.call("POST", f"/api/workspaces/open?token={account}",
                                       {"team": "red", "path": created["path"], "version": 117})[2])["token"]
        self.assertEqual(json.loads(self.call("POST", f"/api/workspaces/asset?token={session}&path=pics/a.png&offset=0", raw=b"\x89PNG")[2]),
                         {"ok": True, "size": 4})
        self.assertEqual(json.loads(self.call("POST", f"/api/workspaces/asset?token={session}&path=pics/a.png&offset=4", raw=b"rest")[2])["size"], 8)
        status, kind, data = self.call("GET", f"/api/workspaces/asset?token={session}&path=pics/a.png")
        self.assertEqual((status, kind, data), (200, "image/png", b"\x89PNGrest"))
        self.assertEqual(self.call("GET", f"/api/workspaces/asset?token={session}&path=pics/none.png")[0], 404)
        self.assertEqual(self.call("GET", "/api/workspaces/asset?token=nobody&path=pics/a.png")[0], 403)
        self.assertEqual(self.call("POST", f"/api/workspaces/asset?token={session}&offset=0", raw=b"x")[0], 400, "no path")


if __name__ == "__main__":
    unittest.main()
