const SETTINGS_KEY = "mdnotes.settings.v1";

function createDefaultSettings() {
  return {
    theme: "system",
    serverUrl: "",
    serverPin: "",
    displayName: "",
    explorer: "expanded",
    explorerAnchor: "docked",
    autoSave: true,
    preview: "shown",
    source: "shown",
    wordWrap: true,
    indentStyle: "tab",
    // Source (editor + gutter) typography. sourceFontFamily is a bare family
    // name the user picked or typed; "" means the default monospace stack. A
    // font that isn't installed simply falls back to that stack.
    sourceFontSize: 13,
    sourceFontFamily: "",
    explorerFilter: "all",
    debugPanel: false,
    sidebarWidth: 280,
    previewWidth: 420,
    chatPanel: "hidden",
    chatWidth: 420,
    previewWidthCustomized: false,
    debugPanelHeight: 180,
    bmapGenerateScope: "connected",
    bmapAutoPan: true,
    autoReconnect: true,
    chatModel: "",
    // Runtime memory: true while the user has an active/intended session, so the
    // app can auto-reconnect on next load or after a dropped connection.
    wasConnected: false,
    showFormatToolbar: false,
    // Accounts mode (state 3) auto-restore. Credentials are plaintext (matching
    // the server whitelist choice). accountSuccess maps a normalized server URL
    // to the username that last logged in there successfully — auto-login only
    // fires for a server+username that previously succeeded. lastWorkspace is the
    // last-opened cloud workspace, reopened on boot.
    accountUsername: "",
    accountPassword: "",
    accountSuccess: {},
    lastWorkspace: null,
    // Agent (chat) source: "server" uses this server's configured key; "own"
    // sends the user's own key to the proxy (works from anywhere, their bill).
    agentSource: "server",
    agentApiKey: "",
    agentApiUrl: "",
    agentModel: "",
    // "team/path" when the locally-stored project is a cloud workspace's content,
    // so a reload with unsaved edits can push local instead of pulling over it.
    syncedProjectId: null,
    // Server revision this browser's copy of syncedProjectId was last in sync
    // with. Used to decide push-vs-pull on reopen; null means "unknown, treat as
    // stale and pull" so an out-of-date device can never overwrite newer work.
    syncedRevision: null
  };
}

function loadSettings() {
  const defaults = createDefaultSettings();

  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!value) {
      return defaults;
    }

    const parsed = JSON.parse(value);
    const hasPreviewWidth = Object.prototype.hasOwnProperty.call(parsed, "previewWidth");
    const hasPreviewWidthCustomized = Object.prototype.hasOwnProperty.call(parsed, "previewWidthCustomized");
    const migratedPreviewWidthCustomized = hasPreviewWidthCustomized
      ? Boolean(parsed.previewWidthCustomized)
      : hasPreviewWidth && Number(parsed.previewWidth) !== defaults.previewWidth;

    return {
      ...defaults,
      ...parsed,
      previewWidthCustomized: migratedPreviewWidthCustomized
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

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

export { applyEditorFont, applyTheme, clampSourceFontSize, cssFontFamily, loadSettings, saveSettings };