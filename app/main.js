import { startModules, ignore, ignored } from "./kernel/index.js";
import shellModule, { normalizeServerUrl } from "./modules/shell/index.js";
import fileTypesModule from "./modules/file-types/index.js";
import workspaceModule from "./modules/workspace/index.js";
import identityModule from "./modules/identity/index.js";
import historyModule from "./modules/history/index.js";
import extensionModules from "./extensions.js";
import { createWorkspacePorts } from "./features/workspace-ports.js";
import { installMobileViewport } from "./services/chat-ui-service.js";
import { APP_VERSION } from "./version.js";
import { seedDefaultProject, applyHostCounters, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isImageFileName, isTextFileName } from "./domain/project-model.js";
import { importDirectory, importOsFolderIntoOpfs, importSingleFile, importZipArchive, loadProject, saveProject, supportsDirectoryAccess, supportsOpfs } from "./modules/workspace/index.js";
import syncModule from "./modules/sync/index.js";
import { parsePersona, personaTemplate } from "./services/persona-service.js";
import { signInSettings } from "./services/settings-service.js";
import cloudModule, { saveUserState, uploadAsset } from "./modules/cloud/index.js";
import modelsModule from "./modules/models/index.js";
import chatsModule from "./modules/chats/index.js";
import charactersModule from "./modules/characters/index.js";
import assistantModule from "./modules/assistant/index.js";
import commentsModule from "./modules/comments/index.js";
import { loadTemplateProject } from "./services/template-service.js";
import { query } from "./ui/dom.js";
import explorerModule from "./modules/explorer/index.js";
import { registerPreviews } from "./features/previews.js";
import { createLayout } from "./ui/layout.js";
import editorModule, { escapeHtmlAttribute, forgetViewStates, getRelativeProjectPath, normalizePath, renderMarkdown } from "./modules/editor/index.js";
import { createDialogs } from "./ui/dialogs.js";

document.querySelectorAll("[data-app-version]").forEach((label) => { label.textContent = `v${APP_VERSION}`; });

const elements = {
  app: query("#app"),
  workspaceShell: query("#workspace-shell"),
  workspaceSplitter: query("#workspace-splitter"),
  chatSplitter: query("#chat-splitter"),
  editorGrid: query("#editor-grid"),
  editorSplitter: query("#editor-splitter"),
  debugSplitter: query("#debug-splitter"),
  explorerPanel: query("#explorer-panel"),
  chatPanel: query("#chat-panel"),
  sourcePane: query("#source-pane"),
  previewPane: query("#preview-pane"),
  sourceTabStrip: query("#source-tab-strip"),
  previewTabStrip: query("#preview-tab-strip"),
  sourceTabOverflow: query("#source-tab-overflow"),
  previewTabOverflow: query("#preview-tab-overflow"),
  tabOverflowMenu: query("#tab-overflow-menu"),
  editorOverviewRuler: query("#editor-overview-ruler"),
  explorerTree: query("#explorer-tree"),
  explorerContextMenu: query("#explorer-context-menu"),
  explorerFilterButton: query("#explorer-filter-button"),
  explorerAnchorButton: query("#explorer-anchor-button"),
  explorerAddButton: query("#explorer-add-button"),
  projectNameLabel: query("#project-name-label"),
  editorGutter: query("#editor-gutter"),
  editorScroll: query("#editor-scroll"),
  editorContent: query("#editor-content"),
  editorDropCaret: query("#editor-drop-caret"),
  editorMarkBar: query("#editor-mark-bar"),
  editorCursors: query("#editor-cursors"),
  editorSearchHighlights: query("#editor-search-highlights"),
  editorFindBar: query("#editor-find-bar"),
  findInput: query("#find-input"),
  findCount: query("#find-count"),
  findToggleCase: query("#find-toggle-case"),
  findToggleWord: query("#find-toggle-word"),
  findToggleRegex: query("#find-toggle-regex"),
  findPrev: query("#find-prev"),
  findNext: query("#find-next"),
  findToggleReplace: query("#find-toggle-replace"),
  findClose: query("#find-close"),
  findReplaceRow: query("#find-replace-row"),
  replaceInput: query("#replace-input"),
  replaceOne: query("#replace-one"),
  replaceAll: query("#replace-all"),
  editorAutocomplete: query("#editor-autocomplete"),
  editorFormatToolbar: query("#editor-format-toolbar"),
  editorAutocompleteLabel: query("#editor-autocomplete-label"),
  editorAutocompleteList: query("#editor-autocomplete-list"),
  preview: query("#preview-output"),
  addFileDialog: query("#add-file-dialog"),
  addFileTargetText: query("#add-file-target-text"),
  addFileUrlInput: query("#add-file-url-input"),
  addFileDropzone: query("#add-file-dropzone"),
  addFileSourceText: query("#add-file-source-text"),
  addFilePickerButton: query("#add-file-picker-button"),
  addFilePickerInput: query("#add-file-picker-input"),
  addFileNameInput: query("#add-file-name-input"),
  addFileStatusText: query("#add-file-status-text"),
  addFileSubmitButton: query("#add-file-submit-button"),
  replaceFileInput: query("#replace-file-input"),
  editorEmptyState: query("#editor-empty-state"),
  newFileDialog: query("#new-file-dialog"),
  newFileType: query("#new-file-type"),
  newFileFolder: query("#new-file-folder"),
  newFileName: query("#new-file-name"),
  newFileStatus: query("#new-file-status"),
  newFileCancelButton: query("#new-file-cancel-button"),
  newFileSubmitButton: query("#new-file-submit-button"),
  settingsButton: query("#settings-button"),
  settingsDialog: query("#settings-dialog"),
  accountLockedNote: query("#account-locked-note"),
  serverUrlInput: query("#server-url-input"),
  serverPinInput: query("#server-pin-input"),
  displayNameInput: query("#display-name-input"),
  pingServerButton: query("#ping-server-button"),
  connectServerButton: query("#connect-server-button"),
  accountLoginRow: query("#account-login-row"),
  accountLoginFields: query("#account-login-fields"),
  accountUsernameInput: query("#account-username-input"),
  accountPasswordInput: query("#account-password-input"),
  accountLoginButton: query("#account-login-button"),
  accountLogoutButton: query("#account-logout-button"),
  accountStatusText: query("#account-status-text"),
  openServerLoginNote: query("#open-server-login-note"),
  serverBrowser: query("#server-browser"),
  browserTitle: query("#browser-title"),
  browserSubtitle: query("#browser-subtitle"),
  browserSideToggle: query("#browser-side-toggle"),
  browserSideLocal: query("#browser-side-local"),
  browserSideServer: query("#browser-side-server"),
  browserBreadcrumb: query("#browser-breadcrumb"),
  browserList: query("#browser-list"),
  browserStatus: query("#browser-status"),
  browserNewFolder: query("#browser-new-folder"),
  browserNewProject: query("#browser-new-project"),
  browserTrash: query("#browser-trash"),
  browserPublishHere: query("#browser-publish-here"),
  browserOpenBtn: query("#browser-open-btn"),
  browserAccessBtn: query("#browser-access-btn"),
  browserSelectToggle: query("#browser-select-toggle"),
  browserDeleteBtn: query("#browser-delete-btn"),
  browserMoveBtn: query("#browser-move-btn"),
  browserCopyBtn: query("#browser-copy-btn"),
  browserPickBtn: query("#browser-pick-btn"),
  browserPickCancel: query("#browser-pick-cancel"),
  browserSelectionLabel: query("#browser-selection-label"),
  accessDialog: query("#access-dialog"),
  accessDialogTitle: query("#access-dialog-title"),
  accessWhitelist: query("#access-whitelist"),
  accessBlacklist: query("#access-blacklist"),
  accessStatus: query("#access-status"),
  collabHosting: query("#collab-hosting"),
  hostTeamSelect: query("#host-team-select"),
  hostButton: query("#host-button"),
  hostPinText: query("#host-pin-text"),
  serverStatusPanel: query("#server-status-text")?.closest(".settings-status-panel"),
  accountSection: query("#account-login-row")?.closest(".settings-section"),
  sharedSessionSection: query("#connect-server-button")?.closest(".settings-section"),
  acceptConnectionDialog: query("#accept-connection-dialog"),
  acceptConnectionMessage: query("#accept-connection-message"),
  acceptConnectionAcceptButton: query("#accept-connection-accept-button"),
  workspaceModeToggle: query("#workspace-mode-toggle"),
  explorerToggleButton: query("#explorer-toggle-button"),
  mobileExplorerButton: query("#mobile-explorer-button"),
  mobileSourceToggle: query("#mobile-source-toggle"),
  mobilePreviewToggle: query("#mobile-preview-toggle"),
  mobilePaneCaption: query("#mobile-pane-caption"),
  mobileRenameButton: query("#mobile-rename-button"),
  mobileChatToggle: query("#mobile-chat-toggle"),
  mobileMenuButton: query("#mobile-menu-button"),
  menuBar: query(".menu-bar"),
  openServerDialog: query("#open-server-dialog"),
  importFileInput: query("#import-file-input"),
  previewCollapseButton: query("#preview-collapse-button"),
  sourceCollapseButton: query("#source-collapse-button"),
  sourceToggleActivityButton: query("#source-toggle-activity-button"),
  previewToggleActivityButton: query("#preview-toggle-activity-button"),
  chatToggleActivityButton: query("#chat-toggle-activity-button"),
  debugPanel: query("#debug-panel"),
  debugTabStrip: query("#debug-tab-strip"),
  debugCopyButton: query("#debug-copy-button"),
  debugClearButton: query("#debug-clear-button"),
  logCollapseButton: query("#log-collapse-button"),
  debugLogList: query("#debug-log-list"),
  chatStatusText: query("#chat-status-text"),
  chatModelSelect: query("#chat-model-select"),
  chatNewThreadButton: query("#chat-new-thread-button"),
  chatCollapseButton: query("#chat-collapse-button"),
  chatThreadList: query("#chat-thread-list"),
  chatAddActiveFileButton: query("#chat-add-active-file-button"),
  chatContextList: query("#chat-context-list"),
  chatMessageList: query("#chat-message-list"),
  chatComposeForm: query("#chat-compose-form"),
  chatInput: query("#chat-input"),
  chatSendButton: query("#chat-send-button"),
  chatHistoryToggleButton: query("#chat-history-toggle-button"),
  chatHistoryPane: query("#chat-history-pane"),
  chatHistorySearch: query("#chat-history-search")
};

// ---- Modules (docs/ARCHITECTURE.md) ----
// The app is moving into modules one step at a time. Code still in this file
// reaches a module only through the public API the kernel hands back.
const modules = await startModules([shellModule, fileTypesModule, workspaceModule, identityModule, editorModule, syncModule, historyModule, explorerModule, commentsModule, cloudModule, modelsModule, charactersModule, chatsModule, assistantModule, ...extensionModules], {
  log: (owner, ...args) => { try { logDebug("action", `${owner}: ${args.join(" ")}`); } catch (error) { ignore(error, "the log panel is not ready yet"); } }
});
const { shell, workspace, identity } = modules;

// The app's settings: Shell's. Read them here; change them with settings.change({ key: value }).
const settings = shell.settings;
shell.server.configure({ address: () => settings.serverUrl });
identity.attach(signInSettings(settings));
const storedProject = loadProject();
const controller = workspace.openProject(storedProject ?? seedDefaultProject());
// What the editor shows (tabs, the preview's file and part, the selection): the Editor's.
const editorView = modules.editor.view;
editorView.reset(controller.getProject());
// Shared or local work, and the local project kept aside meanwhile: Sync's.
const syncMode = modules.sync.mode;
// The session as the app sees it (status, presence, role...): Sync's, read-only;
// say what happened with syncState.change({ ... }).
const syncState = modules.sync.status;
// Saving is Workspace's; what it cannot know is said here: an IME composition
// under way, which workspace a save belongs to, and which files of a shared
// workspace the server has confirmed (only those may lose their dirty mark).
workspace.saving.attach({
  busy: () => editorParts.isComposing(),
  scope: () => settings.syncedProjectId || controller.getProject()?.id || "local", // whose saved positions: the cloud workspace's, else the project's
  shared: () => syncMode.get().workspaceMode === "synced",
  confirmed: (project, ids) => (syncMode.get().workspaceMode !== "synced" ? ids
    : collaboration.isConnected?.() ? ids.filter((id) => !collaboration.hasUnsyncedText?.(getPath(project, id))) : [])
});
// The Editor's parts (source editor, find, autocomplete, links, tabs, preview),
// created now and given what no module owns yet: each entry of this port should
// find an owner or become an extension point (modules/editor/adapters/surface.js).
var editorParts = modules.editor.attach({
  get collaboration() { return collaboration; },
  get workspaceMode() { return syncMode.get().workspaceMode; },
  settings, elements, identity,
  saveUserState: (ws, openFiles, activeFile) => saveUserState(settings.serverUrl, identity.token(), ws.team, ws.path, openFiles, activeFile),
  logDebug, traceEditorEvent, formatEditorDebugValue,
  imageSrcFor,
  setMobileExplorerOpen, togglePreview,
  scope: () => chatWorkspaceKey(), isReadOnly: () => isReadOnlyWorkspace(), onDrop: (event) => handleEditorDrop(event)
});
// The explorer and file actions, given what no module owns yet (modules/explorer/adapters/surface.js).
var explorerParts = modules.explorer.attach({
  settings, persistSettings, elements, logDebug, imageSrcFor,
  canManagePreview: () => Boolean(identity.account()) && syncMode.get().workspaceMode === "synced"
    && collaboration.isConnected() && Boolean(settings.lastWorkspace?.team),
  openAccessEditor, openMtreeToolsDialog, remapPersonaPaths
});
// A new character sheet starts from the template (diagrams add their own: extensions/bmap-diagram).
modules.explorer.newFiles.add({ id: "persona", content(name) {
  const base = parsePersona("", name).name;
  return personaTemplate(/^new character( \d+)?$/i.test(base) ? "New Character" : base);
} });
// Snapshots, the version label, the diff tab and History's dialogs (modules/history/adapters/surface.js).
var historyParts = modules.history.attach({ togglePreview, logDebug });
// The cloud file browser, accounts and hosting (modules/cloud/adapters/surface.js).
var cloudParts = modules.cloud.attach({
  elements, logDebug, flashStatusPanel, openSettingsDialog, refreshChatStatus,
  setMobileExplorerOpen
});
var chatsPage = modules.chats.attach({ cloudWorkspaceTarget, chatWorkspaceKey, personaAvatarSrc, isMobileLayout, logDebug }); // the side panel's Chats page
// Diagrams and character sheets add their previews to the Editor's extension point.
registerPreviews(modules.editor.previews, {
  view: editorView, settings, escapeHtmlAttribute, normalizePath, getRelativeProjectPath,
  personaAvatarSrc,
  get controller() { return controller; }
});
// Total source characters of the active file, cached for the footer counter by
// updateStatus. null → no text file open (the counter hides). Declared up here so
// the hoisted updateStatus can never touch it inside its temporal dead zone.
// Typing fast path + deferred/debounced work (see render()); whether a keystroke
// is being applied is the Editor's (editorParts?.isTyping()).
const DEFERRED_RENDER_IDLE_MS = 250;
const DEFERRED_RENDER_MAX_MS = 1500;
let deferredRenderTimer = null;
let deferredRenderDeadline = 0;
// ---- The Editor's parts (the Editor module: adapters/surface.js) ----
// Forwarders: code here still calls the editor's functions by name.
function applyEditorEdit(...args) { return editorParts.applyEditorEdit(...args); }
function getViewState(...args) { return editorParts.getViewState(...args); }
function isPreviewableFileName(...args) { return editorParts.isPreviewableFileName(...args); }
function redrawRemoteCursors(...args) { return editorParts.redrawRemoteCursors(...args); }
function resolveProjectAssetUrl(...args) { return editorParts.resolveProjectAssetUrl(...args); }
function showActiveFile(...args) { return editorParts.showActiveFile(...args); }
function attachSelectionChangeListener(...args) { return editorParts.attachSelectionChangeListener(...args); }
function clamp(...args) { return editorParts.clamp(...args); }
function clearEditorDropCaret(...args) { return editorParts.clearEditorDropCaret(...args); }
function getEditorSelection(...args) { return editorParts.getEditorSelection(...args); }
function getEditorText(...args) { return editorParts.getEditorText(...args); }
function handleIndentKeydown(...args) { return editorParts.handleIndentKeydown(...args); }
function notifyEditorChanged(...args) { return editorParts.notifyEditorChanged(...args); }
function onRemoteCursor(...args) { return editorParts.onRemoteCursor(...args); }
function pruneRemoteCursors(...args) { return editorParts.pruneRemoteCursors(...args); }
function queueExternalEditorSelection(...args) { return editorParts.queueExternalEditorSelection(...args); }
function refreshFormatToolbar(...args) { return editorParts.refreshFormatToolbar(...args); }
function renderEditorContent(...args) { return editorParts.renderEditorContent(...args); }
function renderRemoteCursors(...args) { return editorParts.renderRemoteCursors(...args); }
function scheduleOverviewRuler(...args) { return editorParts.scheduleOverviewRuler(...args); }
function setEditorSelection(...args) { return editorParts.setEditorSelection(...args); }
function syncEditorScroll(...args) { return editorParts.syncEditorScroll(...args); }
function transformEditorSelection(...args) { return editorParts.transformEditorSelection(...args); }

// Declared up here because the hoisted mobile render helpers reach it during
// the first render, which would otherwise be inside its temporal dead zone.
const MOBILE_MAX_WIDTH = 900;    // must match the CSS breakpoint

const debugState = {
  entries: [],
  maxEntries: 300,
  activeTab: "all"
};


const debugTabs = [...elements.debugTabStrip.querySelectorAll(".debug-tab")].map((element) => ({ id: element.dataset.tab, element }));





// ---- Chat panel ------------------------------------------------------------
// The Agent page is the Assistant module's. It loads the first time it is
// needed — the panel shown or Settings open (Agent status) — so sessions that
// never open it don't download it.
let chat = null;
let chatLoading = null;

function chatNeeded() {
  return settings.chatPanel === "shown" || layout().mobileView() === "chat" || Boolean(elements.settingsDialog?.open);
}

function loadChat() {
  chatLoading ??= modules.assistant.load({
    cloudWorkspaceTarget, chatConnectionInfo, chatWorkspaceKey, elements, isMobileLayout, logDebug, openSettingsDialog,
    personaAvatarSrc, storedProject, chatsPage
  }).then((loaded) => {
    chat = loaded;
    chat.chatState.shouldScrollToBottom = true;
    chat.renderChatPanel(controller.getProject());
    void chat.refreshChatStatus({ silent: true });
    return chat;
  }).catch((error) => {
    chatLoading = null;
    logDebug("error", "Chat panel failed to load", error.message);
    showToast("The chat panel could not load. Check your connection and try again.");
    return null;
  });
  return chatLoading;
}

function renderChatPanel(project) {
  if (chat) chat.renderChatPanel(project);
  else if (chatNeeded()) void loadChat();
}

async function refreshChatStatus(options) {
  if (chat) return chat.refreshChatStatus(options);
  if (chatNeeded()) await loadChat(); // loading checks the status itself
}

/** Group chats name their characters by path; follow a rename or move of a
 *  character file, or of a folder holding one. */
function remapPersonaPaths(oldPath, newPath) { chatsPage.remapPersonaPaths(oldPath, newPath); } // Chats follows renamed characters

function chatConnectionInfo() {
  return syncMode.get().workspaceMode === "synced" ? collaboration.getConnectionInfo?.() : null;
}

function chatWorkspaceKey(project = controller.getProject()) {
  const connection = chatConnectionInfo();
  if (connection?.sessionId) return `cloud:${normalizeServerUrl(connection.serverUrl)}/${connection.sessionId}`;
  // Keep cloud drafts scoped while its transport reconnects.
  if (syncMode.get().workspaceMode === "synced" && settings.syncedProjectId) {
    return `cloud:${normalizeServerUrl(settings.serverUrl)}/${settings.syncedProjectId}`;
  }
  return project.id;
}

/** A persona's avatar as an <img> src, or "" when it doesn't resolve. */
function personaAvatarSrc(project, personaNodeId, avatar) {
  const value = String(avatar ?? "").trim();
  if (!value) return "";
  if (/^(https?:\/\/|data:image\/)/i.test(value)) return value;
  const resolved = resolveProjectAssetUrl(project, personaNodeId, value);
  return resolved && resolved !== value ? resolved : "";
}


// ---- Dialogs, toasts and the debug log (./ui/dialogs.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var dialogsInstance;
function dialogs() {
  return (dialogsInstance ??= createDialogs({
    get shell() { return shell; },
    get controller() { return controller; },
    get debugState() { return debugState; },
    get debugTabs() { return debugTabs; },
    historyPosition: () => editorParts.historyPosition(),
    get elements() { return elements; },
    get escapeEditorHtml() { return escapeEditorHtml; },
    get getEditorLineIndexAtOffset() { return getEditorLineIndexAtOffset; },
    get getEditorSelection() { return getEditorSelection; },
    get settings() { return settings; }
  }));
}
async function confirmAction(message) { return shell.confirm(String(message)); }
async function copyDebugLogToClipboard(...args) { return dialogs().copyDebugLogToClipboard(...args); }
async function copyTextToClipboard(text) { return shell.copyText(text); }
function flashStatusPanel(...args) { return dialogs().flashStatusPanel(...args); }
async function forceAppUpgrade(...args) { return dialogs().forceAppUpgrade(...args); }
function formatEditorDebugValue(...args) { return dialogs().formatEditorDebugValue(...args); }
function logDebug(...args) { return dialogs().logDebug(...args); }
function notify(message) { return shell.notify(message); }
async function promptForName(message, value = "", options = {}) { return shell.input({ title: message, message, value, submitLabel: "Save", ...options }); }
function renderDebugPanel(...args) { return dialogs().renderDebugPanel(...args); }
function showAcceptConnectionDialog(...args) { return dialogs().showAcceptConnectionDialog(...args); }
function showConfirmDialog(options) { return shell.confirm(options); }
function showToast(message, options) { return shell.toast(message, options); }
function traceEditorEvent(...args) { return dialogs().traceEditorEvent(...args); }

/** Resolve an image node to a usable <img> src. Local/PIN workspaces inline the
 *  bytes as a data: URL in content; directory-backed cloud workspaces keep the
 *  bytes on the server and serve them by the file's workspace path. */
function imageSrcFor(project, node) {
  if (!node) return "";
  const content = typeof node.content === "string" ? node.content : "";
  if (content.startsWith("data:")) {
    return content;
  }
  const conn = collaboration.getConnectionInfo?.();
  if (conn && syncMode.get().workspaceMode === "synced") {
    const base = normalizeServerUrl(conn.serverUrl);
    const path = getPath(project, node.id);
    return `${base}/api/workspaces/asset?token=${encodeURIComponent(conn.token)}&path=${encodeURIComponent(path)}`;
  }
  return content;
}

function getEditorLineIndexAtOffset(textOffset) {
  const lineEls = Array.from(elements.editorContent.children);
  let remaining = Math.max(0, textOffset);
  for (let index = 0; index < lineEls.length; index += 1) {
    const lineLen = lineEls[index].textContent.length;
    if (remaining <= lineLen) {
      return index;
    }
    remaining -= lineLen + 1;
  }
  return Math.max(0, lineEls.length - 1);
}

function showEditorAutocomplete(...args) { return editorParts.showEditorAutocomplete(...args); }

function computeSearchMatches(...args) { return editorParts.computeSearchMatches(...args); }
function findNext(...args) { return editorParts.findNext(...args); }
function findPrev(...args) { return editorParts.findPrev(...args); }
function openFindBar(...args) { return editorParts.openFindBar(...args); }

// True when this session only has read access to the open cloud workspace.
function isReadOnlyWorkspace() {
  return syncMode.get().workspaceMode === "synced" && syncState.role === "reader";
}



// The cloud workspace on screen (Sync's), for the code that still asks main.js.
function cloudWorkspaceTarget() { return modules.sync.cloudWorkspace(); }
// Snapshots, the version label, the diff tab and History's dialogs (the History module).
function createSnapshotNow(...args) { return historyParts.createSnapshotNow(...args); }

// The live session is Sync's; it is given what only the app can do, and
// tells its news through events (modules/sync/index.js).
const collaboration = modules.sync.attach({
  async preserveLocalFiles(files) {
    const store = historyParts.snapshotStore();
    for (const [path, content] of files) {
      await store.create(path, content, "Recovery: local edits before cloud reload");
    }
    showToast(`Local changes saved in Snapshots (${files.size} file(s)); loading the cloud version.`);
  },
  replaceProject(project) {
    const view = collaboration.isReconnecting() ? currentWorkspaceView() : null;
    controller.replaceProject(project);
    if (view) restoreResumeState(view);
  },
  applyOperation(clientId, operation) {
    try {
      const activeFile = controller.getActiveFile();
      const activePath = activeFile ? getPath(controller.getProject(), activeFile.id) : null;
      if (
        operation.type === "patch-file" &&
        activeFile &&
        activePath === operation.path &&
        elements.editorContent === document.activeElement
      ) {
        const selection = getEditorSelection();
        const insertedLength = String(operation.text ?? "").length;
        queueExternalEditorSelection(
          activeFile.id,
          transformEditorSelection(selection, Number(operation.start), Number(operation.end), insertedLength)
        );
      }
      controller.applySyncOperation(operation);
      // After a remote patch lands, immediately advance that peer's cached
      // cursor to the end of their insertion so it stays visible and correct
      // without waiting for their next selectionchange broadcast.
      if (operation.type === "patch-file" && clientId) {
        editorParts.moveRemoteCursor(clientId, Number(operation.start) + String(operation.text ?? "").length);
      }
    } catch (error) {
      ignore(error, "applying a remote change failed; reloading from the server");
      collaboration?.reloadFromServer("Sync conflict — reloading from server.").catch(ignored("reloading after a failed remote change failed"));
    }
  },
  // The account token died (server restart). Sign in again with the stored,
  // previously-proven credentials so reconnect can continue; return null to let
  // the runtime stop retrying instead of looping on a dead token.
  async reauthenticate() {
    if (!identity.canRestore()) return null;
    const token = collaboration.getConnectionInfo()?.token;
    try {
      await performLogin(settings.accountUsername, settings.accountPassword, {
        silent: true, isCurrent: () => Boolean(token) && collaboration.getConnectionInfo()?.token === token
      });
      logDebug("action", "Re-authenticated after token expiry", settings.accountUsername);
      return identity.token();
    } catch (error) {
      logDebug("response", "Re-authentication failed", error.message);
      if (![401, 403].includes(error.status)) throw error;
      return null;
    }
  },
  uploadAsset,
  upgrade: (detail) => forceAppUpgrade(detail),
  confirmJoin: () => showAcceptConnectionDialog(),
  flash: (type) => flashStatusPanel(type, elements.sharedSessionSection)
});
// What happens as the session changes is Sync's (adapters/connection.js); the
// editor drops the carets of people who left.
modules.sync.events.on("status", () => pruneRemoteCursors(syncState.presence));
modules.sync.events.on("remote-cursor", (event) => {
  onRemoteCursor(event);
});
modules.sync.events.on("patch-confirmed", () => {
  // Text confirmed by server — now safe to send the definitive cursor position.
  const activeFile = controller.getActiveFile();
  if (activeFile && collaboration.isConnected()) {
    const sel = getEditorSelection();
    // Path (not node id) so peers can match it — see renderRemoteCursors.
    const path = getPath(controller.getProject(), activeFile.id);
    collaboration.scheduleAwareness(path, sel.start, sel.end);
  }
});
workspace.attach(createWorkspacePorts({ controller, collaboration, publishOperation, getEditorSelection, applyEditorEdit,
  get workspaceMode() { return syncMode.get().workspaceMode; },
  editorShowsWholeFile: () => !editorView.get().sourcePart && isTextFileName(controller.getActiveFile()?.name ?? "") }));

attachSelectionChangeListener();



shell.menus.add({ id: "file", label: "File", order: 1 });
shell.menus.add({ id: "edit", label: "Edit", order: 2 });
shell.menus.add({ id: "create", label: "Create", order: 3 });
shell.menus.add({ id: "view", label: "View", order: 4 });
shell.menus.add({ id: "settings", label: "Settings", order: 5 });

// Module map tools (.mtree → Markdown) load the first time their dialog opens.
let moduleMapTools = null;
let moduleMapToolsLoading = null;

function loadModuleMapTools() {
  moduleMapToolsLoading ??= import("./features/module-map-tools.js").then(({ createModuleMapTools }) => {
    moduleMapTools = createModuleMapTools({
      controller, getPath, getNode, findChildByName, notify, publishOperation,
      setActiveSourceFile, setPreviewFile, highlightMarkdownSource, renderMarkdown,
      typesetPreview, handleIndentKeydown, workspace
    });
    return moduleMapTools;
  }).catch((error) => {
    moduleMapToolsLoading = null;
    throw error;
  });
  return moduleMapToolsLoading;
}

async function openMtreeToolsDialog(fileId) {
  try {
    (await loadModuleMapTools()).open(fileId);
  } catch (error) {
    notify(`Module map tools could not load: ${error.message}`);
  }
}
function escapeEditorHtml(...args) { return editorParts.escapeEditorHtml(...args); }
function highlightMarkdownSource(...args) { return editorParts.highlightMarkdownSource(...args); }

function renderLinksPanel(...args) { return editorParts.renderLinksPanel(...args); }


// ---- Tabs, panes and preview (the Editor module) ----
function bindPaneDropTarget(...args) { return editorParts.bindPaneDropTarget(...args); }
function bindTabStripReorderTarget(...args) { return editorParts.bindTabStripReorderTarget(...args); }
function cachedWorkspaceView(...args) { return editorParts.cachedWorkspaceView(...args); }
function clearPaneDropState(...args) { return editorParts.clearPaneDropState(...args); }
function closeTabOverflowMenu(...args) { return editorParts.closeTabOverflowMenu(...args); }
function currentWorkspaceView(...args) { return editorParts.currentWorkspaceView(...args); }
function ensureOpenTabs(...args) { return editorParts.ensureOpenTabs(...args); }
function openFileFromExplorer(...args) { return editorParts.openFileFromExplorer(...args); }
function openTabOverflowMenu(...args) { return editorParts.openTabOverflowMenu(...args); }
function printPreviewAsPdf(...args) { return editorParts.printPreviewAsPdf(...args); }
function renderPreviewContent(...args) { return editorParts.renderPreviewContent(...args); }
function renderTabs(...args) { return editorParts.renderTabs(...args); }
function restoreResumeState(...args) { return editorParts.restoreResumeState(...args); }
function setActiveSourceFile(...args) { return editorParts.setActiveSourceFile(...args); }
function setPreviewFile(...args) { return editorParts.setPreviewFile(...args); }
function showResumedFile(...args) { return editorParts.showResumedFile(...args); }
function tabOverflowButton(...args) { return editorParts.tabOverflowButton(...args); }
async function typesetPreview(...args) { return editorParts.typesetPreview(...args); }

// ---- The explorer and file actions (the Explorer module) ----
function suggestUniqueFileName(...args) { return explorerParts.suggestUniqueFileName(...args); }
function clearExplorerDropState(...args) { return explorerParts.clearExplorerDropState(...args); }
function createFileInFolder(...args) { return explorerParts.createFileInFolder(...args); }
function exportNode(...args) { return explorerParts.exportNode(...args); }
function getSelectedNode(...args) { return explorerParts.getSelectedNode(...args); }
function getSelectedParent(...args) { return explorerParts.getSelectedParent(...args); }
async function handleEditorDrop(...args) { return explorerParts.handleEditorDrop(...args); }
function moveExplorerNode(...args) { return explorerParts.moveExplorerNode(...args); }
function openNewFileDialog(...args) { return explorerParts.openNewFileDialog(...args); }
async function renameFileById(...args) { return explorerParts.renameFileById(...args); }


async function handleSaveCommand() {
  if (moduleMapTools?.isOpen() && moduleMapTools.contains(document.activeElement)) {
    logDebug("action", "Module map written to target");
    moduleMapTools.write();
    return;
  }

  try {
    logDebug("action", "Workspace save requested");
    await workspace.saving.saveActiveFile();
    logDebug("response", "Workspace saved");
  } catch (error) {
    notify(error.message);
  }
  // Auto-save handles persistence now, so Ctrl+S doubles as "commit a snapshot":
  // a manual save point the user can later compare against.
  await createSnapshotNow();
}

for (const pane of ["source", "preview"]) {
  tabOverflowButton(pane)?.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = tabOverflowButton(pane)?.classList.contains("is-open");
    closeTabOverflowMenu();
    if (!isOpen) openTabOverflowMenu(pane);
  });
}

document.addEventListener("click", (event) => {
  if (elements.tabOverflowMenu?.hidden) return;
  if (event.target.closest?.("#tab-overflow-menu, .tab-overflow-btn")) return;
  closeTabOverflowMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.tabOverflowMenu?.hidden) closeTabOverflowMenu();
});

// ── Collapsible sidebar sections (Linked Notes / Session) ───────────────────
// Collapsed state is per-panel and persisted. Until the user has touched one,
// the phone layout starts them collapsed — on a 390px screen those two blocks
// pushed the file tree, which is the reason the sidebar exists, off-screen.

const SIDEBAR_PANEL_IDS = ["links", "session"];

function sidebarPanelCollapsed(id) {
  const stored = settings.sidebarPanels;
  if (stored && typeof stored === "object" && id in stored) return Boolean(stored[id]);
  return isMobileLayout();  // never chosen → collapsed on a phone, open on desktop
}

function renderSidebarPanels() {
  for (const toggle of document.querySelectorAll(".sidebar-panel-toggle")) {
    const id = toggle.dataset.panel;
    if (!id) continue;
    const collapsed = sidebarPanelCollapsed(id);
    toggle.closest(".sidebar-panel")?.setAttribute("data-collapsed", String(collapsed));
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }
}

function toggleSidebarPanel(id) {
  if (!SIDEBAR_PANEL_IDS.includes(id)) return;
  const next = { ...(settings.sidebarPanels ?? {}) };
  // Write BOTH panels on first use, so flipping one doesn't leave the other
  // silently following the viewport and re-collapsing on the next resize.
  for (const key of SIDEBAR_PANEL_IDS) {
    if (!(key in next)) next[key] = sidebarPanelCollapsed(key);
  }
  next[id] = !next[id];
  settings.change({ sidebarPanels: next });
  persistSettings();  // -> applyWorkspaceSettings -> renderSidebarPanels
  logDebug("action", "Sidebar section toggled", `${id} ${next[id] ? "collapsed" : "expanded"}`);
}

function applyWorkspaceSettings() {
  const computedStyles = globalThis.getComputedStyle?.(elements.app);
  const splitterSize = Number.parseFloat(computedStyles?.getPropertyValue("--splitter-size") ?? "4") || 4;
  const editorGridWidth = elements.editorGrid.getBoundingClientRect().width;
  const hasEditorGridWidth = Number.isFinite(editorGridWidth) && editorGridWidth > 0;
  const defaultSplitPreviewWidth = hasEditorGridWidth
    ? Math.round(clamp((editorGridWidth - splitterSize) / 2, 280, Math.max(320, editorGridWidth - 280)))
    : 420;
  const previewWidth = settings.previewWidthCustomized
    ? settings.previewWidth
    : defaultSplitPreviewWidth;

  elements.app.dataset.explorer = settings.explorer;
  // The explorer is always an overlay flyout on the phone layout, so "floating"
  // must never reach the DOM there. The desktop rule
  //   [data-explorer-anchor="floating"][data-chat="hidden"] .workspace-shell
  // carries more specificity than the mobile single-column override (media
  // queries add none), so it won for anyone who had toggled dock/float: the
  // workspace was pinned to grid-column 1, which under that rule is the 48px
  // activity-bar track — a 32px-wide editor. settings.explorerAnchor is left
  // alone so the desktop preference survives the trip through a phone.
  elements.app.dataset.explorerAnchor = isMobileLayout() ? "docked" : settings.explorerAnchor;
  renderSidebarPanels();
  elements.app.dataset.preview = settings.preview;
  elements.app.dataset.source = settings.source;
  elements.app.dataset.chat = settings.chatPanel;
  elements.app.dataset.wordWrap = settings.wordWrap ? "on" : "off";
  elements.app.dataset.debug = settings.debugPanel ? "on" : "off";
  elements.app.style.setProperty("--sidebar-width", `${settings.sidebarWidth}px`);
  elements.app.style.setProperty("--preview-width", `${previewWidth}px`);
  elements.app.style.setProperty("--chat-width", `${settings.chatWidth}px`);
  elements.app.style.setProperty("--debug-height", `${settings.debugPanelHeight}px`);
  elements.app.style.setProperty("--indent-tab-size", "4");
  // Word-wrap is CSS-driven via data-word-wrap; no textarea.wrap needed.
  elements.previewCollapseButton.setAttribute("aria-expanded", settings.preview === "shown" ? "true" : "false");
  elements.chatCollapseButton.setAttribute("aria-expanded", settings.chatPanel === "shown" ? "true" : "false");
  elements.debugPanel.hidden = !settings.debugPanel;
  refreshFormatToolbar();
  elements.chatPanel.hidden = settings.chatPanel === "hidden";
  elements.chatToggleActivityButton.classList.toggle("is-active", settings.chatPanel === "shown");
  elements.explorerFilterButton.classList.toggle("is-active", settings.explorerFilter !== "all");
  if (elements.explorerAnchorButton) {
    const floating = settings.explorerAnchor === "floating";
    elements.explorerAnchorButton.classList.toggle("is-active", floating);
    elements.explorerAnchorButton.setAttribute("aria-pressed", String(floating));
    elements.explorerAnchorButton.title = floating
      ? "Dock the explorer (fixed panel)"
      : "Float the explorer (overlay)";
  }
  if (!elements.app.dataset.mobileExplorer) elements.app.dataset.mobileExplorer = "closed";
  if (!elements.app.dataset.mobileMenu) elements.app.dataset.mobileMenu = "closed";
  applyMobileViewState();
  renderDebugPanel();
}


function startPointerResize(event, onMove) {
  event.preventDefault();

  function handleMove(moveEvent) {
    onMove(moveEvent);
  }

  function handleUp() {
    document.removeEventListener("pointermove", handleMove);
    document.removeEventListener("pointerup", handleUp);
  }

  document.addEventListener("pointermove", handleMove);
  document.addEventListener("pointerup", handleUp);
}

elements.workspaceSplitter.addEventListener("pointerdown", (event) => {
  if (settings.explorer === "collapsed") {
    return;
  }

  startPointerResize(event, (moveEvent) => {
    const shellRect = elements.workspaceShell.getBoundingClientRect();
    const activityWidth = 48;
    const nextWidth = clamp(moveEvent.clientX - shellRect.left - activityWidth, 180, Math.max(240, shellRect.width - 320));
    settings.change({ sidebarWidth: Math.round(nextWidth) });
    persistSettings();
    renderEditorContent(getEditorText());
    syncEditorScroll();
  });
});

elements.editorSplitter.addEventListener("pointerdown", (event) => {
  if (settings.preview === "hidden") {
    return;
  }

  startPointerResize(event, (moveEvent) => {
    const gridRect = elements.editorGrid.getBoundingClientRect();
    const nextWidth = clamp(gridRect.right - moveEvent.clientX, 280, Math.max(320, gridRect.width - 280));
    settings.change({ previewWidthCustomized: true, previewWidth: Math.round(nextWidth) });
    persistSettings();
    renderEditorContent(getEditorText());
    syncEditorScroll();
  });
});

elements.chatSplitter.addEventListener("pointerdown", (event) => {
  if (settings.chatPanel === "hidden") {
    return;
  }

  startPointerResize(event, (moveEvent) => {
    const shellRect = elements.workspaceShell.getBoundingClientRect();
    const nextWidth = clamp(shellRect.right - moveEvent.clientX, 300, Math.max(340, shellRect.width - 360));
    settings.change({ chatWidth: Math.round(nextWidth) });
    persistSettings();
    renderEditorContent(getEditorText());
    syncEditorScroll();
  });
});

elements.debugSplitter.addEventListener("pointerdown", (event) => {
  if (!settings.debugPanel) {
    return;
  }

  startPointerResize(event, (moveEvent) => {
    const workspaceRect = elements.workspaceShell.getBoundingClientRect();
    const footerHeight = 24;
    const bottom = workspaceRect.bottom - footerHeight;
    const nextHeight = clamp(bottom - moveEvent.clientY, 120, Math.max(180, workspaceRect.height - 220));
    settings.change({ debugPanelHeight: Math.round(nextHeight) });
    persistSettings();
    renderEditorContent(getEditorText());
    syncEditorScroll();
  });
});

function closeMenus() { shell.closeMenus(); }

document.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-code]");
  if (!copyButton) {
    return;
  }
  const codeEl = copyButton.closest(".md-code-block")?.querySelector("pre > code");
  const codeText = codeEl?.textContent ?? "";
  if (!codeText) {
    return;
  }
  event.preventDefault();
  try {
    await copyTextToClipboard(codeText);
    const originalText = copyButton.textContent || "Copy";
    copyButton.textContent = "Copied";
    copyButton.classList.add("is-copied");
    window.setTimeout(() => {
      copyButton.textContent = originalText;
      copyButton.classList.remove("is-copied");
    }, 1200);
  } catch {
    notify("Could not copy code block.");
  }
});

function persistSettings() { applyWorkspaceSettings(); } // the settings save themselves (Shell); this applies them

applyWorkspaceSettings();

// The editor's side of a redraw: the tabs, the shown file, the preview, links,
// chat. (The status bar's items, the snapshot version among them, draw themselves.)
function updateStatus(project) {
  ensureOpenTabs(project);
  renderTabs(project);
  elements.projectNameLabel.textContent = project.name;
  renderMobilePaneCaption(); // tracks the active/preview file, not just the view

  const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
  const previewFile = editorView.get().previewFileId ? project.nodes[editorView.get().previewFileId] : null;
  showActiveFile(project); // the source editor shows the active file (the Editor)
  editorParts.drawPreviewPane(project, previewFile); // a file's preview, or a pane view such as History's diff
  renderLinksPanel(project, activeFile);
  renderChatPanel(project);
}


function render(project) {
  if (editorParts?.isTyping()) {
    // A keystroke. The editor has already drawn it; the explorer, tabs, preview,
    // links, chat and status follow once typing pauses (or every
    // DEFERRED_RENDER_MAX_MS during a long burst). Doing them synchronously here
    // cost a full app render plus a whole-project localStorage write per key.
    scheduleDeferredRender();
    workspace.saving.schedule(project);
    return;
  }
  cancelDeferredRender(); // this full render covers whatever was pending
  explorerParts.renderTree(project);
  updateStatus(project);
  workspace.saving.schedule(project); // this browser's copy, a local project's folder, auto-save (Workspace)
}

function scheduleDeferredRender() {
  const now = performance.now();
  if (!deferredRenderDeadline) deferredRenderDeadline = now + DEFERRED_RENDER_MAX_MS;
  if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
  const delay = Math.max(0, Math.min(DEFERRED_RENDER_IDLE_MS, deferredRenderDeadline - now));
  deferredRenderTimer = setTimeout(() => {
    deferredRenderTimer = null;
    deferredRenderDeadline = 0;
    render(controller.getProject());
  }, delay);
}

function cancelDeferredRender() {
  if (deferredRenderTimer) clearTimeout(deferredRenderTimer);
  deferredRenderTimer = null;
  deferredRenderDeadline = 0;
}

controller.subscribe(render);
// Modules ask Shell to draw the app again; this is where it happens.
shell.events.on("render", ({ project, only }) => (only === "status" ? updateStatus(project) : render(project)));

if (!storedProject) {
  const placeholder = controller.getProject();
  void loadTemplateProject()
    .then((project) => {
      // The template is only a first-run placeholder, fetched file by file. If
      // anything took over while it loaded — above all a cloud workspace
      // restoring itself on a fresh device — installing it would put the
      // template on screen inside a synced session, and the next reconnect's
      // reconcile would then upload its files into that cloud workspace. Seen
      // with a slow connection: the welcome files appeared in the workspace.
      const current = controller.getProject();
      const edited = Object.values(current.nodes ?? {}).some((node) => node?.dirty);
      if (syncMode.get().workspaceMode === "synced" || current.id !== placeholder.id || edited) {
        logDebug("action", "Default template not installed", "a workspace or edits arrived first");
        return;
      }
      controller.replaceProject(project);
      editorView.reset(project);
      logDebug("action", "Default template loaded", project.name);
    })
    .catch((error) => {
      logDebug("response", "Default template load failed", error.message);
    });
}

logDebug("response", "Debug log initialized", `panel=${settings.debugPanel ? "visible" : "hidden"}`);

// Sending a change is Sync's (adapters/connection.js).
function publishSnapshot() { modules.sync.publishSnapshot(); }
function publishOperation(operation) { return modules.sync.publish(operation); }

function updateFileContentFromPreview(...args) { return editorParts.updateFileContentFromPreview(...args); }



// The file the mobile pane's pen button should act on: the previewed file in
// preview view, otherwise the active source file. Null in chat view.
function currentMobileFileId() {
  if (layout().mobileView() === "chat") return null;
  if (layout().mobileView() === "preview") return editorParts.shownPaneView() ? null : editorView.get().previewFileId;
  return controller.getActiveFile()?.id ?? null;
}


shell.commands.add({ id: "workspace.save", title: "Save", menu: { id: "file", group: 0, order: 6 }, keys: ["Mod+S"], run: async () => {
  await handleSaveCommand();
} });

shell.commands.add({ id: "preview.save-pdf", title: "Save as PDF", menu: { id: "file", group: 0, order: 7 }, run: printPreviewAsPdf });
shell.commands.add({ id: "workspace.export", title: "Export Project Zipped", menu: { id: "file", group: 0, order: 8 }, run: () => exportNode(controller.getProject().rootId) });
shell.commands.add({ id: "workspace.export-selected", title: "Export Selected", menu: { id: "file", group: 0, order: 9 }, run: () => exportNode(getSelectedNode(controller.getProject())?.id ?? controller.getProject().rootId) });

shell.commands.add({ id: "workspace.new-project", title: "New Project", menu: { id: "file", group: 0, order: 1 }, run: async () => {
  logDebug("action", "New project requested");
  closeMenus();
  // No local store and no server account: keep the legacy in-browser workspace.
  if (!supportsOpfs() && !identity.account()) {
    controller.replaceProject(seedDefaultProject());
    editorView.reset(controller.getProject());
    publishSnapshot();
    logDebug("action", "New in-browser project created");
    return;
  }
  // Otherwise open the unified browser so the user can pick where it lives
  // (this device or a team folder) and create it there.
  openFileBrowser({ side: supportsOpfs() ? "local" : "server", intent: "create" });
} });

shell.commands.add({ id: "workspace.import-folder", title: "Import Local Folder", menu: { id: "file", group: 0, order: 4 }, run: async () => {
  if (!supportsDirectoryAccess()) {
    notify("Folder import is only available in Chromium-based browsers.");
    return;
  }
  try {
    logDebug("action", "Import folder requested");
    // Copy a real OS folder into the persistent local store, then open it from
    // there. Without OPFS, fall back to a live (session-only) directory link.
    const project = supportsOpfs()
      ? await importOsFolderIntoOpfs("")
      : await importDirectory();
    controller.replaceProject(project);
    if (project.sourceMode === "opfs" && project.localPath) {
      settings.change({ lastLocalProject: { path: project.localPath } });
    }
    editorView.reset(project);
    publishSnapshot();
    logDebug("action", "Imported folder", project.localPath ?? project.name);
  } catch (error) {
    if (error?.name === "AbortError") return; // user dismissed the picker
    notify(error.message);
  }
} });

shell.commands.add({ id: "cloud.open-project", title: "Open Project…", menu: { id: "file", group: 0, order: 2 }, run: () => {
  closeMenus();
  logDebug("action", "Open project browser");
  // Default to the server side when signed in (it replaces the old "Open Server
  // Directory"), else start on this device. The in-dialog toggle switches sides.
  openFileBrowser({ side: identity.account() ? "server" : "local", intent: "open" });
} });

shell.commands.add({ id: "cloud.file-manager", title: "File Manager", menu: { id: "file", group: 0, order: 3 }, run: () => {
  closeMenus();
  logDebug("action", "Open file manager");
  openFileBrowser({ side: identity.account() ? "server" : "local", mode: "manage" });
} });

shell.commands.add({ id: "workspace.import-file", title: "Import File or Zip", menu: { id: "file", group: 0, order: 5 }, run: () => elements.importFileInput.click() });

elements.importFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    logDebug("action", "Import requested", file.name);
    const project = file.name.toLowerCase().endsWith(".zip") ? await importZipArchive(file) : await importSingleFile(file);
    controller.replaceProject(project);
    editorView.reset(project);
    publishSnapshot();
  } catch (error) {
    notify(error.message);
  } finally {
    event.target.value = "";
  }
});



shell.commands.add({ id: "editor.find-replace", title: "Find & Replace", menu: { id: "edit", group: 0, order: 1 }, run: () => openFindBar(true) });
window.addEventListener("resize", scheduleOverviewRuler);
bindPaneDropTarget(elements.sourcePane, "source");
bindPaneDropTarget(elements.sourceTabStrip, "source");
bindPaneDropTarget(elements.previewPane, "preview");
bindPaneDropTarget(elements.previewTabStrip, "preview");
bindTabStripReorderTarget(elements.sourceTabStrip, "source");
bindTabStripReorderTarget(elements.previewTabStrip, "preview");

document.addEventListener("dragend", () => {
  clearPaneDropState();
  clearExplorerDropState();
  clearEditorDropCaret();
});
document.addEventListener("drop", () => {
  clearPaneDropState();
  clearExplorerDropState();
  clearEditorDropCaret();
});
// ---- Layout: panels, mobile panes and touch gestures (./ui/layout.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var layoutInstance;
function layout() {
  return (layoutInstance ??= createLayout({
    view: editorView,
    shownPaneView: () => editorParts.shownPaneView(),
    get chat() { return chat; },
    get closeMenus() { return closeMenus; },
    get controller() { return controller; },
    get currentMobileFileId() { return currentMobileFileId; },
    get elements() { return elements; },
    get isMobileLayout() { return isMobileLayout; },
    get isPreviewableFileName() { return isPreviewableFileName; },
    get logDebug() { return logDebug; },
    get persistSettings() { return persistSettings; },
    get refreshChatStatus() { return refreshChatStatus; },
    get renderChatPanel() { return renderChatPanel; },
    get setPreviewFile() { return setPreviewFile; },
    get settings() { return settings; }
  }));
}
function applyMobileViewState(...args) { return layout().applyMobileViewState(...args); }
function cancelMobileGesture(...args) { return layout().cancelMobileGesture(...args); }
function handleFloatingExplorerOutsidePress(...args) { return layout().handleFloatingExplorerOutsidePress(...args); }
function onGestureEnd(...args) { return layout().onGestureEnd(...args); }
function onGestureMove(...args) { return layout().onGestureMove(...args); }
function onGestureStart(...args) { return layout().onGestureStart(...args); }
function renderMobilePaneCaption(...args) { return layout().renderMobilePaneCaption(...args); }
function selectMobilePane(...args) { return layout().selectMobilePane(...args); }
function setExplorerAnchor(...args) { return layout().setExplorerAnchor(...args); }
function setMobileExplorerOpen(...args) { return layout().setMobileExplorerOpen(...args); }
function setMobileMenuOpen(...args) { return layout().setMobileMenuOpen(...args); }
function toggleChat(...args) { return layout().toggleChat(...args); }
function toggleExplorer(...args) { return layout().toggleExplorer(...args); }
function toggleExplorerAnchor(...args) { return layout().toggleExplorerAnchor(...args); }
function toggleMobileExplorer(...args) { return layout().toggleMobileExplorer(...args); }
function toggleMobileMenu(...args) { return layout().toggleMobileMenu(...args); }
function togglePreview(...args) { return layout().togglePreview(...args); }
function toggleSource(...args) { return layout().toggleSource(...args); }

// ── Touch gestures: explorer drawer + pane carousel ─────────────────────────
// One dispatcher owns every horizontal drag so the two gestures can never fight
// over the same finger. At gesture start it decides who gets it:
//
//   drawer open                  → drag to close (anywhere)
//   touch within EDGE_ZONE left  → drag to open the drawer
//   otherwise                    → drag to switch panes
//
// Nothing is claimed until the finger has moved SLOP px and is clearly more
// horizontal than vertical, so vertical scrolling, caret placement and
// long-press text selection in the editor all behave as before.

function isMobileLayout() {
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
}function toggleLogPanel() {
  settings.change({ debugPanel: !settings.debugPanel });
  persistSettings();
  logDebug("action", settings.debugPanel ? "Log panel enabled" : "Log panel disabled");
}

shell.commands.add({ id: "shell.toggle-explorer", title: "Toggle Explorer", menu: { id: "view", group: 0, order: 1 }, run: toggleExplorer });
shell.commands.add({ id: "editor.toggle-preview", title: "Toggle Preview", menu: { id: "view", group: 0, order: 3 }, run: togglePreview });
shell.commands.add({ id: "editor.toggle-source", title: "Toggle Source", menu: { id: "view", group: 0, order: 2 }, run: toggleSource });
shell.commands.add({ id: "assistant.toggle-chat", title: () => (settings.chatPanel === "shown" ? "Hide Chat" : "Show Chat"), menu: { id: "view", group: 0, order: 4 }, run: toggleChat });
shell.commands.add({ id: "shell.toggle-log", title: "Toggle Log", menu: { id: "view", group: 0, order: 5 }, run: toggleLogPanel });
elements.explorerToggleButton.addEventListener("click", toggleExplorer);
// Touch gestures. touchmove must be non-passive: once a drag is claimed we
// preventDefault it to suppress the scroll/selection the browser would
// otherwise run alongside. touchstart stays passive — it never blocks.
document.addEventListener("touchstart", onGestureStart, { passive: true });
document.addEventListener("touchmove", onGestureMove, { passive: false });
document.addEventListener("touchend", onGestureEnd, { passive: true });
document.addEventListener("touchcancel", onGestureEnd, { passive: true });

document.addEventListener("click", (event) => {
  const toggle = event.target.closest?.(".sidebar-panel-toggle");
  if (toggle?.dataset.panel) toggleSidebarPanel(toggle.dataset.panel);
});

elements.explorerAnchorButton?.addEventListener("click", toggleExplorerAnchor);
// Capture phase so the outside-press check runs before in-tree click handlers.
document.addEventListener("pointerdown", handleFloatingExplorerOutsidePress, true);
elements.previewToggleActivityButton.addEventListener("click", togglePreview);
elements.sourceToggleActivityButton?.addEventListener("click", toggleSource);
elements.chatToggleActivityButton.addEventListener("click", toggleChat);
elements.previewCollapseButton.addEventListener("click", togglePreview);
elements.sourceCollapseButton?.addEventListener("click", toggleSource);
elements.chatCollapseButton.addEventListener("click", toggleChat);
elements.logCollapseButton.addEventListener("click", toggleLogPanel);

// Mobile topbar controls (inert on desktop where the buttons are hidden).
elements.mobileExplorerButton?.addEventListener("click", toggleMobileExplorer);
for (const button of [elements.mobileSourceToggle, elements.mobilePreviewToggle, elements.mobileChatToggle]) {
  button?.addEventListener("click", () => selectMobilePane(button.dataset.pane));
}
elements.mobileRenameButton?.addEventListener("click", () => {
  const id = currentMobileFileId();
  if (!id) { showToast("No file to rename"); return; }
  void renameFileById(id);
});
elements.mobileMenuButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMobileMenu();
});
// Choosing a command from the ⋮ dropdown dismisses it (menu triggers, which only
// open sub-popovers, are left alone). Inert on desktop.
elements.menuBar?.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (button && !button.classList.contains("menu-trigger")) {
    setMobileMenuOpen(false);
  }
});

// Dismiss the mobile flyouts when tapping outside them.
document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (elements.app.dataset.mobileMenu === "open"
    && !elements.menuBar?.contains(target)
    && !elements.mobileMenuButton?.contains(target)) {
    setMobileMenuOpen(false);
  }
  if (elements.app.dataset.mobileExplorer === "open"
    && !elements.explorerPanel?.contains(target)
    && !elements.mobileExplorerButton?.contains(target)
    // The quick-add / context / filter menu lives outside the panel; interacting
    // with it must not dismiss the explorer the user is still managing.
    && !elements.explorerContextMenu?.contains(target)) {
    setMobileExplorerOpen(false);
  }
}, true);
installMobileViewport(window, document.documentElement);

elements.settingsButton.addEventListener("click", () => {
  logDebug("action", "Settings dialog opened");
  openSettingsDialog("appearance");
});

shell.commands.add({ id: "shell.open-settings", title: "Open Settings", menu: { id: "settings", group: 0, order: 1 }, run: () => {
  logDebug("action", "Settings dialog opened from menu");
  openSettingsDialog("appearance");
} });

// Status-bar footer items double as shortcuts to their related menus/panels.
// ── Settings (Shell's dialog; its sections and fields are their owners') ──
function openSettingsDialog(tab = "appearance") { shell.settingsDialog.open(tab); }
// The Agent page draws Settings → Agent's connected tools: load it with Settings.
shell.settingsDialog.onOpen(() => { if (!chat) void loadChat(); });
// The frame's layout follows its settings, whoever changed them.
settings.on((view, changed) => {
  if (changed.some((key) => ["explorer", "explorerAnchor", "preview"].includes(key))) persistSettings();
});

// The status bar's collaborators (Sync's) reveal the Session panel in the explorer sidebar.
shell.commands.add({ id: "layout.show-session", title: "Show the Session Panel", run() {
  // The session/presence panel lives in the explorer sidebar — reveal it.
  if (settings.explorer !== "expanded") {
    settings.change({ explorer: "expanded" });
    persistSettings();
  }
  // Revealing a collapsed section would show only its header, so open it.
  if (sidebarPanelCollapsed("session")) toggleSidebarPanel("session");
  document.querySelector(".collaboration-sidebar-panel")?.scrollIntoView({ block: "nearest" });
  logDebug("action", "Status bar: reveal session panel");
} });

shell.commands.add({ id: "shell.log-panel", title: () => (settings.debugPanel ? "Hide Log Panel" : "Show Log Panel"), menu: { id: "settings", group: 0, order: 2 }, run: toggleLogPanel });

debugTabs.forEach((tab) => {
  tab.element.addEventListener("click", () => {
    debugState.activeTab = tab.id;
    renderDebugPanel();
  });
});

elements.debugCopyButton.addEventListener("click", () => {
  void copyDebugLogToClipboard().catch((error) => notify(error.message));
});

elements.debugClearButton.addEventListener("click", () => dialogs().clearDebugLog());

window.addEventListener("resize", () => {
  cancelMobileGesture();
  // The width observer above owns editor rendering and preserves the caret.
  // Keyboard / browser chrome height changes need only scroll alignment.
  syncEditorScroll();
});

// Crossing the phone breakpoint (rotation, or a resized desktop window) has to
// re-decide the explorer anchor — see applyWorkspaceSettings.
window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
  .addEventListener("change", () => {
    cancelMobileGesture();
    setMobileExplorerOpen(false);
    setMobileMenuOpen(false);
    applyWorkspaceSettings();
    applyMobileViewState();
  });

// ---- The cloud file browser, accounts and hosting (the Cloud module) ----
function handleAccountLogout(...args) { return cloudParts.handleAccountLogout(...args); }
async function handleOpenWorkspace(...args) { return cloudParts.handleOpenWorkspace(...args); }
async function openAccessEditor(...args) { return cloudParts.openAccessEditor(...args); }
function openFileBrowser(...args) { return cloudParts.openFileBrowser(...args); }
async function performLogin(...args) { return cloudParts.performLogin(...args); }
async function pingCurrentServer(...args) { return cloudParts.pingCurrentServer(...args); }
function renderHostTargets(...args) { return cloudParts.renderHostTargets(...args); }





renderHostTargets(); // needs the live session, which exists from here on

void shell.registerOffline();
void refreshChatStatus({ silent: true });

// Resume the last session (Cloud's), so a reload is not a fresh start.
void cloudParts.resumeSession();
