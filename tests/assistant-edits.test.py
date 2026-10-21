"""The agent's edit_file (Assistant module): exact passages, one match each,
no overlaps, all or nothing; edits in one turn build on each other; the
proposal travels as an update-file with the text it started from and its
edits; characters cannot use it. And the server's half of
spec/assistant/tools.cases.json (the browser's is agent-tools.test.mjs): the
agent's tools as both runners run them; edits.MAX_EDITS is the contract's."""
import copy, json, sys, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.assistant.service import agent as agent_module  # noqa: E402
from stilo.modules.assistant import Agent, EditError, apply_edits, propose_edit  # noqa: E402

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
        proxy = Agent()
        proposals = []
        tc = {"function": {"name": name, "arguments": json.dumps(args)}}
        with patch.object(agent_module, '_log'):
            result = proxy._execute_tool_call(tc, copy.deepcopy(PROJECT), proposals, read_only=read_only)
        return result, proposals

    def test_the_agent_offers_and_runs_edit_file(self):
        names = [t["function"]["name"] for t in Agent._get_tool_schemas()]
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


class RoutesOverHttp(unittest.TestCase):
    """The Assistant's routes on a real server: its status, the sign-in gate on
    the server's keys, and the shared conversations refusing an old tab."""

    def test_status_gate_and_shared_conversations(self):
        import socket, tempfile, threading, urllib.error, urllib.request
        sys.path.insert(0, str(ROOT / "server"))
        import mdnotes_server as server
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "accounts.json").write_text(json.dumps({"users": [{"username": "amy", "password": "pw", "teams": ["red"]}]}))
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            httpd = server.build_server("127.0.0.1", port, "2468", ROOT, folder / "state.json",
                                        whitelist_file=folder / "accounts.json", data_dir=folder / "data")
            threading.Thread(target=httpd.serve_forever, daemon=True).start()

            def call(method, path, body=None):
                request = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                                 data=json.dumps(body).encode() if body is not None else None,
                                                 headers={"content-type": "application/json"})
                try:
                    with urllib.request.urlopen(request, timeout=10) as response:
                        return response.status, response.read()
                except urllib.error.HTTPError as error:
                    return error.code, error.read()
            try:
                status, body = call("GET", "/api/chat/status")
                self.assertEqual((status, json.loads(body)["requiresAccount"]), (200, True))
                status, body = call("POST", "/api/chat", {"messages": [{"role": "user", "content": "hi"}]})
                self.assertEqual(status, 403, "the server's keys need a signed-in account")
                self.assertIn("Sign in", json.loads(body)["message"])
                session = json.loads(call("POST", "/api/session/connect", {"pin": "2468", "displayName": "Ann"})[1])["token"]
                status, body = call("GET", f"/api/chat/workspace?token={session}")
                self.assertEqual((status, json.loads(body)), (200, {"threads": [], "revision": 0}))
                status, body = call("POST", f"/api/chat/workspace?token={session}", {"version": 116, "threads": [], "baseRevision": 0})
                self.assertEqual((status, json.loads(body)["upgradeRequired"]), (426, True))
                status, body = call("POST", f"/api/chat/workspace?token={session}", {"version": 117, "threads": [], "baseRevision": 0})
                self.assertEqual((status, json.loads(body)["revision"]), (200, 1))
                status, body = call("POST", f"/api/chat/workspace?token={session}", {"version": 117, "threads": [], "baseRevision": 0})
                self.assertEqual(status, 409, "a save against an old revision is a conflict")
                status, _ = call("POST", "/api/chat/workspace?token=never-issued", {"version": 117, "threads": [], "baseRevision": 0})
                self.assertEqual(status, 403, "an unknown session is refused, not a storage failure")
            finally:
                httpd.shutdown()
                httpd.server_close()


class SharedToolCases(unittest.TestCase):
    """spec/assistant/tools.cases.json, run by the server's tools."""
    TABLE = json.loads((ROOT / "spec/assistant/tools.cases.json").read_text(encoding="utf-8"))

    def test_edit_passages(self):
        for entry in self.TABLE["edits"]:
            with self.subTest(entry["name"]):
                if "error" in entry:
                    with self.assertRaises(EditError) as raised:
                        apply_edits(entry["text"], entry["edits"])
                    self.assertEqual(str(raised.exception), entry["error"])
                else:
                    self.assertEqual(apply_edits(entry["text"], entry["edits"]), entry["expect"])

    def test_turns(self):
        from types import SimpleNamespace
        from stilo.modules.assistant.service.tools import AgentTools

        class Tools(AgentTools):
            _req = SimpleNamespace()

            def images_available(self):
                return False

        tools = Tools()
        for turn in self.TABLE["turns"]:
            with self.subTest(turn["name"]):
                proposals = []
                results = [tools._execute_tool_call({"function": {"name": call["tool"], "arguments": call["arguments"]}},
                                                    copy.deepcopy(self.TABLE["project"]), proposals, read_only=turn["readOnly"])
                           for call in turn["calls"]]
                names = {}

                def norm(value):
                    if isinstance(value, dict):
                        return {k: (names.setdefault(v, f"op-{len(names) + 1}") if k == "proposalId" else norm(v)) for k, v in value.items()}
                    return [norm(v) for v in value] if isinstance(value, list) else value
                self.assertEqual(norm(results), [call["result"] for call in turn["calls"]])
                self.assertEqual(norm(proposals), turn["proposals"])

    def test_first_requests(self):
        """spec/assistant/request.cases.json: the first request of a turn, as the browser's runner sends it too."""
        from types import SimpleNamespace
        from stilo.modules.assistant.adapters.contract import AGENT_TOOLS
        table = json.loads((ROOT / "spec/assistant/request.cases.json").read_text(encoding="utf-8"))
        agent = Agent()
        agent.default_workspace = None
        for case in table["cases"]:
            with self.subTest(case["name"]):
                captured = []
                agent._ready_route = lambda model, own_key, own_model: SimpleNamespace(model=own_model or model, label="Your key", ready=True)
                agent._complete = lambda payload, emit: captured.append(copy.deepcopy(payload)) or {"choices": [{"message": {"content": "Done."}}]}
                result = agent.chat(case["messages"], case["contextFiles"], case["projectName"], client_project=copy.deepcopy(case["project"]),
                                    override={"apiKey": "k", "model": case["model"]})
                body = captured[0]
                body["messages"][0]["content"] = body["messages"][0]["content"].replace(agent.manual_content, "<manual>")
                if "tools" in body:
                    self.assertEqual(body["tools"], AGENT_TOOLS)
                    body["tools"] = "<contract tools>"
                self.assertEqual(body, case["body"])
                self.assertEqual(result["contextPaths"], case["contextPaths"])

    def test_the_contract_and_the_edit_rules_agree(self):
        from stilo.modules.assistant.adapters.contract import LIMITS
        from stilo.modules.assistant.model.edits import MAX_EDITS
        self.assertEqual(MAX_EDITS, LIMITS["maxEdits"])


if __name__ == "__main__":
    unittest.main()
