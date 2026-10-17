"""Keeping concurrent edits apart: a text patch made against an older revision
is moved over the patches applied since, and a write based on a revision
older than the last change to its path is refused. Pure, in memory: the log
is empty after a restart, and then anything based on an older revision must
reload (`floor`).

transform_range has a twin in the browser (app/modules/sync/model/rebase.js:
transformTextPatch); both run spec/sync/rebase.cases.json."""

LOG_SIZE = 2000


def transform_range(start, end, a_start, a_end, inserted):
    """[start, end) moved over an earlier patch that replaced [a_start, a_end)
    with `inserted` units. Ambiguous overlaps are refused (the client then
    keeps its text as a draft and reloads)."""
    delta = inserted - (a_end - a_start)
    if start == end and a_start == a_end:
        return (start + inserted, end + inserted) if a_start < start else (start, end)
    if start == end:
        if a_start < start < a_end:
            raise ValueError("patch conflict: insertion inside concurrently removed text")
        return (start + delta, end + delta) if start >= a_end else (start, end)
    if a_start == a_end:
        if start < a_start < end:
            raise ValueError("patch conflict: concurrent insertion inside removed text")
        return (start + inserted, end + inserted) if a_start <= start else (start, end)
    if start < a_end and a_start < end:
        raise ValueError("patch conflict: overlapping replacements")
    return (start + delta, end + delta) if a_end <= start else (start, end)


class RebaseLog:
    def __init__(self, floor: int = 0, size: int = LOG_SIZE):
        self.entries: list[dict] = []          # applied text patches, oldest first
        self.changed_at: dict[str, int] = {}   # path -> revision it last changed
        self.replaced_at: dict[str, int] = {}  # path -> revision it was last replaced, moved or renamed
        self.floor = floor                     # anything older than this predates the log
        self.size = size

    def reset(self, revision: int) -> None:
        """The whole tree changed (a replace, or a reload): everything older must pull."""
        self.entries.clear()
        self.changed_at.clear()
        self.replaced_at.clear()
        self.floor = revision

    def _since(self, changes: dict, path: str) -> int:
        return max([self.floor] + [revision for changed, revision in changes.items()
                                   if path == changed or path.startswith(changed + "/")])

    def last_change(self, path: str) -> int:
        return self._since(self.changed_at, path)

    def note(self, paths, revision: int, text_only: bool) -> None:
        """Record the paths a change applied at `revision` touched. Anything but
        a text patch is a barrier: a patch made before it cannot rebase across it."""
        for path in paths:
            if path:
                self.changed_at[path] = revision
                if not text_only:
                    self.replaced_at[path] = revision

    def record_patch(self, revision: int, path: str, start: int, end: int, inserted: int) -> None:
        self.entries.append({"revision": revision, "path": path, "start": start, "end": end, "insertedLength": inserted})
        if len(self.entries) > self.size:
            self.entries = self.entries[-self.size:]

    def rebase(self, path: str, start: int, end: int, base: int, revision: int) -> tuple[int, int]:
        """A patch to `path` made at revision `base` moved to the current text."""
        if base >= revision:
            return start, end
        oldest = self.entries[0]["revision"] if self.entries else None
        if oldest is None or base < oldest - 1:
            raise ValueError(f"patch conflict on {path!r}: base revision {base} is too far behind revision "
                             f"{revision} to rebase safely (the server restarted) — reload to continue")
        if base < self._since(self.replaced_at, path):
            raise ValueError("patch conflict: file was replaced or its path changed — reload to continue")
        for entry in self.entries:
            if entry["revision"] > base and entry["path"] == path:
                start, end = transform_range(start, end, entry["start"], entry["end"], entry["insertedLength"])
        return start, end
