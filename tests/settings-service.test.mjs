import test from "node:test";
import assert from "node:assert/strict";

import { clampSourceFontSize, cssFontFamily, loadSettings } from "../app/services/settings-service.js";

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
