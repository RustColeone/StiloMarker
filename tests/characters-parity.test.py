"""The server's half of spec/characters/sheets.cases.json (the browser's is characters-parity.test.mjs)."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.characters import (hidden_from_characters, notes_mode, persona_header, persona_summary,  # noqa: E402
                                      split_author_notes, without_author_notes)

TABLE = json.loads((ROOT / "spec/characters/sheets.cases.json").read_text(encoding="utf-8"))


class CharacterParity(unittest.TestCase):
    def test_headers_and_bodies(self):
        for c in TABLE["headers"]:
            parsed = persona_header(c["content"])
            self.assertEqual(parsed["body"], c["body"], c["content"])
            for key, value in c["header"].items():
                self.assertEqual(parsed["header"].get(key), value, c["content"])

    def test_summaries(self):
        for c in TABLE["summaries"]:
            self.assertEqual(persona_summary(c["body"]), c["summary"], c["body"])

    def test_author_notes(self):
        for c in TABLE["notes"]:
            self.assertEqual(split_author_notes(c["body"]), {"sheet": c["sheet"], "notes": c["notes"]}, c["body"])
        for c in TABLE["modes"]:
            self.assertEqual(notes_mode(c["header"]), c["mode"])
        for c in TABLE["without"]:
            self.assertEqual(without_author_notes(c["content"]), c["result"])

    def test_what_characters_cannot_see(self):
        for c in TABLE["hidden"]:
            self.assertEqual(hidden_from_characters(c["path"]), c["hidden"], c["path"])


if __name__ == "__main__":
    unittest.main()
