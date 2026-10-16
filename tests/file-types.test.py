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

    def test_mime_types(self):
        self.assertEqual(BUILTIN.mime_of("a.JPG"), "image/jpeg")
        self.assertEqual(BUILTIN.extensions_of("persona"), [".persona.skill"])


if __name__ == "__main__":
    unittest.main()
