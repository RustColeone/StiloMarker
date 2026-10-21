"""Reading this browser's copies of workspaces (Workspace's, in IndexedDB) from a test.

STORED_FILE(name) -> the content of the file called `name` in the copy the
next load opens (or null), after a pagehide asks the app to write it.
STORED_NAMES() -> that copy's file names. STORED_COPIES() -> { key: [file
names] } for every copy, and POINTER() -> { open, own } (in localStorage).
"""

_DB = '''const db = await new Promise((resolve, reject) => { const q = indexedDB.open("mdnotes-workspaces"); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  const ask = (name, call) => new Promise((resolve) => { try { const q = call(db.transaction(name).objectStore(name)); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); } catch { resolve(null); } });'''

# The copy's nodes (key: the pointer's open copy when not given).
_READ = '''async (key = null) => {
  ''' + _DB + '''
  const pointer = JSON.parse(localStorage.getItem("mdnotes.copies.v1") ?? "{}");
  const named = key ?? pointer.open;
  const nodes = named ? await ask("nodes", (s) => s.getAll(IDBKeyRange.bound([named], [named, []]))) : [];
  db.close();
  return nodes ?? [];
}'''

# The pagehide makes the app write its copy now; the wait lets the write land.
STORED_FILE = '''async (name) => {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const nodes = await (''' + _READ + ''')();
  return nodes.find((node) => node.name === name)?.content ?? null;
}'''

STORED_NAMES = '''async () => (await (''' + _READ + ''')()).filter((node) => node.kind === "file").map((node) => node.name).sort()'''

STORED_COPIES = '''async () => {
  ''' + _DB + '''
  const keys = (await ask("copies", (s) => s.getAllKeys())) ?? [];
  const copies = {};
  for (const key of keys) {
    const nodes = (await ask("nodes", (s) => s.getAll(IDBKeyRange.bound([key], [key, []])))) ?? [];
    copies[key] = nodes.filter((node) => node.kind === "file").map((node) => node.name).sort();
  }
  db.close();
  return copies;
}'''

POINTER = '''() => JSON.parse(localStorage.getItem("mdnotes.copies.v1") ?? "{}")'''
