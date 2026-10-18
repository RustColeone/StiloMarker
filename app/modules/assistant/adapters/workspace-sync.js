// Chats merge by stable thread/message IDs. Missing records are not deletions:
// a late or offline client must never erase somebody else's conversation.
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function sharedChat(workspace) {
  return { threads: (workspace.threads ?? []).map(({ contextPaths, draft, ...thread }) => clone(thread)) };
}
function mergeRecord(base = {}, local = {}, remote = {}) {
  const result = { ...remote };
  for (const [key, value] of Object.entries(local)) {
    // Conflicting updates to an existing field keep the server's value. New
    // messages have distinct IDs, so both users' text survives independently.
    if (!(key in remote) || (equal(remote[key], base[key]) && !equal(value, base[key]))) result[key] = clone(value);
  }
  return result;
}
export function mergeChatWorkspace(base, local, remote) {
  const byId = rows => new Map((rows ?? []).map(row => [row.id, row]));
  const b = byId(base.threads), l = byId(local.threads), r = byId(remote.threads);
  const threads = [...new Set([...l.keys(), ...r.keys()])].map(id => {
    const lt = l.get(id), rt = r.get(id), bt = b.get(id);
    if (!lt || !rt) return clone(lt ?? rt);
    const bm = byId(bt?.messages), lm = byId(lt.messages), rm = byId(rt.messages);
    const messages = [...new Set([...lm.keys(), ...rm.keys()])].map(mid =>
      mergeRecord(bm.get(mid), lm.get(mid), rm.get(mid)))
      .sort((a, b) => (a.createdAt - b.createdAt) || a.id.localeCompare(b.id));
    return { ...mergeRecord(bt, lt, rt), messages, contextPaths: lt.contextPaths ?? [], draft: lt.draft ?? "",
      updatedAt: Math.max(lt.updatedAt ?? 0, rt.updatedAt ?? 0) };
  }).sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id));
  return { ...local, threads };
}

export function createChatSynchronizer({ getLocal, setLocal, fetchRemote, pushRemote, base,
  onError = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let confirmed = base ?? { revision: 0, threads: [] };
  let disposed = false, running = null, timer = null, hydrated = false;
  function adopt(remote, previous = confirmed) {
    if (disposed || (hydrated && remote.revision < confirmed.revision)) return;
    const next = mergeChatWorkspace(previous, getLocal(), remote);
    confirmed = clone(remote); hydrated = true;
    setLocal(next, confirmed);
  }
  async function flush() {
    if (disposed) return;
    if (running) return running;
    const task = (async () => {
      if (!hydrated) adopt(await fetchRemote());
      for (let attempt = 0; !disposed && attempt < 4; attempt++) {
        const sent = sharedChat(getLocal());
        if (equal(sent, sharedChat(confirmed))) { onError(null); return; }
        try {
          const response = await pushRemote({ ...sent, baseRevision: confirmed.revision });
          if (disposed) return;
          // A newer SSE update can arrive before this HTTP acknowledgment.
          if (response.revision >= confirmed.revision) adopt(response, sent);
          onError(null);
        } catch (error) {
          if (error.status !== 409) throw error;
          adopt(await fetchRemote());
        }
      }
      if (!disposed && !equal(sharedChat(getLocal()), sharedChat(confirmed))) schedule(1500);
    })();
    running = task;
    try { await task; }
    catch (error) { if (!disposed) { onError(error); schedule(5000); } }
    finally { if (running === task) running = null; }
  }
  function schedule(delay = 150) {
    if (disposed || timer) return;
    timer = setTimer(() => { timer = null; void flush(); }, delay);
  }
  return {
    flush, schedule,
    receive(remote) { if (disposed) return; adopt(remote); schedule(); },
    getBase: () => clone(confirmed),
    dispose() { disposed = true; if (timer) clearTimer(timer); },
  };
}
