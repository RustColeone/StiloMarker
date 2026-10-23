// JSON files: a line's highlighting (keys, strings, numbers, true / false /
// null, punctuation; a JSON string never runs over lines, so each line
// stands alone), and what the preview says of a text: valid (with the
// value, formatted) or where it is not.

const TOKEN = /("(?:[^"\\]|\\.)*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function highlightJsonLine(rawLine, { escape, blank }) {
  if (!rawLine.trim()) return blank(rawLine);
  let out = "";
  let at = 0;
  for (const match of rawLine.matchAll(TOKEN)) {
    const [whole, string, colon, number, literal] = match;
    out += escape(rawLine.slice(at, match.index));
    if (string !== undefined) {
      out += `<span class="token-json-${colon ? "key" : "string"}">${escape(string)}</span>`;
      if (colon) out += `<span class="token-json-punctuation">${escape(colon)}</span>`;
    } else if (number !== undefined) out += `<span class="token-json-number">${escape(number)}</span>`;
    else if (literal !== undefined) out += `<span class="token-json-literal">${literal}</span>`;
    else out += `<span class="token-json-punctuation">${escape(whole)}</span>`;
    at = match.index + whole.length;
  }
  return `<div class="editor-line">${out}${escape(rawLine.slice(at))}</div>`;
}

// { ok: true, value, formatted } or { ok: false, message, line, column } (1-based).
export function checkJson(text) {
  try {
    const value = JSON.parse(text);
    return { ok: true, value, formatted: JSON.stringify(value, null, 2) };
  } catch (error) {
    // Browsers word it differently and some never say where: found here instead.
    const at = errorAt(text);
    if (at === -1) return { ok: false, message: String(error?.message ?? error), line: null, column: null };
    const before = text.slice(0, at);
    const line = before.split("\n").length;
    const column = at - before.lastIndexOf("\n");
    return { ok: false, message: at >= text.length ? "the text ends too soon" : `unexpected “${text[at]}”`, line, column };
  }
}

// Where a text stops being JSON: the offset of the first character that
// can't be there (its length when it ends too soon). The containers open at a
// point are a list, not calls, so no nesting is too deep to find it.
class Stop {
  constructor(at) { this.at = at; }
}
const LITERAL = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

export function errorAt(text) {
  let i = 0;
  const space = () => { while (i < text.length && " \t\n\r".includes(text[i])) i += 1; };
  const stop = () => { throw new Stop(i); };
  const expect = (char) => { space(); if (text[i] !== char) stop(); i += 1; };
  function string() {
    i += 1;
    while (text[i] !== '"') {
      if (i >= text.length || text[i] < " ") stop();
      if (text[i] === "\\") {
        i += 1;
        if (text[i] === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) stop(); i += 4; }
        else if (!'"\\/bfnrt'.includes(text[i] ?? "x")) stop();
      }
      i += 1;
    }
    i += 1;
  }
  const key = () => { space(); if (text[i] !== '"') stop(); string(); expect(":"); };
  const open = []; // "{" or "[", outermost first
  try {
    for (;;) {
      // A value.
      space();
      const char = text[i];
      if (char === "{" || char === "[") {
        i += 1;
        space();
        if (text[i] === (char === "{" ? "}" : "]")) i += 1; // empty: a whole value
        else {
          open.push(char);
          if (char === "{") key();
          continue;
        }
      } else if (char === '"') string();
      else {
        LITERAL.lastIndex = i;
        const match = LITERAL.exec(text);
        if (!match) stop();
        i += match[0].length;
      }
      // After a value: the next one in its container, or the container closed (a value itself).
      for (;;) {
        space();
        if (!open.length) {
          if (i < text.length) stop();
          return -1;
        }
        const container = open[open.length - 1];
        if (text[i] === ",") { i += 1; if (container === "{") key(); break; }
        if (text[i] === (container === "{" ? "}" : "]")) { i += 1; open.pop(); continue; }
        stop();
      }
    }
  } catch (error) {
    if (error instanceof Stop) return error.at;
    throw error;
  }
}

// What a value is, in a few words: "an object with 3 keys", "a list of 20,000 items".
export function describeJson(value) {
  const count = (n, word) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
  if (Array.isArray(value)) return `a list of ${count(value.length, "item")}`;
  if (value && typeof value === "object") return `an object with ${count(Object.keys(value).length, "key")}`;
  return value === null ? "null" : `a ${typeof value}`;
}
