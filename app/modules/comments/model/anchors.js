// Keeping a line comment on its line as the text changes: a comment remembers
// its line's text, and when that line moved it is found again by that text,
// searching outward from the old position (the nearest match is the right one
// when lines were added or removed above it). Pure.

// The comments that moved: [{ id, line, anchorText }]. Changes `comments` in place.
export function reanchor(comments, text) {
  const lines = String(text ?? "").split("\n");
  const moves = [];
  for (const comment of comments) {
    const anchor = String(comment.anchorText ?? "");
    // A blank anchor cannot be matched (every empty line looks alike).
    if (!anchor.trim() || lines[comment.line] === anchor) continue;
    let found = -1;
    for (let distance = 1; distance <= lines.length; distance += 1) {
      const above = comment.line - distance;
      const below = comment.line + distance;
      if (above >= 0 && lines[above] === anchor) { found = above; break; }
      if (below < lines.length && lines[below] === anchor) { found = below; break; }
      if (above < 0 && below >= lines.length) break;
    }
    if (found >= 0 && found !== comment.line) {
      comment.line = found;
      moves.push({ id: comment.id, line: found, anchorText: anchor });
    }
  }
  return moves;
}

// The list with `comment` added or replaced, by line.
export function withComment(comments, comment) {
  return [...comments.filter((c) => c.id !== comment.id), comment].sort((a, b) => a.line - b.line);
}
