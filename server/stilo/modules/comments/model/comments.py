"""Line comments: a note anchored to a line of a file, never in its text.
A project's comments are {"files": {file key: [comment, ...]}}, each list
sorted by line. Pure: these change the record they are given."""

MAX_LENGTH = 4000
MAX_PER_FILE = 500
ANCHOR_LENGTH = 400


def empty() -> dict:
    return {"files": {}}


def _sorted(entries):
    entries.sort(key=lambda c: int(c.get("line", 0)))


def save(data: dict, file: str, payload: dict, author: str, now: int, new_id: str) -> dict:
    """Add a comment, or edit the one named by payload["id"] (which may also
    move it). Returns the comment as kept."""
    text = str(payload.get("text", "")).strip()
    if not text:
        raise ValueError("A comment needs some text")
    if len(text) > MAX_LENGTH:
        raise ValueError("That comment is too long")
    entries = data["files"].setdefault(file, [])
    comment_id = str(payload.get("id") or "")
    existing = next((c for c in entries if c.get("id") == comment_id), None) if comment_id else None
    if existing is not None:
        existing["text"] = text
        existing["updatedAt"] = now
        if payload.get("line") is not None:
            existing["line"] = max(0, int(payload.get("line", 0)))
        if payload.get("anchorText") is not None:
            existing["anchorText"] = str(payload.get("anchorText", ""))[:ANCHOR_LENGTH]
        result = existing
    else:
        if len(entries) >= MAX_PER_FILE:
            raise ValueError("Too many comments on that file")
        # The line's own text, so the comment can follow its line when edits
        # move it (anchoring happens in the browser, which has the live text).
        result = {"id": new_id, "line": max(0, int(payload.get("line", 0))),
                  "anchorText": str(payload.get("anchorText", ""))[:ANCHOR_LENGTH],
                  "text": text, "author": author, "createdAt": now, "updatedAt": now}
        entries.append(result)
    _sorted(entries)
    return result


def delete(data: dict, comment_id: str) -> bool:
    removed = False
    for key, entries in list(data["files"].items()):
        kept = [c for c in entries if c.get("id") != comment_id]
        removed = removed or len(kept) != len(entries)
        if kept:
            data["files"][key] = kept
        else:
            data["files"].pop(key, None)
    return removed


def reanchor(data: dict, file: str, moves) -> bool:
    """Where the browser found each comment's line after edits; True if any moved."""
    entries = data["files"].get(file, [])
    by_id = {c.get("id"): c for c in entries}
    changed = False
    for move in moves or []:
        target = by_id.get(str(move.get("id", "")))
        if target is None:
            continue
        line = max(0, int(move.get("line", target.get("line", 0))))
        if target.get("line") != line:
            target["line"] = line
            changed = True
        if move.get("anchorText") is not None:
            anchor = str(move.get("anchorText", ""))[:ANCHOR_LENGTH]
            if target.get("anchorText") != anchor:
                target["anchorText"] = anchor
                changed = True
    if changed:
        _sorted(entries)
    return changed
