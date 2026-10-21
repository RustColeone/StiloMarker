// This browser's copies of workspaces, one per workspace (IndexedDB
// "mdnotes-workspaces"): an in-browser workspace's only storage, and a crash
// net for the others. Each is named by a key: "local:<project id>" for this
// browser's own workspaces, "shared:<where>" for a shared one's content (Sync
// names it). A copy is a record for the project (its nodes' ids, when it was
// saved) and one per node; a save writes only the nodes that changed since
// this page's last save of that copy (all of them when the copy is new to the
// page or gone), and throws when it can't (the caller says so). A pointer (in
// localStorage) names the copy the next page load opens and the last own
// workspace, which leaving a shared one brings back. As the page goes, what
// changed since the last save is written to localStorage at once
// (keepJournal, one per copy, and the pointer with it: an IndexedDB write
// begun as a tab closes may never land, a localStorage one does); the next
// load of that copy applies it. Moved over once from where v0.2.19 kept its
// single copy (IndexedDB "mdnotes-workspace") and from before that
// (localStorage).
import { deserializeProject } from "../model/project.js";
import { ignore, ignored } from "../../../kernel/index.js";

const DB_NAME = "mdnotes-workspaces";
const COPIES = "copies", NODES = "nodes";
const POINTER = "mdnotes.copies.v1"; // { open: the copy the next load opens, own: the last own workspace }
const OLD_DB = "mdnotes-workspace";          // v0.2.19: one copy, store "copy"
const LEGACY_KEY = "mdnotes.project.v1";      // before v0.2.19: localStorage
const OLD_JOURNAL = "mdnotes.journal.v1";     // v0.2.19's journal, of its one copy
const JOURNAL = "mdnotes.journal.v2:";        // + a copy's key
const MAX_COPIES = 16;                        // beyond it, the oldest not saved for a day go
const DAY = 24 * 60 * 60 * 1000;

const localKey = (project) => `local:${project?.id ?? "workspace"}`;
const isLocalKey = (key) => typeof key === "string" && key.startsWith("local:");
const nodesOf = (key) => IDBKeyRange.bound([key], [key, []]); // every [key, node id]

// ---- The database.
const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const finished = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error ?? new Error("the browser refused the write"));
  tx.onabort = () => reject(tx.error ?? new Error("the browser refused the write (its storage may be full)"));
});

// Opened once per page. A database found without its stores (made empty by
// something else) is opened again one version up, which adds them.
let opening = null;
function openDatabase() {
  const open = (version) => new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [COPIES, NODES]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (![COPIES, NODES].every((name) => db.objectStoreNames.contains(name))) {
        db.close();
        open(db.version + 1).then(resolve, reject);
        return;
      }
      // A newer version of the app wants the database: let it, and open again next time.
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB would not open"));
  });
  opening ??= (globalThis.indexedDB ? open(undefined) : Promise.reject(new Error("this browser keeps no IndexedDB")))
    .catch((error) => { opening = null; throw error; });
  return opening;
}

// ---- Copies as stored.
// The project without its nodes (and without its folder handles, which are
// re-acquired at run time and can't be stored).
function metaOf(project, key, savedAt) {
  const { nodes, handles, ...rest } = project;
  return { ...rest, nodeIds: Object.keys(nodes), savedAt, key };
}

// A node as last written (its own copy: a later edit can't change it under us).
const copyOf = (node) => ({ ...node, ...(Array.isArray(node.children) ? { children: node.children.slice() } : {}) });

function sameNode(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = a[key], y = b[key];
    if (x === y) continue;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((value, index) => value === y[index])) continue;
    if (x && y && typeof x === "object" && typeof y === "object" && JSON.stringify(x) === JSON.stringify(y)) continue;
    return false;
  }
  return true;
}

// A copy put together from its records (nodes missing from it, a copy cut
// short, are left out: repair drops what names them).
function assemble(meta, records) {
  const ids = new Set(meta.nodeIds), nodes = {};
  for (const node of records) if (node && ids.has(node.id)) nodes[node.id] = node;
  const { nodeIds, key, ...rest } = meta;
  return { ...rest, nodes };
}

// A copy that opens: its root there, children naming nodes it has, the file
// it shows one of its files (else none). Null when it has no root.
function repair(project) {
  if (!project?.nodes?.[project.rootId]) return null;
  for (const node of Object.values(project.nodes)) {
    if (Array.isArray(node.children) && node.children.some((id) => !project.nodes[id])) node.children = node.children.filter((id) => project.nodes[id]);
  }
  if (project.activeFileId && project.nodes[project.activeFileId]?.kind !== "file") project.activeFileId = null;
  return project;
}

async function readCopy(db, key) {
  const tx = db.transaction([COPIES, NODES], "readonly");
  const [meta, records] = await Promise.all([done(tx.objectStore(COPIES).get(key)), done(tx.objectStore(NODES).getAll(nodesOf(key)))]);
  return meta ? assemble(meta, records) : null;
}

function readPointer() {
  try { return JSON.parse(globalThis.localStorage?.getItem(POINTER) ?? "null") ?? {}; } catch (error) { ignore(error, "an unreadable pointer names no copy"); return {}; }
}

// ---- Saving. What this page last wrote, to write only what changed since
// (the nodes, and the project's own fields: the file it shows, its name...).
let written = { key: null, nodes: new Map(), meta: "" };
const metaText = (project, key) => JSON.stringify(metaOf(project, key, 0));
// The copy this page last named in the pointer (the one it opened, or switched to).
let pointed = null;

// This page switched copies: the next load opens this one (and leaving a
// shared one comes back to it, when it is this browser's own). Named once it
// is stored, or journaled.
function point(key) {
  if (pointed === key) return;
  try {
    globalThis.localStorage?.setItem(POINTER, JSON.stringify({ ...readPointer(), open: key, ...(isLocalKey(key) ? { own: key } : {}) }));
    pointed = key;
  } catch (error) {
    ignore(error, "the pointer could not be written: the next load opens the copy named before");
  }
}

function changesOf(project, key) {
  const whole = written.key !== key;
  const changed = Object.entries(project.nodes).filter(([id, node]) => whole || !sameNode(written.nodes.get(id), node));
  const removed = whole ? [] : [...written.nodes.keys()].filter((id) => !(id in project.nodes));
  return { whole, changed, removed, meta: metaText(project, key) };
}

// Saves are one at a time, in order (a later one compares against the earlier).
let queue = Promise.resolve();
// When things happened, in order: a journal written, a save asked for. A
// save asked for after the journal holds all of it: once written, the
// journal goes (left, it would bring older text back after a crash).
let moments = 0;
const journaled = new Map(); // copy key -> the moment its journal was written

async function write(project, key, moment) {
  // Not a browser (Node, a test): there is nowhere to keep a copy, which is no failure.
  if (!globalThis.indexedDB && !globalThis.localStorage) return { nodes: 0 };
  const db = await openDatabase();
  let { whole, changed, removed, meta } = changesOf(project, key);
  const tx = db.transaction([COPIES, NODES], "readwrite");
  const copies = tx.objectStore(COPIES), nodes = tx.objectStore(NODES);
  const saving = finished(tx);
  saving.catch(ignored("a refused write is reported below, or by the read that failed first"));
  // The copy may be gone (emptied, or let go of elsewhere): then all of it is written again.
  const stored = whole ? null : await done(copies.get(key));
  if (!whole && !stored) ({ whole, changed, removed } = { whole: true, changed: Object.entries(project.nodes), removed: [] });
  if (whole) nodes.delete(nodesOf(key));
  copies.put(metaOf(project, key, Date.now()), key);
  for (const [id, node] of changed) nodes.put(node, [key, id]);
  for (const id of removed) nodes.delete([key, id]);
  await saving;
  point(key);
  if (whole) written = { key, nodes: new Map(), meta: "" };
  for (const [id, node] of changed) written.nodes.set(id, copyOf(node));
  for (const id of removed) written.nodes.delete(id);
  written.meta = meta;
  if (journaled.has(key) && journaled.get(key) < moment) {
    journaled.delete(key);
    try { globalThis.localStorage?.removeItem(JOURNAL + key); } catch (error) { ignore(error, "the journal stays; the next load applies what it holds"); }
  }
  return { nodes: changed.length };
}

// Resolves once written; rejects with the reason when it couldn't be.
function saveProject(project, key = localKey(project)) {
  const moment = ++moments;
  const next = queue.then(() => write(project, key, moment));
  queue = next.catch((error) => ignore(error, "a failed save is reported by its caller; the next one tries again"));
  return next;
}

// As the page goes: what changed since the last save, written to localStorage
// at once. Throws when even that can't be written (storage full).
function keepJournal(project, key = localKey(project)) {
  const store = globalThis.localStorage;
  if (!store || !project) return;
  const { whole, changed, removed, meta } = changesOf(project, key);
  if (!whole && !changed.length && !removed.length && meta === written.meta) { store.removeItem(JOURNAL + key); journaled.delete(key); point(key); return; }
  store.setItem(JOURNAL + key, JSON.stringify({ meta: metaOf(project, key, Date.now()), whole, nodes: Object.fromEntries(changed), removed }));
  journaled.set(key, ++moments);
  point(key);
}

// A journal laid over the stored copy (or, if it holds the whole project, instead of it).
function withJournal(project, name) {
  let journal = null;
  try { journal = JSON.parse(globalThis.localStorage?.getItem(name) ?? "null"); } catch (error) { ignore(error, "an unreadable journal is dropped"); }
  if (!journal?.meta) return { project, used: false };
  const base = journal.whole || project?.id !== journal.meta.id ? {} : project.nodes;
  const nodes = {};
  for (const id of journal.meta.nodeIds) {
    const node = journal.nodes[id] ?? base[id];
    if (!node) return { project, used: false }; // incomplete: the stored copy stands
    nodes[id] = node;
  }
  const { nodeIds, key, ...rest } = journal.meta;
  return { project: { ...rest, nodes }, used: true };
}

// ---- Moving over what older versions kept: v0.2.19's database, else localStorage.
function readOldDatabase() {
  return new Promise((resolve) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const request = globalThis.indexedDB.open(OLD_DB);
    // It didn't exist: don't make it.
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => resolve(null);
    request.onsuccess = async () => {
      const db = request.result;
      try {
        if (!db.objectStoreNames.contains("copy")) { resolve(null); return; }
        const store = db.transaction("copy", "readonly").objectStore("copy");
        const meta = await done(store.get("project"));
        if (!meta) { resolve(null); return; }
        const records = await Promise.all(meta.nodeIds.map((id) => done(store.get(`node:${id}`))));
        resolve(assemble({ ...meta, key: null }, records));
      } catch (error) {
        ignore(error, "v0.2.19's copy could not be read; none is moved over");
        resolve(null);
      } finally {
        db.close();
      }
    };
  });
}

async function readOlderCopy() {
  let project = await readOldDatabase();
  if (project) return { project, from: "database" };
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_KEY);
    if (raw) project = deserializeProject(raw);
  } catch (error) {
    ignore(error, "an unreadable old copy is left where it is");
  }
  return project ? { project, from: "localStorage" } : null;
}

function forgetOlderCopies(from) {
  try {
    if (from === "database") globalThis.indexedDB?.deleteDatabase(OLD_DB);
    globalThis.localStorage?.removeItem(LEGACY_KEY);
    globalThis.localStorage?.removeItem(OLD_JOURNAL);
  } catch (error) {
    ignore(error, "an old copy left behind is never read again");
  }
}

// ---- Letting go of copies: those from before the app was cleared, and the
// oldest beyond MAX_COPIES (never the pointer's, nor one saved in the last day).
async function prune(db, { clearedAt, keep }) {
  const tx = db.transaction([COPIES, NODES], "readwrite");
  const copies = tx.objectStore(COPIES);
  const [keys, metas] = await Promise.all([done(copies.getAllKeys()), done(copies.getAll())]);
  const saved = keys.map((key, index) => ({ key, savedAt: metas[index]?.savedAt ?? 0 })).sort((a, b) => b.savedAt - a.savedAt);
  const now = Date.now();
  const gone = saved.filter(({ key, savedAt }, index) => !keep.includes(key)
    && ((clearedAt && savedAt < clearedAt) || (index >= MAX_COPIES && now - savedAt > DAY)));
  for (const { key } of gone) {
    copies.delete(key);
    tx.objectStore(NODES).delete(nodesOf(key));
  }
  await finished(tx);
  return gone.length;
}

// ---- Loading.
// The copy this page opens (null: none, or the app was cleared since it was
// saved: clearedAt, Shell's): the one named (key), else the pointer's. On a
// first start after v0.2.19, what it kept is moved over, as this browser's
// own workspace — or, when it was a shared workspace's content (wasShared),
// under "shared:legacy". A copy's journal is applied, and removed once the
// copy is written. Returns { project, key } or null.
async function loadProject({ clearedAt = 0, key: wanted = null, wasShared = false } = {}) {
  let db = null;
  const pointer = readPointer();
  try {
    db = await openDatabase();
  } catch (error) {
    ignore(error, "IndexedDB is not available: an older copy, or none, is used");
  }
  let key = wanted ?? pointer.open ?? null;
  let project = null, older = null;
  if (db && key) {
    try { project = await readCopy(db, key); } catch (error) { ignore(error, "the stored copy could not be read"); }
    if (project && clearedAt && (project.savedAt ?? 0) < clearedAt) project = null;
    // What is stored: the next save writes only what changes from it.
    if (project) written = { key, nodes: new Map(Object.entries(project.nodes).map(([id, node]) => [id, copyOf(node)])), meta: metaText(project, key) };
  }
  if (!project && !wanted && !pointer.open) {
    older = await readOlderCopy();
    if (older) {
      project = older.project;
      key = wasShared ? "shared:legacy" : localKey(project);
    }
  }
  if (!key) return null;
  const journals = [JOURNAL + key, ...(older ? [OLD_JOURNAL] : [])];
  let journaled = false;
  for (const name of journals) {
    const result = withJournal(project, name);
    project = result.project;
    journaled ||= result.used;
  }
  if (db) await prune(db, { clearedAt, keep: [key, pointer.open, pointer.own] }).catch(ignored("letting go of old copies failed"));
  project = repair(project);
  if (!project) return null;
  delete project.savedAt;
  // An OS-picked "filesystem" directory can't be reopened without a fresh user
  // gesture, so it downgrades to an in-browser copy. An "opfs" project keeps its
  // mode: its directory is re-attachable on boot without any permission prompt.
  if (project.sourceMode === "filesystem") project.sourceMode = "memory";
  // This page opened the copy the pointer names: only a switch to another moves it.
  // (A copy moved over from an older version is named by its first save.)
  if (pointer.open === key) pointed = key;
  if (older || journaled) {
    try {
      await saveProject(project, key);
      if (older) forgetOlderCopies(older.from);
      for (const name of journals) globalThis.localStorage?.removeItem(name);
    } catch (error) {
      ignore(error, "writing the copy failed; the older copy and the journal stay for the next load");
    }
  }
  return { project, key };
}

// Another copy, as stored (leaving a shared workspace for this browser's own): null if none.
async function loadCopy(key) {
  if (!key) return null;
  try {
    const db = await openDatabase();
    const project = await readCopy(db, key);
    if (!project) return null;
    delete project.savedAt;
    if (project.sourceMode === "filesystem") project.sourceMode = "memory";
    return repair(withJournal(project, JOURNAL + key).project);
  } catch (error) {
    ignore(error, "the copy could not be read");
    return null;
  }
}

// The last own (in-browser) workspace's key, or null.
async function ownKey() {
  return readPointer().own ?? null;
}

// This page takes over a copy another window wrote (it kept the workspace
// and went): its journal is older than what this page holds, and the next
// save writes all of the copy.
function takeOver(key) {
  try { globalThis.localStorage?.removeItem(JOURNAL + key); } catch (error) { ignore(error, "the journal stays; this page writes over it"); }
  written = { key: null, nodes: new Map(), meta: "" };
}

// Every copy let go of (Empty Everything; the pointer and journals went with
// the app's other keys): the next save starts afresh.
async function clearCopies() {
  globalThis.localStorage?.removeItem(POINTER);
  written = { key: null, nodes: new Map(), meta: "" };
  pointed = null;
  if (!globalThis.indexedDB) return;
  const db = await openDatabase();
  const tx = db.transaction([COPIES, NODES], "readwrite");
  for (const name of [COPIES, NODES]) tx.objectStore(name).clear();
  await finished(tx);
}

export { clearCopies, isLocalKey, keepJournal, loadCopy, loadProject, localKey, ownKey, saveProject, takeOver };
