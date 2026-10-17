"""The server's half of spec/workspace/operations.cases.json (the browser's is
operations-parity.test.mjs): both must build the same tree, and refuse the same operations."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.modules.file_types import BUILTIN as TYPES  # noqa: E402
from stilo.modules.workspace import apply_operation  # noqa: E402
CASES = json.loads((ROOT / "spec/workspace/operations.cases.json").read_text(encoding="utf-8"))["cases"]


def tree(project):
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
    def test_cases(self):
        for case in CASES:
            with self.subTest(case["name"]):
                project = {"id": "w", "name": "W", "rootId": "root", "activeFileId": None,
                           "nodes": {"root": {"id": "root", "kind": "folder", "name": "W", "children": []}}}
                ops = case["ops"][:-1] if case.get("error") else case["ops"]
                for op in ops:
                    apply_operation(project, dict(op), TYPES)
                if case.get("error"):
                    with self.assertRaises(Exception):
                        apply_operation(project, dict(case["ops"][-1]), TYPES)
                else:
                    self.assertEqual(tree(project), case["tree"])


if __name__ == "__main__":
    unittest.main()
