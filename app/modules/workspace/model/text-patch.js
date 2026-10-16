// Text patches: the change one edit makes to a file, as the server applies
// and rebases them (server/mdnotes_server.py, CollaborationBroker
// _apply_text_patch and _rebase_patch are the twin). Pure.
// Splice coordinates are UTF-16 offsets, matching browser selections.
// Compares UTF-16 code units with charCodeAt, not text[i]: indexing a string of
// CJK text allocates a one-character string per position, so finding the
// changed span of a long chapter allocated ~180k strings on every keystroke.
// Same units, same result.
export function buildTextPatch(path, previousContent, nextContent, baseRevision) {
    if (previousContent === nextContent) return null;
    let start = 0;
    while (start < previousContent.length && start < nextContent.length
      && previousContent.charCodeAt(start) === nextContent.charCodeAt(start)) {
      start += 1;
    }

    let previousEnd = previousContent.length;
    let nextEnd = nextContent.length;
    while (previousEnd > start && nextEnd > start
      && previousContent.charCodeAt(previousEnd - 1) === nextContent.charCodeAt(nextEnd - 1)) {
      previousEnd -= 1;
      nextEnd -= 1;
    }

    const splitsPair = (text, offset) => offset > 0 && offset < text.length
      && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]);
    if (splitsPair(previousContent, start) || splitsPair(nextContent, start)) start -= 1;
    if (splitsPair(previousContent, previousEnd) || splitsPair(nextContent, nextEnd)) {
      previousEnd += 1;
      nextEnd += 1;
    }
    const removedText = previousContent.slice(start, previousEnd);
    const insertText = nextContent.slice(start, nextEnd);

    return {
      type: "patch-file",
      path,
      start,
      end: previousEnd,
      removedText,
      text: insertText,
      baseRevision
    };

}

export function transformTextPatch(op, applied, insertAfter = false) {
  let { start, end } = op;
  const a = applied.start, b = applied.end, n = String(applied.text ?? "").length;
  const delta = n - (b - a);
  const shift = (amount) => ({ ...op, start: start + amount, end: end + amount });
  if (start === end && a === b) return shift(a < start || (a === start && insertAfter) ? n : 0);
  if (start === end) {
    if (a < start && start < b) throw new Error("Concurrent insertion inside removed text");
    return shift(start >= b ? delta : 0);
  }
  if (a === b) {
    if (start < a && a < end) throw new Error("Concurrent insertion inside removed text");
    return shift(a <= start ? n : 0);
  }
  if (start < b && a < end) throw new Error("Overlapping concurrent replacements");
  return shift(b <= start ? delta : 0);
}

// Applies a patch. The removed text must match, unless skipConflictCheck
// (a patch rebased over local typing legitimately covers different text; the
// sync runtime checks it strictly before that).
export function applyTextPatch(content, op, { skipConflictCheck = false } = {}) {
  const start = Number(op.start), end = Number(op.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > content.length) {
    throw new Error("Invalid text patch range");
  }
  if (!skipConflictCheck && content.slice(start, end) !== String(op.removedText ?? "")) {
    throw new Error("Text patch no longer matches its document");
  }
  return content.slice(0, start) + String(op.text ?? "") + content.slice(end);
}
