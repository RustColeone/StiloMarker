// Where the app's settings are kept: this browser's localStorage. Loading
// fills in the defaults; saving merges only the changed keys into what is
// stored now, so a tab never writes back values another tab changed since it
// loaded. Moved from the legacy settings service when Shell took settings.
import { ignore } from "../../../kernel/index.js";

const SETTINGS_KEY = "mdnotes.settings.v1";

function createDefaultSettings() {
  return {
    theme: "system",
    serverUrl: "",
    serverPin: "",
    displayName: "",
    explorer: "expanded",
    explorerAnchor: "docked",
    // Collapsed state of the sidebar's Linked Notes / Session sections. null
    // means "never chosen": the phone layout then starts them collapsed so the
    // file tree keeps the screen, while desktop starts them open.
    sidebarPanels: null,
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
    // Which chat tab is open: "agent" or "chats" ("roleplay" from v0.1.25 means chats).
    chatTab: "agent",
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
    // { path } of the local (OPFS) project reopened at boot, or null.
    lastLocalProject: null,
    // Agent (chat) source: "server" uses this server's configured key; "own"
    // sends the user's own key to the proxy (works from anywhere, their bill).
    agentSource: "server",
    agentApiKey: "",
    agentApiUrl: "",
    agentModel: "",
    // "browser": characters' replies in Chats call agentApiUrl straight from this
    // browser (e.g. a local model at http://localhost:11434/v1/chat/completions).
    agentRunner: "server",
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
  } catch (error) {
    ignore(error, "the stored settings are unreadable; starting from the defaults");
    return defaults;
  }
}

// Merge a patch into whatever is stored RIGHT NOW, instead of writing this tab's
// whole in-memory settings object. `patchFor(stored)` returns the fields to write,
// or null to write nothing. Used where a tab saves without the user acting (page
// unload), so it can't clobber changes another tab saved since this one loaded.
function patchStoredSettings(patchFor) {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    const patch = patchFor(stored);
    if (!patch) return;
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify({ ...stored, ...patch }));
  } catch (error) { ignore(error, "saving settings failed: storage is unavailable or corrupt"); }
}

export { createDefaultSettings, loadSettings, patchStoredSettings };
