import test from "node:test";
import assert from "node:assert";

// Mirror of collaboration-service buildPatchOp's char-level diff (common
// prefix/suffix) and a direct server apply. With the serialized one-in-flight
// model, every patch's base equals the server's current content and its
// baseRevision matches, so the server applies each op DIRECTLY (no rebase) and
// the content must reconstruct exactly — including edits in the middle of the
// document. This guards the diff + the serialization invariant against
// regressions that would land characters in the wrong place.
function diffPatch(prev, next) {
  if (prev === next) return null;
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start += 1;
  let prevEnd = prev.length;
  let nextEnd = next.length;
  while (prevEnd > start && nextEnd > start && prev[prevEnd - 1] === next[nextEnd - 1]) {
    prevEnd -= 1;
    nextEnd -= 1;
  }
  return { start, end: prevEnd, text: next.slice(start, nextEnd) };
}

function applyPatch(content, op) {
  return content.slice(0, op.start) + op.text + content.slice(op.end);
}

test("serialized patches reconstruct the final content (append, middle edit, delete)", () => {
  let server = "The quick brown fox";
  const localStates = [
    "The quick brown fox jumps",                 // append
    "The quick brown fox jumps over",            // append
    "The quick red fox jumps over",              // middle edit (brown -> red)
    "The quick red fox over",                    // middle delete (jumps )
    "The quick red fox over the lazy dog",       // append
    "The quick red fox over the lazy dog 大纲",   // unicode append (user types CJK)
  ];
  let base = server; // serialized: base == server's current content each send
  for (const next of localStates) {
    const op = diffPatch(base, next);
    if (op) {
      server = applyPatch(server, op);
      base = server;
    }
  }
  assert.strictEqual(server, localStates[localStates.length - 1]);
});

// Exact copy of collaboration-service's transformOffset (the client OT diamond
// core): rebase an offset past an already-applied op [appliedStart, appliedEnd)
// that inserted `insertedLength` chars.
function transformOffset(offset, appliedStart, appliedEnd, insertedLength) {
  const removedLength = appliedEnd - appliedStart;
  if (offset <= appliedStart) return offset;
  if (offset <= appliedEnd) return appliedStart + insertedLength;
  return offset + insertedLength - removedLength;
}

// Apply a remote op (in server coords) to a local model that already has our own
// op `local` applied, by transforming the remote op through `local` — mirroring
// the client's SSE diamond. Returns the new model, which must equal the server's
// converged content (our op then the remote op, in either order).
function applyRemoteThroughLocal(model, local, remote) {
  const start = transformOffset(remote.start, local.start, local.end, local.text.length);
  const end = transformOffset(remote.end, local.start, local.end, local.text.length);
  return model.slice(0, start) + remote.text + model.slice(end);
}

test("client diamond converges with the server (insert vs insert, different regions)", () => {
  const s0 = "0123456789";
  const opA = { start: 2, end: 2, text: "AAA" };            // our in-flight op
  const model = s0.slice(0, opA.start) + opA.text + s0.slice(opA.end); // "01AAA23456789"
  const opB = { start: 8, end: 8, text: "BBB" };            // remote op (server coords)
  const merged = applyRemoteThroughLocal(model, opA, opB);
  // Same convergence the server produces (validated in the Python selftest).
  assert.strictEqual(merged, "01AAA234567BBB89");
});

test("client diamond converges (remote delete overlapping region past our insert)", () => {
  const s0 = "hello world";
  const opA = { start: 5, end: 5, text: " brave" };         // "hello brave world"
  const model = s0.slice(0, 5) + opA.text + s0.slice(5);
  const opB = { start: 6, end: 11, text: "" };              // remote deletes "world" (server coords)
  const merged = applyRemoteThroughLocal(model, opA, opB);
  // opB.start 6 > appliedEnd 5 → 6+6=12; opB.end 11 → 11+6=17. Delete [12,17) of
  // "hello brave world" removes "world" → "hello brave ".
  assert.strictEqual(merged, "hello brave ");
});

test("diff of a full-document replacement (Ctrl+A + paste) replaces everything", () => {
  const before = "line one\nline two\nline three";
  const after = "completely different content";
  const op = diffPatch(before, after);
  assert.strictEqual(applyPatch(before, op), after);
  // The op must cover the whole document, not insert at the top.
  assert.strictEqual(op.start, 0);
  assert.strictEqual(op.end, before.length);
});
