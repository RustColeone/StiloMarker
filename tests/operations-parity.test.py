"""The server's half of spec/workspace/operations.cases.json (the browser's is
operations-parity.test.mjs): both must build the same tree, and refuse the same operations."""
import importlib.util, json, unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mdnotes_server", ROOT / "server/mdnotes_server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
CASES = json.loads((ROOT / "spec/workspace/operations.cases.json").read_text(encoding="utf-8"))["cases"]


def tree(broker):
    project = broker.project
    out = []
    def walk(node_id, prefix):
        for child in project["nodes"][node_id].get("children", []):
            node = project["nodes"][child]
            path = f"{prefix}{node['name']}"
            out.append(f"{path}/" if node["kind"] == "folder" else f"{path}={node.get('content', '')}")
            if node["kind"] == "folder":
                walk(child, f"{path}/")
    walk(project["rootId"], "")
    return out


class OperationParity(unittest.TestCase):
    def setUp(self):
        logs = patch.object(server, "_log"); logs.start(); self.addCleanup(logs.stop)

    def test_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                broker = server.CollaborationBroker("2468", None)
                broker.project = {"id": "w", "name": "W", "rootId": "root", "activeFileId": None,
                                  "nodes": {"root": {"id": "root", "kind": "folder", "name": "W", "children": []}}}
                ops = case["ops"][:-1] if case.get("error") else case["ops"]
                for op in ops:
                    broker._apply_operation(dict(op))
                if case.get("error"):
                    with self.assertRaises(Exception):
                        broker._apply_operation(dict(case["ops"][-1]))
                else:
                    self.assertEqual(tree(broker), case["tree"])


if __name__ == "__main__":
    unittest.main()
