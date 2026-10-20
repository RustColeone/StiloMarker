// The page's theme (Settings → Appearance → Theme): "system" (the device's
// light or dark), or a theme's id: the core's Light and Dark, or one an
// extension contributes (model/themes.js). Applied as its base on
// <html data-theme> ("light" or "dark", which styles.css colours) and its own
// colours as the tokens' values on <html>; the browser's bar takes the page's
// background. Kept in this browser ("mdnotes.theme.v1"), so app/boot-theme.js
// shows it before the modules load.
import { ignore } from "../../../kernel/index.js";
import { THEME_TOKENS, paletteOf, themeFor } from "../model/themes.js";

export const KEPT_THEME = "mdnotes.theme.v1";

export const prefersDark = () => Boolean(globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches);

// Returns the theme applied.
export function applyTheme(setting, themes, { doc = globalThis.document, store = globalThis.localStorage, dark = prefersDark() } = {}) {
  const theme = themeFor(setting, themes, dark);
  if (!doc) return theme;
  const root = doc.documentElement;
  root.dataset.theme = theme.base;
  root.dataset.themeId = theme.id;
  for (const token of THEME_TOKENS) root.style.removeProperty(`--${token}`);
  for (const [token, value] of Object.entries(theme.colors ?? {})) root.style.setProperty(`--${token}`, value);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", paletteOf(theme).bg);
  try {
    store?.setItem(KEPT_THEME, JSON.stringify({ setting, base: theme.base, colors: theme.colors ?? {} }));
  } catch (error) {
    ignore(error, "keeping the theme failed: storage is blocked, so the next page shows Light until the app starts");
  }
  return theme;
}
