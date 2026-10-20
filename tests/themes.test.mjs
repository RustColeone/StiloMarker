// Themes (Shell's): the tokens a theme may set, Light and Dark as styles.css
// draws them, the themes extensions contribute, and every theme readable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { BASES, CORE_THEMES, THEME_TOKENS, checkTheme, paletteOf, themeFor, usableThemes } from "../app/modules/shell/model/themes.js";
import contributed from "../app/modules/shell/model/contributed-themes.js";
import { KEPT_THEME, applyTheme } from "../app/modules/shell/adapters/theme.js";

const css = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return css.slice(start, css.indexOf("}", start));
};
const declared = (text) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));

test("themes: Light and Dark are styles.css's values, and every token is declared for both", () => {
  const light = declared(block(":root"));
  const dark = declared(block(':root[data-theme="dark"]'));
  for (const token of THEME_TOKENS) {
    assert.equal(BASES.light[token], light[token], `--${token} in :root`);
    assert.equal(BASES.dark[token], dark[token], `--${token} in the dark block`);
  }
  assert.deepEqual(Object.keys(BASES.light).sort(), [...THEME_TOKENS].sort());
  assert.deepEqual(Object.keys(BASES.dark).sort(), [...THEME_TOKENS].sort());
});

test("themes: a theme names an id, a label, a base and colours of known tokens only", () => {
  const good = { id: "sea", label: "Sea", base: "dark", colors: { bg: "#001020", accent: "rgba(0, 120, 200, 0.5)" } };
  checkTheme(good);
  assert.throws(() => checkTheme({ ...good, id: "Sea Blue" }), /id/);
  assert.throws(() => checkTheme({ ...good, id: "system" }), /system/);
  assert.throws(() => checkTheme({ ...good, label: "" }), /label/);
  assert.throws(() => checkTheme({ ...good, base: "grey" }), /base/);
  assert.throws(() => checkTheme({ ...good, colors: { "font-ui": "#000" } }), /no token "font-ui"/);
  assert.throws(() => checkTheme({ ...good, colors: { bg: "red; background: url(x)" } }), /not a colour/);
  const skipped = [];
  const themes = usableThemes([good, { ...good, label: "Again" }, { ...good, id: "light" }, { id: "bad" }], (id, why) => skipped.push([id, why]));
  assert.deepEqual(themes.map((theme) => theme.id), ["light", "dark", "sea"]);
  assert.deepEqual(skipped.map(([id]) => id), ["sea", "light", "bad"]);
});

test("themes: System is Light or Dark as the device prefers; an unknown theme falls back the same way", () => {
  const themes = usableThemes([{ id: "sea", label: "Sea", base: "dark", colors: {} }]);
  assert.equal(themeFor("system", themes, false).id, "light");
  assert.equal(themeFor("system", themes, true).id, "dark");
  assert.equal(themeFor("sea", themes).id, "sea");
  assert.equal(themeFor("removed", themes, true).id, "dark");
  assert.equal(paletteOf(themes[2]).text, BASES.dark.text, "a theme starts from its base");
});

test("themes: every contributed theme can be applied, with its own id", () => {
  const ids = contributed.map((theme) => theme.id);
  assert.deepEqual(ids, ["paper", "midnight", "forest", "high-contrast"]);
  const skipped = [];
  assert.equal(usableThemes(contributed, (id, why) => skipped.push(`${id}: ${why}`)).length, CORE_THEMES.length + contributed.length);
  assert.deepEqual(skipped, []);
});

// WCAG's contrast ratio between two "#rrggbb" colours.
const luminance = (hex) => {
  const digits = hex.replace("#", "");
  const full = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits.slice(0, 6);
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
};
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test("themes: every theme is readable (text, links and highlighted source against the editor)", () => {
  for (const theme of usableThemes(contributed)) {
    const palette = paletteOf(theme);
    const strict = theme.id === "high-contrast";
    const at = (token, against, least) => {
      const ratio = contrast(palette[token], palette[against]);
      assert.ok(ratio >= least, `${theme.id}: --${token} on --${against} is ${ratio.toFixed(1)}:1, under ${least}:1`);
    };
    at("text", "editor", strict ? 15 : 7);
    at("text-muted", "editor", 4.5);
    at("text-dim", "editor", 3.5);
    at("link", "editor", strict ? 7 : 4.5);
    for (const token of THEME_TOKENS.filter((name) => name.startsWith("syntax-"))) at(token, "editor", strict ? 7 : 4);
    at("status-text", "status-bg", 4.5);
    at("text-on-accent", "accent", 4.5);
  }
});

test("applying a theme: its base, its colours on the page (the last theme's taken off), kept for the next page", () => {
  const props = new Map();
  const meta = { content: "", setAttribute(name, value) { this[name] = value; } };
  const doc = { documentElement: { dataset: {}, style: { setProperty: (name, value) => props.set(name, value), removeProperty: (name) => props.delete(name) } },
    querySelector: (selector) => (selector === 'meta[name="theme-color"]' ? meta : null) };
  const kept = new Map();
  const store = { setItem: (key, value) => kept.set(key, value) };
  const themes = usableThemes(contributed);
  props.set("--editor-font-size", "13px");
  applyTheme("paper", themes, { doc, store, dark: false });
  assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.themeId], ["light", "paper"]);
  assert.equal(props.get("--bg"), "#efe8dc");
  assert.equal(meta.content, "#efe8dc");
  assert.deepEqual(JSON.parse(kept.get(KEPT_THEME)).base, "light");
  applyTheme("system", themes, { doc, store, dark: true });
  assert.deepEqual([doc.documentElement.dataset.theme, doc.documentElement.dataset.themeId], ["dark", "dark"]);
  assert.ok(!props.has("--bg"), "Paper's colours are gone");
  assert.equal(props.get("--editor-font-size"), "13px", "what is not a theme's is left alone");
  assert.equal(meta.content, BASES.dark.bg);
  assert.equal(JSON.parse(kept.get(KEPT_THEME)).setting, "system");
});
