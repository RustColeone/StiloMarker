// Keeping concurrent edits apart where they are put in order: a text patch
// made against an older revision is moved over the patches applied since,
// and a write based on a revision older than the last change to its path is
// refused. The browser's twin of the server's RebaseLog
// (server/stilo/modules/sync/model/rebase.py), for the windows of one browser
// that share a workspace (one of them puts their edits in order:
// service/broker.js). Pure, in memory: anything based on a revision older
// than the log (`floor`) must reload. Its refusals carry status 409.
import { transformTextPatch } from "./rebase.js";

const LOG_SIZE = 2000;

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

export function createRebaseLog({ floor: start = 0, size = LOG_SIZE } = {}) {
  let entries = [];               // applied text patches, oldest first: { revision, path, start, end, text }
  const changedAt = new Map();    // path -> the revision it last changed
  const replacedAt = new Map();   // path -> the revision it was last replaced, moved or renamed
  let floor = start;              // anything older than this predates the log

  const since = (changes, path) => {
    let latest = floor;
    for (const [changed, revision] of changes) {
      if (path === changed || path.startsWith(`${changed}/`)) latest = Math.max(latest, revision);
    }
    return latest;
  };

  return {
    // The whole tree changed (a replace): everything older must reload.
    reset(revision) {
      entries = [];
      changedAt.clear();
      replacedAt.clear();
      floor = revision;
    },
    lastChange: (path) => since(changedAt, path),
    // The paths a change applied at `revision` touched. Anything but a text
    // patch is a barrier: a patch made before it cannot rebase across it.
    note(paths, revision, textOnly) {
      for (const path of paths) {
        if (!path) continue;
        changedAt.set(path, revision);
        if (!textOnly) replacedAt.set(path, revision);
      }
    },
    record(revision, path, startAt, end, text) {
      entries.push({ revision, path, start: startAt, end, text });
      if (entries.length > size) entries = entries.slice(-size);
    },
    // A patch to `path` made at revision `base`, moved to the current text.
    rebase(path, startAt, end, base, revision) {
      if (base >= revision) return { start: startAt, end };
      const oldest = entries[0]?.revision;
      if (oldest === undefined || base < oldest - 1) {
        throw conflict(`patch conflict on "${path}": base revision ${base} is too far behind revision ${revision} to rebase safely — reload to continue`);
      }
      if (base < since(replacedAt, path)) throw conflict("patch conflict: file was replaced or its path changed — reload to continue");
      let range = { start: startAt, end };
      for (const entry of entries) {
        if (entry.revision <= base || entry.path !== path) continue;
        try {
          range = transformTextPatch(range, entry);
        } catch (error) {
          throw conflict(`patch conflict: ${error.message}`);
        }
      }
      return { start: range.start, end: range.end };
    }
  };
}
