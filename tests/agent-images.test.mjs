import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Applying an agent's generated image: the bytes come from /api/generated, then
// the file is created like any image (data: URL locally; uploaded bytes plus an
// empty-content create-file in a directory-backed cloud workspace).
const source = await readFile(new URL('../app/main.js', import.meta.url), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const applySource = slice('function generatedImageUrl(', '\ndocument.addEventListener("click"');

const PNG = Uint8Array.from([137, 80, 78, 71, 1, 2, 3]);
const dataUrl = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

class FakeFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onload();
    });
  }
}

function harness({ synced = false, directory = false, account = { token: 'acct' }, status = 200 } = {}) {
  const project = { nodes: { root: { id: 'root', kind: 'folder', name: 'W', children: [] } } };
  const fetches = [], applied = [], published = [], uploads = [], toasts = [];
  const deps = {
    syncState: { account },
    settings: { serverUrl: 'https://notes.example/' },
    normalizeServerUrl: (url) => url.replace(/\/+$/, ''),
    fetch: async (url) => {
      fetches.push(url);
      return { ok: status === 200, status, blob: async () => new Blob([PNG], { type: 'image/png' }) };
    },
    FileReader: FakeFileReader,
    captureAgentCheckpoint: () => {},
    agentDocumentSignature: () => 'sig',
    controller: { getProject: () => project, applySyncOperation: (op) => applied.push(op) },
    isImageFileName: (name) => /\.(png|jpe?g|webp|gif)$/i.test(name),
    getNodeIdByPath: () => null,
    collaboration: {
      isConnected: () => synced,
      isDirectoryBacked: () => directory,
      uploadAsset: async (path, content) => uploads.push({ path, content }),
      publishOperation: async (op) => { published.push(op); return { revision: op.baseRevision + 1 }; }
    },
    workspaceMode: synced ? 'synced' : 'private',
    showToast: (message) => toasts.push(message),
    registerAgentDecorations: () => {}
  };
  const api = new Function(...Object.keys(deps), `${applySource}\nreturn { acceptAgentOperations, generatedImageUrl };`)(...Object.values(deps));
  const guard = { current: () => true, signature: 'sig', baseRevision: 7 };
  return { api, guard, fetches, applied, published, uploads, toasts };
}

const imageOp = () => ({
  proposalId: 'op-1', type: 'create-file', parentPath: 'Art', name: 'mara.png', content: '',
  generatedImage: { id: 'a'.repeat(32), mime: 'image/png', prompt: 'Mara at the lamp' }
});

test('a generated image is fetched for the signed-in account and saved locally as a data URL', async () => {
  const h = harness();
  const op = imageOp();
  await h.api.acceptAgentOperations([op], { batchId: 'b' }, h.guard);
  assert.equal(h.fetches[0], `https://notes.example/api/generated?token=acct&id=${'a'.repeat(32)}`);
  assert.deepEqual(h.applied, [{ type: 'create-file', parentPath: 'Art', name: 'mara.png', content: dataUrl }]);
  assert.equal(op.proposalState, 'accepted');
});

test('in a directory-backed cloud workspace the bytes are uploaded, not sent in the operation', async () => {
  const h = harness({ synced: true, directory: true });
  await h.api.acceptAgentOperations([imageOp()], { batchId: 'b' }, h.guard);
  assert.deepEqual(h.uploads, [{ path: 'Art/mara.png', content: dataUrl }]);
  assert.equal(h.published[0].content, '');
  assert.equal(h.published[0].generatedImage, undefined);
  assert.equal(h.published[0].expectedRevision, 7);
});

test('a PIN-shared (not directory-backed) session sends the image in the operation', async () => {
  const h = harness({ synced: true, directory: false });
  await h.api.acceptAgentOperations([imageOp()], { batchId: 'b' }, h.guard);
  assert.equal(h.uploads.length, 0);
  assert.equal(h.published[0].content, dataUrl);
});

test('an expired image or a signed-out user leaves the edit unapplied with a reason', async () => {
  let h = harness({ status: 404 });
  let op = imageOp();
  await h.api.acceptAgentOperations([op], { batchId: 'b' }, h.guard);
  assert.equal(op.proposalState, 'stale');
  assert.match(h.toasts[0], /expired/);
  h = harness({ account: null });
  op = imageOp();
  await h.api.acceptAgentOperations([op], { batchId: 'b' }, h.guard);
  assert.equal(h.fetches.length, 0);
  assert.equal(op.proposalState, 'stale');
  assert.match(h.toasts[0], /Sign in/);
});

test('the agent still cannot write image files directly', async () => {
  const h = harness();
  const op = { proposalId: 'op-2', type: 'create-file', parentPath: '', name: 'x.png', content: 'data:image/png;base64,AAAA' };
  await h.api.acceptAgentOperations([op], { batchId: 'b' }, h.guard);
  assert.equal(op.proposalState, 'stale');
  assert.equal(h.applied.length, 0);
});
