// The page's theme: "light", "dark", or "system" (the device's choice).
export function resolveTheme(theme, prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches) {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

export function applyTheme(theme, doc = globalThis.document) {
  if (doc) doc.documentElement.dataset.theme = resolveTheme(theme);
}
