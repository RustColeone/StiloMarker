// The service worker's fetch handler, run in a stand-in for the browser: what
// it answers from its caches and what it leaves to the network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { resolveFromRoot } from "./helpers/mocks.mjs";

const ORIGIN = "https://rustcoleone.github.io";

async function loadWorker() {
  const listeners = {};
  const self = {
    location: new URL(`${ORIGIN}/StiloMarker/service-worker.js`),
    addEventListener: (type, run) => { listeners[type] = run; }
  };
  const source = await readFile(resolveFromRoot("service-worker.js"), "utf8");
  const pending = () => new Promise(() => {});  // what it answers is not looked at, only that it does
  vm.runInNewContext(source, { self, URL, importScripts: () => {}, caches: { open: pending }, fetch: pending, console });
  // Whether the worker answers this request itself (true) or lets the browser fetch it (false).
  return (path, { method = "GET", accept = "*/*" } = {}) => {
    let answered = false;
    listeners.fetch({
      request: { method, url: new URL(path, ORIGIN).href, headers: { get: (name) => (name === "accept" ? accept : null) } },
      respondWith: () => { answered = true; }
    });
    return answered;
  };
}

test("the worker answers the app's files and leaves the server, the stream and the docs to the network", async () => {
  const answers = await loadWorker();
  assert.equal(answers("/StiloMarker/app/main.js"), true);
  assert.equal(answers("/StiloMarker/index.html"), true);
  assert.equal(answers("/StiloMarker/vendor/mathjax/3.2.2/tex-svg.js"), true);
  assert.equal(answers("/StiloMarker/api/ping"), false);
  assert.equal(answers("/StiloMarker/api/events/stream", { accept: "text/event-stream" }), false);
  assert.equal(answers("/StiloMarker/app/main.js", { method: "POST" }), false);
  assert.equal(answers("https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"), false);
  // The architecture page changes without a new version of the app: never kept with it.
  assert.equal(answers("/StiloMarker/docs/architecture/index.html"), false);
  assert.equal(answers("/StiloMarker/docs/architecture/data.js"), false);
  assert.equal(answers("/docs/architecture/app.js"), false);
});
