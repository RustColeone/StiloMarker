// Searching text, for the find bar (the open file) and Find in Files (every
// file): the pattern for a query and its options, the matches in a text with
// their line and column, a line's snippet around a match, and replacing them.

export const MATCH_LIMIT = 20000; // matches in one text (a pattern matching everything stops here)

// The pattern for a query: { pattern } (a global RegExp), { pattern: null }
// for an empty query, or { error } for a regular expression that isn't one.
export function searchPattern(query, { regex = false, wholeWord = false, caseSensitive = false } = {}) {
  if (!query) return { pattern: null };
  let source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord) source = `\\b(?:${source})\\b`;
  try {
    return { pattern: new RegExp(source, `g${caseSensitive ? "" : "i"}`) };
  } catch (error) {
    return { error: error.message };
  }
}

// Every match of `pattern` in `text`: [{ start, end }] (an empty match moves on one character).
export function findMatches(text, pattern, limit = MATCH_LIMIT) {
  const out = [];
  if (!pattern) return out;
  pattern.lastIndex = 0;
  let m;
  while ((m = pattern.exec(text)) !== null && out.length < limit) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
  return out;
}

// The matches with their line (0-based) and column, in one pass over the text.
export function locate(text, matches) {
  let line = 0;
  let lineStart = 0;
  let at = 0;
  return matches.map((match) => {
    for (let next = text.indexOf("\n", at); next !== -1 && next < match.start; next = text.indexOf("\n", at)) {
      line += 1;
      lineStart = next + 1;
      at = next + 1;
    }
    return { ...match, line, column: match.start - lineStart, lineStart };
  });
}

// The match's line around it: { before, hit, after } (cut to `reach` characters each side,
// with … where cut, leading space dropped), for a result list.
export function snippet(text, match, reach = 40) {
  const lineStart = match.lineStart ?? text.lastIndexOf("\n", match.start - 1) + 1;
  const newline = text.indexOf("\n", match.end);
  const lineEnd = newline === -1 ? text.length : newline;
  const hitEnd = Math.min(match.end, lineEnd);
  let from = Math.max(lineStart, match.start - reach);
  const to = Math.min(lineEnd, hitEnd + reach * 2);
  let before = text.slice(from, match.start);
  if (from === lineStart) before = before.trimStart();
  else before = `…${before}`;
  const after = text.slice(hitEnd, to) + (to < lineEnd ? "…" : "");
  return { before, hit: text.slice(match.start, hitEnd), after };
}

// Every match replaced: { text, count }. A regular expression's replacement
// may use $1, $& and the like; otherwise it is taken as it is.
export function replaceMatches(text, pattern, replacement, { regex = false } = {}) {
  if (!pattern) return { text, count: 0 };
  pattern.lastIndex = 0;
  const count = (text.match(pattern) ?? []).length;
  // A string replacement reads $1 and $& in the match's own context; a function's result is taken as it is.
  const next = text.replace(pattern, regex ? replacement : () => replacement);
  pattern.lastIndex = 0;
  return { text: next, count };
}
