// The project's copy in this browser: the in-browser workspace's only storage,
// and a crash net for the others. It lives in IndexedDB ("mdnotes-workspace":
// a record for the project and one per node), which has no ~5 MB ceiling; it
// was in localStorage before v0.2.19 and is moved over once. A save writes
// only the nodes that changed since the last one, and throws when it can't
// (the caller says so). As the page goes, what changed since the last save is
// also written to localStorage at once (keepJournal: an IndexedDB write begun
// as a tab closes may never land, a localStorage one does); the next load
// applies it.
import { deserializeProject } from "../model/project.js";
import { ignore } from "../../../kernel/index.js";

const DB_NAME = "mdnotes-workspace";
const STORE = "copy";
const META = "project"; // the project without its nodes: which nodes it has, when it was saved
const LEGACY_KEY = "mdnotes.project.v1";
const JOURNAL_KEY = "mdnotes.journal.v1";
const nodeKey = (id) => `node:${id}`;

let opening = null;
function openDatabase() {
  opening ??= new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("this browser keeps no IndexedDB")); return; }
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB would not open"));
  }).catch((error) => { opening = null; throw error; });
  return opening;
}

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// The project without its nodes (and without its folder handles, which are
// re-acquired at run time and can't be stored).
function metaOf(project, savedAt) {
  const { nodes, handles, ...rest } = project;
  return { ...rest, nodeIds: Object.keys(nodes), savedAt };
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

// What was last written: the project's id and its nodes, to write only what changed since.
let written = { projectId: null, nodes: new Map() };

function changesOf(project) {
  const whole = written.projectId !== project.id;
  const changed = Object.entries(project.nodes).filter(([id, node]) => whole || !sameNode(written.nodes.get(id), node));
  const removed = whole ? [] : [...written.nodes.keys()].filter((id) => !(id in project.nodes));
  return { whole, changed, removed };
}

// Saves are one at a time, in order (a later one compares against the earlier).
let queue = Promise.resolve();

async function write(project) {
  // Not a browser (Node, a test): there is nowhere to keep a copy, which is no failure.
  if (!globalThis.indexedDB && !globalThis.localStorage) return { nodes: 0 };
  const db = await openDatabase();
  const { whole, changed, removed } = changesOf(project);
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  if (whole) store.clear();
  store.put(metaOf(project, Date.now()), META);
  for (const [id, node] of changed) store.put(node, nodeKey(id));
  for (const id of removed) store.delete(nodeKey(id));
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error ?? new Error("the browser refused the write"));
    tx.onabort = () => reject(tx.error ?? new Error("the browser refused the write (its storage may be full)"));
  });
  if (whole) written = { projectId: project.id, nodes: new Map() };
  for (const [id, node] of changed) written.nodes.set(id, copyOf(node));
  for (const id of removed) written.nodes.delete(id);
  return { nodes: changed.length };
}

// Resolves once written; rejects with the reason when it couldn't be.
function saveProject(project) {
  const next = queue.then(() => write(project));
  queue = next.catch((error) => ignore(error, "a failed save is reported by its caller; the next one tries again"));
  return next;
}

// As the page goes: what changed since the last save, written to localStorage
// at once. Throws when even that can't be written (storage full).
function keepJournal(project) {
  const store = globalThis.localStorage;
  if (!store || !project) return;
  const { whole, changed, removed } = changesOf(project);
  if (!whole && !changed.length && !removed.length) { store.removeItem(JOURNAL_KEY); return; }
  store.setItem(JOURNAL_KEY, JSON.stringify({ meta: metaOf(project, Date.now()), whole, nodes: Object.fromEntries(changed), removed }));
}

async function readCopy() {
  const db = await openDatabase();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const meta = await done(store.get(META));
  if (!meta) return null;
  const records = await Promise.all(meta.nodeIds.map((id) => done(store.get(nodeKey(id)))));
  const nodes = {};
  meta.nodeIds.forEach((id, index) => { if (records[index]) nodes[id] = records[index]; });
  const { nodeIds, ...rest } = meta;
  return { ...rest, nodes };
}

// The journal laid over the stored copy (or, if it holds the whole project, instead of it).
function withJournal(project) {
  let journal = null;
  try { journal = JSON.parse(globalThis.localStorage?.getItem(JOURNAL_KEY) ?? "null"); } catch (error) { ignore(error, "an unreadable journal is dropped"); }
  if (!journal?.meta) return { project, used: false };
  const base = journal.whole || project?.id !== journal.meta.id ? {} : project.nodes;
  const nodes = {};
  for (const id of journal.meta.nodeIds) {
    const node = journal.nodes[id] ?? base[id];
    if (!node) return { project, used: false }; // incomplete: the stored copy stands
    nodes[id] = node;
  }
  const { nodeIds, ...rest } = journal.meta;
  return { project: { ...rest, nodes }, used: true };
}

// The copy this browser keeps (null: none, or the app was cleared since it
// was saved: clearedAt, Shell's). Moves an old localStorage copy over, and
// applies the journal; both are removed once the copy is written.
async function loadProject({ clearedAt = 0 } = {}) {
  let project = null;
  try {
    project = await readCopy();
    if (project) written = { projectId: project.id, nodes: new Map(Object.entries(project.nodes).map(([id, node]) => [id, copyOf(node)])) };
  } catch (error) {
    ignore(error, "the stored copy could not be read; the old one or none is used");
  }
  if (project && clearedAt && (project.savedAt ?? 0) < clearedAt) project = null;
  let moved = false;
  if (!project) {
    try {
      const raw = globalThis.localStorage?.getItem(LEGACY_KEY);
      if (raw) { project = deserializeProject(raw); moved = true; }
    } catch (error) {
      ignore(error, "an unreadable old copy is left where it is");
    }
  }
  const journaled = withJournal(project);
  project = journaled.project;
  if (!project) return null;
  delete project.savedAt;
  // An OS-picked "filesystem" directory can't be reopened without a fresh user
  // gesture, so it downgrades to an in-browser copy. An "opfs" project keeps its
  // mode: its directory is re-attachable on boot without any permission prompt.
  if (project.sourceMode === "filesystem") project.sourceMode = "memory";
  if (moved || journaled.used) {
    try {
      await saveProject(project);
      if (moved) globalThis.localStorage?.removeItem(LEGACY_KEY);
      if (journaled.used) globalThis.localStorage?.removeItem(JOURNAL_KEY);
    } catch (error) {
      ignore(error, "moving the copy failed; the old copy and the journal stay for the next load");
    }
  }
  return project;
}

export { keepJournal, loadProject, saveProject };
