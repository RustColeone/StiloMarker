"""Sync (server): the shared rebase cases, the rebase log's barriers, sessions
and their roles, and a shared workspace end to end over a store faked in
memory."""
import json, sys, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import stilo.kernel.log  # noqa: E402,F401
from stilo.modules.sync import PARTS, RebaseLog, SharedWorkspace, transform_range  # noqa: E402
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


if __name__ == "__main__":
    unittest.main()
