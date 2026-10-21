// Two versions of a text that both grew from one base, put together line by
// line (a three-way merge): what each changed is kept, and where both
// changed the same lines differently the merge refuses (null), so nothing is
// put together by guesswork. For edits made offline to a cloud workspace,
// merged on reconnect with what others did meanwhile. Pure.

// Lines a and b share, in order, as matched index pairs (Myers' diff: its
// cost grows with the number of changed lines, not the length of the text).
// Past `maxEdits` changed lines it is not attempted (null).
function matchLines(a, b, maxEdits) {
  const n = a.length, m = b.length;
  const offset = n + m + 1;
  const v = new Int32Array(2 * offset + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(maxEdits, n + m); d += 1) {
    // v as it stood before this step, for k in [-d-1, d+1]: what the way back reads.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) return wayBack(trace, n, m);
    }
  }
  return null;
}

// The matched pairs, read back from the end through each step's v.
function wayBack(trace, n, m) {
  const pairs = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d -= 1) {
    const before = trace[d];
    const at = (k) => before[k + d + 1];
    const k = x - y;
    const fromK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const fromX = at(fromK), fromY = fromX - fromK;
    while (x > fromX && y > fromY) { x -= 1; y -= 1; pairs.push([x, y]); }
    x = fromX;
    y = fromY;
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; pairs.push([x, y]); }
  return pairs.reverse();
}

// What `next` changed in `base` (both arrays of lines): [{ start, end,
// lines }], the base lines [start, end) replaced by `lines`, in base order;
// null past `maxEdits` changed lines.
export function lineChanges(base, next, maxEdits = 5000) {
  // The shared start and end are no change; only the middle is compared.
  let head = 0;
  while (head < base.length && head < next.length && base[head] === next[head]) head += 1;
  let tail = 0;
  while (tail < base.length - head && tail < next.length - head && base[base.length - 1 - tail] === next[next.length - 1 - tail]) tail += 1;
  const a = base.slice(head, base.length - tail), b = next.slice(head, next.length - tail);
  const pairs = matchLines(a, b, maxEdits);
  if (!pairs) return null;
  const hunks = [];
  let i = 0, j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length]]) {
    if (pi > i || pj > j) hunks.push({ start: head + i, end: head + pi, lines: b.slice(j, pj) });
    i = pi + 1;
    j = pj + 1;
  }
  return hunks;
}

const same = (x, y) => x.start === y.start && x.end === y.end && x.lines.length === y.lines.length && x.lines.every((line, index) => line === y.lines[index]);

// ours and theirs both made from base: the text with both sets of changes,
// or null where they change the same lines differently (or either changed
// more than `maxEdits` lines: not compared).
export function mergeText(base, ours, theirs, { maxEdits = 5000 } = {}) {
  if (ours === theirs) return ours;
  if (ours === base) return theirs;
  if (theirs === base) return ours;
  const lines = (text) => text.split("\n");
  const original = lines(base);
  const mine = lineChanges(original, lines(ours), maxEdits);
  const yours = lineChanges(original, lines(theirs), maxEdits);
  if (!mine || !yours) return null;
  // Both lists in base order: take each change, refusing any two that change
  // the same lines, or where one inserts right at the other's edge (which
  // goes first is a guess), unless they are the same change.
  const all = [...mine.map((hunk) => ({ ...hunk, side: 0 })), ...yours.map((hunk) => ({ ...hunk, side: 1 }))]
    .sort((x, y) => x.start - y.start || x.end - y.end || x.side - y.side);
  const insertion = (hunk) => hunk.start === hunk.end;
  const merged = [];
  for (const hunk of all) {
    const last = merged.at(-1);
    if (last) {
      const clash = hunk.start < last.end
        || ((hunk.start === last.end || hunk.start === last.start) && (insertion(hunk) || insertion(last)));
      if (clash) {
        if (same(hunk, last)) continue;
        return null;
      }
    }
    merged.push(hunk);
  }
  const out = [];
  let at = 0;
  for (const hunk of merged) {
    out.push(...original.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  out.push(...original.slice(at));
  return out.join("\n");
}
