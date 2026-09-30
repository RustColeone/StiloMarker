import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createCollaborationRuntime } from '../app/services/collaboration-service.js';
import { applySyncOperation } from '../app/domain/project-model.js';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

for (const first of ['a', 'b']) for (const ackFirst of [true, false]) {
  test(`two production clients and broker converge: ${first} first, HTTP first=${ackFirst}`, async (t) => {
    const broker = spawn('python3', ['-B', 'tests/helpers/broker-stdio.py'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const waiting = []; let errors = '';
    broker.stderr.on('data', chunk => errors += chunk);
    createInterface({ input: broker.stdout }).on('line', line => {
      const answer = JSON.parse(line), job = waiting.shift();
      if (answer.error) job.reject(new Error(answer.error)); else job.resolve(answer.result);
    });
    broker.on('exit', code => { while (waiting.length) waiting.shift().reject(new Error(errors || `Broker exit ${code}`)); });
    const rpc = request => new Promise((resolve, reject) => { waiting.push({ resolve, reject }); broker.stdin.write(JSON.stringify(request) + '\n'); });
    const old = { fetch: globalThis.fetch, window: globalThis.window, EventSource: globalThis.EventSource };
    const streams = new Map(), timers = new Map(), sends = [];
    const clients = {};
    let timerId = 0;
    globalThis.window = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
    globalThis.EventSource = class {
      constructor(url) { streams.set(new URL(url).searchParams.get('token'), this); }
      close() {}
    };
    globalThis.fetch = async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : {};
      const client = new URL(url).searchParams.get('token');
      let result;
      if (url.includes('/workspaces/open')) result = await rpc({ type: 'open', client });
      else if (url.includes('/session/state')) result = await rpc({ type: 'get', client });
      else if (url.includes('/operations')) return new Promise(resolve => sends.push({ client, operation: body.operation, resolve }));
      else throw new Error(`Unexpected ${url}`);
      return Response.json(result);
    };
    t.after(() => { for (const c of Object.values(clients)) c.runtime.disconnect(); Object.assign(globalThis, old); broker.stdin.end(); });
    for (const name of ['a', 'b']) {
      const c = { project: null, archives: [] }; clients[name] = c;
      c.runtime = createCollaborationRuntime({ getProject: () => c.project,
        replaceProject: p => c.project = p,
        applyOperation: (_, op) => c.project = applySyncOperation(c.project, op),
        preserveLocalFiles: async files => c.archives.push(files), onStatusChange() {} });
      await c.runtime.openWorkspace('https://test.invalid', name, 'team', 'test');
      c.edit = text => { const file = Object.values(c.project.nodes).find(n => n.kind === 'file');
        const old = file.content; file.content = text; file.dirty = true; c.runtime.scheduleTextPatch('note.md', old, text); };
      c.text = () => Object.values(c.project.nodes).find(n => n.kind === 'file').content;
    }
    const tick = async delay => { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } await settle(); };
    clients.a.edit('Ax'); clients.b.edit('Bx'); await tick(250);
    const second = first === 'a' ? 'b' : 'a';
    // Both requests leave before either peer sees a stream event. Continue typing
    // behind the second peer's in-flight request to exercise both local layers.
    clients[second].edit(second.toUpperCase() + '!x');
    for (const name of [first, second]) {
      const send = sends.find(s => s.client === name);
      const event = await rpc({ type: 'operation', client: name, operation: send.operation });
      if (ackFirst) { send.resolve(Response.json(event)); await settle(); }
      for (const stream of streams.values()) stream.onmessage({ data: JSON.stringify(event) });
      if (!ackFirst) send.resolve(Response.json(event));
      await settle();
    }
    await tick(250);
    const send = sends[2]; assert.ok(send, 'continued typing produces a second patch');
    const event = await rpc({ type: 'operation', client: send.client, operation: send.operation });
    for (const stream of streams.values()) stream.onmessage({ data: JSON.stringify(event) });
    send.resolve(Response.json(event)); await settle();
    const state = await rpc({ type: 'get' });
    const canonical = Object.values(state.project.nodes).find(n => n.kind === 'file').content;
    assert.equal(canonical, second.toUpperCase() + '!' + first.toUpperCase() + 'x');
    for (const client of Object.values(clients)) {
      assert.equal(client.text(), canonical); assert.equal(client.archives.length, 0);
      assert.equal(client.runtime.hasUnsyncedText('note.md'), false);
    }
  });
}
