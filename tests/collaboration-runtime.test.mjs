import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollaborationRuntime } from '../app/services/collaboration-service.js';
import { applySyncOperation as applyModelOperation } from '../app/domain/project-model.js';

function project(content = 'original') {
  return { id: 'test', rootId: 'root', nodes: {
    root: { id: 'root', kind: 'folder', name: 'Test', children: ['file'] },
    file: { id: 'file', parentId: 'root', kind: 'file', name: 'note.md', content, dirty: false }
  }};
}
const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(setImmediate); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(t) {
  const old = { fetch: globalThis.fetch, window: globalThis.window, EventSource: globalThis.EventSource };
  const timers = new Map();
  let nextTimer = 1;
  const streams = [];
  const posts = [];
  const archives = [];
  const statuses = [];
  let local = project();
  const server = { project: project(), revision: 1 };
  const hooks = {};
  globalThis.window = { setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
  globalThis.EventSource = class {
    constructor() { streams.push(this); }
    close() { this.closed = true; }
    event(event) { this.onmessage({ data: JSON.stringify(event) }); }
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes('/workspaces/open')) return json({ token: 'session', clientId: 'me', workspace: 'team/test', revision: server.revision });
    if (url.includes('/session/state') && options.method === 'GET') {
      if (hooks.get) return hooks.get();
      return json(structuredClone(server));
    }
    if (url.includes('/operations')) {
      const { operation } = JSON.parse(options.body);
      posts.push(operation);
      if (hooks.post) return hooks.post(operation);
      server.project = applyModelOperation(server.project, operation);
      server.revision++;
      return json({ revision: server.revision });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const runtime = createCollaborationRuntime({
    getProject: () => local,
    replaceProject: (p) => { local = p; },
    applyOperation: (_, op) => { local = applyModelOperation(local, op); },
    onStatusChange: (status) => statuses.push(status),
    preserveLocalFiles: async (files) => {
      if (hooks.archive) await hooks.archive(files);
      archives.push(new Map(files));
    }
  });
  t.after(() => { runtime.disconnect(); Object.assign(globalThis, old); });
  return {
    runtime, server, hooks, posts, archives, statuses, streams, json,
    local: () => local,
    async open(options = {}) { await runtime.openWorkspace('https://example.test', 'account', 'team', 'test', options); },
    edit(text) { const oldText = local.nodes.file.content; local.nodes.file.content = text; local.nodes.file.dirty = true; runtime.scheduleTextPatch('note.md', oldText, text); },
    async tick(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } await settle(); }
  };
}

test('reconnect keeps newer cloud text and archives the offline draft without a write', async (t) => {
  const h = harness(t); await h.open();
  h.streams[0].onerror(); h.edit('offline draft');
  h.server.project = project('newer cloud'); h.server.revision = 2;
  await h.tick(1000);
  assert.equal(h.local().nodes.file.content, 'newer cloud');
  assert.equal(h.archives[0].get('note.md'), 'offline draft');
  assert.equal(h.posts.length, 0);
  assert.equal(h.runtime.getRevision(), 2);
});

test('reconcile retains the original base if cloud advances between open and fetch', async (t) => {
  const h = harness(t); await h.open(); h.edit('old local');
  h.hooks.get = async () => h.json({ project: project('newer cloud'), revision: 2 });
  await h.open({ reconcileLocal: true, localBaseRevision: 1 });
  assert.equal(h.posts.length, 0);
  assert.equal(h.local().nodes.file.content, 'newer cloud');
  assert.equal(h.archives[0].get('note.md'), 'old local');
});

for (const status of [400, 409, 422]) test(`HTTP ${status} frees the rejected patch and subsequent editing syncs`, async (t) => {
  const h = harness(t); await h.open();
  h.hooks.post = async () => h.json({ message: 'rejected change' }, status);
  h.edit('rejected draft'); await h.tick(250);
  assert.equal(h.archives[0].get('note.md'), 'rejected draft');
  assert.equal(h.runtime.hasUnsyncedText('note.md'), false);
  delete h.hooks.post;
  h.edit('original plus new text'); await h.tick(250);
  assert.equal(h.posts.length, 2);
  assert.equal(h.server.project.nodes.file.content, 'original plus new text');
  assert.equal(h.runtime.hasUnsyncedText('note.md'), false);
});

test('archive failure keeps the draft and pauses sends until recovery succeeds', async (t) => {
  const h = harness(t); await h.open(); h.edit('precious draft');
  h.server.project = project('cloud version'); h.server.revision = 2;
  h.hooks.archive = async () => { throw new Error('disk full'); };
  await assert.rejects(h.runtime.reloadFromServer(), /disk full/);
  assert.equal(h.local().nodes.file.content, 'precious draft');
  assert.equal(h.runtime.hasUnsyncedText('note.md'), true);
  await h.tick(250); assert.equal(h.posts.length, 0);
  delete h.hooks.archive;
  await h.runtime.reloadFromServer();
  assert.equal(h.archives[0].get('note.md'), 'precious draft');
  assert.equal(h.local().nodes.file.content, 'cloud version');
});

test('typing while the recovery archive is pending is preserved too', async (t) => {
  const h = harness(t); await h.open(); h.edit('first draft');
  const gate = deferred(); let calls = 0;
  h.hooks.archive = async () => { if (++calls === 1) await gate.promise; };
  const reload = h.runtime.reloadFromServer(); await settle();
  h.edit('new typing during recovery'); gate.resolve(); await reload;
  assert.equal(h.archives.at(-1).get('note.md'), 'new typing during recovery');
});

test('ready detects the join gap and buffers changes received during catch-up', async (t) => {
  const h = harness(t); await h.open();
  const gate = deferred(); h.hooks.get = () => gate.promise;
  h.streams[0].event({ type: 'ready', revision: 2 });
  h.streams[0].event({ type: 'operation', clientId: 'peer', revision: 3,
    operation: { type: 'patch-file', path: 'note.md', start: 3, end: 3, text: '!', removedText: '' } });
  gate.resolve(h.json({ project: project('new'), revision: 2 })); await settle();
  assert.equal(h.local().nodes.file.content, 'new!');
  assert.equal(h.runtime.getRevision(), 3);
});

test('transport failure reconnects instead of permanently disabling cloud sync', async (t) => {
  const h = harness(t); await h.open();
  h.hooks.post = async () => { throw new TypeError('network failed'); };
  h.edit('offline text'); await h.tick(250);
  assert.equal(h.runtime.isReconnecting(), true);
  delete h.hooks.post; await h.tick(1000);
  assert.equal(h.server.project.nodes.file.content, 'offline text');
  assert.equal(h.runtime.isReconnecting(), false);
});

test('an old request cannot change the revision after switching workspaces', async (t) => {
  const h = harness(t); await h.open();
  const gate = deferred(); h.hooks.post = () => gate.promise;
  h.edit('old workspace'); await h.tick(250);
  await h.open(); gate.resolve(h.json({ revision: 99 })); await settle();
  assert.equal(h.runtime.getRevision(), 1);
});

for (const [before, after] of [['A😀BC', 'A😀XBC'], ['😀', '😁'], ['😀', '🈀']]) {
  test(`runtime patch preserves Unicode boundaries: ${before} -> ${after}`, async (t) => {
    const h = harness(t); h.server.project = project(before); await h.open();
    h.edit(after); await h.tick(250);
    assert.equal(h.server.project.nodes.file.content, after);
    assert.equal(h.posts[0].text.isWellFormed(), true);
    assert.equal(h.posts[0].removedText.isWellFormed(), true);
  });
}

test('an accepted request completing during recovery is included before the pull', async (t) => {
  const h = harness(t); await h.open();
  const gate = deferred();
  h.hooks.post = async (op) => {
    await gate.promise;
    h.server.project = applyModelOperation(h.server.project, op); h.server.revision++;
    return h.json({ revision: h.server.revision });
  };
  h.edit('accepted later'); await h.tick(250);
  const reload = h.runtime.reloadFromServer(); await settle();
  gate.resolve(); await reload;
  assert.equal(h.local().nodes.file.content, 'accepted later');
  assert.equal(h.archives.length, 0);
});

test('a peer state event during catch-up triggers another pull, not a missed revision', async (t) => {
  const h = harness(t); await h.open();
  const gate = deferred(); h.hooks.get = () => gate.promise;
  const reload = h.runtime.reloadFromServer(); await settle();
  h.streams[0].event({ type: 'state', clientId: 'peer', revision: 3, project: project('newest') });
  h.server.project = project('newest'); h.server.revision = 3;
  delete h.hooks.get;
  gate.resolve(h.json({ project: project('older snapshot'), revision: 2 }));
  await reload; await settle();
  assert.equal(h.local().nodes.file.content, 'newest');
  assert.equal(h.runtime.getRevision(), 3);
});

test('reconnect preserves queued edits even if a remote apply cleared their dirty flag', async (t) => {
  const h = harness(t); await h.open(); h.edit('draft whose dirty flag was cleared');
  h.local().nodes.file.dirty = false;
  h.streams[0].onerror(); h.server.project = project('cloud wins'); h.server.revision = 2;
  await h.tick(1000);
  assert.equal(h.archives[0].get('note.md'), 'draft whose dirty flag was cleared');
  assert.equal(h.local().nodes.file.content, 'cloud wins');
});

test('cloud advance after a reconcile write never authorizes another stale whole-file write', async (t) => {
  const h = harness(t); await h.open();
  const other = { id: 'other', kind: 'file', parentId: 'root', name: 'other.md', content: 'other base', dirty: false };
  h.local().nodes.other = structuredClone(other); h.local().nodes.root.children.push('other');
  h.server.project.nodes.other = structuredClone(other); h.server.project.nodes.root.children.push('other');
  h.local().nodes.other.content = 'stale other draft'; h.local().nodes.other.dirty = true;
  h.streams[0].onerror(); h.edit('local draft');
  h.hooks.post = async (op) => {
    if (op.path === 'note.md') {
      h.server.project.nodes.other.content = 'newer peer draft';
      h.server.revision = 3;
      h.server.project = applyModelOperation(h.server.project, op);
      return h.json({ revision: 3 });
    }
    assert.equal(op.baseRevision, 1, 'reconcile must keep the original base for all files');
    return h.json({ message: 'conflict' }, 409);
  };
  await h.tick(1000);
  assert.equal(h.local().nodes.other.content, 'newer peer draft');
  assert.equal(h.archives[0].get('other.md'), 'stale other draft');
});

test('a scheduled whole-project publish keeps its original revision', async (t) => {
  const h = harness(t); await h.open();
  const originalFetch = globalThis.fetch;
  const states = [];
  globalThis.fetch = async (url, options) => {
    if (url.includes('/session/state') && options?.method === 'POST') {
      states.push(JSON.parse(options.body));
      return h.json({ message: 'conflict' }, 409);
    }
    return originalFetch(url, options);
  };
  h.runtime.scheduleSnapshot(h.local());
  h.server.project = project('peer changed'); h.server.revision = 2;
  h.streams[0].event({ type: 'operation', clientId: 'peer', revision: 2,
    operation: { type: 'update-file', path: 'note.md', content: 'peer changed', baseRevision: 1 } });
  await h.tick(120);
  assert.equal(states[0].baseRevision, 1);
  assert.equal(states[0].version, 112);
  assert.equal(h.local().nodes.file.content, 'peer changed');
});

// Follow-up review probe; intentionally asserts the observed divergence.
test('AUDIT: same-position concurrent inserts diverge on the originating client', async (t) => {
  const h = harness(t); h.server.project = project('x'); await h.open();
  const gate = deferred();
  h.hooks.post = async (op) => { await gate.promise; return h.json({ revision: 3 }); };
  h.edit('Bx'); await h.tick(250);
  const sent=h.posts[0];
  h.server.project = project('Ax'); h.server.revision = 2;
  h.streams[0].event({ type:'operation', clientId:'peer', revision:2,
    operation:{type:'patch-file',path:'note.md',start:0,end:0,text:'A',removedText:'',baseRevision:1} });
  // The server's <= offset tie rule places the later B before the earlier A.
  h.server.project = project('BAx'); h.server.revision = 3;
  gate.resolve(); await settle();
  h.streams[0].event({type:'operation',clientId:'me',revision:3,operation:sent});
  assert.equal(h.local().nodes.file.content,'ABx');
  assert.equal(h.server.project.nodes.file.content,'BAx');
  console.log('AUDIT confirmed: client=ABx, server=BAx after same-position concurrent inserts.');
});
