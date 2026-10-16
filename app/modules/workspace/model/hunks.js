// Turning "this text should become that text" into small, placeable changes.
// Pure: strings in, offsets out (UTF-16 offsets, as the editor and the
// server's text patches use).
//
// A hunk replaces before.slice(start, end) with `text`.

// Line-level diff of two texts (Myers' O(ND) algorithm on lines, after
// trimming the lines both share at the start and end). Returns hunks in
// increasing order, offsets into `before`.
export function diffHunks(before, after) {
  if (before === after) return [];
  const a = splitLines(before);
  const b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const ops = myers(a.slice(head, a.length - tail), b.slice(head, b.length - tail));

  // Walk the edit script, merging consecutive changed lines into one hunk.
  const offsets = lineOffsets(a);
  const hunks = [];
  let ai = head;
  let bi = head;
  let open = null;
  const close = () => {
    if (!open) return;
    hunks.push({ start: offsets[open.a], end: offsets[ai], text: b.slice(open.b, bi).join("") });
    open = null;
  };
  for (const op of ops) {
    if (op === "=") { close(); ai += 1; bi += 1; continue; }
    open ??= { a: ai, b: bi };
    if (op === "-") ai += 1; else bi += 1;
  }
  close();
  return hunks;
}

// Where each hunk belongs in `current`, a later version of `before`. Each
// hunk's old text, with up to two lines of context either side, must occur
// exactly once; otherwise the edit cannot be placed safely and this returns
// null (the write is stale). Hunks keep their order and never overlap.
export function placeHunks(hunks, before, current) {
  if (current === before) return hunks.map((h) => ({ ...h }));
  const placed = [];
  let floor = 0;
  for (const hunk of hunks) {
    const lead = contextBefore(before, hunk.start);
    const trail = contextAfter(before, hunk.end);
    const needle = lead + before.slice(hunk.start, hunk.end) + trail;
    if (!needle) {
      if (current !== "") return null; // a whole-file insert only fits an empty file
      placed.push({ start: 0, end: 0, text: hunk.text });
      continue;
    }
    const at = current.indexOf(needle);
    if (at < 0 || current.indexOf(needle, at + 1) >= 0) return null;
    const start = at + lead.length;
    if (start < floor) return null;
    const end = start + (hunk.end - hunk.start);
    placed.push({ start, end, text: hunk.text });
    floor = end;
  }
  return placed;
}

export function applyHunks(text, hunks) {
  let out = text;
  for (const hunk of [...hunks].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, hunk.start) + hunk.text + out.slice(hunk.end);
  }
  return out;
}

// ---- helpers -------------------------------------------------------------

// Lines keep their "\n", so joining them gives the text back exactly.
function splitLines(text) {
  if (!text) return [];
  const lines = text.split(/(?<=\n)/);
  return lines;
}

function lineOffsets(lines) {
  const out = [0];
  for (const line of lines) out.push(out[out.length - 1] + line.length);
  return out;
}

function contextBefore(text, offset) {
  let start = offset;
  for (let lines = 0; lines < 2 && start > 0; lines += 1) {
    start = text.lastIndexOf("\n", start - 2) + 1;
  }
  return text.slice(start, offset);
}

function contextAfter(text, offset) {
  let end = offset;
  for (let lines = 0; lines < 2 && end < text.length; lines += 1) {
    const next = text.indexOf("\n", end);
    end = next < 0 ? text.length : next + 1;
  }
  return text.slice(offset, end);
}

// Myers' diff: the shortest edit script from a to b as "=", "-", "+".
function myers(a, b) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Map([[1, 0]]);
  const trace = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? v.get(k + 1) ?? 0 : (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v.set(k, x);
      if (x >= n && y >= m) return backtrack(trace, a, b, d);
    }
  }
  return [];
}

function backtrack(trace, a, b, depth) {
  const ops = [];
  let x = a.length, y = b.length;
  for (let d = depth; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1)) ? k + 1 : k - 1;
    const prevX = v.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push("="); x -= 1; y -= 1; }
    ops.push(x === prevX ? "+" : "-");
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push("="); x -= 1; y -= 1; }
  return ops.reverse();
}
