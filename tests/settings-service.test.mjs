import test from "node:test";
import assert from "node:assert/strict";

import { clampSourceFontSize, cssFontFamily, loadSettings, patchStoredSettings } from "../app/services/settings-service.js";

test("settings: source font size clamps to a sane range", () => {
  assert.equal(clampSourceFontSize(13), 13);
  assert.equal(clampSourceFontSize("16"), 16);
  assert.equal(clampSourceFontSize(2), 10);      // below min
  assert.equal(clampSourceFontSize(999), 28);    // above max
  assert.equal(clampSourceFontSize("abc"), 13);  // unparseable -> default
  assert.equal(clampSourceFontSize(undefined), 13);
  assert.equal(clampSourceFontSize(null), 13);
});

test("settings: source font family falls back and is CSS-safe", () => {
  // Empty -> the default monospace stack only.
  assert.equal(cssFontFamily(""), "var(--font-mono)");
  assert.equal(cssFontFamily(undefined), "var(--font-mono)");
  // A real name is quoted and keeps the stack as a fallback, so a font that
  // isn't installed degrades instead of breaking the pane.
  assert.equal(cssFontFamily("JetBrains Mono"), '"JetBrains Mono", var(--font-mono)');
  assert.equal(cssFontFamily("  Fira Code  "), '"Fira Code", var(--font-mono)');
  // Characters that could break out of the declaration are stripped.
  const injected = cssFontFamily('X"; background: url(evil); }body{color:red');
  assert.ok(!injected.includes(";"), `must not contain ';': ${injected}`);
  assert.ok(!injected.includes("{") && !injected.includes("}"), `must not contain braces: ${injected}`);
  assert.equal(injected.match(/"/g).length, 2, "exactly one quoted family name");
});

test("settings: defaults include source typography", () => {
  const defaults = loadSettings();
  assert.equal(defaults.sourceFontSize, 13);
  assert.equal(defaults.sourceFontFamily, "");
});

test("settings: patchStoredSettings merges into what is stored, never clobbers", () => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v))
  };
  try {
    const KEY = "mdnotes.settings.v1";
    // Another tab already saved a font change this tab never saw.
    store.set(KEY, JSON.stringify({ sourceFontSize: 20, syncedProjectId: "red/Novel", syncedRevision: 3 }));
    patchStoredSettings((stored) => (stored.syncedProjectId === "red/Novel" ? { syncedRevision: 9 } : null));
    const merged = JSON.parse(store.get(KEY));
    assert.equal(merged.sourceFontSize, 20, "unrelated field survives");
    assert.equal(merged.syncedRevision, 9, "patched field written");

    // Different workspace stored: returning null must write nothing at all.
    store.set(KEY, JSON.stringify({ syncedProjectId: "red/Other", syncedRevision: 5 }));
    patchStoredSettings((stored) => (stored.syncedProjectId === "red/Novel" ? { syncedRevision: 99 } : null));
    assert.deepEqual(JSON.parse(store.get(KEY)), { syncedProjectId: "red/Other", syncedRevision: 5 });

    // Corrupt storage is ignored rather than throwing out of an unload handler.
    store.set(KEY, "{not json");
    assert.doesNotThrow(() => patchStoredSettings(() => ({ syncedRevision: 1 })));
  } finally {
    globalThis.localStorage = previous;
  }
});
