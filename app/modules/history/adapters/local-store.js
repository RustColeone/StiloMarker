// Per-file, content-addressed snapshot store — git's storage idea without git.
// Each file version references a content BLOB keyed by its SHA-256 hash, so
// identical content (across versions or files) is stored ONCE; blobs are gzipped
// (CompressionStream) and everything lives in IndexedDB (far larger than the
// ~5 MB localStorage ceiling). Retention: last N versions per file + a total-
// bytes backstop. Entirely client-side — the server stores nothing.
import { builtinTypes } from "../../file-types/index.js";
import { ignore } from "../../../kernel/index.js";

const DB_NAME = "mdnotes-snapshots";
const DB_VERSION = 1;
const MAX_VERSIONS_PER_FILE = 30;
const TOTAL_BUDGET_BYTES = 50 * 1024 * 1024; // 50 MB hard backstop
const TOTAL_BYTES_KEY = "totalBytes";

// Reclaim the old project-level, full-content localStorage snapshots (unused
// for a long time). Called once the module starts, never on import.
export function forgetOldSnapshots() {
  try { globalThis.localStorage?.removeItem("mdnotes.snapshots.v1"); } catch (error) { ignore(error, "local storage is blocked; old snapshots stay"); }
}

const isImageName = (name) => builtinTypes.isImage(name);

// ---- IndexedDB plumbing ----------------------------------------------------
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("blobs")) {
        db.createObjectStore("blobs", { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains("versions")) {
        const vs = db.createObjectStore("versions", { keyPath: "id" });
        vs.createIndex("by_file", ["projectKey", "path"]);
        vs.createIndex("by_project", "projectKey");
        vs.createIndex("by_created", "createdAt");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqP(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---- content hash + gzip ---------------------------------------------------
async function contentHash(str) {
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Non-secure-context (dev) fallback: FNV-1a + length. Distinct markdown files
  // sharing both is astronomically unlikely; production runs over HTTPS anyway.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `fnv${(h >>> 0).toString(16)}-${str.length}`;
}

async function gzipString(str) {
  const bytes = new TextEncoder().encode(str);
  if (typeof CompressionStream === "undefined") return { data: bytes, gz: false };
  try {
    const cs = new CompressionStream("gzip");
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return { data: new Uint8Array(buf), gz: true };
  } catch {
    return { data: bytes, gz: false };
  }
}

async function gunzip(data, gz) {
  if (!gz) return new TextDecoder().decode(data);
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(data);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}

// ---- meta (running total bytes) --------------------------------------------
async function bumpTotalBytes(store, delta) {
  const cur = await reqP(store.get(TOTAL_BYTES_KEY));
  const value = Math.max(0, (cur?.value ?? 0) + delta);
  store.put({ key: TOTAL_BYTES_KEY, value });
}
async function getTotalBytes(db) {
  const t = db.transaction("meta", "readonly");
  const cur = await reqP(t.objectStore("meta").get(TOTAL_BYTES_KEY));
  return cur?.value ?? 0;
}

// ---- core ops --------------------------------------------------------------
function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getFileVersionsRaw(db, projectKey, path) {
  const t = db.transaction("versions", "readonly");
  const all = await reqP(t.objectStore("versions").index("by_file").getAll([projectKey, path]));
  all.sort((a, b) => b.createdAt - a.createdAt); // newest first
  return all;
}

// Store one version + its blob (deduped, refcounted) in a single transaction.
async function storeVersion(db, { projectKey, path, hash, data, gz, label, counters }) {
  const t = db.transaction(["blobs", "versions", "meta"], "readwrite");
  const blobs = t.objectStore("blobs");
  const existing = await reqP(blobs.get(hash));
  if (existing) {
    existing.refs = (existing.refs ?? 1) + 1;
    blobs.put(existing);
  } else {
    blobs.put({ hash, data, gz, size: data.byteLength, refs: 1 });
    await bumpTotalBytes(t.objectStore("meta"), data.byteLength);
  }
  const version = {
    id: newId(), projectKey, path, blobHash: hash,
    createdAt: Date.now(), label: String(label || "").slice(0, 80), byteSize: data.byteLength,
    // Baseline for the S.E.N label: E counts sittings since this snapshot.
    editSessions: Number(counters?.editSessions) || 0,
    sessionEdits: Number(counters?.sessionEdits) || 0,
    sourceVersion: Number(counters?.sourceVersion) || 0,
  };
  t.objectStore("versions").put(version);
  await txDone(t);
  return version;
}

async function deleteVersionInternal(db, versionId) {
  const t = db.transaction(["versions", "blobs", "meta"], "readwrite");
  const versions = t.objectStore("versions");
  const v = await reqP(versions.get(versionId));
  if (!v) { await txDone(t); return; }
  versions.delete(versionId);
  const blobs = t.objectStore("blobs");
  const blob = await reqP(blobs.get(v.blobHash));
  if (blob) {
    blob.refs = (blob.refs ?? 1) - 1;
    if (blob.refs <= 0) {
      blobs.delete(v.blobHash);
      await bumpTotalBytes(t.objectStore("meta"), -(blob.size ?? 0));
    } else {
      blobs.put(blob);
    }
  }
  await txDone(t);
}

async function pruneFile(db, projectKey, path) {
  const all = await getFileVersionsRaw(db, projectKey, path);
  for (const v of all.slice(MAX_VERSIONS_PER_FILE)) {
    await deleteVersionInternal(db, v.id);
  }
}

async function enforceBudget(db) {
  if (await getTotalBytes(db) <= TOTAL_BUDGET_BYTES) return;
  const t = db.transaction("versions", "readonly");
  const all = await reqP(t.objectStore("versions").index("by_created").getAll());
  all.sort((a, b) => a.createdAt - b.createdAt); // oldest first
  for (const v of all) {
    if (await getTotalBytes(db) <= TOTAL_BUDGET_BYTES) break;
    await deleteVersionInternal(db, v.id);
  }
}

// ---- public API ------------------------------------------------------------
/** Snapshot every CHANGED text file of the project (unchanged files cost
 *  nothing — same content hash as their latest version is skipped). */
async function createFileSnapshots(projectKey, project, pathOf, label = "") {
  const db = await openDB();
  const nodes = Object.values(project?.nodes ?? {}).filter(
    (n) => n.kind === "file" && !isImageName(n.name)
  );
  let created = 0;
  let skipped = 0;
  for (const node of nodes) {
    const path = pathOf(node.id);
    if (!path) continue;
    const content = String(node.content ?? "");
    const hash = await contentHash(content);
    const latest = (await getFileVersionsRaw(db, projectKey, path))[0];
    if (latest && latest.blobHash === hash) { skipped += 1; continue; }
    const { data, gz } = await gzipString(content);
    await storeVersion(db, { projectKey, path, hash, data, gz, label, counters: node });
    await pruneFile(db, projectKey, path);
    created += 1;
  }
  await enforceBudget(db);
  return { created, skipped, total: nodes.length };
}

/** Snapshot a SINGLE file (the current-file "commit"). Unchanged content since
 *  the file's latest version costs nothing (same hash ⇒ skipped). */
async function createFileSnapshot(projectKey, path, content, label = "", counters = null) {
  const db = await openDB();
  const str = String(content ?? "");
  const hash = await contentHash(str);
  const latest = (await getFileVersionsRaw(db, projectKey, path))[0];
  if (latest && latest.blobHash === hash) return { created: false };
  const { data, gz } = await gzipString(str);
  await storeVersion(db, { projectKey, path, hash, data, gz, label, counters });
  await pruneFile(db, projectKey, path);
  await enforceBudget(db);
  return { created: true };
}

/** Version metadata for one file, newest first (no content). */
async function listFileVersions(projectKey, path) {
  const db = await openDB();
  const all = await getFileVersionsRaw(db, projectKey, path);
  return all.map((v) => ({
    id: v.id, createdAt: v.createdAt, label: v.label, byteSize: v.byteSize,
    editSessions: v.editSessions ?? 0, sessionEdits: v.sessionEdits ?? 0
  }));
}

/** Distinct file paths that have any snapshot history in this project. */
async function listSnapshotPaths(projectKey) {
  const db = await openDB();
  const t = db.transaction("versions", "readonly");
  const all = await reqP(t.objectStore("versions").index("by_project").getAll(projectKey));
  const baselines = {};
  for (const v of all) {
    const seen = baselines[v.path];
    if (!seen) {
      baselines[v.path] = { count: 1, createdAt: v.createdAt, editSessions: v.editSessions ?? 0, sessionEdits: v.sessionEdits ?? 0 };
      continue;
    }
    seen.count += 1;
    if (v.createdAt > seen.createdAt) {  // keep the newest snapshot's baseline
      seen.createdAt = v.createdAt;
      seen.editSessions = v.editSessions ?? 0;
      seen.sessionEdits = v.sessionEdits ?? 0;
    }
  }
  return { paths: Object.keys(baselines).sort((a, b) => a.localeCompare(b)), baselines };
}

/** Decompressed content of a specific version, or null. */
async function getVersionContent(versionId) {
  const db = await openDB();
  const t = db.transaction(["versions", "blobs"], "readonly");
  const v = await reqP(t.objectStore("versions").get(versionId));
  const blob = v ? await reqP(t.objectStore("blobs").get(v.blobHash)) : null;
  if (!blob) return null;
  return gunzip(blob.data, blob.gz);
}

async function deleteVersion(versionId) {
  await deleteVersionInternal(await openDB(), versionId);
}

/** Total compressed bytes currently stored (for a settings/stats display). */
async function snapshotStorageBytes() {
  try {
    return await getTotalBytes(await openDB());
  } catch {
    return 0;
  }
}

export {
  createFileSnapshots,
  createFileSnapshot,
  listFileVersions,
  listSnapshotPaths,
  getVersionContent,
  deleteVersion,
  snapshotStorageBytes
};
