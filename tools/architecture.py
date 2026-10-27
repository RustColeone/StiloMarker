"""Build docs/architecture/data.js and source.js: the code's architecture as data for the browsable page in
docs/architecture/ (data.js the structure, source.js every file's text, which the page loads when it first shows code).

    python3 tools/architecture.py            # write them
    python3 tools/architecture.py --check    # exit 1 when they are out of date (tests/architecture.test.py runs this)

Everything comes from the files git tracks. Python is read with its `ast`: each file's docstring, imports, classes
and functions (and the functions inside them), which call which, and the source. JavaScript is read by JsReader
below, which knows the language well enough for this: each file's opening comment, its imports, its functions
(declared, assigned, methods of classes and object literals) and the ones inside them, the comment above each, which
call which. The modules come from their own definitions (a browser module's `defineModule({...})`, a server module's
module.json, an extension's extension.json), the contracts from protocol/. Only the top map's fixed boxes are named
here (PARTS), after docs/ARCHITECTURE.md; change them when the architecture changes. The output has no dates or
commit IDs, so it changes only when the code does.
"""

from __future__ import annotations

import ast
import json
import posixpath
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "architecture" / "data.js"
SOURCE = ROOT / "docs" / "architecture" / "source.js"
REPO = "https://github.com/RustColeone/StiloMarker"
BRANCH = "main"
ROOTS = ("app", "server", "extensions", "desktop", "protocol", "spec", "tools", "tests")  # the folders shown, in order
TOP_FILES = ("service-worker.js",)
CODE = re.compile(r"\.(m?js|cjs|py)$")
DATA = re.compile(r"^(protocol|spec)/.*\.json$|/(extension|module)\.json$")  # read, not parsed: contracts and manifests
SKIP = re.compile(r"(^|/)vendor/|\.min\.js$")
# The top map's fixed boxes (docs/ARCHITECTURE.md, "The shape"): id, label, what it does, where it lives.
PARTS = [
    ("MAIN", "main.js", "boots the page: starts every module", "app/main.js"),
    ("BK", "Kernel", "starts the modules · hands out declared APIs · the trace", "app/kernel"),
    ("SW", "service-worker.js", "the app offline: its files, cached per version", "service-worker.js"),
    ("SRV", "mdnotes_server.py", "starts the server's modules", "server/mdnotes_server.py"),
    ("SK", "Kernel", "starts the modules · every(...) · the log", "server/stilo/kernel"),
    ("PROTO", "protocol/", "each module's messages and version · file types · the extension API", "protocol"),
    ("SPEC", "spec/", "the cases a rule written in both languages passes on both ends", "spec"),
    ("DESK", "desktop/", "Electron: the app in its own window; it can run the server", "desktop"),
]


def tracked_files() -> list[str]:
    listed = subprocess.run(["git", "ls-files", "--", *ROOTS, *TOP_FILES], cwd=ROOT, capture_output=True, text=True,
                            check=True).stdout.splitlines()
    return sorted(path for path in listed if (CODE.search(path) or DATA.search(path)) and not SKIP.search(path)
                  and (ROOT / path).is_file())


def first_paragraph(text: str) -> str:
    """A README's or a docstring's first paragraph of prose (after a title), for the side pane."""
    paragraph: list[str] = []
    for line in text.splitlines():
        if line.startswith("#") or line.startswith("<!--"):
            if paragraph:
                break
            continue
        if not line.strip():
            if paragraph:
                break
            continue
        paragraph.append(line.strip())
    return " ".join(paragraph)[:1200]


def unique(symbols: list[dict]) -> list[dict]:
    """Ids made unique within the file: a second `render` inside the same function is `parent.render~2`."""
    seen: dict[str, int] = {}
    for symbol in symbols:
        count = seen.get(symbol["id"], 0) + 1
        seen[symbol["id"]] = count
        if count > 1:
            symbol["id"] = f"{symbol['id']}~{count}"
    return symbols


def resolve_call(name: str, caller: dict, children: dict, top: set[str]) -> str | None:
    """Which symbol of the file a bare call names: one declared inside the caller first, then one beside it, then any
    inside the same top-level function or class, then a top-level one."""
    found = children.get((caller["parent"] or caller["id"], name), [])
    for wanted in (caller["id"], caller.get("within"), None):
        for symbol in found:
            if (wanted is None or symbol.get("within") == wanted) and symbol["id"] != caller["id"]:
                return symbol["id"]
    return name if name in top and name != caller["id"] else None


# ---- Python ---------------------------------------------------------------------------------------------------------
SECTION = re.compile(r"^\s*# -{2,}\s*(.+?)\s*-{2,}\s*$")  # "# ---- pages and files ------" groups methods
FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


def python_module_path(module: str, known: set[str]) -> str | None:
    """`stilo.kernel.log` → server/stilo/kernel/log.py (or a package's __init__.py), when it is in the repository."""
    base = module.replace(".", "/")
    for prefix in ("", "server/", "tests/"):
        for candidate in (f"{prefix}{base}.py", f"{prefix}{base}/__init__.py"):
            if candidate in known:
                return candidate
    return None


def python_signature(node) -> str:
    if isinstance(node, ast.ClassDef):
        bases = ", ".join(ast.unparse(base) for base in node.bases)
        return f"class {node.name}" + (f"({bases})" if bases else "")
    returns = f" -> {ast.unparse(node.returns)}" if node.returns else ""
    return f"{'async ' if isinstance(node, ast.AsyncFunctionDef) else ''}def {node.name}({ast.unparse(node.args)}){returns}"


def own_nodes(node):
    """The nodes of a function or class that are its own: not those of a function or class defined inside it."""
    stack = list(ast.iter_child_nodes(node))
    while stack:
        item = stack.pop()
        yield item
        if not isinstance(item, (*FUNCTIONS, ast.ClassDef)):
            stack.extend(ast.iter_child_nodes(item))


class PythonReader:
    """One Python file's docstring, imports, symbols and calls."""

    def __init__(self, path: str, known: set[str]):
        self.path, self.known = path, known
        self.text = (ROOT / path).read_text(encoding="utf-8")
        self.tree = ast.parse(self.text, filename=path)
        self.lines = self.text.splitlines()
        self.imported: dict[str, tuple[str, str]] = {}  # local name → (path, name there; "" for a module)
        self.imports: list[dict] = []

    def read(self) -> dict:
        self._imports()
        top = [node for node in self.tree.body if isinstance(node, (*FUNCTIONS, ast.ClassDef))]
        found: list[tuple[dict, object]] = []
        for node in top:
            found.append((self._symbol(node, None, None, ""), node))
            sections = self._sections(node.body) if isinstance(node, ast.ClassDef) else {}
            self._inner(node, node, None, sections, found)
        symbols = unique([symbol for symbol, _ in found])
        for symbol in symbols:
            if "within" in symbol:
                symbol["within"] = symbol["within"]["id"]
        names = {symbol["name"] for symbol, _ in found if not symbol["parent"]}
        children: dict[tuple[str, str], list[dict]] = {}
        for symbol, _ in found:
            if symbol["parent"]:
                children.setdefault((symbol["parent"], symbol["name"]), []).append(symbol)
        for symbol, node in found:
            if symbol["kind"] != "class":
                self._calls(symbol, node, children, names, top)
        return {"doc": ast.get_docstring(self.tree) or "", "lines": len(self.lines), "imports": self.imports,
                "symbols": symbols, "text": self.text, "language": "python"}

    def _sections(self, body) -> dict[int, str]:
        """For each method's first line, the `# ---- name ----` comment above it in its class (or "")."""
        found, current, last = {}, "", 0
        for statement in body:
            start = statement.lineno - len(getattr(statement, "decorator_list", []) or [])
            for text in self.lines[last:start - 1]:
                match = SECTION.match(text)
                if match:
                    current = match.group(1).strip(" .:")
            found[statement.lineno] = current
            last = getattr(statement, "end_lineno", statement.lineno)
        return found

    def _inner(self, node, top, within, sections, found) -> None:
        """Every function defined inside a top-level function or class, flattened under it; `within` is the function
        it is written in (none when that is the top-level one, or for a method of the class itself)."""
        for child in ast.iter_child_nodes(node):
            if isinstance(child, FUNCTIONS):
                method = isinstance(node, ast.ClassDef) and node is top
                section = sections.get(child.lineno, "") if method else within["name"] if within else ""
                symbol = self._symbol(child, top, within, section, method)
                found.append((symbol, child))
                self._inner(child, top, symbol, {}, found)
            elif not isinstance(child, ast.ClassDef):
                self._inner(child, top, within, sections, found)

    def _imports(self) -> None:
        seen = set()
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target = python_module_path(alias.name, self.known)
                    self.imported[alias.asname or alias.name.split(".")[0]] = (target or "", "")
                    self._record(alias.name, target, seen)
            elif isinstance(node, ast.ImportFrom):
                module = self._resolve_from(node)
                base = python_module_path(module, self.known)
                for alias in node.names:
                    submodule = python_module_path(f"{module}.{alias.name}", self.known)  # `from . import routes`
                    if submodule:
                        self.imported[alias.asname or alias.name] = (submodule, "")
                    elif base:
                        self.imported[alias.asname or alias.name] = (base, alias.name)
                    self._record(module if not submodule else f"{module}.{alias.name}", submodule or base, seen)

    def _resolve_from(self, node: ast.ImportFrom) -> str:
        """The absolute module an import names, relative ones (`from .service import X`) included."""
        if not node.level:
            return node.module or ""
        package = self.path.split("/")[:-1]
        package = package[:len(package) - (node.level - 1)] if node.level > 1 else package
        return ".".join([*package, *([node.module] if node.module else [])])

    def _record(self, module: str, target: str | None, seen: set) -> None:
        key = target or module
        if key and key not in seen and target != self.path:
            seen.add(key)
            self.imports.append({"module": module, "path": target or ""})

    def _symbol(self, node, top, within, section="", method=False) -> dict:
        start = min([node.lineno, *(item.lineno for item in node.decorator_list)])
        parent = top.name if top is not None else ""
        symbol = {"id": f"{parent}.{node.name}" if parent else node.name, "name": node.name,
                  "kind": "class" if isinstance(node, ast.ClassDef) else "method" if method else "function",
                  "parent": parent, "line": start, "end": node.end_lineno, "signature": python_signature(node),
                  "doc": ast.get_docstring(node) or "", "decorators": [ast.unparse(item) for item in node.decorator_list]}
        if parent:
            symbol["section"] = section
            if within:
                symbol["within"] = within
        if isinstance(node, ast.ClassDef):
            symbol["bases"] = [ast.unparse(base) for base in node.bases]
        return symbol

    def _calls(self, symbol: dict, node, children: dict, names: set[str], top: list) -> None:
        classes = {item.name: item for item in top if isinstance(item, ast.ClassDef)}
        owner = classes.get(symbol["parent"])
        methods = {item.name for item in owner.body if isinstance(item, FUNCTIONS)} if owner else set()
        calls, uses = [], []
        for call in (item for item in own_nodes(node) if isinstance(item, ast.Call)):
            function, target = call.func, None
            if isinstance(function, ast.Name):
                target = resolve_call(function.id, symbol, children, names)
                if not target and function.id in self.imported and self.imported[function.id][0]:
                    path, there = self.imported[function.id]
                    uses.append({"path": path, "name": there or function.id})
            elif isinstance(function, ast.Attribute) and isinstance(function.value, ast.Name):
                holder, attribute = function.value.id, function.attr
                if holder in ("self", "cls") and attribute in methods:
                    target = f"{owner.name}.{attribute}"
                elif holder in classes:
                    target = f"{holder}.{attribute}" if any(isinstance(item, FUNCTIONS) and item.name == attribute
                                                            for item in classes[holder].body) else holder
                elif holder in self.imported and self.imported[holder][0]:
                    path, there = self.imported[holder]
                    uses.append({"path": path, "name": f"{there}.{attribute}" if there else attribute})
            if target and target != symbol["id"] and target not in calls:
                calls.append(target)
        symbol["calls"] = calls
        symbol["uses"] = [dict(item) for item in {(use["path"], use["name"]): use for use in uses}.values()]


# ---- JavaScript -----------------------------------------------------------------------------------------------------
PUNCTUATION = sorted(""">>>= ... === !== **= <<= >>= >>> &&= ||= ??= => == != <= >= && || ?? ?. ++ -- += -= *= /= %= &=
                        |= ^= ** << >> { } ( ) [ ] ; , < > + - * / % & | ^ ! ~ ? : = . @""".split(), key=len, reverse=True)
BEFORE_REGEX = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else",
                "yield", "await"}
KEYWORDS = {"if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "with", "super",
            "import", "class", "delete", "void", "yield", "in", "of", "instanceof", "do", "else", "case", "throw"}
# Before a `{`, these make it an object literal (else it is a block).
OBJECT_BEFORE = {"(", ",", "=", ":", "[", "?", "return", "...", "||", "&&", "??", "!", "${", "default", "+", "=>(",
                 "??=", "||=", "&&=", "yield", "await"}
NAME_START = re.compile(r"[A-Za-z_$#À-￿]")
NAME_REST = re.compile(r"[\w$À-￿]*")
NUMBER = re.compile(r"(0[xXbBoO][\da-fA-F_]+|(\d[\d_]*\.?[\d_]*|\.\d[\d_]*)([eE][+-]?\d+)?)n?")


class Tok:
    __slots__ = ("kind", "value", "line", "start", "end")

    def __init__(self, kind, value, line, start, end):
        self.kind, self.value, self.line, self.start, self.end = kind, value, line, start, end


def js_tokens(text: str) -> tuple[list[Tok], list[tuple[int, int, str, int]]]:
    """The tokens (names, numbers, strings, template parts, regular expressions, punctuation) and the comments, each
    comment with its lines and the index of the token after it. A template's `${` is a token, so its `}` closes it."""
    tokens: list[Tok] = []
    comments: list[tuple[int, int, str, int]] = []
    braces: list[str] = []
    i, n, line = 0, len(text), 1

    def regex_allowed() -> bool:
        if not tokens:
            return True
        last = tokens[-1]
        if last.kind == "name":
            return last.value in BEFORE_REGEX
        return last.kind == "punct" and last.value not in (")", "]", "}")

    def template(start: int, j: int) -> int:  # from inside a template (its text from start) to its end or next `${`
        nonlocal line
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == "`":
                tokens.append(Tok("tmpl", text[start:j + 1], line, start, j + 1))
                line += text.count("\n", start, j + 1)
                return j + 1
            if text.startswith("${", j):
                tokens.append(Tok("tmpl", text[start:j], line, start, j))
                line += text.count("\n", start, j)
                tokens.append(Tok("punct", "${", line, j, j + 2))
                braces.append("${")
                return j + 2
            j += 1
        tokens.append(Tok("tmpl", text[start:], line, start, n))
        line += text.count("\n", start)
        return n

    if text.startswith("#!"):
        i = text.find("\n") if "\n" in text else n
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
            i += 1
        elif c in " \t\r\f\v﻿   ":
            i += 1
        elif text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end < 0 else end
            comments.append((line, line, text[i:end], len(tokens)))
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end < 0 else end + 2
            comments.append((line, line + text.count("\n", i, end), text[i:end], len(tokens)))
            line += text.count("\n", i, end)
            i = end
        elif c == "`":
            i = template(i, i + 1)
        elif c == "}" and braces and braces[-1] == "${":
            braces.pop()
            tokens.append(Tok("punct", "}", line, i, i + 1))
            i = template(i + 1, i + 1)
        elif c in "\"'":
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            tokens.append(Tok("str", text[i:j + 1], line, i, j + 1))
            i = j + 1
        elif c == "/" and regex_allowed():
            j, in_class = i + 1, False
            while j < n and text[j] != "\n":
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == "[":
                    in_class = True
                elif text[j] == "]":
                    in_class = False
                elif text[j] == "/" and not in_class:
                    break
                j += 1
            j += 1
            while j < n and (text[j].isalpha()):
                j += 1
            tokens.append(Tok("re", text[i:j], line, i, j))
            i = j
        elif c.isdigit() or (c == "." and i + 1 < n and text[i + 1].isdigit()):
            match = NUMBER.match(text, i)
            end = match.end() if match and match.end() > i else i + 1
            tokens.append(Tok("num", text[i:end], line, i, end))
            i = end
        elif NAME_START.match(c):
            end = NAME_REST.match(text, i + 1).end()
            tokens.append(Tok("name", text[i:end], line, i, end))
            i = end
        else:
            mark = next((item for item in PUNCTUATION if text.startswith(item, i)), c)
            if mark == "{":
                braces.append("{")
            elif mark == "}" and braces:
                braces.pop()
            tokens.append(Tok("punct", mark, line, i, i + len(mark)))
            i += len(mark)
    return tokens, comments


def pairs(tokens: list[Tok]) -> dict[int, int]:
    """Each opening bracket's index → its closing one's (and back)."""
    closes = {")": "(", "]": "[", "}": "{"}
    found: dict[int, int] = {}
    stack: list[int] = []
    for index, token in enumerate(tokens):
        if token.kind != "punct":
            continue
        if token.value in ("(", "[", "{", "${"):
            stack.append(index)
        elif token.value in closes:
            while stack:
                opener = stack.pop()
                if tokens[opener].value.endswith(closes[token.value]):
                    found[opener], found[index] = index, opener
                    break
    return found


def literal(tokens: list[Tok], match: dict[int, int], index: int):
    """A JSON-like literal written in JavaScript (`{ name: "sync", uses: ["shell"] }`) starting at a token, as Python
    data; members that are not plain data (a method, a call) are left out. Returns (value, next index)."""
    token = tokens[index]
    if token.kind == "str":
        return token.value[1:-1].replace('\\"', '"').replace("\\'", "'"), index + 1
    if token.kind == "tmpl" and not token.value.endswith("${"):
        return token.value[1:-1], index + 1
    if token.kind == "num":
        try:
            return float(token.value) if "." in token.value else int(token.value), index + 1
        except ValueError:
            return token.value, index + 1
    if token.kind == "name" and token.value in ("true", "false", "null"):
        return {"true": True, "false": False, "null": None}[token.value], index + 1
    if token.value in ("[", "{") and index in match:
        end, items, keyed = match[index], [], {}
        position = index + 1
        while position < end:
            key = None
            if token.value == "{":
                if tokens[position].kind in ("name", "str") and position + 1 < end and tokens[position + 1].value == ":":
                    key = tokens[position].value.strip("\"'")
                    position += 2
                else:  # not a plain `key: value` (a method, a spread): skip to the next member
                    position = skip_member(tokens, match, position, end)
                    continue
            value, after = literal(tokens, match, position)
            if after is None or (after < end and tokens[after].value != ","):
                position = skip_member(tokens, match, position, end)
                continue
            if key is None:
                items.append(value)
            else:
                keyed[key] = value
            position = after + 1
        return (keyed if token.value == "{" else items), end + 1
    return None, None


def skip_member(tokens: list[Tok], match: dict[int, int], position: int, end: int) -> int:
    while position < end and tokens[position].value != ",":
        position = match.get(position, position) + 1 if tokens[position].value in ("(", "[", "{", "${") else position + 1
    return position + 1


def comment_text(raw: str) -> str:
    if raw.startswith("//"):
        return re.sub(r"^// ?", "", raw)
    body = raw[2:-2] if raw.endswith("*/") else raw[2:]
    lines = [re.sub(r"^\s*\*? ?", "", item) for item in body.strip("*").splitlines()]
    return "\n".join(lines).strip()


def comments_text(found: list[tuple[int, int, str, int]]) -> str:
    """Comments one after another, as one text: a blank line between them where the source has one."""
    out, last = [], None
    for start, end, raw, _ in found:
        if last is not None and start > last + 1:
            out.append("")
        out.append(comment_text(raw))
        last = end
    return "\n".join(out).strip()


class JsReader:
    """One JavaScript file's opening comment, imports, symbols and calls."""

    def __init__(self, path: str, known: set[str]):
        self.path, self.known = path, known
        self.text = (ROOT / path).read_text(encoding="utf-8")
        self.lines = self.text.splitlines()
        self.tokens, self.comments = js_tokens(self.text)
        self.match = pairs(self.tokens)
        self.enclosing = self._enclosing()
        self.imported: dict[str, tuple[str, str]] = {}  # local name → (path, name there: "default", "*" or its name)
        self.imports: list[dict] = []
        self.class_body: dict[int, int] = {}  # `class` → its body's `{`
        self.kinds = self._brace_kinds()

    def read(self) -> dict:
        self._imports()
        return {"doc": self._head(), "lines": len(self.lines), "imports": self.imports, "symbols": self._symbols(),
                "text": self.text, "language": "javascript"}

    def definition(self) -> dict | None:
        """The fields of the file's `defineModule({...})` that are plain data (name, level, uses, owns)."""
        tokens = self.tokens
        for index in range(len(tokens) - 2):
            if tokens[index].value == "defineModule" and tokens[index + 1].value == "(" and tokens[index + 2].value == "{" \
                    and (index == 0 or tokens[index - 1].value != "function"):
                value, _ = literal(tokens, self.match, index + 2)
                return value
        return None

    # ---- what holds what ----------------------------------------------------------------------------------------
    def _enclosing(self) -> list[int]:
        """For each token, the bracket it is inside (-1 at the top)."""
        found, stack = [], []
        for index, token in enumerate(self.tokens):
            found.append(stack[-1] if stack else -1)
            if token.kind != "punct":
                continue
            if token.value in ("(", "[", "{", "${"):
                stack.append(index)
            elif token.value in (")", "]", "}") and index in self.match:
                opener = self.match[index]
                while stack and stack.pop() != opener:
                    pass
        return found

    def _frame(self, index: int) -> str:
        """The kind of bracket that holds a token most closely: "body", "class", "object", "block", "paren" or ""."""
        opener = self.enclosing[index]
        if opener < 0:
            return ""
        return self.kinds.get(opener, "paren") if self.tokens[opener].value == "{" else "paren"

    def _is_word(self, index: int) -> bool:
        """A keyword used as a keyword, not as a property's name (`node.class`, `{ class: "x" }`)."""
        tokens = self.tokens
        return not (index and tokens[index - 1].value in (".", "?.")) and not (
            index + 1 < len(tokens) and tokens[index + 1].value == ":")

    def _brace_kinds(self) -> dict[int, str]:
        """What each `{` opens: a function's body, a class's body, an object literal or a block."""
        tokens, kinds, bodies = self.tokens, {}, set()
        for index, token in enumerate(tokens[:-1]):
            if token.kind != "punct" and token.value != "class":
                continue
            if token.value in ("=>", ")") and tokens[index + 1].value == "{":
                bodies.add(index + 1)  # a function's, a method's, or an `if (…) {` block's: told apart below
            elif token.value == "class" and token.kind == "name" and self._is_word(index):
                position = index + 1
                while position < len(tokens) and tokens[position].value not in ("{", ";"):
                    position = self.match.get(position, position) + 1 if tokens[position].value in ("(", "[") else position + 1
                if position < len(tokens) and tokens[position].value == "{":
                    kinds[position] = "class"
                    self.class_body[index] = position
        for index, token in enumerate(tokens):
            if token.value != "{" or token.kind != "punct" or index in kinds:
                continue
            before = tokens[index - 1] if index else None
            if index in bodies and before.value == ")":
                opener = self.match.get(index - 1)
                head = tokens[opener - 1] if opener else None
                kinds[index] = "block" if head is not None and head.value in KEYWORDS - {"function"} else "body"
            elif index in bodies:
                kinds[index] = "body"
            elif before is None or before.value in (";", "}", "{", ")", "else", "do", "try", "finally") or \
                    (before.kind == "name" and before.value not in OBJECT_BEFORE):
                kinds[index] = "block"
            else:
                kinds[index] = "object"
        return kinds

    # ---- reading ------------------------------------------------------------------------------------------------
    def _head(self) -> str:
        """The file's opening comment (after a "use strict" too)."""
        first = 0
        while first < len(self.tokens) and (self.tokens[first].kind == "str" or self.tokens[first].value == ";"):
            first += 1
        return comments_text([item for item in self.comments if item[3] <= first])

    def _doc_before(self, index: int) -> str:
        """The comment right above a token: the run of comments that ends on the line before it (or on its line)."""
        found = [item for item in self.comments if item[3] == index]
        if not found or found[-1][1] < self.tokens[index].line - 1:
            return ""
        run = [found[-1]]
        for item in reversed(found[:-1]):
            if item[1] < run[0][0] - 1:
                break
            run.insert(0, item)
        return comments_text(run)

    def _record(self, spec: str) -> str:
        if spec.startswith("."):
            path = posixpath.normpath(posixpath.join(posixpath.dirname(self.path), spec))
        elif spec.startswith("/"):
            path = spec.lstrip("/")
        else:
            path = ""
        path = path if path in self.known else ""
        if path != self.path and not any(item["module"] == spec for item in self.imports):
            self.imports.append({"module": spec, "path": path})
        return path

    def _imports(self) -> None:
        tokens = self.tokens
        for index, token in enumerate(tokens[:-2]):
            if token.kind != "name" or token.value not in ("import", "export", "require") \
                    or (index and tokens[index - 1].value in (".", "?.")):
                continue
            following = tokens[index + 1]
            if token.value == "require":
                if following.value == "(" and tokens[index + 2].kind == "str":
                    self._record(tokens[index + 2].value[1:-1])
            elif token.value == "import" and following.kind == "str":
                self._record(following.value[1:-1])
            elif token.value == "import" and following.value == "(":
                if tokens[index + 2].kind == "str":
                    self._record(tokens[index + 2].value[1:-1])
            elif token.value == "import" and following.value != ".":
                self._bindings(index + 1)
            elif token.value == "export" and following.value in ("*", "{"):
                position = (self.match.get(index + 1, index + 1) if following.value == "{" else index + 1) + 1
                while position < len(tokens) - 1 and tokens[position].value not in ("from", ";") \
                        and position < index + 6 + (self.match.get(index + 1, index) - index):
                    position += 1
                if position < len(tokens) - 1 and tokens[position].value == "from" and tokens[position + 1].kind == "str":
                    self._record(tokens[position + 1].value[1:-1])

    def _bindings(self, index: int) -> None:
        """`import a, { b as c } from "x"`, `import * as d from "x"`: each local name and what it is there."""
        tokens, names, position = self.tokens, [], index
        while position < len(tokens) and tokens[position].value != "from" and position - index < 400:
            token = tokens[position]
            if token.value == "*" and position + 2 < len(tokens) and tokens[position + 1].value == "as":
                names.append((tokens[position + 2].value, "*"))
                position += 3
            elif token.value == "{":
                end = self.match.get(position, position)
                inner = position + 1
                while inner < end:
                    if tokens[inner].kind in ("name", "str"):
                        there = local = tokens[inner].value.strip("\"'")
                        if inner + 2 < end and tokens[inner + 1].value == "as":
                            local = tokens[inner + 2].value
                            inner += 2
                        names.append((local, there))
                    inner += 1
                position = end + 1
            elif token.kind == "name":
                names.append((token.value, "default"))
                position += 1
            else:
                position += 1
        if position + 1 < len(tokens) and tokens[position].value == "from" and tokens[position + 1].kind == "str":
            path = self._record(tokens[position + 1].value[1:-1])
            for local, there in names:
                self.imported[local] = (path, there)

    def _expression_end(self, index: int) -> int:
        """The last token of an arrow function's expression body, which starts at index."""
        tokens, position, last = self.tokens, index, index
        starts = {"const", "let", "var", "function", "export", "import", "return", "if", "for", "while", "class"}
        while position < len(tokens):
            token = tokens[position]
            if token.kind == "punct" and token.value in (",", ";", ")", "]", "}"):
                return last
            if position > index and token.line > tokens[last].line and token.value in starts:
                return last
            if token.kind == "punct" and token.value in ("(", "[", "{", "${"):
                position = self.match.get(position, len(tokens) - 1)
            last = position
            position += 1
        return last

    def _exported(self, head: int) -> int:
        while head and self.tokens[head - 1].value in ("export", "default"):
            head -= 1
        return head

    def _assigned(self, start: int):
        """The name a function or class expression starting at a token is given: `const name =`, `name =` (a class
        field too) or `name:` in an object literal. (name, head, the name's index, kind) or None."""
        tokens = self.tokens
        if start < 2:
            return None
        before = tokens[start - 1]
        if before.value == "=" and tokens[start - 2].kind == "name":
            at = start - 2
            if at and tokens[at - 1].value in (".", "?."):
                return None  # a property set from outside: not a symbol of its own
            if self._frame(at) in ("paren", "object"):
                return None  # a parameter's default (`{ log = () => {} } = {}`)
            head = at - 1 if at and tokens[at - 1].value in ("const", "let", "var", "static") else at
            return tokens[at].value, self._exported(head), at, "method" if self._frame(at) == "class" else "function"
        if before.value == ":" and tokens[start - 2].kind in ("name", "str") and self._frame(start - 2) == "object" \
                and (start < 3 or tokens[start - 3].value in ("{", ",")):
            return tokens[start - 2].value.strip("\"'"), start - 2, start - 2, "method"
        return None

    # ---- the symbols --------------------------------------------------------------------------------------------
    def _symbols(self) -> list[dict]:
        tokens, found = self.tokens, []

        def add(name, head, at, end, kind, opening=None, arrow=None):
            found.append({"name": name, "head": head, "at": at, "end": end, "kind": kind, "open": opening, "arrow": arrow})

        for index, token in enumerate(tokens[:-1]):
            if token.kind != "name":
                continue
            value = token.value
            if value == "function" and self._is_word(index):
                position = index + 1 + (tokens[index + 1].value == "*")
                at = position if position < len(tokens) and tokens[position].kind == "name" else None
                paren = position + 1 if at is not None else position
                if paren >= len(tokens) or tokens[paren].value != "(" or paren not in self.match:
                    continue
                body = self.match[paren] + 1
                if body >= len(tokens) or tokens[body].value != "{":
                    continue
                named = self._assigned(index - 1 if index and tokens[index - 1].value == "async" else index)
                if named is not None:
                    add(named[0], named[1], named[2], self.match.get(body, body), "function", body)
                elif at is not None:
                    head = index - 1 if index and tokens[index - 1].value == "async" else index
                    add(tokens[at].value, self._exported(head), at, self.match.get(body, body), "function", body)
            elif value == "class" and index in self.class_body:
                body = self.class_body[index]
                if body not in self.match:
                    continue
                if tokens[index + 1].kind == "name" and tokens[index + 1].value != "extends":
                    add(tokens[index + 1].value, self._exported(index), index + 1, self.match[body], "class", body)
                else:
                    named = self._assigned(index)
                    if named:
                        add(named[0], named[1], named[2], self.match[body], "class", body)
            elif value == "defineModule" and index + 2 < len(tokens) and tokens[index + 1].value == "(" \
                    and tokens[index + 2].value == "{" and self.enclosing[index] < 0:
                add("defineModule", self._exported(index), index, self.match.get(index + 1, index + 1), "definition", index + 2)
            elif tokens[index + 1].value == "(" and value not in KEYWORDS and index + 1 in self.match \
                    and self.kinds.get(self.match[index + 1] + 1) == "body" and self._frame(index) in ("object", "class"):
                head = index
                while head and tokens[head - 1].value in ("async", "static", "get", "set", "*"):
                    head -= 1
                if head and tokens[head - 1].value not in ("{", ",", ";", "}"):
                    continue
                body = self.match[index + 1] + 1
                add(value, head, index, self.match.get(body, body), "method", body)
            elif value in ("const", "let", "var") and self.enclosing[index] < 0 and index + 3 < len(tokens) \
                    and tokens[index + 1].kind == "name" and tokens[index + 2].value == "=" and tokens[index + 3].value == "{":
                # `const api = { a() {}, b: () => {} }` at the top: a box of its own (when it holds functions)
                add(tokens[index + 1].value, self._exported(index), index + 1, self.match.get(index + 3, index + 3), "object",
                    index + 3)
        for index, token in enumerate(tokens[:-1]):
            if token.value != "=>" or token.kind != "punct":
                continue
            before = index - 1
            start = self.match.get(before) if tokens[before].value == ")" else before if tokens[before].kind == "name" else None
            if start is None:
                continue
            if start and tokens[start - 1].value == "async":
                start -= 1
            named = self._assigned(start)
            if named is None:
                continue
            if tokens[index + 1].value == "{":
                add(named[0], named[1], named[2], self.match.get(index + 1, index + 1), named[3], index + 1, index)
            else:
                add(named[0], named[1], named[2], self._expression_end(index + 1), named[3], None, index)
        return self._arrange([item for item in found if not self._minor(item)])

    def _minor(self, item: dict) -> bool:
        """A short function written in an options object handed straight to a call (`createAway({ log: (message) =>
        ctx.log(message) })`), with no comment above it: left out, so a file's diagram shows its functions rather than
        every callback. An object returned, kept in a name, frozen (`Object.freeze({...})`: an API) or a module's
        definition keeps all its members, as a class does."""
        if item["kind"] != "method":
            return False
        opener = self.enclosing[item["at"]]
        if opener < 1 or self.kinds.get(opener) != "object" or self.tokens[opener - 1].value not in ("(", ","):
            return False
        call = self.enclosing[opener]
        if call < 1 or self.tokens[call].value != "(" or self.tokens[call - 1].value in ("defineModule", "freeze"):
            return False
        lines = self.tokens[item["end"]].line - self.tokens[item["head"]].line + 1
        return lines < 3 and not self._doc_before(item["head"])

    def _arrange(self, found: list[dict]) -> list[dict]:
        """Each top-level function, class or object, the functions inside it flattened under it, and the calls."""
        tokens = self.tokens
        found.sort(key=lambda item: (item["head"], -item["end"]))
        kept, stack = [], []
        for item in found:
            if kept and kept[-1]["head"] == item["head"] and kept[-1]["end"] == item["end"]:
                continue
            while stack and stack[-1]["end"] < item["head"]:
                stack.pop()
            item["top"] = stack[0] if stack else None
            item["outer"] = stack[-1] if stack else None
            item["inside"] = []
            if stack:
                stack[-1]["inside"].append(item)
            stack.append(item)
            kept.append(item)
        definition = None
        symbols = []
        for item in kept:
            top, outer = item["top"], item["outer"]
            if top is None and item["kind"] == "object" and not item["inside"]:
                continue  # plain data
            if top is not None and top["kind"] == "object" and "symbol" not in top:
                continue
            member = outer is top and item["kind"] == "method"
            kind = item["kind"] if top is None else "method" if member else "function"
            parent = top["name"] if top else ""
            stop = tokens[item["open"]].start if item["open"] is not None else tokens[item["arrow"]].end \
                if item["arrow"] is not None else tokens[item["end"]].end
            signature = re.sub(r"\s+", " ", self.text[tokens[item["head"]].start:stop]).strip()
            if kind == "definition":
                definition = definition or self.definition() or {}
                signature = f"export default defineModule({{ name: {json.dumps(definition.get('name'))}, " \
                            f"level: {definition.get('level')}, … }})"
            symbol = {"id": f"{parent}.{item['name']}" if parent else item["name"], "name": item["name"], "kind": kind,
                      "parent": parent, "line": tokens[item["head"]].line, "end": tokens[item["end"]].line,
                      "signature": signature[:240], "doc": self._doc_before(item["head"]), "decorators": []}
            if parent:
                symbol["section"] = "" if outer is top else outer["name"]
            item["symbol"] = symbol
            symbols.append(symbol)
        unique(symbols)
        for item in kept:
            outer = item["outer"]
            if "symbol" in item and outer is not None and outer is not item["top"] and "symbol" in outer:
                item["symbol"]["within"] = outer["symbol"]["id"]
        names = {symbol["name"] for symbol in symbols if not symbol["parent"]}
        children: dict[tuple[str, str], list[dict]] = {}
        for symbol in symbols:
            if symbol["parent"]:
                children.setdefault((symbol["parent"], symbol["name"]), []).append(symbol)
        declared = {item["at"] for item in kept}
        for item in kept:
            if "symbol" in item:
                self._calls(item, children, names, declared)
        return symbols

    def _calls(self, item: dict, children: dict, names: set[str], declared: set[int]) -> None:
        """What a function calls in its own code (not in the functions written inside it): functions of this file,
        and what it imported."""
        tokens, symbol = self.tokens, item["symbol"]
        holes = {inner["head"]: inner["end"] for inner in item["inside"]}
        head_end = item["open"] if item["open"] is not None else item["arrow"] if item["arrow"] is not None else item["at"]
        params = {token.value for token in tokens[item["at"] + 1:head_end] if token.kind == "name"}  # its own, not a call
        top = item["top"] or item
        calls, uses = [], []
        position = item["head"]
        while position <= item["end"] and position < len(tokens) - 1:
            if position in holes and position != item["head"]:
                position = holes[position] + 1
                continue
            token, following = tokens[position], tokens[position + 1]
            calling = following.value == "(" or (following.value == "?." and position + 2 < len(tokens)
                                                 and tokens[position + 2].value == "(")
            if token.kind == "name" and calling and position not in declared:
                before = tokens[position - 1].value if position else ""
                target = None
                if before in (".", "?.") and position >= 2 and tokens[position - 2].kind == "name":
                    holder = tokens[position - 2].value
                    if holder == "this" and top["kind"] == "class":
                        target = f"{top['name']}.{token.value}" if (top["name"], token.value) in children else None
                    elif holder in self.imported and self.imported[holder][0]:
                        path, there = self.imported[holder]
                        uses.append({"path": path, "name": token.value if there == "*" else f"{there}.{token.value}"})
                    elif holder in names and (holder, token.value) in children:
                        target = f"{holder}.{token.value}"
                elif before not in (".", "?.") and token.value not in KEYWORDS and token.value not in params:
                    target = resolve_call(token.value, symbol, children, names)
                    if not target and token.value in self.imported and self.imported[token.value][0]:
                        path, there = self.imported[token.value]
                        uses.append({"path": path, "name": token.value if there in ("default", "*") else there})
                if target and target != symbol["id"] and target not in calls:
                    calls.append(target)
            position += 1
        if symbol["kind"] != "class":
            symbol["calls"] = calls
            symbol["uses"] = [dict(entry) for entry in {(use["path"], use["name"]): use for use in uses}.values()]


class DataReader:
    """A contract, a manifest or a case table: its "about" as its description, its text for the pane."""

    def __init__(self, path: str, known: set[str]):
        self.path = path
        self.text = (ROOT / path).read_text(encoding="utf-8")

    def read(self) -> dict:
        try:
            data = json.loads(self.text)
        except ValueError:
            data = None
        about = data.get("about", "") if isinstance(data, dict) else ""
        return {"doc": about if isinstance(about, str) else "", "lines": len(self.text.splitlines()), "imports": [],
                "symbols": [], "text": self.text if len(self.text) <= 60_000 else self.text[:60_000] + "\n…",
                "language": "json"}


# ---- the modules ----------------------------------------------------------------------------------------------------
def modules(files: dict[str, dict], known: set[str]) -> dict[str, dict]:
    """Every module on both ends and every extension: its name, level, the modules it uses, what it owns, what it
    is (its opening comment, docstring or manifest's about), its other half and its contract."""
    found = {}
    for path in files:
        parts = path.split("/")
        if len(parts) == 4 and parts[:2] == ["app", "modules"] and parts[3] == "index.js":
            definition = JsReader(path, known).definition() or {}
            found["/".join(parts[:3])] = {"end": "browser", **pick(definition), "about": first_paragraph(files[path]["doc"])}
        elif len(parts) == 5 and parts[:3] == ["server", "stilo", "modules"] and parts[4] == "module.json":
            definition = json.loads((ROOT / path).read_text(encoding="utf-8"))
            init = files.get("/".join(parts[:4]) + "/__init__.py", {})
            found["/".join(parts[:4])] = {"end": "server", **pick(definition), "about": first_paragraph(init.get("doc", ""))}
        elif len(parts) == 3 and parts[0] == "extensions" and parts[2] == "extension.json":
            manifest = json.loads((ROOT / path).read_text(encoding="utf-8"))
            entry = f"extensions/{parts[1]}/{manifest['browser']}" if manifest.get("browser") else ""
            definition = (JsReader(entry, known).definition() or {}) if entry in files else {}
            found["/".join(parts[:2])] = {
                "end": "extension", **pick(definition), "name": manifest.get("name", parts[1]),
                "level": definition.get("level", 6), "about": manifest.get("about", ""), "api": manifest.get("api"),
                "entry": entry, "fileTypes": [{"id": item.get("id"), "label": item.get("label"),
                                               "extensions": sorted(item.get("extensions", {}))}
                                              for item in manifest.get("fileTypes", [])],
                "contributes": sorted(manifest.get("contributes", {}))}
    by_name = {(module["end"], module["name"].replace("_", "-")): folder for folder, module in found.items()}
    for folder, module in found.items():
        key = module["name"].replace("_", "-")
        other = {"browser": "server", "server": "browser"}.get(module["end"])
        if other and (other, key) in by_name:
            module["twin"] = by_name[(other, key)]
        contract = f"protocol/{key}.contract.json"
        if module["end"] != "extension" and contract in files:
            module["contract"] = contract
    return found


def pick(definition: dict) -> dict:
    return {key: definition[key] for key in ("name", "level", "uses", "owns") if key in definition}


def folders(files: dict[str, dict]) -> dict[str, dict]:
    tree: dict[str, dict] = {}
    for path in files:
        parts = path.split("/")
        for depth in range(1, len(parts)):
            folder = "/".join(parts[:depth])
            entry = tree.setdefault(folder, {"children": [], "readme": ""})
            child = "/".join(parts[:depth + 1])
            if child not in entry["children"]:
                entry["children"].append(child)
    for folder, entry in tree.items():
        readme = ROOT / folder / "README.md"
        if readme.is_file():
            entry["readme"] = first_paragraph(readme.read_text(encoding="utf-8"))
        entry["children"].sort(key=lambda child: (child in files, child))  # folders first
    return tree


def extension_api() -> dict:
    """What an extension may use (protocol/extension-api.json), for the guide."""
    api = json.loads((ROOT / "protocol" / "extension-api.json").read_text(encoding="utf-8"))
    return {"version": api.get("version"), "kernel": api.get("kernel", {}),
            "modules": {name: {"alias": entry.get("alias", name), "members": entry.get("members", []),
                               "static": entry.get("static", [])} for name, entry in api.get("modules", {}).items()}}


def numbered(document: str, heading: str) -> list[str]:
    """A numbered list under a heading of a document in docs/ (the ten rules, the steps to add an extension), one
    string per item, so the page says what the document says."""
    lines, items, inside = (ROOT / "docs" / document).read_text(encoding="utf-8").splitlines(), [], False
    for line in lines:
        if line.startswith("## "):
            inside = line[3:].strip() == heading
            continue
        if not inside:
            continue
        if re.match(r"^\d+\. ", line):
            items.append(re.sub(r"^\d+\. ", "", line).strip())
        elif items and line.startswith("   ") and line.strip():
            items[-1] += " " + line.strip()
        elif items and not line.strip():
            continue
        elif items:
            break
    return items


def build() -> dict[Path, str]:
    """The two files: data.js (the structure) and source.js (every file's text, which the page loads when it first
    shows code)."""
    paths = tracked_files()
    known = set(paths)
    readers = {".py": PythonReader, ".json": DataReader}
    files = {path: readers.get(Path(path).suffix, JsReader)(path, known).read() for path in paths}
    source = {path: file.pop("text") for path, file in files.items()}
    data = {"repo": REPO, "branch": BRANCH, "roots": [root for root in ROOTS if any(p.startswith(root + "/") for p in paths)],
            "parts": [{"id": part, "label": label, "note": note, "target": target} for part, label, note, target in PARTS],
            "modules": modules(files, known), "folders": folders(files), "files": files, "extensionApi": extension_api(),
            "rules": numbered("ARCHITECTURE.md", "The ten rules"), "extensionSteps": numbered("EXTENSIONS.md", "Adding an extension")}
    stamp = "// Generated by tools/architecture.py from the code; do not edit (run it again instead).\n"
    dump = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))  # noqa: E731
    return {OUT: f"{stamp}window.ARCH = {dump(data)};\n", SOURCE: f"{stamp}window.ARCH_SOURCE = {dump(source)};\n"}


def main() -> int:
    built = build()
    if "--check" in sys.argv:
        stale = [path for path, text in built.items() if (path.read_text(encoding="utf-8") if path.is_file() else "") != text]
        for path in stale:
            print(f"{path.relative_to(ROOT)} is out of date: run `python3 tools/architecture.py`", file=sys.stderr)
        return 1 if stale else 0
    for path, text in built.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
