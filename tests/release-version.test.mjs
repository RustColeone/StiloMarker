import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION, SYNC_PROTOCOL_VERSION } from '../app/version.js';
import { CACHE_NAME } from '../app/services/offline-service.js';

test('release labels agree while the sync gate remains numeric and independent', async () => {
  const root = new URL('../', import.meta.url);
  const [manifest, worker, backend] = await Promise.all(['package.json', 'service-worker.js', 'server/mdnotes_server.py'].map(
    (path) => readFile(new URL(path, root), 'utf8')
  ));
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, JSON.parse(manifest).version);
  assert.equal(CACHE_NAME, `mdnotes-shell-v${APP_VERSION}`);
  assert.ok(worker.includes(`const CACHE_NAME = "${CACHE_NAME}";`));
  assert.ok(worker.includes('"./app/version.js"'));
  assert.equal(Number.isInteger(SYNC_PROTOCOL_VERSION), true);
  assert.equal(SYNC_PROTOCOL_VERSION, Number(backend.match(/MIN_CLIENT_VERSION = _read_int_env\("MDNOTES_MIN_CLIENT_VERSION", (\d+)/)[1]));
});
