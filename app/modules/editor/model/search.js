// Searching text, for the find bar (the open file) and Find in Files (every
// file): the pattern for a query and its options, the matches in a text with
// their line and column, a line's snippet around a match, and replacing them.

export const MATCH_LIMIT = 20000; // matches found at most (a pattern matching everything stops here)

// A word's letters in any script (a whole word is not inside another), and,
// for a regular expression written for the older rules, ASCII's.
const WORD = "[\\p{L}\\p{M}\\p{N}_]";
const ASCII_WORD = "\\w";

// The pattern for a query: { pattern } (a global RegExp), { pattern: null }
// for an empty query, or { error } for a regular expression that isn't one.
// ^ and $ are a line's start and end. Unicode-aware (a whole word in any
// script, an emoji one character), unless the expression is written in a way
// only the older rules read (\- and the like): then as they read it.
export function searchPattern(query, { regex = false, wholeWord = false, caseSensitive = false } = {}) {
  if (!query) return { pattern: null };
  const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = `gm${caseSensitive ? "" : "i"}`;
  // Whole word: no letter on both sides of either end (so a match that starts
  // or ends with punctuation needs nothing beside it there).
  const edge = (word) => `(?!(?<=${word})${word})`;
  const whole = (word) => (wholeWord ? `${edge(word)}(?:${source})${edge(word)}` : source);
  try {
    return { pattern: new RegExp(whole(WORD), `${flags}u`) };
  } catch {
    try {
      return { pattern: new RegExp(whole(ASCII_WORD), flags) };
    } catch (error) {
      return { error: error.message };
    }
  }
}

// After an empty match, the next character (an emoji's two halves are one).
const nextAfterEmpty = (text, at) => at + (text.codePointAt(at) > 0xffff ? 2 : 1);

// Every match of `pattern` in `text`: [{ start, end }], `limit` at most (as
// many means there may be more).
export function findMatches(text, pattern, limit = MATCH_LIMIT) {
  const out = [];
  if (!pattern || limit <= 0) return out;
  pattern.lastIndex = 0;
  let m;
  while (out.length < limit && (m = pattern.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) pattern.lastIndex = nextAfterEmpty(text, pattern.lastIndex);
  }
  pattern.lastIndex = 0;
  return out;
}

// One match replaced, the one at `start` (found again there, in its context:
// a lookbehind, ^, $1): { text, end } (end: after the replacement), or null
// when it is no longer there.
export function replaceAt(text, pattern, start, replacement, { regex = false } = {}) {
  if (!pattern) return null;
  const sticky = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}y`);
  sticky.lastIndex = start;
  const match = sticky.exec(text);
  if (!match) return null;
  sticky.lastIndex = start;
  const next = text.replace(sticky, regex ? replacement : () => replacement);
  return { text: next, end: start + match[0].length + next.length - text.length };
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
