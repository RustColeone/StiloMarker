"""The agent's edit_file (Assistant module): exact passages, one match each,
no overlaps, all or nothing; edits in one turn build on each other; the
proposal travels as an update-file with the text it started from and its
edits; characters cannot use it."""
import copy, json, sys, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
import mdnotes_server as server  # noqa: E402
from stilo.modules.assistant import EditError, apply_edits, propose_edit  # noqa: E402

TEXT = "# Mara\n\n## Who\nA keeper.\n\n## How they speak\nDry.\n\n## Author's notes\nGoes blind.\n"
PROJECT = {"rootId": "root", "nodes": {
    "root": {"id": "root", "kind": "folder", "name": "W", "parentId": None, "children": ["m", "img"]},
    "m": {"id": "m", "kind": "file", "name": "mara.persona.skill", "parentId": "root", "content": TEXT},
    "img": {"id": "img", "kind": "file", "name": "art.png", "parentId": "root", "content": ""}}}


class ApplyEdits(unittest.TestCase):
    def test_exact_passages_change_and_the_rest_stays(self):
        out = apply_edits(TEXT, [{"find": "A keeper.", "replace": "A keeper of the Gannet Point light (chapter 4)."},
                                 {"find": "Dry.", "replace": "Dry, short sentences."}])
        self.assertIn("Gannet Point light (chapter 4)", out)
        self.assertIn("Dry, short sentences.", out)
        self.assertTrue(out.endswith("## Author's notes\nGoes blind.\n"), "untouched text is byte for byte the same")

    def test_refusals_name_the_edit_and_the_reason(self):
        cases = [([{"find": "##", "replace": "#"}], "matches 3 times"),
                 ([{"find": "a lighthouse", "replace": "x"}], "not found"),
                 ([{"find": "", "replace": "x"}], "not empty"),
                 ([{"find": "## Who\nA", "replace": "x"}, {"find": "A keeper", "replace": "y"}], "overlap"),
                 ([], "non-empty list"),
                 ([{"find": "Dry.", "replace": "x"}] * 21, "at most 20")]
        for edits, message in cases:
            with self.subTest(message):
                with self.assertRaisesRegex(EditError, message):
                    apply_edits(TEXT, edits)

    def test_all_or_nothing(self):
        with self.assertRaises(EditError):
            apply_edits(TEXT, [{"find": "Dry.", "replace": "Wet."}, {"find": "missing", "replace": ""}])


class ProposeEdit(unittest.TestCase):
    def test_a_proposal_carries_its_base_and_edits_and_later_edits_build_on_it(self):
        proposals = []
        self.assertEqual(propose_edit(PROJECT, proposals, "mara.persona.skill", [{"find": "Dry.", "replace": "Dry, short."}], "op-1")["status"], "proposed")
        self.assertEqual(propose_edit(PROJECT, proposals, "mara.persona.skill", [{"find": "Dry, short.", "replace": "Dry, short, never sorry."}], "op-2")["status"], "proposed")
        first, second = proposals
        self.assertEqual((first["type"], first["preImage"]), ("update-file", TEXT))
        self.assertEqual(first["edits"], [{"find": "Dry.", "replace": "Dry, short."}])
        self.assertEqual(second["preImage"], first["content"], "the second edit starts from the first one's result")
        self.assertIn("never sorry", second["content"])

    def test_missing_files_images_and_no_op_edits(self):
        self.assertIn("not found", propose_edit(PROJECT, [], "ghost.md", [{"find": "a", "replace": "b"}], "x")["error"])
        self.assertIn("Images", propose_edit(PROJECT, [], "art.png", [{"find": "a", "replace": "b"}], "x")["error"])
        self.assertEqual(propose_edit(PROJECT, [], "mara.persona.skill", [{"find": "Dry.", "replace": "Dry."}], "x")["status"], "unchanged")


class InTheAgent(unittest.TestCase):
    def call(self, name, args, read_only=False):
        proxy = server.ChatProxy()
        proposals = []
        tc = {"function": {"name": name, "arguments": json.dumps(args)}}
        with patch.object(server, "_log"):
            result = proxy._execute_tool_call(tc, copy.deepcopy(PROJECT), proposals, read_only=read_only)
        return result, proposals

    def test_the_agent_offers_and_runs_edit_file(self):
        names = [t["function"]["name"] for t in server.ChatProxy._get_tool_schemas()]
        self.assertIn("edit_file", names)
        result, proposals = self.call("edit_file", {"path": "mara.persona.skill", "edits": [{"find": "Dry.", "replace": "Wry."}]})
        self.assertEqual(result["status"], "proposed")
        self.assertEqual(proposals[0]["content"], TEXT.replace("Dry.", "Wry."))
        result, _ = self.call("edit_file", {"path": "mara.persona.skill", "edits": [{"find": "##", "replace": "#"}]})
        self.assertIn("include more surrounding text", result["error"])

    def test_characters_cannot_edit(self):
        result, proposals = self.call("edit_file", {"path": "mara.persona.skill", "edits": [{"find": "Dry.", "replace": "Wry."}]}, read_only=True)
        self.assertIn("cannot change", result["error"])
        self.assertEqual(proposals, [])


if __name__ == "__main__":
    unittest.main()
