"""The server's half of the shared mention table (spec/characters/mentions.cases.json).
The browser's half is mention-parity.test.mjs; both must pass the same cases."""
import importlib.util, json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
spec = importlib.util.spec_from_file_location("conversations", ROOT / "server/conversations.py")
conversations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conversations)
TABLE = json.loads((ROOT / "spec/characters/mentions.cases.json").read_text(encoding="utf-8"))


class MentionParity(unittest.TestCase):
    def test_mentions_match_the_shared_table(self):
        for case in TABLE["cases"]:
            self.assertEqual(conversations.find_mentions(case["text"], TABLE["handles"]), case["expect"], case["text"])

    def test_handles_match_the_shared_table(self):
        for case in TABLE["handleCases"]:
            self.assertEqual(conversations.persona_handle(case["path"]), case["expect"], case["path"])


if __name__ == "__main__":
    unittest.main()
