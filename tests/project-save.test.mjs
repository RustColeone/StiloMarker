import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, addFolder, addFile, updateFileContent, toggleFolder, renameNode } from '../app/domain/project-model.js';
import { buildSourceIndex, saveProjectToHandles } from '../app/services/fs-access-service.js';
import { snapshotProject, savedFileIds, createProjectSaveQueue } from '../app/services/project-save-service.js';
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function localProject(root = {}) {
  let p = createProject('local');
  p = addFile(p, p.rootId, 'note.md', 'old');
  p.sourceMode = 'opfs'; p.handles = { [p.rootId]: root };
  return p;
}
const fileId = p => Object.values(p.nodes).find(n => n.kind === 'file').id;

test('queued save waits for its own immutable contents, preserving newer dirty edits', async () => {
  const first = deferred(), second = deferred(), writes = [];
  const save = createProjectSaveQueue(async p => { writes.push(p.nodes[fileId(p)].content); await (writes.length === 1 ? first : second).promise; });
  let p = localProject(); const id = fileId(p);
  const oldSnapshot = snapshotProject(p), one = save(oldSnapshot);
  p = updateFileContent(p, id, 'second'); const saved = snapshotProject(p);
  let complete = false; const two = save(saved).then(() => complete = true);
  await settle(); assert.deepEqual(writes, ['old']); assert.equal(complete, false);
  p = updateFileContent(p, id, 'third'); first.resolve(); await one; await settle();
  assert.deepEqual(writes, ['old', 'second']); assert.equal(complete, false);
  second.resolve(); await two;
  assert.deepEqual(savedFileIds(p, saved), []);
  assert.equal(p.nodes[id].dirty, true);
});

test('failed writes reject; a later save retries and confirms only its contents', async () => {
  let failures = 1;
  const save = createProjectSaveQueue(async () => { if (failures--) throw new Error('disk full'); });
  const p = localProject(); const saved = snapshotProject(p);
  await assert.rejects(save(saved), /disk full/);
  await save(saved);
  assert.deepEqual(savedFileIds(p, saved), [fileId(p)]);
});

test('save receipts do not mark another workspace or a renamed file saved', () => {
  const p = localProject(); const saved = snapshotProject(p);
  const other = snapshotProject(p); other.handles = { [p.rootId]: {} };
  assert.deepEqual(savedFileIds(other, saved), []);
  assert.deepEqual(savedFileIds(renameNode(p, fileId(p), 'renamed.md'), saved), []);
});

function directory(name = 'root', controls = {}, prefix = '') {
  const entries = new Map();
  const missing = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
  return { name, kind: 'directory', entries,
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!entries.has(name)) { if (!create) throw missing(); entries.set(name, directory(name, controls, `${prefix}${name}/`)); }
      return entries.get(name);
    },
    async getFileHandle(name, { create = false } = {}) {
      if (!entries.has(name)) {
        if (!create) throw missing();
        const file = { kind: 'file', name, content: '', async createWritable() {
          let pending;
          return { async write(text) { if (controls.failWrite) throw new Error('disk full'); pending = text; },
            async close() { if (controls.gate) await controls.gate.promise; file.content = pending; } };
        }};
        entries.set(name, file);
      }
      return entries.get(name);
    },
    async removeEntry(name) { if (!entries.delete(name)) throw missing(); },
  };
}

test('collapsed folders stay on disk and still save hidden content', async () => {
  const root = directory(); let p = localProject(root);
  p = addFolder(p, p.rootId, 'folder'); const folder = Object.values(p.nodes).find(n => n.name === 'folder');
  p = addFile(p, folder.id, 'hidden.md', 'hidden');
  const hidden = Object.values(p.nodes).find(n => n.name === 'hidden.md');
  await saveProjectToHandles(p);
  p = toggleFolder(p, folder.id); p = updateFileContent(p, hidden.id, 'changed while collapsed');
  assert.equal(buildSourceIndex(p)[hidden.id].path, 'folder/hidden.md');
  await saveProjectToHandles(p);
  assert.equal(root.entries.get('folder').entries.get('hidden.md').content, 'changed while collapsed');
});

test('failed rename keeps the old file and a retry safely completes cleanup', async () => {
  const controls = {}, root = directory('root', controls); let p = localProject(root);
  await saveProjectToHandles(p); const id = fileId(p);
  p = renameNode(p, id, 'new.md'); controls.failWrite = true;
  await assert.rejects(saveProjectToHandles(p), /disk full/);
  assert.equal(root.entries.get('note.md').content, 'old');
  controls.failWrite = false; await saveProjectToHandles(p);
  assert.equal(root.entries.has('note.md'), false); assert.equal(root.entries.get('new.md').content, 'old');
});

test('queued renames use the last completed disk index despite model cloning', async () => {
  const controls = {}, root = directory('root', controls); let p = localProject(root);
  await saveProjectToHandles(p); const id = fileId(p);
  controls.gate = deferred();
  p = renameNode(p, id, 'middle.md'); const one = saveProjectToHandles(p);
  p = renameNode(p, id, 'final.md'); const two = saveProjectToHandles(p);
  await settle(); controls.gate.resolve(); await Promise.all([one, two]);
  assert.deepEqual([...root.entries.keys()], ['final.md']);
});

// Exercise the production main.js handlers as well as their storage service.
// The UI is replaced by a controller stub; no browser or localhost is needed.
const { readFile } = await import('node:fs/promises');
const mainSource = await readFile(new URL('../app/main.js', import.meta.url), 'utf8');
function mainSaveHandlers(controller, write, persist = () => {}, scope = () => 'workspace') {
  const auto = mainSource.slice(mainSource.indexOf('async function runAutoSave(reason) {'), mainSource.indexOf('// Periodic safety net'));
  const manual = mainSource.slice(mainSource.indexOf('async function saveActiveWorkspaceFile() {'), mainSource.indexOf('async function handleSaveCommand()'));
  return new Function('deps', `const { controller, saveProjectToHandles, saveProject, snapshotProjectKey, snapshotProject, savedFileIds } = deps;
    const settings = { autoSave: true }, editorIsComposing = false, workspaceMode = 'private';
    const logDebug = () => {}, dirtyFileIds = p => Object.values(p.nodes).filter(n => n.dirty).map(n => n.id);
    ${auto}\n${manual}\nreturn { auto: runAutoSave, manual: saveActiveWorkspaceFile };`)
    ({ controller, saveProjectToHandles: write, saveProject: persist, snapshotProjectKey: scope, snapshotProject, savedFileIds });
}
for (const method of ['auto', 'manual']) test(`${method} save keeps dirty on failure and on edits during the write`, async () => {
  let p = localProject(); const id = fileId(p); p.activeFileId = id; p = updateFileContent(p, id, 'unsaved');
  const marked = [];
  const controller = { getProject: () => p, markSaved: id => marked.push(id), markManySaved: ids => marked.push(...ids) };
  const failed = mainSaveHandlers(controller, async () => { throw new Error('disk full'); });
  if (method === 'auto') await failed[method]('test');
  else await assert.rejects(failed[method](), /disk full/);
  assert.deepEqual(marked, []);
  const gate = deferred(); const handlers = mainSaveHandlers(controller, async () => { await gate.promise; return true; });
  const saving = handlers[method]('test'); await settle();
  p = updateFileContent(p, id, 'typed during save'); gate.resolve(); await saving;
  assert.deepEqual(marked, []);
  await handlers[method]('test'); assert.deepEqual(marked, [id]);
});

test('localStorage failure never marks an in-memory project saved', async () => {
  const p = localProject(); p.sourceMode = 'memory'; p.activeFileId = fileId(p); p.nodes[p.activeFileId].dirty = true;
  let marks = 0;
  const controller = { getProject: () => p, markSaved() { marks++; }, markManySaved() { marks++; } };
  const handlers = mainSaveHandlers(controller, async () => false, () => { throw new Error('quota exceeded'); });
  await handlers.auto('test'); await assert.rejects(handlers.manual(), /quota exceeded/);
  assert.equal(marks, 0);
});
