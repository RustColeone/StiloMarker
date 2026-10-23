"""Applying an operation to a project tree. Pure: the browser applies the same
operations with applySyncOperation (app/modules/workspace/model/project.js),
and both run spec/workspace/operations.cases.json and move-node.cases.json, so
every peer builds the same tree. Revisions, rebasing and who may send what
are Sync's; this only changes the tree, or refuses."""
import time

from .text import utf16_index
from .tree import append_node, create_id, find_child_by_name, node_id_by_path, remove_node_recursive, subtree_paths

# The operations whose names the modules above compare against.
PATCH_FILE, UPDATE_FILE, REPLACE_PROJECT = "patch-file", "update-file", "replace-project"

# A writing "sitting": edits to one file less than this apart belong to the
# same sitting (the E in a file's S.E.N version label).
EDIT_SESSION_GAP_SECONDS = 600


def bump_edit_counters(node: dict, now: float | None = None, gap: float = EDIT_SESSION_GAP_SECONDS) -> dict:
    """Advance a file's display counters (the E and N of its S.E.N label).
    Cosmetic: nothing that orders changes reads them."""
    stamp = time.time() if now is None else float(now)
    if stamp - float(node.get("lastEditAt") or 0) > gap:
        node["editSessions"] = int(node.get("editSessions", 0) or 0) + 1
        node["sessionEdits"] = 0
    node["lastEditAt"] = stamp
    node["sourceVersion"] = int(node.get("sourceVersion", 0) or 0) + 1
    node["sessionEdits"] = int(node.get("sessionEdits", 0) or 0) + 1
    return {"editSessions": node["editSessions"], "sessionEdits": node["sessionEdits"], "sourceVersion": node["sourceVersion"]}


def patch_text(content: str, start: int, end: int, text: str, removed: str) -> str:
    """`content` with [start, end) (UTF-16 units) replaced by `text`, provided
    that range still holds `removed`."""
    str(text).encode("utf-8")  # refuse lone surrogates before changing anything
    if start < 0 or end < start:
        raise ValueError("Invalid text patch range")
    py_start, py_end = utf16_index(content, start), utf16_index(content, end)
    if content[py_start:py_end] != removed:
        raise ValueError("patch conflict: removed text no longer matches — reload to continue")
    return f"{content[:py_start]}{text}{content[py_end:]}"


def touched_paths(operation: dict, moved=()) -> list[str]:
    """The paths an operation changes (a move: every path under the node, old and new)."""
    kind = operation.get("type")
    path = str(operation.get("path", ""))
    if kind in (PATCH_FILE, UPDATE_FILE, "delete-node"):
        return [path]
    if kind in ("create-file", "create-folder"):
        parent, name = str(operation.get("parentPath", "")), str(operation.get("name", ""))
        return [f"{parent}/{name}" if parent else name]
    if kind == "move-node":
        return list(moved)
    if kind == "rename-node":
        parent = path.rsplit("/", 1)[0] if "/" in path else ""
        name = str(operation.get("name", ""))
        return [path] + ([f"{parent}/{name}" if parent else name] if name else [])
    return []


def _parent_id(project, parent_path):
    parent_id = node_id_by_path(project, parent_path) if parent_path else project["rootId"]
    if not parent_id:
        raise ValueError(f"Parent path not found: {parent_path}")
    return parent_id


MAX_NAME = 255


def name_problem(name) -> str | None:
    """Why a file or folder name cannot be used, or None. A name becomes a path
    on disk, so none walks out of its folder (., .., a slash) or reads as
    another name on some disk (control characters; a trailing dot or space,
    which Windows drops). The browser's project.js (nameProblem) refuses the same."""
    if not isinstance(name, str) or not name:
        return "A file or folder needs a name."
    if name in (".", "..") or "/" in name or "\\" in name:
        return f"{name!r} cannot be a file or folder name."
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        return "A file or folder name cannot hold control characters."
    if name[-1] in ". ":
        return f"{name!r}: a file or folder name cannot end with a dot or a space."
    if len(name) > MAX_NAME:
        return f"A file or folder name has at most {MAX_NAME} characters."
    return None


def _check_name(project, parent_id, name, types):
    """A name that can stand in this folder: a usable name, and at the top none
    of the names the server keeps its own files under there (as the browser's
    ensureUniqueName refuses them)."""
    problem = name_problem(name)
    if problem:
        raise ValueError(problem)
    if parent_id == project["rootId"] and types.is_reserved(name):
        raise ValueError(f"{name!r} is kept for the app's own file at a workspace's top")


def tree_problem(project: dict, types) -> str | None:
    """Why a whole project brought in at once (Share This Workspace, an import,
    a state pushed) cannot be kept, or None: every node a usable name in a
    folder that lists it, a file of a known type, nothing at the top that only
    the app's own files may be called, no loop, no two names alike in a folder."""
    nodes, root_id = (project or {}).get("nodes"), (project or {}).get("rootId")
    if not isinstance(nodes, dict) or root_id not in nodes:
        return "The workspace has no root."
    names_in = {}
    for node_id, node in nodes.items():
        if node_id == root_id:
            continue
        if not isinstance(node, dict):
            return "The workspace holds something that is not a file or folder."
        name = node.get("name")
        problem = name_problem(name)
        if problem:
            return problem
        parent = nodes.get(node.get("parentId"))
        if not isinstance(parent, dict) or parent.get("kind") != "folder" or node_id not in parent.get("children", []):
            return f"{name!r} is not in the folder it names."
        if node.get("kind") == "file" and not types.is_known(name):
            return f"Unsupported file type: {name}"
        if node.get("kind") not in ("file", "folder"):
            return f"{name!r} is neither a file nor a folder."
        if node.get("parentId") == root_id and types.is_reserved(name):
            return f"{name!r} is kept for the app's own file at a workspace's top."
        key = (node.get("parentId"), name.lower())
        if key in names_in:
            return f"Two items are named {name!r} in one folder."
        names_in[key] = node_id
        steps, current = 0, node
        while current.get("parentId") and steps <= len(nodes):
            current, steps = nodes.get(current["parentId"], {}), steps + 1
        if steps > len(nodes):
            return f"{name!r} is inside itself."
    return None


def _node(project, path, what="Node"):
    node_id = node_id_by_path(project, path)
    if not node_id:
        raise ValueError(f"{what} path not found: {path}")
    return node_id, project["nodes"][node_id]


def apply_operation(project: dict, operation: dict, types, gap: float = EDIT_SESSION_GAP_SECONDS) -> dict:
    """Change `project` by one operation; raises ValueError when it cannot apply.
    `types` is File types (is_known, is_reserved). Returns what the caller needs to know:
    {"moved": [paths]} for a move (every path under the node, old and new),
    {"counters": {...}} for a file whose text changed, {} otherwise. A text
    patch must already be rebased to the current text."""
    kind = operation.get("type")
    if kind in ("create-folder", "create-file"):
        parent_id = _parent_id(project, operation.get("parentPath", ""))
        name = operation["name"]
        if find_child_by_name(project, parent_id, name):
            raise ValueError("create conflict: a file or folder with that name already exists")
        _check_name(project, parent_id, name, types)
        if kind == "create-folder":
            append_node(project, parent_id, {"id": create_id("folder"), "kind": "folder", "name": name,
                                             "parentId": parent_id, "children": [], "expanded": True})
            return {}
        if not types.is_known(name):  # as the browser refuses it: peers could not apply it
            raise ValueError(f"Unsupported file type: {name}")
        append_node(project, parent_id, {"id": create_id("file"), "kind": "file", "name": name, "parentId": parent_id,
                                         "content": operation.get("content", ""), "dirty": False, "sourceVersion": 0,
                                         "editSessions": 0, "sessionEdits": 0, "lastEditAt": 0})
        return {}

    if kind == "rename-node":
        node_id, node = _node(project, operation["path"])
        sibling = find_child_by_name(project, node["parentId"], operation["name"])
        if sibling and sibling["id"] != node_id:
            raise ValueError("rename conflict: a file or folder with that name already exists")
        if node["kind"] == "file" and not types.is_known(operation["name"]):
            raise ValueError(f"Unsupported file type: {operation['name']}")
        _check_name(project, node["parentId"], operation["name"], types)
        node["name"] = operation["name"]
        return {}

    if kind == "move-node":
        return {"moved": _move(project, operation, types)}

    if kind == "delete-node":
        node_id = node_id_by_path(project, operation["path"])
        if not node_id:
            return {}
        node = project["nodes"][node_id]
        parent = project["nodes"][node["parentId"]]
        parent["children"] = [child for child in parent.get("children", []) if child != node_id]
        remove_node_recursive(project, node_id)
        return {}

    if kind == UPDATE_FILE:
        _, node = _node(project, operation["path"], "File")
        node["content"] = operation.get("content", "")
        node["dirty"] = False
        return {"counters": bump_edit_counters(node, gap=gap)}

    if kind == PATCH_FILE:
        _, node = _node(project, operation["path"], "File")
        if node["kind"] != "file":
            raise ValueError("Only files can receive text patches")
        node["content"] = patch_text(node.get("content", ""), int(operation.get("start", -1)), int(operation.get("end", -1)),
                                     str(operation.get("text", "")), str(operation.get("removedText", "")))
        node["dirty"] = False
        return {"counters": bump_edit_counters(node, gap=gap)}

    raise ValueError(f"Unsupported operation type: {kind}")


def _move(project: dict, operation: dict, types) -> list[str]:
    """Re-parent or reorder a node. Validation and index arithmetic mirror
    moveNode() in the browser exactly: peers apply the same broadcast with it,
    and any difference would order the tree differently for different people."""
    node_id, node = _node(project, operation["path"])
    nodes, root_id = project["nodes"], project["rootId"]
    if node_id == root_id:
        raise ValueError("move conflict: the workspace root cannot be moved")
    target_id = _parent_id(project, str(operation.get("parentPath", "") or ""))
    target = nodes[target_id]
    if target.get("kind") != "folder":
        raise ValueError("Items can only be moved into folders")
    ancestor = target_id
    while ancestor:
        if ancestor == node_id:
            raise ValueError("move conflict: cannot move an item into itself")
        ancestor = nodes[ancestor].get("parentId")
    lowered = str(node["name"]).lower()  # case-insensitive, like the browser's ensureUniqueName()
    for child_id in target.get("children", []):
        child = nodes.get(child_id)
        if child and child_id != node_id and str(child.get("name", "")).lower() == lowered:
            raise ValueError("move conflict: a file or folder with that name already exists there")
    _check_name(project, target_id, node["name"], types)
    old_paths = subtree_paths(project, node_id)
    source = nodes[node["parentId"]]
    source_children = list(source.get("children", []))
    source_index = source_children.index(node_id) if node_id in source_children else -1
    # index is a slot in the destination as it is BEFORE the move: clamp
    # against that length, then account for the removal.
    slots = len(target.get("children", []))
    raw_index = operation.get("index")
    if raw_index is None:
        clamped = slots
    else:
        try:
            clamped = max(0, min(int(raw_index), slots))
        except (TypeError, ValueError):
            raise ValueError("move-node index must be an integer")
    if source["id"] == target_id and 0 <= source_index < clamped:
        clamped -= 1
    source["children"] = [child for child in source_children if child != node_id]
    target.setdefault("children", []).insert(clamped, node_id)
    node["parentId"] = target_id
    return old_paths + subtree_paths(project, node_id)
