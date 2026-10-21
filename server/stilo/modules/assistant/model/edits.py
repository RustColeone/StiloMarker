"""edit_file: changing exact passages of a file instead of rewriting it.
Pure: text and edits in, new text out. A precise error makes the model retry
with better passages instead of the edit landing somewhere it should not.

Its twin is the browser's (app/modules/assistant/model/agent-tools.js, for
the agent it runs with the user's own key); both run
spec/assistant/tools.cases.json. The result travels as the full new text
with the text it started from, and the Workspace write path places it."""
from stilo.modules.file_types import BUILTIN as FILE_TYPES
from stilo.modules.workspace import node_id_by_path, update_file_operation

MAX_EDITS = 20   # protocol/agent.json: limits.maxEdits (a test checks they agree)


class EditError(ValueError):
    pass


def apply_edits(text: str, edits) -> str:
    """Each edit's `find` must occur exactly once in `text`, edits may not
    overlap, and `replace` replaces it (empty deletes). All or nothing."""
    if not isinstance(edits, list) or not edits:
        raise EditError("edits must be a non-empty list of {find, replace}")
    if len(edits) > MAX_EDITS:
        raise EditError(f"at most {MAX_EDITS} edits per call; split the change")
    spans = []
    for number, edit in enumerate(edits, start=1):
        if not isinstance(edit, dict):
            raise EditError(f"edit {number} must be an object with find and replace")
        find, replace = edit.get("find"), edit.get("replace", "")
        if not isinstance(find, str) or not find:
            raise EditError(f"edit {number}: find must be the exact text to change (not empty)")
        if not isinstance(replace, str):
            raise EditError(f"edit {number}: replace must be text")
        count = text.count(find)
        if count == 0:
            raise EditError(f"edit {number}: find was not found; copy the passage exactly as the file has it (read_file first)")
        if count > 1:
            raise EditError(f"edit {number}: find matches {count} times; include more surrounding text so it matches once")
        start = text.index(find)
        spans.append((start, start + len(find), replace, number))
    spans.sort()
    for (a_start, a_end, _, a_number), (b_start, _, _, b_number) in zip(spans, spans[1:]):
        if b_start < a_end:
            raise EditError(f"edits {a_number} and {b_number} overlap; merge them into one edit")
    out = text
    for start, end, replace, _ in reversed(spans):
        out = out[:start] + replace + out[end:]
    return out


def propose_edit(project: dict | None, proposals: list, path: str, edits, proposal_id: str) -> dict:
    """Resolve an edit_file call against the file as the agent sees it this turn
    (the project, or an earlier proposal for the same file in this turn), and
    add the proposal. Returns the tool result for the model."""
    path = str(path or "").strip()
    if not path:
        return {"error": "path is required"}
    if FILE_TYPES.is_image(path):
        return {"error": "Images cannot be edited as text."}
    base = None
    for proposal in reversed(proposals):
        if "content" in proposal and proposal.get("type") != "delete-node":
            target = proposal.get("path") or "/".join(p for p in (proposal.get("parentPath"), proposal.get("name")) if p)
            if target == path:
                base = proposal.get("content", "")
                break
    if base is None:
        node_id = node_id_by_path(project or {}, path)
        node = (project or {}).get("nodes", {}).get(node_id) if node_id else None
        if not node or node.get("kind") != "file":
            return {"error": f"File not found: {path}. Use create_file for a new file."}
        base = node.get("content", "")
    try:
        content = apply_edits(base, edits)
    except EditError as error:
        return {"error": str(error)}
    if content == base:
        return {"status": "unchanged", "message": "These edits change nothing."}
    # Travels as an update-file (old tabs apply it as one); `edits` lets the
    # review card show each change, and the browser places it into the file as
    # it is now (Workspace write path).
    proposals.append({"proposalId": proposal_id, **update_file_operation(
        path, content, base, edits=[{"find": e["find"], "replace": e.get("replace", "")} for e in edits])})
    return {"status": "proposed", "proposalId": proposal_id, "edits": len(edits)}

