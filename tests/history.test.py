"""History (server): the retention rules, the content-addressed store, and the
snapshot and backup services over a temporary folder and a workspace faked in
memory. (End to end over HTTP: backend-selftest.py and workspace-backups.test.py.)"""
import sys, tempfile, threading, time, unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.file_types import BUILTIN as TYPES  # noqa: E402
from stilo.modules.history.adapters.blob_store import BlobStore  # noqa: E402
from stilo.modules.history.model.retention import POLICY, backups_to_drop, over_budget, skip_backup  # noqa: E402
from stilo.modules.history.service.backups import Backups  # noqa: E402
from stilo.modules.history.service.snapshots import Snapshots  # noqa: E402
from stilo.modules.workspace import file_key  # noqa: E402

DAY = 86400 * 1000


def daily(day, created=None, ident=None):
    stamp = created if created is not None else int(time.mktime(time.strptime(day, "%Y-%m-%d")) * 1000)
    return {"id": ident or day, "kind": "daily", "day": day, "createdAt": stamp}


class Rules(unittest.TestCase):
    def test_file_keys_are_normalized_and_any_name_is_fine(self):
        self.assertEqual(file_key("\\第一卷//./第一回.md/"), "第一卷/第一回.md")
        for bad in ("", "/../", "x" * 513, "a\x00b"):
            with self.assertRaises(ValueError):
                file_key(bad)

    def test_over_budget_goes_oldest_first_and_never_the_one_kept(self):
        files = {"a.md": [{"id": "a2", "createdAt": 5}, {"id": "a1", "createdAt": 1}], "b.md": [{"id": "b1", "createdAt": 3}]}
        self.assertEqual([v["id"] for _, v in over_budget(files, keep_id="a1")], ["b1", "a2"])

    def test_a_backup_is_skipped_when_nothing_changed_or_a_burst_has_its_copy(self):
        latest = {"revision": 7, "kind": "safety", "createdAt": 1000}
        self.assertTrue(skip_backup(latest, "daily", 7, 5000))
        self.assertFalse(skip_backup(latest, "manual", 7, 5000), "a backup by hand is always taken")
        self.assertTrue(skip_backup(latest, "safety", 8, 1000 + 30_000), "within the burst")
        self.assertFalse(skip_backup(latest, "safety", 8, 1000 + 61_000))
        self.assertFalse(skip_backup(None, "daily", 0, 0))

    def test_retention_keeps_two_weeks_then_weeks_then_months(self):
        start = time.strptime("2026-01-01", "%Y-%m-%d")
        backups = [daily(time.strftime("%Y-%m-%d", time.localtime(time.mktime(start) + d * 86400))) for d in range(200)]
        now = backups[-1]["createdAt"]
        kept = [b for b in backups if b not in backups_to_drop(backups, now)]
        recent = [b for b in kept if now - b["createdAt"] < POLICY["daily_days"] * DAY]
        self.assertEqual(len(recent), POLICY["daily_days"])
        self.assertLessEqual(len(kept), POLICY["daily_days"] + POLICY["weekly"] + POLICY["monthly"])
        self.assertGreater(len(kept), POLICY["daily_days"], "older weeks and months keep one each")
        old_safety = {"id": "s", "kind": "safety", "createdAt": now - 20 * DAY}
        self.assertIn(old_safety, backups_to_drop([old_safety], now))


class Store(unittest.TestCase):
    def test_identical_bytes_are_kept_once_and_go_with_their_last_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = BlobStore(Path(tmp), {"files": {}})
            index = store.load()
            first = store.put(index, b"same")
            self.assertEqual(store.put(index, b"same"), first)
            self.assertEqual(index["refs"][first], 2)
            store.release(index, first)
            self.assertTrue((Path(tmp) / "blobs" / f"{first}.gz").exists())
            self.assertEqual(store.read(first), b"same")
            store.release(index, first)
            self.assertFalse((Path(tmp) / "blobs" / f"{first}.gz").exists())
            self.assertEqual((index["bytes"], index["refs"]), (0, {}))
            store.save(index)
            self.assertEqual(store.load()["files"], {})


class Services(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.snapshots = Snapshots(lambda team, rel: BlobStore(root / "s" / team / rel, {"files": {}}),
                                   lambda team, rel, file: {"editSessions": 2, "sessionEdits": 1, "sourceVersion": 9},
                                   limits={"per_file": 3, "budget": 10_000})

    def test_snapshots_dedupe_import_cap_and_delete(self):
        made = self.snapshots.create("amy", "red", "Novel", "a.md", "one", "first")
        self.assertTrue(made["created"])
        self.assertEqual((made["version"]["author"], made["version"]["editSessions"]), ("amy", 2))
        self.assertFalse(self.snapshots.create("amy", "red", "Novel", "a.md", "one")["created"], "same as newest")
        old = self.snapshots.create("amy", "red", "Novel", "a.md", "older", created_at=1_000)
        self.assertTrue(old["created"])
        self.assertFalse(self.snapshots.create("amy", "red", "Novel", "a.md", "older", created_at=1_000)["created"])
        for i in range(5):
            time.sleep(0.002)  # versions are ordered by their millisecond
            self.snapshots.create("amy", "red", "Novel", "a.md", f"v{i}")
        versions = self.snapshots.versions("red", "Novel", "a.md")["versions"]
        self.assertEqual([v["byteSize"] for v in versions], [2, 2, 2], "three newest kept")
        self.assertEqual(self.snapshots.content("red", "Novel", versions[0]["id"])["content"], "v4")
        self.assertEqual(self.snapshots.delete("red", "Novel", versions[0]["id"]), {"deleted": True})
        self.assertEqual(self.snapshots.paths("red", "Novel")["baselines"]["a.md"]["count"], 2)
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            self.snapshots.content("red", "Novel", "nope")

    def test_backups_capture_text_and_images_and_skip_when_unchanged(self):
        project = {"rootId": "r", "nodes": {
            "r": {"id": "r", "kind": "folder", "name": "W", "children": ["f", "t", "i"]},
            "f": {"id": "f", "kind": "folder", "name": "Cast", "parentId": "r", "children": []},
            "t": {"id": "t", "kind": "file", "name": "a.md", "parentId": "r", "content": "text"},
            "i": {"id": "i", "kind": "file", "name": "art.png", "parentId": "r", "content": ""}}}
        workspace = SimpleNamespace(lock=threading.RLock(), project=project, revision=4)
        paths = lambda p: [(nid, p["nodes"][nid]["name"], p["nodes"][nid]) for nid in p["nodes"] if nid != "r"]
        root = Path(self.tmp.name)
        backups = Backups(lambda team, rel: BlobStore(root / "b" / team / rel, {"backups": []}), TYPES, paths,
                          lambda ws, path, node: b"PNG")
        made = backups.back_up(workspace, "red", "Novel", "daily", now=1_800_000_000)
        self.assertEqual((made["fileCount"], made["folderCount"], made["revision"]), (2, 1, 4))
        self.assertIsNone(backups.back_up(workspace, "red", "Novel", "daily", now=1_800_000_600), "nothing changed")
        listing = backups.files("red", "Novel", made["id"])
        self.assertEqual({f["path"]: f["image"] for f in listing["files"]}, {"a.md": False, "art.png": True})
        self.assertEqual(backups.content("red", "Novel", made["id"], "a.md")["content"], "text")
        self.assertEqual(backups.content("red", "Novel", made["id"], "art.png")["content"], "data:image/png;base64,UE5H")
        workspace.revision = 5
        self.assertEqual(backups.sweep([("red", "Novel", workspace)], now=1_800_000_900), 1)
        self.assertEqual(len(backups.list("red", "Novel")["backups"]), 1, "one daily per day, refreshed")


if __name__ == "__main__":
    unittest.main()
