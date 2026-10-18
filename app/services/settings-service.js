// Legacy (before the module restructure): applying settings to the page (the
// theme, the source pane's typography) and where Identity keeps the stored
// sign-in. The settings themselves are Shell's (shell.settings).
function resolveTheme(theme) {
  if (theme === "system") {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }
  return theme;
}

function applyTheme(settings) {
  const theme = resolveTheme(settings.theme);
  document.documentElement.dataset.theme = theme;
}

const SOURCE_FONT_SIZE_MIN = 10;
const SOURCE_FONT_SIZE_MAX = 28;

function clampSourceFontSize(value) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return 13;
  return Math.min(SOURCE_FONT_SIZE_MAX, Math.max(SOURCE_FONT_SIZE_MIN, n));
}

/** A user-supplied family name as a safe CSS font-family value. Strips the
 *  characters that could break out of the declaration, then quotes it and keeps
 *  the default mono stack as the fallback for a font that isn't installed. */
function cssFontFamily(name) {
  const clean = String(name ?? "").replace(/["';{}<>\\]/g, "").trim();
  return clean ? `"${clean}", var(--font-mono)` : "var(--font-mono)";
}

/** Push the source-pane typography settings onto the :root CSS variables that
 *  the editor and its gutter read. */
function applyEditorFont(settings) {
  const root = document.documentElement;
  root.style.setProperty("--editor-font-size", `${clampSourceFontSize(settings?.sourceFontSize)}px`);
  root.style.setProperty("--editor-font-family", cssFontFamily(settings?.sourceFontFamily));
}

export { applyEditorFont, applyTheme, clampSourceFontSize, cssFontFamily };

// Where Identity keeps the account's stored sign-in: in these settings.
export function signInSettings(settings) {
  return {
    read: () => ({ username: settings.accountUsername, password: settings.accountPassword, proven: settings.accountSuccess }),
    write(stored) {
      settings.change({
        ...("username" in stored ? { accountUsername: stored.username } : {}),
        ...("password" in stored ? { accountPassword: stored.password } : {}),
        ...("proven" in stored ? { accountSuccess: stored.proven } : {})
      }, "the stored sign-in");
    }
  };
}
