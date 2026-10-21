"""Reading the project's copy this browser keeps (Workspace's, in IndexedDB) from a test.

STORED_FILE(name) -> the content of the file called `name` in the stored copy (or null),
after a pagehide asks the app to write it. STORED_NAMES() -> the stored files' names.
"""

_READ = '''async () => {
  const db = await new Promise((resolve, reject) => { const q = indexedDB.open("mdnotes-workspace"); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  const store = db.transaction("copy").objectStore("copy");
  const get = (key) => new Promise((resolve) => { const q = store.get(key); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
  const meta = await get("project");
  const nodes = meta ? await Promise.all(meta.nodeIds.map((id) => get("node:" + id))) : [];
  db.close();
  return nodes.filter(Boolean);
}'''

# The pagehide makes the app write its copy now; the wait lets the write land.
STORED_FILE = '''async (name) => {
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const nodes = await (''' + _READ + ''')();
  return nodes.find((node) => node.name === name)?.content ?? null;
}'''

STORED_NAMES = '''async () => (await (''' + _READ + ''')()).filter((node) => node.kind === "file").map((node) => node.name).sort()'''
