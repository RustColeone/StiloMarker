// Typing on its way to the server, per file: coalesced while the typist
// types (`queued`), at most one patch in flight per file (`inFlight`), and
// the files edited since the server last confirmed them (`edited`).
// Serialized on purpose: the next patch is computed only once the previous one
// is confirmed, so its offsets and its base revision always match the server's
// text (the cause of letters landing in the wrong place when typing fast).
//
// ports:
//   canQueue()        typing may be queued now (connected, not catching up)
//   canSend()         queued typing may leave now
//   revision()        the revision this tab last confirmed
//   send(op)          -> Promise (the runtime's publishOperation)
//   epoch()           a value that changes whenever the session or model is replaced
//   currentText(path) the file's text on screen now, or undefined
//   failed(path, error)  a sent patch was refused (after its typing was put back)
//   buildTextPatch(path, previous, next, baseRevision)
//   clock             { setTimeout, clearTimeout }
export function createPatchQueue(ports) {
  const queued = new Map();   // path -> { baseContent, latest, timer }
  const inFlight = new Map(); // path -> the patch sent, { ..., operationId, confirmed }
  const edited = new Set();

  function schedule(path, previousContent, nextContent) {
    if (!ports.canQueue() || previousContent === nextContent) return;
    edited.add(path);
    // One entry per file: keep the ORIGINAL base (the patch spans everything
    // typed since) and the LATEST text. The base revision is stamped when it
    // is sent, when the base is sure to equal the server's text.
    const existing = queued.get(path);
    if (existing) ports.clock.clearTimeout(existing.timer);
    const entry = { baseContent: existing ? existing.baseContent : previousContent, latest: nextContent, timer: null };
    entry.timer = ports.clock.setTimeout(() => flush(path), 250);
    queued.set(path, entry);
  }

  function flush(path) {
    const entry = queued.get(path);
    if (!entry || !ports.canSend()) return;
    if (inFlight.has(path)) {
      entry.timer = ports.clock.setTimeout(() => flush(path), 120);
      return;
    }
    queued.delete(path);
    const op = ports.buildTextPatch(path, entry.baseContent, entry.latest, ports.revision());
    if (!op) { edited.delete(path); return; }
    const sent = { ...op };
    inFlight.set(path, sent);
    const epoch = ports.epoch();
    ports.send(op).catch((error) => {
      if (epoch !== ports.epoch() || sent.confirmed) return;
      // Keep the refused typing, even if a remote change cleared the dirty flag.
      if (inFlight.get(path) === sent) inFlight.delete(path);
      const text = ports.currentText(path);
      if (text !== undefined && !queued.has(path)) queued.set(path, { baseContent: entry.baseContent, latest: text, timer: null });
      ports.failed(path, error);
    });
  }

  // A rename or move changes paths (a folder's: all of its descendants'). A
  // queued patch for the OLD path would be refused; it follows the file instead.
  // A patch already in flight left under the old path and settles by itself.
  function remap(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return;
    const moved = (key) => key === oldPath ? newPath : key.startsWith(`${oldPath}/`) ? `${newPath}${key.slice(oldPath.length)}` : null;
    for (const key of [...edited]) {
      const next = moved(key);
      if (next) { edited.delete(key); edited.add(next); }
    }
    for (const key of [...queued.keys()]) {
      const next = moved(key);
      if (!next || next === key) continue;
      const entry = queued.get(key);
      queued.delete(key);
      if (entry.timer) ports.clock.clearTimeout(entry.timer);
      entry.timer = ports.clock.setTimeout(() => flush(next), 250);
      queued.set(next, entry);
    }
  }

  // A deleted file or folder can never take a queued patch.
  function drop(path) {
    if (!path) return;
    const under = (key) => key === path || key.startsWith(`${path}/`);
    for (const key of [...edited]) if (under(key)) edited.delete(key);
    for (const key of [...queued.keys()]) {
      if (!under(key)) continue;
      ports.clock.clearTimeout(queued.get(key)?.timer);
      queued.delete(key);
    }
    for (const key of [...inFlight.keys()]) if (under(key)) inFlight.delete(key);
  }

  // The server confirmed this tab's own operation.
  function confirm(path, operationId) {
    const sent = inFlight.get(path);
    if (sent?.operationId !== operationId) return;
    sent.confirmed = true;
    inFlight.delete(path);
    if (!queued.has(path)) edited.delete(path);
  }

  return {
    schedule,
    remap,
    drop,
    confirm,
    // Stop every timer and forget queued and in-flight typing (it is safe in the
    // model; a reconnect sends the files again).
    clear() {
      queued.forEach((entry) => ports.clock.clearTimeout(entry.timer));
      queued.clear();
      inFlight.clear();
    },
    forgetEdits: () => edited.clear(),
    inFlight: (path) => inFlight.get(path),
    queued: (path) => queued.get(path),
    hasQueued: (path) => queued.has(path),
    // Typing the server has not confirmed yet.
    unconfirmed: (path) => edited.has(path) || queued.has(path) || inFlight.has(path)
  };
}
