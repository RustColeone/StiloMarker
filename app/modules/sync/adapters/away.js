// What this tab does while away from a cloud workspace (offline, or
// reconnecting), kept for when it is back (service/offline-merge.js puts it
// together with what others did): each edited file's base (its text when the
// server last had all of it, noted at its first unconfirmed edit, dropped
// once the server has it again) and the structural changes made meanwhile,
// in order. Kept in localStorage per shared workspace's copy while away (so
// a reload keeps it); while connected only in memory, for the moment between
// an edit and its confirmation.
//
//   createAway({ key, live, log })  key(): the shared copy's key (null: none);
//     live(): connected and not reconnecting
//   edited(path, previous)   a file's text changed here (its base, if none)
//   confirmed(path)          the server has a file's text again
//   moved(from, to)          a file or folder's path changed (bases follow)
//   recordOp(op, had?)       a structural change made away (a deleted file's text then)
//   snapshot() -> { bases: Map, ops: [] }
//   clear()                  all of it taken care of (the server's copy opened)
//   keep()                   written down now (the session stopped being live, the page goes)
import { ignore } from "../../../kernel/index.js";

const PREFIX = "mdnotes.away.v1:";

export function createAway({ key, live, log = () => {}, store = globalThis.localStorage }) {
  let current = null; // { key, bases: Map, ops: [] }

  function read(name) {
    try {
      const data = JSON.parse(store?.getItem(PREFIX + name) ?? "null");
      return { key: name, bases: new Map(Object.entries(data?.bases ?? {})), ops: Array.isArray(data?.ops) ? data.ops : [] };
    } catch (error) {
      ignore(error, "an unreadable away log is started afresh");
      return { key: name, bases: new Map(), ops: [] };
    }
  }

  // The log of the shared copy on screen now (another copy's stays where it is).
  function active() {
    const name = key();
    if (!name) return null;
    if (current?.key !== name) current = read(name);
    return current;
  }

  function keep() {
    if (!current || !store) return;
    try {
      if (!current.bases.size && !current.ops.length) { store.removeItem(PREFIX + current.key); return; }
      store.setItem(PREFIX + current.key, JSON.stringify({ bases: Object.fromEntries(current.bases), ops: current.ops }));
    } catch (error) {
      // Too large for localStorage: the merge then keeps those files in Snapshots.
      log(`What was done away could not be kept for the reconnect: ${error.message}`);
    }
  }
  const keepIfAway = () => { if (!live()) keep(); };

  return Object.freeze({
    edited(path, previous) {
      const away = active();
      if (!away || away.bases.has(path)) return;
      away.bases.set(path, previous);
      keepIfAway();
    },
    confirmed(path) {
      const away = active();
      if (!away?.bases.delete(path)) return;
      keepIfAway();
    },
    moved(from, to) {
      const away = active();
      if (!away || !from || from === to) return;
      for (const [path, text] of [...away.bases]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        away.bases.delete(path);
        away.bases.set(to + path.slice(from.length), text);
      }
      keepIfAway();
    },
    recordOp(op, had) {
      const away = active();
      if (!away) return;
      away.ops.push(had === undefined ? op : { ...op, had });
      keep();
    },
    snapshot() {
      const away = active();
      return { bases: new Map(away?.bases ?? []), ops: [...(away?.ops ?? [])] };
    },
    clear() {
      const away = active();
      if (!away) return;
      away.bases.clear();
      away.ops = [];
      keep();
    },
    keep
  });
}
