"""The project tree: folders and files in a dict of nodes. Pure functions on
that dict; the browser's twin is app/modules/workspace/model/project.js."""
import uuid


def default_project(name: str = "Workspace") -> dict:
    return {
        "id": "server-project",
        "name": name,
        "sourceMode": "memory",
        "rootId": "root",
        "activeFileId": None,
        "nodes": {"root": {"id": "root", "kind": "folder", "name": name, "parentId": None, "children": [], "expanded": True}},
    }


def create_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def find_child_by_name(project: dict, parent_id: str, name: str):
    """Tolerant of a broken tree (a snapshot a browser sent): a missing node is no match."""
    nodes = project.get("nodes", {})
    for child_id in nodes.get(parent_id, {}).get("children", []):
        child = nodes.get(child_id)
        if child and child.get("name") == name:
            return child
    return None


def node_id_by_path(project: dict, path: str):
    current_id = project.get("rootId", "root")
    for segment in (s for s in str(path or "").split("/") if s):
        child = find_child_by_name(project, current_id, segment)
        if not child:
            return None
        current_id = child["id"]
    return current_id


def path_of(project: dict, node_id: str, strict: bool = False) -> str:
    """The node's path from the root ('' for the root). With strict, a missing
    node or parent is an error instead of ending the path."""
    nodes = project["nodes"]
    segments = []
    current = nodes[node_id] if strict else nodes.get(node_id)
    while current and current.get("parentId"):
        segments.insert(0, current["name"])
        current = nodes[current["parentId"]] if strict else nodes.get(current["parentId"])
    return "/".join(segments)


def subtree_paths(project: dict, node_id: str) -> list[str]:
    """Paths of a node and everything beneath it."""
    out, stack = [], [node_id]
    while stack:
        current = stack.pop()
        out.append(path_of(project, current))
        stack.extend(project["nodes"].get(current, {}).get("children", []))
    return out


def append_node(project: dict, parent_id: str, node: dict) -> None:
    project["nodes"][parent_id].setdefault("children", []).append(node["id"])
    project["nodes"][node["id"]] = node


def remove_node_recursive(project: dict, node_id: str) -> None:
    node = project["nodes"].get(node_id)
    if not node:
        return
    if node["kind"] == "folder":
        for child_id in list(node.get("children", [])):
            remove_node_recursive(project, child_id)
    del project["nodes"][node_id]


def update_file_operation(path: str, content: str, base: str | None = None, **extra) -> dict:
    """A whole-file update as it travels; `base` is the text it was made from."""
    operation = {"type": "update-file", "path": path, "content": content}
    if base is not None:
        operation["preImage"] = base
    return {**operation, **extra}
