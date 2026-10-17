// Keeping concurrent typing apart in the browser: a patch moved over one
// applied before it, and an incoming patch moved over this tab's own unsent
// and unconfirmed typing. Pure. transformTextPatch has a twin on the server
// (server/stilo/modules/sync/model/rebase.py: transform_range); both run
// spec/sync/rebase.cases.json.

// `op` moved over `applied`. With insertAfter, an insert at the same point as
// `applied` goes after it (the server orders a later insert first at a tie).
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

// An incoming patch placed over this tab's own typing. `pending` is the patch
// sent and not yet confirmed (changed in place to sit after the incoming one);
// `queued` ({ baseContent, latest }) is typing not sent yet (changed in place
// too). Returns the incoming patch as it applies to the text on screen.
// Throws when they overlap and cannot be placed safely.
export function rebaseIncoming(remote, pending, queued, { buildTextPatch, applyTextPatch }) {
  let incoming = remote;
  if (pending) {
    incoming = transformTextPatch(remote, pending, true);
    Object.assign(pending, transformTextPatch(pending, remote));
  }
  if (queued) {
    const unsent = buildTextPatch(remote.path, queued.baseContent, queued.latest);
    const before = incoming;
    if (unsent) incoming = transformTextPatch(before, unsent, true);
    queued.baseContent = applyTextPatch(queued.baseContent, before);
    queued.latest = applyTextPatch(queued.latest, incoming);
  }
  return incoming;
}
