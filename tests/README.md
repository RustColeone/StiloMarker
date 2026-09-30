# Tests

Unit tests for the mdnotes / StlioMarker workspace. They run on the built-in
[Node.js test runner](https://nodejs.org/api/test.html) — **no dependencies to
install**.

## Run everything (the easy way)

| Platform | Command |
|----------|---------|
| Windows  | `tests\run-tests.bat` (or double-click it) |
| Linux/macOS | `./tests/run-tests.sh` |

Both scripts run the Node.js suite, Python backend self-test, and storage-failure regressions.

## Other entry points

```bash
npm run test:reliability # Sync recovery + broker/storage regressions, no HTTP listener
npm test                 # Node.js unit tests only (node --test tests/)
npm run selftest         # same suite via tools/selftest.mjs (prints "Self-test passed.")
npm run backend:selftest # Python backend self-test only
npm run test:all         # Node self-test + Python backend self-test
node --test tests/       # raw test runner
```

## Layout

| File | Covers |
|------|--------|
| `helpers/mocks.mjs` | Shared module loader + in-memory File System Access mocks (not a test file). |
| `project-model.test.mjs` | Project tree, file/folder ops, sync operations. |
| `rendering.test.mjs` | Markdown rendering + mtree module map. |
| `bmap-service.test.mjs` | `.bmap` node/connector parsing, normalization, serialization. |
| `urldb-service.test.mjs` | `.urldb` serialize/parse/update/remove round-trips. |
| `zip-fs.test.mjs` | ZIP import/export and File System Access persistence. |
| `collaboration-runtime.test.mjs` | Production sync runtime: reconnect conflicts, recovery snapshots, request races, patch rejection, join gaps, Unicode. |
| `server-reliability.test.py` | Production broker: UTF-16, disk-failure recovery, ordered events, and existing broker regressions. |
| `sync-service.test.mjs` | Collaboration transport against a mock HTTP server. |
| `agent-collaborator.test.mjs` | Agent proposal round-trips + agent-feature wiring. |
| `project-structure.test.mjs` | Required files, `index.html` ids, and source-symbol wiring. |

## Adding a test

Create `tests/<name>.test.mjs` and import shared helpers:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadModules } from "./helpers/mocks.mjs";

const { projectModel } = await loadModules();

test("describes the behavior", () => {
  assert.equal(1 + 1, 2);
});
```

The runner auto-discovers any file matching `*.test.mjs`.
