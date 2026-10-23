"""The server's half of spec/file-types/type-of.cases.json (the browser's is file-types.test.mjs)."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.file_types import BUILTIN  # noqa: E402

CASES = json.loads((ROOT / "spec/file-types/type-of.cases.json").read_text(encoding="utf-8"))["cases"]


class FileTypeParity(unittest.TestCase):
    def test_lookups_match_the_shared_table(self):
        t = BUILTIN
        for c in CASES:
            entry = t.type_of(c["name"])
            got = {"type": entry["id"] if entry else None, "extension": t.extension_of(c["name"]), "base": t.base_name(c["name"]),
                   "image": t.is_image(c["name"]), "text": t.is_text(c["name"]), "format": t.format_of(c["name"])}
            want = {k: c[k] for k in ("type", "extension", "base", "image", "text", "format")}
            self.assertEqual(got, want, c["name"])
            if "reserved" in c:
                self.assertEqual(t.is_reserved(c["name"]), c["reserved"], c["name"])

    def test_reserved_covers_every_kept_file(self):
        """Every file a module keeps in a project's folder is a reserved name: a
        user's file of that name could overwrite it, and a folder of that name
        would stop the module writing it."""
        from stilo.modules.assistant.service.threads import THREADS_FILE
        from stilo.modules.chats import DB_FILES
        from stilo.modules.comments.adapters.comments_file import COMMENTS_FILE
        from stilo.modules.identity import ACCESS_FILE
        from stilo.modules.projects.adapters.team_folders import USER_STATE_FILE
        from stilo.modules.workspace.adapters.folder_store import JOURNAL, MANIFEST
        kept = [MANIFEST, JOURNAL, ACCESS_FILE, COMMENTS_FILE, THREADS_FILE, USER_STATE_FILE, *DB_FILES]
        missing = [name for name in kept if not BUILTIN.is_reserved(name)]
        self.assertEqual(missing, [])

    def test_an_extension_for_another_api_version_is_left_out(self):
        import tempfile
        from stilo.modules.file_types.adapters.data import load_types
        with tempfile.TemporaryDirectory() as tmp:
            for name, version in (("current", 1), ("newer", 2)):
                folder = Path(tmp) / name
                folder.mkdir()
                (folder / "extension.json").write_text(json.dumps({"name": name, "api": version, "fileTypes": [
                    {"id": f"{name}type", "label": name, "kind": "text", "format": name, "extensions": {f".{name}x": "text/plain"}, "icon": "is-file", "filters": []}]}))
            ids = [entry["id"] for entry in load_types(tmp)]
        self.assertIn("currenttype", ids)
        self.assertNotIn("newertype", ids)

    def test_mime_types(self):
        self.assertEqual(BUILTIN.mime_of("a.JPG"), "image/jpeg")
        self.assertEqual(BUILTIN.extensions_of("persona"), [".persona.skill"])


if __name__ == "__main__":
    unittest.main()
