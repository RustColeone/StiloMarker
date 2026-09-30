import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSynchronizer, mergeChatWorkspace, sharedChat } from '../app/services/chat-sync-service.js';
import { shouldSubmitChat, isChatNearBottom, installMobileViewport } from '../app/services/chat-ui-service.js';
import { saveChatWorkspace, loadChatWorkspace } from '../app/services/chat-storage-service.js';
const copy = value => structuredClone(value);
const message = (id, content = id) => ({ id, role: 'user', content, createdAt: 1 });
const workspace = (...messages) => ({ revision: 0, activeThreadId: 't', threads: [{ id: 't', title: 'Chat', createdAt: 1, updatedAt: 1, messages, contextPaths: [], draft: '' }] });
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
function channel(server, initial = workspace()) {
  let local = copy(initial); const errors = [], scheduled = [];
  const sync = createChatSynchronizer({ getLocal: () => local, setLocal: value => local = value,
    fetchRemote: async () => copy(server.value),
    pushRemote: async value => {
      if (value.baseRevision !== server.value.revision) throw Object.assign(new Error('conflict'), { status: 409 });
      const result = { ...copy(sharedChat(value)), revision: server.value.revision + 1 };
      server.value = result;
      if (server.wait) await server.wait.promise;
      return result;
    }, onError: error => { if (error) errors.push(error); }, setTimer: fn => { scheduled.push(fn); return scheduled.length; }, clearTimer() {} });
  return { sync, errors, scheduled, get local() { return local; } };
}

test('two stale chat clients retain both independent messages after CAS retry', async () => {
  const server = { value: workspace(message('original')) };
  const a = channel(server), b = channel(server);
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  a.local.threads[0].messages.push(message('A')); b.local.threads[0].messages.push(message('B'));
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  a.sync.receive(server.value); b.sync.receive(server.value);
  for (const value of [server.value, a.local, b.local]) assert.deepEqual(value.threads[0].messages.map(m => m.id), ['A', 'B', 'original']);
  assert.equal(a.errors.length + b.errors.length, 0);
});

test('editing while a save is in flight is included in the next save', async () => {
  const server = { value: workspace() }; const c = channel(server);
  await c.sync.flush(); c.local.threads[0].messages.push(message('one'));
  server.wait = gate(); const saving = c.sync.flush(); await settle();
  c.local.threads[0].messages.push(message('two')); server.wait.resolve(); await saving;
  assert.equal(server.value.threads[0].messages.length, 2);
});

test('a late HTTP response cannot replace a newer stream snapshot', async () => {
  const server = { value: workspace() }; const c = channel(server); await c.sync.flush();
  c.local.threads[0].messages.push(message('mine')); server.wait = gate();
  const saving = c.sync.flush(); await settle();
  server.value.threads[0].messages.push(message('peer')); server.value.revision++;
  c.sync.receive(copy(server.value)); server.wait.resolve(); await saving;
  assert.equal(c.sync.getBase().revision, 2); assert.equal(c.local.threads[0].messages.length, 2);
});

test('workspace disposal ignores late hydration and does not post to the new connection', async () => {
  const waiting = gate(); let writes = 0, updates = 0;
  const sync = createChatSynchronizer({ getLocal: () => workspace(message('local')), setLocal: () => updates++, fetchRemote: () => waiting.promise, pushRemote: async () => writes++ });
  const loading = sync.flush(); sync.dispose(); waiting.resolve(workspace()); await loading;
  assert.equal(writes, 0); assert.equal(updates, 0);
});

test('peer updates preserve the local thread selection, draft, and attachments', () => {
  const base = workspace(message('m')); const local = copy(base), remote = copy(base);
  local.activeThreadId = 'private-selection'; local.threads[0].draft = 'draft'; local.threads[0].contextPaths = ['note.md'];
  remote.activeThreadId = 'peer-selection'; remote.threads[0].messages.push(message('peer'));
  const merged = mergeChatWorkspace(base, local, remote);
  assert.equal(merged.activeThreadId, 'private-selection'); assert.equal(merged.threads[0].draft, 'draft');
  assert.deepEqual(merged.threads[0].contextPaths, ['note.md']);
  assert.equal('draft' in sharedChat(merged).threads[0], false);
  assert.equal('contextPaths' in sharedChat(merged).threads[0], false);
});

test('stale proposal metadata cannot undo a peer resolution', () => {
  const base = workspace({ ...message('m'), proposalState: 'pending' });
  const remote = copy(base); remote.threads[0].messages[0].proposalState = 'accepted';
  const merged = mergeChatWorkspace(base, copy(base), remote);
  assert.equal(merged.threads[0].messages[0].proposalState, 'accepted');
});

test('chat cache retains drafts, interrupted replies, reasoning, and sync base', t => {
  const old = globalThis.localStorage, data = new Map();
  globalThis.localStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  t.after(() => globalThis.localStorage = old);
  const value = workspace({ ...message('m'), interrupted: true, reasoning: 'text', reasoningMs: 50 });
  value.threads[0].draft = 'unsent'; value.syncBase = { revision: 4, threads: [] };
  saveChatWorkspace('cloud:a', value); const loaded = loadChatWorkspace('cloud:a');
  assert.equal(loaded.threads[0].draft, 'unsent'); assert.equal(loaded.threads[0].messages[0].interrupted, true);
  assert.equal(loaded.threads[0].messages[0].reasoningMs, 50); assert.equal(loaded.syncBase.revision, 4);
  assert.equal(loadChatWorkspace('cloud:b').threads.length, 0);
});

test('mobile Enter adds a newline, desktop Enter sends, and composition never sends', () => {
  const enter = { key: 'Enter' };
  assert.equal(shouldSubmitChat(enter, true), false); assert.equal(shouldSubmitChat(enter, false), true);
  assert.equal(shouldSubmitChat({ ...enter, ctrlKey: true }, true), true);
  for (const mobile of [true, false]) for (const fields of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }]) {
    assert.equal(shouldSubmitChat({ ...enter, ...fields }, mobile), false);
  }
});

test('scroll follow stops when reading older messages', () => {
  assert.equal(isChatNearBottom({ scrollHeight: 1000, clientHeight: 300, scrollTop: 695 }), true);
  assert.equal(isChatNearBottom({ scrollHeight: 1000, clientHeight: 300, scrollTop: 200 }), false);
});

test('mobile viewport follows keyboard height and resets on desktop or pinch zoom', () => {
  const properties = new Map(); let mobile = true;
  const window = { matchMedia: () => ({ matches: mobile }), addEventListener() {}, visualViewport: { height: 350, scale: 1, addEventListener() {} } };
  const element = { style: { setProperty: (k,v) => properties.set(k,v), removeProperty: k => properties.delete(k) } };
  const update = installMobileViewport(window, element);
  assert.equal(properties.get('--mobile-viewport-height'), '350px');
  window.visualViewport.height = 700; update(); assert.equal(properties.get('--mobile-viewport-height'), '700px');
  mobile = false; update(); assert.equal(properties.size, 0);
  mobile = true; window.visualViewport.scale = 2; update(); assert.equal(properties.size, 0);
});

test('chat transport sends both the compatibility version and chat base revision', async t => {
  const { pushServerChatWorkspace } = await import('../app/services/chat-api-service.js');
  const { SYNC_PROTOCOL_VERSION } = await import('../app/version.js');
  const old = globalThis.fetch; t.after(() => globalThis.fetch = old);
  let body;
  globalThis.fetch = async (_, options) => { body = JSON.parse(options.body); return Response.json({ revision: 8, threads: [] }); };
  const saved = await pushServerChatWorkspace('https://example.test', 'test-token', { baseRevision: 7, threads: [] });
  assert.equal(body.version, SYNC_PROTOCOL_VERSION); assert.equal(body.baseRevision, 7); assert.equal(saved.revision, 8);
});
