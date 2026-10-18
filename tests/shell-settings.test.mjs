// Shell's settings (app/modules/shell): read-only to everyone, changed through
// settings.change, saved key by key, secrets kept out of the trace.
import test from "node:test";
import assert from "node:assert/strict";

import { createLiveView, createState, createTrace } from "../app/kernel/index.js";
import { SECRET_SETTINGS, keysToSave } from "../app/modules/shell/service/settings.js";
import { createDefaultSettings, loadSettings, patchStoredSettings } from "../app/modules/shell/adapters/settings-store.js";

function fresh(initial = { theme: "light", agentApiKey: "", sidebarWidth: 280, syncedProjectId: null, syncedRevision: null }) {
  const log = createTrace({ now: () => 0 });
  const state = createState("shell", initial, log, { secret: SECRET_SETTINGS });
  return { settings: createLiveView(state), state, log };
}

test("settings read the current value; a plain assignment throws", () => {
  const { settings } = fresh();
  assert.equal(settings.theme, "light");
  settings.change({ theme: "dark" });
  assert.equal(settings.theme, "dark");
  assert.throws(() => { settings.theme = "light"; }, /read-only here: change it with \.change/);
  assert.throws(() => { delete settings.theme; }, TypeError);
  assert.deepEqual({ ...settings }.theme, "dark", "spreading reads the current values");
  assert.equal(JSON.parse(JSON.stringify(settings)).theme, "dark");
  assert.ok("sidebarWidth" in settings);
  assert.throws(() => settings.change({ thme: "x" }), /not part of its state/, "a misspelt setting is refused");
});

test("each change names where it came from, and secrets stay out of the trace", () => {
  const { settings, log } = fresh();
  settings.change({ agentApiKey: "sk-secret", sidebarWidth: 300 });
  const entry = log.entries().at(-1);
  assert.match(entry.message, /^changed at .*tests\/shell-settings\.test\.mjs:\d+$/);
  assert.equal(entry.detail, "agentApiKey=(hidden) sidebarWidth=300");
  settings.change({ theme: "dark" }, "the theme picker");
  assert.equal(log.entries().at(-1).message, "the theme picker");
  const heard = [];
  const off = settings.on((view, changed) => heard.push([view.theme, changed]));
  settings.change({ theme: "light" });
  off();
  assert.deepEqual(heard, [["light", ["theme"]]]);
});

test("a change saves its keys only; the sync revision only with its workspace", () => {
  assert.deepEqual(keysToSave(["theme"]), ["theme"]);
  assert.deepEqual(keysToSave(["syncedRevision"]), [], "held until the page goes away (a guarded merge)");
  assert.deepEqual(keysToSave(["syncedProjectId"]), ["syncedProjectId", "syncedRevision"]);
  const stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) };
  try {
    stored.set("mdnotes.settings.v1", JSON.stringify({ theme: "dark", sidebarWidth: 500 }));
    const loaded = loadSettings();
    assert.equal(loaded.theme, "dark");
    assert.equal(loaded.lastLocalProject, null, "every key has a default");
    assert.ok(Object.keys(createDefaultSettings()).includes("lastLocalProject"));
    // Another tab changed sidebarWidth meanwhile; saving the theme leaves it alone.
    stored.set("mdnotes.settings.v1", JSON.stringify({ theme: "dark", sidebarWidth: 640 }));
    patchStoredSettings(() => ({ theme: "light" }));
    assert.deepEqual(JSON.parse(stored.get("mdnotes.settings.v1")), { theme: "light", sidebarWidth: 640 });
  } finally {
    delete globalThis.localStorage;
  }
});
