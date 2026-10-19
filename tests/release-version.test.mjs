import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../app/version.js';
import { syncVersion } from '../app/modules/sync/index.js';
import { CACHE_PREFIX } from '../app/modules/shell/adapters/offline.js';

test('release labels agree while the sync gate remains numeric and independent', async () => {
  const root = new URL('../', import.meta.url);
  const [manifest, worker, contract] = await Promise.all(['package.json', 'service-worker.js', 'protocol/sync.contract.json'].map(
    (path) => readFile(new URL(path, root), 'utf8')
  ));
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(APP_VERSION, JSON.parse(manifest).version);
  // The worker's cache is named for this version, under the prefix Clear All Cache removes.
  assert.ok(worker.includes(`const CACHE_NAME = "${CACHE_PREFIX}v${APP_VERSION}";`));
  assert.ok(worker.includes('"./app/version.js"'));
  // The sync level is Sync's contract's, on both ends.
  assert.equal(syncVersion, JSON.parse(contract).version);
});
