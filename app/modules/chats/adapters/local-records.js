// Where a browser-only workspace keeps its chats: one record per workspace in
// IndexedDB (they are small), or in memory when IndexedDB is unavailable
// (private mode, tests).
const DB_NAME = "stilomarker-chats";
const STORE = "workspaces";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
    const request = globalThis.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Load / save one workspace's chats as a single record (they are small). */
export function createIdbRecordStore() {
  let db = null;
  const memory = new Map(); // when IndexedDB is unavailable (private mode, tests)
  async function database() {
    if (db === false) return null;
    try { db ??= await openDatabase(); } catch { db = false; return null; }
    return db;
  }
  return {
    async load(key) {
      const handle = await database();
      if (!handle) return memory.get(key) ?? null;
      return new Promise((resolve) => {
        const request = handle.transaction(STORE).objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
    },
    async save(record) {
      const handle = await database();
      if (!handle) { memory.set(record.key, structuredClone(record)); return; }
      await new Promise((resolve, reject) => {
        const tx = handle.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  };
}
