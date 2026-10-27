"""The architecture page (docs/architecture) is made from the code by tools/architecture.py, so it must match the
code: every module with its level and uses, every file, class and function, with its source."""

import ast
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import architecture  # noqa: E402


def load(name: str, variable: str) -> dict:
    text = (ROOT / "docs" / "architecture" / name).read_text(encoding="utf-8")
    return json.loads(text.split(f"window.{variable} = ", 1)[1].rstrip().rstrip(";"))


class ArchitecturePageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load("data.js", "ARCH")
        cls.source = load("source.js", "ARCH_SOURCE")

    def test_the_page_matches_the_code(self):
        result = subprocess.run([sys.executable, "tools/architecture.py", "--check"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr + "\nRun `python3 tools/architecture.py` and commit "
                                                               "docs/architecture/data.js and source.js.")

    def test_every_python_function_is_there_with_its_own_source(self):
        path = "server/stilo/kernel/log.py"
        tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
        defined = {node.name for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
        listed = {item["id"]: item for item in self.data["files"][path]["symbols"]}
        self.assertLessEqual(defined, set(listed))
        ignore = listed["ignore"]
        lines = self.source[path].splitlines()[ignore["line"] - 1:ignore["end"]]
        self.assertTrue(lines[0].startswith("def ignore("), lines[0])  # the pane shows exactly this function

    def test_a_javascript_function_is_there_with_its_comment_its_calls_and_its_source(self):
        path = "app/kernel/index.js"
        listed = {item["id"]: item for item in self.data["files"][path]["symbols"]}
        exported = set(re.findall(r"^export (?:async )?function (\w+)", self.source[path], re.M))
        self.assertTrue(exported and exported <= set(listed), exported - set(listed))
        start = listed["startModules"]
        self.assertTrue(start["doc"], "the comment above it is its text")
        lines = self.source[path].splitlines()[start["line"] - 1:start["end"]]
        self.assertTrue(lines[0].startswith("export async function startModules("), lines[0])
        self.assertEqual(lines[-1], "}")
        self.assertIn("createRegistry", [call for symbol in listed.values() if symbol["parent"] == "startModules"
                                         for call in symbol.get("calls", [])])
        # a module's definition holds start(), and the functions written inside start() are drawn inside it
        sync = {item["id"]: item for item in self.data["files"]["app/modules/sync/index.js"]["symbols"]}
        self.assertEqual(sync["defineModule"]["kind"], "definition")
        self.assertEqual(sync["defineModule.start"]["kind"], "method")
        self.assertTrue(any(item.get("within") == "defineModule.start" for item in sync.values()))

    def test_every_bracket_of_every_javascript_file_pairs_up(self):
        # the reader knows strings, templates, regular expressions and comments: a slip there unpairs the rest
        for path in (item for item in architecture.tracked_files() if re.search(r"\.(m?js|cjs)$", item)):
            tokens, _ = architecture.js_tokens((ROOT / path).read_text(encoding="utf-8"))
            pairs = architecture.pairs(tokens)
            loose = [token.line for index, token in enumerate(tokens)
                     if token.kind == "punct" and token.value in ("(", "[", "{", "${", ")", "]", "}") and index not in pairs]
            self.assertFalse(loose, f"{path}: a bracket without its pair on line {loose[:1]}")

    def test_the_modules_are_read_from_their_definitions(self):
        modules = self.data["modules"]
        sync = modules["app/modules/sync"]
        self.assertEqual((sync["end"], sync["level"]), ("browser", 3))
        self.assertIn("workspace", sync["uses"])
        self.assertEqual(sync["twin"], "server/stilo/modules/sync")
        self.assertEqual(sync["contract"], "protocol/sync.contract.json")
        definition = json.loads((ROOT / "server/stilo/modules/sync/module.json").read_text(encoding="utf-8"))
        self.assertEqual(modules["server/stilo/modules/sync"]["level"], definition["level"])
        album = modules["extensions/url-album"]
        self.assertEqual((album["end"], album["level"], album["api"]), ("extension", 6, 1))
        self.assertEqual(album["entry"], "extensions/url-album/browser/index.js")
        for part in self.data["parts"]:
            self.assertTrue(part["target"] in self.data["files"] or part["target"] in self.data["folders"], part)
        self.assertEqual(len(self.data["rules"]), 10, "the ten rules, read from docs/ARCHITECTURE.md")
        self.assertTrue(self.data["extensionSteps"], "the steps, read from docs/EXTENSIONS.md")

    def test_nothing_private_is_on_the_page(self):
        paths = set(self.source)
        self.assertFalse({path for path in paths if re.search(r"whitelist|session-state|\.env$|(^|/)data/", path)}, paths)
        self.assertFalse({path for path in paths if "/vendor/" in path})


if __name__ == "__main__":
    unittest.main()
