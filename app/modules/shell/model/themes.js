// Themes: the colours the page is drawn with, as values of its colour tokens
// (the CSS custom properties app/styles.css defines on :root, e.g. --accent).
// Light and Dark are the core's: their values are styles.css's, repeated here
// for the Settings picker's cards (tests/themes.test.mjs keeps the two the
// same). Extensions add more in their manifests (contributes.themes:
// { id, label, base: "light" | "dark", colors: { token: value } }), copied
// for the browser by tools/protocol-sync.mjs. A theme starts from its base's
// values and changes the tokens it names. Pure, so it runs in Node tests.

// Every token a theme may set. Syntax tokens colour highlighted source: the
// Markdown ones (heading … code) and the code ones any highlighter uses
// (keyword … constant).
export const THEME_TOKENS = Object.freeze([
  "bg", "surface-0", "surface-1", "surface-2", "surface-3", "sidebar", "editor", "panel", "menu", "dialog",
  "border", "border-strong", "text", "text-muted", "text-dim",
  "accent", "accent-strong", "accent-soft", "text-on-accent", "success", "warning", "danger",
  "status-bg", "status-text", "link", "selection",
  "syntax-heading", "syntax-strong", "syntax-emphasis", "syntax-link", "syntax-quote", "syntax-code",
  "syntax-keyword", "syntax-string", "syntax-comment", "syntax-number", "syntax-type", "syntax-attribute",
  "syntax-punctuation", "syntax-constant"
]);

const LIGHT = Object.freeze({
  "bg": "#f3f3f3", "surface-0": "#ffffff", "surface-1": "#f8f8f8", "surface-2": "#efefef", "surface-3": "#e1e1e1",
  "sidebar": "#f7f7f7", "editor": "#ffffff", "panel": "#fbfbfb", "menu": "#ffffff", "dialog": "#f5f5f5",
  "border": "#d4d4d4", "border-strong": "#c6c6c6", "text": "#1f1f1f", "text-muted": "#616161", "text-dim": "#7a7a7a",
  "accent": "#0e639c", "accent-strong": "#1177bb", "accent-soft": "rgba(14, 99, 156, 0.14)", "text-on-accent": "#ffffff",
  "success": "#16825d", "warning": "#b89500", "danger": "#c74e39",
  "status-bg": "#007acc", "status-text": "#ffffff", "link": "#0a6fb5", "selection": "rgba(14, 99, 156, 0.28)",
  "syntax-heading": "#1177bb", "syntax-strong": "#1f1f1f", "syntax-emphasis": "#6a3fa0", "syntax-link": "#0a6fb5",
  "syntax-quote": "#3c7a32", "syntax-code": "#a1401f",
  "syntax-keyword": "#1a4fbf", "syntax-string": "#a31515", "syntax-comment": "#4a7c3a", "syntax-number": "#098658",
  "syntax-type": "#267f99", "syntax-attribute": "#b8331b", "syntax-punctuation": "#a3239b", "syntax-constant": "#795e26"
});

const DARK = Object.freeze({
  "bg": "#1e1e1e", "surface-0": "#252526", "surface-1": "#2d2d2d", "surface-2": "#313131", "surface-3": "#3c3c3c",
  "sidebar": "#252526", "editor": "#1e1e1e", "panel": "#252526", "menu": "#252526", "dialog": "#252526",
  "border": "#2f2f2f", "border-strong": "#3c3c3c", "text": "#cccccc", "text-muted": "#9d9d9d", "text-dim": "#858585",
  "accent": "#0e639c", "accent-strong": "#3794ff", "accent-soft": "rgba(55, 148, 255, 0.18)", "text-on-accent": "#ffffff",
  "success": "#4ec9b0", "warning": "#d7ba7d", "danger": "#f48771",
  "status-bg": "#007acc", "status-text": "#ffffff", "link": "#3794ff", "selection": "rgba(14, 99, 156, 0.28)",
  "syntax-heading": "#3794ff", "syntax-strong": "#dcdcaa", "syntax-emphasis": "#9cdcfe", "syntax-link": "#4fc1ff",
  "syntax-quote": "#6a9955", "syntax-code": "#ce9178",
  "syntax-keyword": "#569cd6", "syntax-string": "#ce9178", "syntax-comment": "#6a9955", "syntax-number": "#b5cea8",
  "syntax-type": "#4ec9b0", "syntax-attribute": "#9cdcfe", "syntax-punctuation": "#c586c0", "syntax-constant": "#d7ba7d"
});

export const BASES = Object.freeze({ light: LIGHT, dark: DARK });

export const CORE_THEMES = Object.freeze([
  Object.freeze({ id: "light", label: "Light", base: "light", colors: Object.freeze({}) }),
  Object.freeze({ id: "dark", label: "Dark", base: "dark", colors: Object.freeze({}) })
]);

const THEME_ID = /^[a-z][a-z0-9-]*$/;
// A colour as CSS reads it, and nothing that could end the declaration.
const COLOUR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)|[a-z]+)$/;

// Throws, naming what is wrong, unless the theme can be applied.
export function checkTheme(theme) {
  if (!theme || !THEME_ID.test(theme.id ?? "")) throw new Error(`A theme's id is lower-case words joined by "-": ${theme?.id}`);
  if (theme.id === "system") throw new Error(`"system" is not a theme's id: it means the device's light or dark`);
  if (typeof theme.label !== "string" || !theme.label) throw new Error(`Theme ${theme.id} needs a label`);
  if (!(theme.base in BASES)) throw new Error(`Theme ${theme.id}: base is "light" or "dark"`);
  for (const [token, value] of Object.entries(theme.colors ?? {})) {
    if (!THEME_TOKENS.includes(token)) throw new Error(`Theme ${theme.id}: no token "${token}"`);
    if (typeof value !== "string" || !COLOUR.test(value.trim())) throw new Error(`Theme ${theme.id}: "${token}" is not a colour: ${value}`);
  }
}

// The theme a setting means: "system" is Light or Dark as the device prefers;
// an id no theme has (an extension removed) falls back the same way.
export function themeFor(setting, themes, prefersDark = false) {
  const fallback = themes.find((theme) => theme.id === (prefersDark ? "dark" : "light")) ?? CORE_THEMES[prefersDark ? 1 : 0];
  if (setting === "system") return fallback;
  return themes.find((theme) => theme.id === setting) ?? fallback;
}

// Every token's value in a theme.
export function paletteOf(theme) {
  return { ...BASES[theme.base], ...(theme.colors ?? {}) };
}

// The themes the page offers: the core's, then each one an extension
// contributes that can be applied (one that can't, or whose id is taken, is
// left out and said through skipped(id, why)).
export function usableThemes(contributed, skipped = () => {}) {
  const out = [...CORE_THEMES];
  for (const theme of contributed) {
    try {
      checkTheme(theme);
      if (out.some((each) => each.id === theme.id)) throw new Error(`the id "${theme.id}" is taken`);
      out.push(Object.freeze({ id: theme.id, label: theme.label, base: theme.base, colors: Object.freeze({ ...theme.colors }) }));
    } catch (error) {
      skipped(theme?.id, error.message);
    }
  }
  return Object.freeze(out);
}
