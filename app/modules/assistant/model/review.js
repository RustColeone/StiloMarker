// Reviewing the agent's applied edits, as rules: which lines an edit changed
// (tinted in the editor until Keep or Drop) and the short diff a proposal card
// shows. Pure.

// The inclusive line range in newContent that differs from preImage, or null
// when nothing changed.
export function changedLineRange(preImage, newContent) {
  const oldLines = preImage.split("\n");
  const newLines = newContent.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  // If everything up to the shorter length matched and lengths are equal → no change.
  if (oldLines.length === newLines.length && start === oldLines.length) return null;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { lineStart: start, lineEnd: Math.max(start, newEnd - 1) };
}

// A unified diff of two texts as hunks ({ op: " " | "-" | "+", text }), with
// two lines of context around the one changed run.
export function textDiffHunks(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const hunks = [];
  const ctxCount = 2;
  const ctxStart = Math.max(0, start - ctxCount);
  for (let i = ctxStart; i < start; i++) {
    hunks.push({ op: " ", text: oldLines[i] });
  }
  for (let i = start; i < oldEnd; i++) {
    hunks.push({ op: "-", text: oldLines[i] });
  }
  for (let i = start; i < newEnd; i++) {
    hunks.push({ op: "+", text: newLines[i] });
  }
  const ctxEnd = Math.min(oldLines.length, oldEnd + ctxCount);
  for (let i = oldEnd; i < ctxEnd; i++) {
    hunks.push({ op: " ", text: oldLines[i] });
  }
  return hunks;
}
