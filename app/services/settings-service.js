const SETTINGS_KEY = "mdnotes.settings.v1";

function createDefaultSettings() {
  return {
    theme: "system",
    serverUrl: "",
    serverPin: "",
    displayName: "",
    explorer: "expanded",
    preview: "shown",
    source: "shown",
    wordWrap: true,
    indentStyle: "tab",
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
    lastWorkspace: null
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

export { applyTheme, loadSettings, saveSettings };