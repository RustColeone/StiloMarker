// Splice coordinates are UTF-16 offsets, matching browser selections.
export function buildTextPatch(path, previousContent, nextContent, baseRevision) {
    if (previousContent === nextContent) return null;
    let start = 0;
    while (start < previousContent.length && start < nextContent.length && previousContent[start] === nextContent[start]) {
      start += 1;
    }

    let previousEnd = previousContent.length;
    let nextEnd = nextContent.length;
    while (previousEnd > start && nextEnd > start && previousContent[previousEnd - 1] === nextContent[nextEnd - 1]) {
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

export function applyTextPatch(content, op) {
  if (op.start < 0 || op.end < op.start || op.end > content.length
      || content.slice(op.start, op.end) !== String(op.removedText ?? "")) {
    throw new Error("Text patch no longer matches its document");
  }
  return content.slice(0, op.start) + op.text + content.slice(op.end);
}
