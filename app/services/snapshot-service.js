// Per-file, content-addressed snapshot store — git's storage idea without git.
// Each file version references a content BLOB keyed by its SHA-256 hash, so
// identical content (across versions or files) is stored ONCE; blobs are gzipped
// (CompressionStream) and everything lives in IndexedDB (far larger than the
// ~5 MB localStorage ceiling). Retention: last N versions per file + a total-
// bytes backstop. Entirely client-side — the server stores nothing.
const DB_NAME = "mdnotes-snapshots";
const DB_VERSION = 1;
const MAX_VERSIONS_PER_FILE = 30;
const TOTAL_BUDGET_BYTES = 50 * 1024 * 1024; // 50 MB hard backstop
const TOTAL_BYTES_KEY = "totalBytes";

// Reclaim the old project-level, full-content localStorage snapshots (now unused).
try { globalThis.localStorage?.removeItem("mdnotes.snapshots.v1"); } catch { /* ignore */ }

function isImageName(name) {
  return /\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(String(name || ""));
}

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
async function storeVersion(db, { projectKey, path, hash, data, gz, label }) {
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
    await storeVersion(db, { projectKey, path, hash, data, gz, label });
    await pruneFile(db, projectKey, path);
    created += 1;
  }
  await enforceBudget(db);
  return { created, skipped, total: nodes.length };
}

/** Snapshot a SINGLE file (the current-file "commit"). Unchanged content since
 *  the file's latest version costs nothing (same hash ⇒ skipped). */
async function createFileSnapshot(projectKey, path, content, label = "") {
  const db = await openDB();
  const str = String(content ?? "");
  const hash = await contentHash(str);
  const latest = (await getFileVersionsRaw(db, projectKey, path))[0];
  if (latest && latest.blobHash === hash) return { created: false };
  const { data, gz } = await gzipString(str);
  await storeVersion(db, { projectKey, path, hash, data, gz, label });
  await pruneFile(db, projectKey, path);
  await enforceBudget(db);
  return { created: true };
}

/** Version metadata for one file, newest first (no content). */
async function listFileVersions(projectKey, path) {
  const db = await openDB();
  const all = await getFileVersionsRaw(db, projectKey, path);
  return all.map((v) => ({ id: v.id, createdAt: v.createdAt, label: v.label, byteSize: v.byteSize }));
}

/** Distinct file paths that have any snapshot history in this project. */
async function listSnapshotPaths(projectKey) {
  const db = await openDB();
  const t = db.transaction("versions", "readonly");
  const all = await reqP(t.objectStore("versions").index("by_project").getAll(projectKey));
  return Array.from(new Set(all.map((v) => v.path))).sort((a, b) => a.localeCompare(b));
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

// ---- Line diff (LCS) — pure, unchanged from before -------------------------
function diffLines(oldText, newText) {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  const n = a.length;
  const m = b.length;
  if (n * m > 1_600_000) return prefixSuffixDiff(a, b);

  const dp = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: "same", text: a[i], oldLine: i + 1, newLine: j + 1 }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null }); i += 1; }
    else { ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 }); j += 1; }
  }
  while (i < n) { ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null }); i += 1; }
  while (j < m) { ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 }); j += 1; }
  return ops;
}

function prefixSuffixDiff(a, b) {
  const n = a.length;
  const m = b.length;
  let p = 0;
  while (p < n && p < m && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < n - p && s < m - p && a[n - 1 - s] === b[m - 1 - s]) s += 1;
  const ops = [];
  for (let i = 0; i < p; i += 1) ops.push({ type: "same", text: a[i], oldLine: i + 1, newLine: i + 1 });
  for (let i = p; i < n - s; i += 1) ops.push({ type: "del", text: a[i], oldLine: i + 1, newLine: null });
  for (let j = p; j < m - s; j += 1) ops.push({ type: "add", text: b[j], oldLine: null, newLine: j + 1 });
  for (let k = 0; k < s; k += 1) ops.push({ type: "same", text: a[n - s + k], oldLine: n - s + k + 1, newLine: m - s + k + 1 });
  return ops;
}

export {
  createFileSnapshots,
  createFileSnapshot,
  listFileVersions,
  listSnapshotPaths,
  getVersionContent,
  deleteVersion,
  snapshotStorageBytes,
  diffLines,
};
