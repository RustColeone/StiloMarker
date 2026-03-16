const SETTINGS_KEY = "mdnotes.settings.v1";

function loadSettings() {
  try {
    const value = globalThis.localStorage?.getItem(SETTINGS_KEY);
    if (!value) {
      return {
        theme: "system",
        serverUrl: "http://localhost:8000",
        serverPin: "",
        displayName: "",
        explorer: "expanded",
        preview: "shown",
        wordWrap: true,
        indentStyle: "tab",
        explorerFilter: "all",
        debugPanel: false,
        sidebarWidth: 280,
        previewWidth: 420,
        debugPanelHeight: 180
      };
    }
    return {
      theme: "system",
      serverUrl: "http://localhost:8000",
      serverPin: "",
      displayName: "",
      explorer: "expanded",
      preview: "shown",
      wordWrap: true,
      indentStyle: "tab",
      explorerFilter: "all",
      debugPanel: false,
      sidebarWidth: 280,
      previewWidth: 420,
      debugPanelHeight: 180,
      ...JSON.parse(value)
    };
  } catch {
    return {
      theme: "system",
      serverUrl: "http://localhost:8000",
      serverPin: "",
      displayName: "",
      explorer: "expanded",
      preview: "shown",
      wordWrap: true,
      indentStyle: "tab",
        explorerFilter: "all",
        debugPanel: false,
      sidebarWidth: 280,
      previewWidth: 420,
      debugPanelHeight: 180
    };
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