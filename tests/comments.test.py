"""Comments (server): the rules for adding, editing, moving and deleting a
line comment, and the service over a temporary project folder telling the
live workspace about each change. (End to end: backend-selftest.py.)"""
import sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
from stilo.modules.comments import COMMENTS_FILE, open_comments  # noqa: E402
from stilo.modules.comments.model import comments as rules  # noqa: E402


class Rules(unittest.TestCase):
    def test_add_edit_move_and_delete(self):
        data = rules.empty()
        first = rules.save(data, "a.md", {"line": 9, "anchorText": "x" * 500, "text": " look "}, "amy", 1, "c1")
        self.assertEqual((first["text"], first["line"], len(first["anchorText"]), first["author"]), ("look", 9, 400, "amy"))
        rules.save(data, "a.md", {"line": 2, "text": "earlier"}, "ben", 2, "c2")
        self.assertEqual([c["id"] for c in data["files"]["a.md"]], ["c2", "c1"], "kept in line order")
        edited = rules.save(data, "a.md", {"id": "c1", "text": "revised", "line": 1}, "ben", 3, "unused")
        self.assertEqual((edited["text"], edited["line"], edited["author"], edited["updatedAt"]), ("revised", 1, "amy", 3))
        self.assertTrue(rules.reanchor(data, "a.md", [{"id": "c2", "line": 7, "anchorText": "moved"}, {"id": "ghost", "line": 1}]))
        self.assertFalse(rules.reanchor(data, "a.md", [{"id": "c2", "line": 7, "anchorText": "moved"}]), "nothing moved")
        self.assertTrue(rules.delete(data, "c1"))
        self.assertTrue(rules.delete(data, "c2"))
        self.assertEqual(data, {"files": {}}, "an empty file's list goes")
        self.assertFalse(rules.delete(data, "c1"))

    def test_refusals(self):
        data = rules.empty()
        for payload, message in (({"text": "  "}, "needs some text"), ({"text": "x" * 4001}, "too long")):
            with self.assertRaisesRegex(ValueError, message):
                rules.save(data, "a.md", payload, "amy", 1, "c")
        data["files"]["a.md"] = [{"id": str(i), "line": i} for i in range(rules.MAX_PER_FILE)]
        with self.assertRaisesRegex(ValueError, "Too many"):
            rules.save(data, "a.md", {"text": "one more"}, "amy", 1, "c")


class Service(unittest.TestCase):
    def test_changes_are_kept_in_the_project_and_told_to_the_live_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            heard, live = [], {"on": True}
            workspace = SimpleNamespace(broadcast=lambda event: heard.append(event))
            def authorize(token, team, path):
                if token != "amy":
                    raise PermissionError("You do not have access to that project")
                return {"username": "amy"}, team, path
            places = SimpleNamespace(authorize_project=authorize, project_dir=lambda team, rel: Path(tmp),
                                     live=lambda team, rel: workspace if live["on"] else None)
            comments = open_comments(places)
            made = comments.save("amy", "red", "Novel", {"file": "第一卷/a.md", "line": 3, "anchorText": "it", "text": "note"})
            self.assertTrue((Path(tmp) / COMMENTS_FILE).is_file())
            self.assertEqual(comments.list("amy", "red", "Novel")["files"]["第一卷/a.md"][0]["id"], made["comment"]["id"])
            self.assertEqual((heard[-1]["type"], list(heard[-1]["files"])), ("comments", ["第一卷/a.md"]))
            self.assertEqual(comments.reanchor("amy", "red", "Novel", "第一卷/a.md", [{"id": made["comment"]["id"], "line": 3}]),
                             {"updated": False})
            self.assertEqual(len(heard), 1, "nothing changed, nothing told")
            live["on"] = False
            self.assertEqual(comments.delete("amy", "red", "Novel", made["comment"]["id"]), {"deleted": True})
            with self.assertRaises(PermissionError):
                comments.list("eve", "red", "Novel")

    def test_an_unreadable_comments_file_is_set_aside_not_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            places = SimpleNamespace(authorize_project=lambda token, team, path: ({"username": token}, team, path),
                                     project_dir=lambda team, rel: Path(tmp), live=lambda team, rel: None)
            comments = open_comments(places)
            (Path(tmp) / COMMENTS_FILE).write_text('{"files": {"a.md": [{"id": "x", "text": "cut sh', encoding="utf-8")
            self.assertEqual(comments.list("amy", "red", "Novel")["files"], {}, "an unreadable file shows no comments")
            comments.save("amy", "red", "Novel", {"file": "a.md", "line": 1, "anchorText": "it", "text": "new"})
            kept = list(Path(tmp).glob("comments.unreadable-*.json"))
            self.assertEqual(len(kept), 1, "the unreadable file is kept, set aside")
            self.assertIn('"text": "cut sh', kept[0].read_text(encoding="utf-8"))
            self.assertEqual([c["text"] for c in comments.list("amy", "red", "Novel")["files"]["a.md"]], ["new"])
            comments.save("amy", "red", "Novel", {"file": "a.md", "line": 2, "anchorText": "it", "text": "more"})
            self.assertEqual(len(list(Path(tmp).glob("comments.unreadable-*.json"))), 1, "a file that reads is never set aside")


if __name__ == "__main__":
    unittest.main()
