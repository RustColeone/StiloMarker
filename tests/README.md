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
| `collaboration-broker.test.mjs` | Two real clients + the Python broker over stdio, both send/ack orders. |
| `text-patch.test.mjs` | Exhaustive short splice-pair convergence and overlap rejection. |
| `project-save.test.mjs` | Queued writes, errors, typing during saves, collapsed folders, rename retries, UI save handlers. |
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


## Chat and mobile regression checks

- `chat-sync.test.mjs`: simultaneous chat saves, conflict merging, late responses,
  local drafts/selection, cache metadata, IME input, viewport resizing, and wire compatibility.
- `chat-turn.test.mjs`: the production turn handlers under workspace changes,
  transport cancellation, stale proposals, and delayed delete confirmation.
- `mobile-chat-browser.py`: optional Playwright browser test using the public
  origin, isolated browser storage, staged static responses, and mocked chat APIs.
  Checks five viewport sizes, composing/sending, attachments, draft switching,
  scroll/selection preservation, and cloud chat isolation. It makes no paid model
  calls and does not open a real user's cloud project.

With Python Playwright and a Chromium browser installed:

```bash
python3 tests/mobile-chat-browser.py
```

Set `STILO_BROWSER` to an existing Chromium executable if needed. Set
`STILO_TEST_URL` to another deployed public origin; no localhost listener is needed.
This emulates mobile Chromium. Physical iOS keyboard behavior still needs a device check.
