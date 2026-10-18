import { startModules, ignore, ignored } from "./kernel/index.js";
import shellModule, { normalizeServerUrl, patchStoredSettings } from "./modules/shell/index.js";
import fileTypesModule from "./modules/file-types/index.js";
import workspaceModule from "./modules/workspace/index.js";
import identityModule from "./modules/identity/index.js";
import historyModule from "./modules/history/index.js";
import extensionModules from "./extensions.js";
import { createWorkspacePorts } from "./features/workspace-ports.js";
import { rememberedWorkspace, createSessionRecovery } from "./services/session-recovery-service.js";
import { installMobileViewport } from "./services/chat-ui-service.js";
import { APP_VERSION } from "./version.js";
import { ROOT_ID, seedDefaultProject, applyHostCounters, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isImageFileName, isTextFileName } from "./domain/project-model.js";
import { getOpfsDirectoryHandle, importDirectory, importOsFolderIntoOpfs, importSingleFile, importZipArchive, loadProject, saveProject, supportsDirectoryAccess, supportsOpfs } from "./modules/workspace/index.js";
import syncModule from "./modules/sync/index.js";
import { parsePersona, personaTemplate } from "./services/persona-service.js";
import { clearOfflineShellData, registerOfflineShell } from "./services/offline-service.js";
import { signInSettings } from "./services/settings-service.js";
import cloudModule, { saveUserState, uploadAsset } from "./modules/cloud/index.js";
import modelsModule from "./modules/models/index.js";
import chatsModule from "./modules/chats/index.js";
import charactersModule from "./modules/characters/index.js";
import assistantModule, { sendGenerationRequest } from "./modules/assistant/index.js";
import { loadTemplateProject } from "./services/template-service.js";
import { query } from "./ui/dom.js";
import { createDefaultBmap } from "./services/bmap-service.js";
import explorerModule from "./modules/explorer/index.js";
import { createDiagramExport } from "./features/diagram-export.js";
import { registerPreviews } from "./features/previews.js";
import { createLayout } from "./ui/layout.js";
import editorModule, { DIFF_TAB_ID, escapeHtmlAttribute, forgetViewStates, getRelativeProjectPath, normalizePath, renderMarkdown } from "./modules/editor/index.js";
import { createDialogs } from "./ui/dialogs.js";
import { createLineComments } from "./modules/comments/index.js";
import { createSnapshots } from "./features/snapshots.js";

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
  lineCommentPopover: query("#line-comment-popover"),
  lineCommentInput: query("#line-comment-input"),
  lineCommentMeta: query("#line-comment-meta"),
  lineCommentDelete: query("#line-comment-delete"),
  lineCommentCancel: query("#line-comment-cancel"),
  lineCommentSave: query("#line-comment-save"),
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
  welcomeResume: query("#welcome-resume"),
  welcomeNewFile: query("#welcome-new-file"),
  welcomeOpenServer: query("#welcome-open-server"),
  welcomeOpenLocal: query("#welcome-open-local"),
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
  previewDiffView: query("#preview-diff-view"),
  diffBody: query("#diff-body"),
  diffRuler: query("#diff-ruler"),
  diffPrevChange: query("#diff-prev-change"),
  diffNextChange: query("#diff-next-change"),
  previewDiffLabel: query("#preview-diff-label"),
  previewDiffStats: query("#preview-diff-stats"),
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
const modules = await startModules([shellModule, fileTypesModule, workspaceModule, identityModule, editorModule, syncModule, historyModule, explorerModule, cloudModule, modelsModule, charactersModule, chatsModule, assistantModule, ...extensionModules], {
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
  scope: () => snapshotProjectKey(),
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
  commentsForActiveFile, scheduleCommentReanchor,
  imageSrcFor, closeDiff, formatSnapshotTime,
  get diffState() { return diffState; },
  renderWelcomeState, setMobileExplorerOpen, togglePreview,
  scope: () => chatWorkspaceKey(), isReadOnly: () => isReadOnlyWorkspace(), onDrop: (event) => handleEditorDrop(event)
});
// The explorer and file actions, given what no module owns yet (modules/explorer/adapters/surface.js).
var explorerParts = modules.explorer.attach({
  publishOperation, publishSnapshot, settings, persistSettings, elements, logDebug, imageSrcFor,
  canManagePreview: () => Boolean(identity.account()) && syncMode.get().workspaceMode === "synced"
    && collaboration.isConnected() && Boolean(settings.lastWorkspace?.team),
  openAccessEditor, openMtreeToolsDialog, remapPersonaPaths, initialContentForKind,
  exportDiagram: createDiagramExport({ get controller() { return controller; }, loadBmapView, notify, logDebug })
});
// The cloud file browser, accounts and hosting (modules/cloud/adapters/surface.js).
var cloudParts = modules.cloud.attach({
  elements, logDebug, flashStatusPanel, openSettingsDialog, refreshChatStatus, loadLineComments,
  ensureSnapshotsMigrated, refreshSnapshotBaselines, snapshotDirtyFiles, setMobileExplorerOpen,
  get sessionRestorer() { return sessionRestorer; },
  get switchWorkspaceMode() { return switchWorkspaceMode; }
});
var chatsPage = modules.chats.attach({ cloudWorkspaceTarget, chatWorkspaceKey, personaAvatarSrc, isMobileLayout, logDebug }); // the side panel's Chats page
// Diagrams and character sheets add their previews to the Editor's extension point.
registerPreviews(modules.editor.previews, {
  view: editorView, settings, escapeHtmlAttribute, normalizePath, getRelativeProjectPath,
  personaAvatarSrc, loadBmapView, quickGenerateBmapFile, updateFileContentFromPreview, logDebug, render, getViewState, openFileFromExplorer,
  get bmapViewModule() { return bmapViewModule; },
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
function captureViewState(...args) { return editorParts.captureViewState(...args); }
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
// The diagram editor is the largest module (~150KB) and most sessions never
// open a diagram, so it loads the first time one is previewed or exported.
let bmapViewModule = null;
let bmapViewLoading = null;

function loadBmapView() {
  bmapViewLoading ??= import("./ui/bmap-view.js")
    .then((module) => (bmapViewModule = module))
    .catch((error) => { bmapViewLoading = null; throw error; });
  return bmapViewLoading;
}


// "private" = user's local workspace; "synced" = connected server workspace.
let sessionRestorer = null;

// Forward declaration — assigned after `collaboration` is created.
let switchWorkspaceMode;

// Set to true while a preview-originated edit (e.g. a bmap inspector change) is
// being committed. The preview view has already updated itself in place, so the
// synchronous updateStatus callback must skip re-rendering the preview pane —
// re-rendering would rebuild the diagram and reset its scroll/selection.
let _previewUpdating = false;

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

// Starting content for a new file of `kind`: a default diagram, a character
// sheet template, or nothing.
function initialContentForKind(kind, name) {
  if (kind === "bmap") return createDefaultBmap();
  if (kind === "persona") {
    const base = parsePersona("", name).name;
    return personaTemplate(/^new character( \d+)?$/i.test(base) ? "New Character" : base);
  }
  return "";
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

// ============================ Snapshots + Diff ==============================
// Per-file, content-addressed history (the History module). Diff state caches
// the fetched old-version text so renderDiff() can run synchronously (in the
// diff overlay). `path` is the file whose version being compared.
// The diff lives in the preview pane's tab strip as a single special (non-file)
// tab, keyed by this sentinel id. When it's the active preview tab the pane shows
// the diff overlay instead of #preview-output. It compares the CURRENT content of
// `fileId` against the cached `oldText` snapshot — independent of which file the
// editor has active, so it behaves like any other preview tab.
const diffState = { active: false, fileId: null, path: null, versionId: null, oldText: "", createdAt: 0, blocks: [], currentChange: -1 };

// A stable-enough key to group snapshots by project: the cloud workspace id when
// synced, otherwise the local project id.
// True when this session only has read access to the open cloud workspace.
function isReadOnlyWorkspace() {
  return syncMode.get().workspaceMode === "synced" && syncState.role === "reader";
}

function snapshotProjectKey() {
  return settings.syncedProjectId || controller.getProject()?.id || "local";
}

// ---- Line comments -----------------------------------------------------------
// A note attached to a LINE, like a breakpoint: it lives in metadata beside the
// project on the server (the Comments module), never in the document text. Shared with
// everyone who can open the workspace. Comments follow the text: each one stores
// the line's own content, so after edits shift it we re-find it rather than
// leaving the note stranded on a line number that now means something else.
const lineComments = { byFile: new Map(), loadedFor: null };
// ---- Line comments (the Comments module) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var lineCommentsUiInstance;
function lineCommentsUi() {
  return (lineCommentsUiInstance ??= createLineComments({
    get cloudWorkspaceTarget() { return cloudWorkspaceTarget; },
    get collaboration() { return collaboration; },
    get controller() { return controller; },
    get elements() { return elements; },
    get getEditorSelection() { return getEditorSelection; },
    get getEditorText() { return getEditorText; },
    get lineComments() { return lineComments; },
    get logDebug() { return logDebug; },
    get notify() { return notify; },
    get renderEditorContent() { return renderEditorContent; },
    get setEditorSelection() { return setEditorSelection; },
    get showToast() { return showToast; },
    get workspaceMode() { return syncMode.get().workspaceMode; }
  }));
}
function closeCommentPopover(...args) { return lineCommentsUi().closeCommentPopover(...args); }
function commentsAvailable(...args) { return lineCommentsUi().commentsAvailable(...args); }
function commentsForActiveFile(...args) { return lineCommentsUi().commentsForActiveFile(...args); }
async function loadLineComments(...args) { return lineCommentsUi().loadLineComments(...args); }
function openCommentPopover(...args) { return lineCommentsUi().openCommentPopover(...args); }
async function removeLineComment(...args) { return lineCommentsUi().removeLineComment(...args); }
function renderEditorFromModel(...args) { return lineCommentsUi().renderEditorFromModel(...args); }
function scheduleCommentReanchor(...args) { return lineCommentsUi().scheduleCommentReanchor(...args); }
async function submitLineComment(...args) { return lineCommentsUi().submitLineComment(...args); }

// ---- Where snapshots live ----------------------------------------------------
// A cloud workspace keeps snapshots ON THE SERVER, so they follow you to any
// device. A local/private project (no account, or not a cloud workspace) keeps
// them in this browser's IndexedDB as before. Everything goes through this one
// adapter so the dialog and diff code never care which backend they talk to.
function cloudWorkspaceTarget() {
  const token = identity.token();
  const ws = settings.lastWorkspace;
  if (!token || !ws?.team || !ws?.path) return null;
  if (settings.syncedProjectId !== `${ws.team}/${ws.path}`) return null; // on-screen project IS that workspace
  return { serverUrl: settings.serverUrl, token, team: ws.team, path: ws.path };
}
// ---- Snapshots, version label and the diff tab (./features/snapshots.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var snapshotsInstance;
function snapshots() {
  return (snapshotsInstance ??= createSnapshots({
    view: editorView,
    get workspace() { return workspace; },
    get DIFF_TAB_ID() { return DIFF_TAB_ID; },
    get cloudWorkspaceTarget() { return cloudWorkspaceTarget; },
    get collaboration() { return collaboration; },
    get controller() { return controller; },
    get diffState() { return diffState; },
    get elements() { return elements; },
    get escapeHtmlAttribute() { return escapeHtmlAttribute; },
    get logDebug() { return logDebug; },
    get render() { return render; },
    get settings() { return settings; },
    get showToast() { return showToast; },
    get snapshotProjectKey() { return snapshotProjectKey; },
    get togglePreview() { return togglePreview; },
    get updateStatus() { return updateStatus; },
    versionItem: shell.statusBar.add({ id: "version", order: 50, className: "status-item-version", hidden: true })
  }));
}
async function applyHistoryOperations(...args) { return snapshots().applyHistoryOperations(...args); }
function closeDiff(...args) { return snapshots().closeDiff(...args); }
async function createSnapshotNow(...args) { return snapshots().createSnapshotNow(...args); }
function ensureSnapshotsMigrated(...args) { return snapshots().ensureSnapshotsMigrated(...args); }
function formatBytes(...args) { return snapshots().formatBytes(...args); }
function formatSnapshotTime(...args) { return snapshots().formatSnapshotTime(...args); }
function gotoChange(...args) { return snapshots().gotoChange(...args); }
function projectPaths(...args) { return snapshots().projectPaths(...args); }
function refreshSnapshotBaselines(...args) { return snapshots().refreshSnapshotBaselines(...args); }
function renderDiff(...args) { return snapshots().renderDiff(...args); }
function renderVersionLabel(...args) { return snapshots().renderVersionLabel(...args); }
function scheduleDiffRefresh(...args) { return snapshots().scheduleDiffRefresh(...args); }
function scheduleVersionLabel(...args) { return snapshots().scheduleVersionLabel(...args); }
function setSnapshotBaselines(...args) { return snapshots().setSnapshotBaselines(...args); }
async function showFileDiff(...args) { return snapshots().showFileDiff(...args); }
async function snapshotDirtyFiles(...args) { return snapshots().snapshotDirtyFiles(...args); }
function snapshotStore(...args) { return snapshots().snapshotStore(...args); }
function writeAtPathOperations(...args) { return snapshots().writeAtPathOperations(...args); }

let workspaceHistory = null;
let workspaceHistoryLoading = null;

async function openWorkspaceHistory() {
  if (!cloudWorkspaceTarget()) {
    showToast("Workspace History is for cloud workspaces — open one from the server first");
    return;
  }
  workspaceHistoryLoading ??= import("./features/workspace-history.js").then(({ createWorkspaceHistory }) => {
    workspaceHistory = createWorkspaceHistory({
      controller, cloudWorkspaceTarget, showToast, notify, confirmAction, formatSnapshotTime, formatBytes,
      projectPaths, writeAtPathOperations, applyHistoryOperations
    });
    return workspaceHistory;
  }).catch((error) => {
    workspaceHistoryLoading = null;
    throw error;
  });
  try {
    await (await workspaceHistoryLoading).open();
  } catch (error) {
    notify(`Workspace History could not load: ${error.message}`);
  }
}

let snapshotsDialog = null;
let snapshotsDialogLoading = null;

// The Snapshots dialog lives in app/features/snapshots-dialog.js and loads on first use.
async function openSnapshotsDialog() {
  snapshotsDialogLoading ??= import("./features/snapshots-dialog.js").then(({ createSnapshotsDialog }) => {
    snapshotsDialog = createSnapshotsDialog({
      controller, collaboration, getPath, getWorkspaceMode: () => syncMode.get().workspaceMode, snapshotStore, ensureSnapshotsMigrated,
      setSnapshotBaselines, refreshSnapshotBaselines, createSnapshotNow, showFileDiff, showToast, notify,
      confirmAction, formatSnapshotTime, formatBytes, projectPaths, writeAtPathOperations,
      applyHistoryOperations, workspace
    });
    return snapshotsDialog;
  }).catch((error) => {
    snapshotsDialogLoading = null;
    throw error;
  });
  try {
    await (await snapshotsDialogLoading).open();
  } catch (error) {
    notify(`Snapshots could not load: ${error.message}`);
  }
}



// The live session is Sync's; it is given what only the app can do, and
// tells its news through events (modules/sync/index.js).
const collaboration = modules.sync.attach({
  async preserveLocalFiles(files) {
    const store = snapshotStore();
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
    // Comments are shared, so a COLLABORATOR's edit can move my commented lines
    // just as my own typing does. Re-anchor after remote ops too, or a teammate
    // inserting a paragraph above would strand every comment below it.
    scheduleCommentReanchor();
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
  uploadAsset
});
modules.sync.events.on("status", ({ next: nextState, previous }) => {
  const prevStatus = previous.status;
  const wasConnected = prevStatus === "connected";
  // Server refused this client as too old (stale cached service worker). Stop
  // syncing and force the app up to date rather than letting it clobber content.
  if (nextState.status === "upgrade-required") {
    forceAppUpgrade(nextState.detail);
    return;
  }
  // Cloud sync now recovers dropped streams on its own (see collaboration-
  // service). Surface it so the user knows their work is safe, not lost.
  if (nextState.status === "reconnecting" && prevStatus !== "reconnecting") {
    showToast("Connection lost — reconnecting… your changes are kept.");
  }
  if (nextState.status === "connected" && prevStatus === "reconnecting") {
    showToast("Reconnected to the cloud workspace.");
  }
  if (nextState.status === "connected") {
    // A clean connect means we're on a good version — reset the one-shot upgrade
    // guard so a future min-version bump can auto-refresh again.
    try { sessionStorage.removeItem("mdnotes.upgradeReloaded"); } catch (error) { ignore(error, "session storage is blocked"); }
  }
  // Reconcile remote carets against who's actually present, so a departed
  // peer's cursor/selection doesn't linger.
  pruneRemoteCursors(syncState.presence);
  // Keep the "what revision is this browser's copy based on" marker current
  // while we're genuinely in sync. It decides, on the next open, whether this
  // device may push its copy over the server or must pull. Persisted on unload;
  // if it's ever missing we treat this device as stale and pull (fail-safe).
  if (nextState.status === "connected" && syncMode.get().workspaceMode === "synced" && settings.syncedProjectId) {
    settings.change({ syncedRevision: syncState.revision });
  }
  // Auto-switch workspace mode on connect/disconnect.
  if (!wasConnected && nextState.status === "connected" && syncMode.get().workspaceMode === "private") {
    if (syncState.role === "client") {
      // User already confirmed before connect() was called; just sync.
      switchWorkspaceMode?.("synced");
      return;
    }
    if (syncState.role === "master") {
      // Master just connected: enter synced mode without reloading from server.
      // The master already pushed its own project as the authoritative state;
      // calling reloadFromServer here would just fetch it back unnecessarily.
      syncMode.share(controller.getProject());
      render(controller.getProject());
      return;
    }
  }
  if (nextState.status === "offline") {
    // Dropped while we had an intended session — try to re-establish it.
    // (Guarded against firing during a deliberate reconnect handshake.)
    scheduleReconnect?.();
  }
  if (nextState.status === "offline" && syncMode.get().workspaceMode === "synced") {
    // A cloud workspace's content is what the user is actively editing; reverting
    // to the pre-open private snapshot here is what made "everything suddenly go
    // empty / back to a previous version". Keep the current project ON SCREEN and
    // just drop to private mode (edits stay local, safe in localStorage); a
    // reconnect or reload re-syncs. Only a PIN/guest session (no cloud workspace)
    // should restore the user's own private project.
    const wasCloud = Boolean(settings.syncedProjectId) || Boolean(settings.lastWorkspace?.team);
    if (wasCloud) {
      // STAY in synced mode. Flipping to "private" here is what silently killed
      // syncing for good: notifyEditorChanged only schedules a patch while
      // workspaceMode === "synced", so after one dropped stream every later
      // keystroke lived only in this tab (server revision never moved) — and the
      // next server pull replaced hours of work with the stale snapshot. Staying
      // synced means patches resume as soon as the stream is back, and
      // reconcileLocalIntoServer() pushes everything changed while offline.
      syncMode.forgetKept(); // don't later clobber the on-screen content
      syncState.change({ detail: "Offline — edits are saved locally and will sync when the connection returns." });
      render(controller.getProject());
      return;
    }
    switchWorkspaceMode?.("private");
    return;
  }
  render(controller.getProject());
});
modules.sync.events.on("remote-cursor", (event) => {
  onRemoteCursor(event);
});
// The host stamped this file's S.E.N counters on the operation it just
// accepted. Adopt them verbatim — we never count locally while synced, so
// everyone in the room shows the same sitting number.
modules.sync.events.on("host-counters", ({ path, counters }) => {
  const project = controller.getProject();
  const nodeId = getNodeIdByPath(project, path);
  if (!nodeId) return;
  applyHostCounters(project, nodeId, counters);
  scheduleVersionLabel();
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
// Other modules' events on Sync's stream: comments, Chats, the agent's threads.
modules.sync.events.on("event", ({ event, ownClientId }) => {
  if (event.type === "comments") {
    // A collaborator added/edited/moved a comment: adopt the server's list and
    // repaint the gutter + overview ruler without waiting for a reopen.
    if (!commentsAvailable()) return;
    lineComments.byFile = new Map(Object.entries(event.files ?? {}));
    renderEditorFromModel();
  } else if (event.type === "chat-message" || event.type === "chat-typing" || event.type === "chat-update") {
    chat?.receiveChatEvent(event);
  } else if (event.type === "chat-workspace-update" && event.clientId !== ownClientId) {
    chat?.receiveChatWorkspace(controller.getProject(), event.workspace); // nothing listens until the panel loads
  }
});
workspace.attach(createWorkspacePorts({ controller, collaboration, publishOperation, getEditorSelection, applyEditorEdit,
  get workspaceMode() { return syncMode.get().workspaceMode; },
  editorShowsWholeFile: () => !editorView.get().sourcePart && isTextFileName(controller.getActiveFile()?.name ?? "") }));

attachSelectionChangeListener();

// Assign the forward-declared switchWorkspaceMode now that `collaboration` exists.
switchWorkspaceMode = function (nextMode) {
  if (nextMode === syncMode.get().workspaceMode) return;
  if (nextMode === "synced") {
    syncMode.share(controller.getProject());
    // reloadFromServer replaces the project internally, triggering render.
    collaboration.reloadFromServer("Switched to synced workspace.").catch(ignored("loading the synced workspace failed"));
  } else {
    sessionRestorer?.cancel();
    const kept = syncMode.leave();
    if (kept) controller.replaceProject(kept);
    // The local project is no longer a cloud workspace's content.
    settings.change({ syncedProjectId: null });
    render(controller.getProject());
  }
};

elements.workspaceModeToggle?.addEventListener("click", () => {
  switchWorkspaceMode(syncMode.get().workspaceMode === "synced" ? "private" : "synced");
});


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
function cacheWorkspaceView(...args) { return editorParts.cacheWorkspaceView(...args); }
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
// chat, the snapshot version. (The status bar's items draw themselves.)
function updateStatus(project) {
  ensureOpenTabs(project);
  renderTabs(project);
  elements.projectNameLabel.textContent = project.name;
  renderMobilePaneCaption(); // tracks the active/preview file, not just the view

  const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
  const previewFile = editorView.get().previewFileId ? project.nodes[editorView.get().previewFileId] : null;
  showActiveFile(project); // the source editor shows the active file (the Editor)
  // The preview is not rebuilt when the change came from the preview itself,
  // nor while the user edits inside it (renderPreviewOrDiff): a rebuild would
  // reset a diagram's scroll and selection, or pull focus out of the field.
  renderPreviewOrDiff(project, previewFile); // the diff tab still shows if it's the active preview tab
  renderLinksPanel(project, activeFile);
  renderChatPanel(project);
  renderVersionLabel();
}

// Paint the preview pane: either the diff overlay (when the diff tab is the active
// preview tab) or the normal preview for `previewFile`. The two are mutually
// exclusive and each hides the other's DOM.
function renderPreviewOrDiff(project, previewFile) {
  const showingDiff = diffState.active && editorView.get().previewFileId === DIFF_TAB_ID;
  if (showingDiff) {
    const wasHidden = elements.previewDiffView ? elements.previewDiffView.hidden : true;
    if (elements.previewDiffView) elements.previewDiffView.hidden = false;
    if (elements.preview) elements.preview.hidden = true;
    // Full immediate render when the tab is (re)activated; debounce the routine
    // live refreshes while the file is being edited underneath.
    if (wasHidden) renderDiff();
    else scheduleDiffRefresh();
    return;
  }
  if (elements.previewDiffView) elements.previewDiffView.hidden = true;
  if (elements.preview) elements.preview.hidden = false;
  // Skip the redundant preview rebuild when the change came from the preview
  // itself, or while the user is editing INSIDE the preview (e.g. a bmap node's
  // Name/Text inspector field): renderPreviewContent() does a full
  // replaceChildren(), so rebuilding here would yank focus out of the field.
  const editingInPreview = elements.preview.contains(document.activeElement)
    && document.activeElement !== elements.preview;
  if (!_previewUpdating && !editingInPreview) {
    const previewState = renderPreviewContent(elements.preview, project, previewFile);
    if (previewState.shouldTypeset) {
      void typesetPreview(previewState.content);
    }
  }
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

function publishSnapshot() {
  if (collaboration.isConnected() && syncMode.get().workspaceMode === "synced") {
    collaboration.scheduleSnapshot(controller.getProject());
  }
}

async function publishOperation(operation) {
  if (!collaboration.isConnected() || syncMode.get().workspaceMode !== "synced") {
    return;
  }
  let op = operation;
  // A whole-file write must declare the revision it is based on, so the server
  // can refuse one that would overwrite newer content. Stamped centrally here so
  // every caller is covered — a missed call site would be exactly the hole that
  // let an old tab clobber the server.
  if (op.type === "update-file" && op.baseRevision === undefined) {
    op = { ...op, baseRevision: collaboration.getRevision?.() ?? 0 };
  }
  // In a directory-backed cloud workspace, an image's bytes upload out-of-band
  // (chunked binary) so a large image can't blow the op-stream body limit (413)
  // or bloat sync as base64; the op then carries empty content and peers fetch
  // the image by URL.
  const opFileName = op.name ?? op.path?.split("/").pop() ?? "";
  if (collaboration.isDirectoryBacked?.()
    && (op.type === "create-file" || op.type === "update-file")
    && isImageFileName(opFileName)
    && typeof op.content === "string"
    && op.content.startsWith("data:")) {
    try {
      const path = op.type === "create-file"
        ? [op.parentPath, op.name].filter(Boolean).join("/")
        : op.path;
      await collaboration.uploadAsset(path, op.content);
      op = { ...op, content: "" };
    } catch (error) {
      notify(error.message);
      return;
    }
  }
  collaboration.publishOperation(op).catch((error) => {
    if (error?.status === 409) {
      // The server has a newer version of this file. Take it rather than
      // overwrite it, and say so — silently dropping the write would leave the
      // two sides diverged with no sign anything happened.
      notify("That file changed on the server — loading the newer version instead of overwriting it.");
      collaboration.reloadFromServer?.("Stale write refused — pulled the newer copy.").catch(ignored("pulling the newer copy after a refused write failed"));
      return;
    }
    notify(error.message);
  });
}

function updateFileContentFromPreview(fileId, nextContent, reason = "preview edit") {
  const project = controller.getProject();
  const file = project.nodes[fileId];
  if (!file || file.kind !== "file") {
    return;
  }
  if (file.content === nextContent) {
    return;
  }

  // The preview already re-rendered itself; suppress its redundant re-render
  // in the synchronous updateStatus the write triggers (commit runs at once).
  _previewUpdating = true;
  try {
    workspace.write(getPath(project, fileId), nextContent, { source: "preview" }).catch((error) => notify(error.message));
  } finally {
    _previewUpdating = false;
  }
  logDebug("action", "Bmap preview updated", reason);
}

function sanitizeGeneratedFileName(name) {
  const cleaned = String(name ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "generated";
}

let bmapGenerationInFlight = false;

async function quickGenerateBmapFile(bmapFileId, request) {
  const subject = String(request?.subject ?? "").trim();
  if (!subject) {
    notify("This node has no name or text to generate from. Add some content first.");
    logDebug("action", "Quick Generate skipped", "node has no subject text");
    return;
  }
  if (bmapGenerationInFlight) {
    logDebug("action", "Quick Generate skipped", "another generation is already in flight");
    return;
  }

  // Empty serverUrl resolves to the page origin (same-origin proxy), so it is
  // valid — only block if the resolved URL would be empty (no window.location).
  const serverUrl = settings.serverUrl?.trim();
  const resolvedUrl = serverUrl || (typeof window !== "undefined" ? window.location.origin : "");
  if (!resolvedUrl) {
    notify("Could not determine server URL. Set one in Settings to use Quick Generate.");
    logDebug("action", "Quick Generate skipped", "no server URL");
    return;
  }

  const project = controller.getProject();
  const bmapNode = project.nodes[bmapFileId];
  if (!bmapNode || bmapNode.kind !== "file") {
    return;
  }
  const parentId = bmapNode.parentId ?? project.rootId;
  const parentPath = parentId === project.rootId ? "" : getPath(project, parentId);
  const baseName = sanitizeGeneratedFileName(request?.nodeName || request?.nodeId || "generated");
  const fileName = suggestUniqueFileName(project, parentId, `${baseName}.md`);
  const contextCount = Array.isArray(request?.contextFiles) ? request.contextFiles.length : 0;

  bmapGenerationInFlight = true;
  logDebug("action", "Quick Generate started", `node="${request?.nodeName}" file="${fileName}" context=${contextCount} scope=${settings.bmapGenerateScope}`);
  logDebug("request", "POST /api/generate", `subject=${subject.slice(0, 80)}${subject.length > 80 ? "…" : ""}`);
  try {
    const result = await sendGenerationRequest(resolvedUrl, {
      subject,
      contextFiles: Array.isArray(request?.contextFiles) ? request.contextFiles : [],
      bmapOverview: String(request?.bmapOverview ?? ""),
      projectName: project.name ?? "Workspace",
      accountToken: identity.token()
    });
    const content = String(result?.content ?? "").trim();
    logDebug("response", "Quick Generate response received", `model=${result?.model ?? "?"} provider=${result?.provider ?? "?"} length=${content.length} chars`);
    if (!content) {
      notify("Generation returned no content.");
      logDebug("error", "Quick Generate empty response", "provider returned no content");
      return;
    }

    controller.createFile(parentId, fileName, content);
    publishOperation({ type: "create-file", parentPath, name: fileName, content });
    logDebug("action", "Quick Generate file created", fileName);

    const created = findChildByName(controller.getProject(), parentId, fileName);
    if (created && created.kind === "file") {
      openFileFromExplorer(created.id);
    }
    notify(`Generated: ${fileName}`);
    logDebug("action", "Quick Generate complete", fileName);
  } catch (error) {
    notify(error?.message ?? "Generation failed.");
    logDebug("error", "Quick Generate failed", error?.message ?? String(error));
  } finally {
    bmapGenerationInFlight = false;
  }
}

// The file the mobile pane's pen button should act on: the previewed file in
// preview view, otherwise the active source file. Null in chat view.
function currentMobileFileId() {
  if (layout().mobileView() === "chat") return null;
  if (layout().mobileView() === "preview") return editorView.get().previewFileId === DIFF_TAB_ID ? null : editorView.get().previewFileId;
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
shell.commands.add({ id: "history.create-snapshot", title: "Create Snapshot", menu: { id: "create", group: 1, order: 1 }, run: () => void createSnapshotNow() });
shell.commands.add({ id: "history.snapshots", title: "Snapshots…", menu: { id: "edit", group: 0, order: 2 }, run: () => void openSnapshotsDialog() });
shell.commands.add({ id: "history.workspace-history", title: "Workspace History…", menu: { id: "edit", group: 0, order: 3 }, run: () => void openWorkspaceHistory() });
// Click a gutter line number to add/edit that line's comment (breakpoint-style).
elements.editorGutter?.addEventListener("click", (event) => {
  const row = event.target.closest?.(".editor-gutter-line");
  if (!row || row.dataset.line === undefined) return;
  openCommentPopover(Number(row.dataset.line));
});
window.addEventListener("resize", scheduleOverviewRuler);
elements.lineCommentSave?.addEventListener("click", () => { void submitLineComment(); });
elements.lineCommentCancel?.addEventListener("click", closeCommentPopover);
elements.lineCommentDelete?.addEventListener("click", () => {
  const id = elements.lineCommentPopover?.dataset.commentId;
  if (id) void removeLineComment(id);
});
elements.lineCommentInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); closeCommentPopover(); return; }
  // Ctrl/Cmd+Enter saves; plain Enter stays a newline inside the note.
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submitLineComment();
  }
});
document.addEventListener("click", (event) => {
  if (elements.lineCommentPopover?.hidden) return;
  if (event.target.closest?.("#line-comment-popover, .editor-gutter-line")) return;
  closeCommentPopover();
});
elements.diffNextChange?.addEventListener("click", () => gotoChange(1));
elements.diffPrevChange?.addEventListener("click", () => gotoChange(-1));

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
    get DIFF_TAB_ID() { return DIFF_TAB_ID; },
    get chat() { return chat; },
    get closeMenus() { return closeMenus; },
    get controller() { return controller; },
    get currentMobileFileId() { return currentMobileFileId; },
    get diffState() { return diffState; },
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

/** Remove every persisted localStorage key this app owns (project, settings,
 *  chat, and any future "mdnotes.*" keys). Returns the count removed. */
function clearAllAppStorage() {
  const store = globalThis.localStorage;
  if (!store) return 0;
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith("mdnotes.")) keys.push(key);
  }
  keys.forEach((key) => store.removeItem(key));
  return keys.length;
}

/** Wipe all saved data and reload into the default welcome workspace
 *  (loaded fresh from the Template on next boot). */
async function resetToDefaultWorkspace() {
  const confirmed = await showConfirmDialog({
    title: "Reset to Default Workspace",
    message: "This deletes your current workspace, chat history, and settings, then reloads the default welcome workspace. This cannot be undone.",
    acceptLabel: "Reset"
  });
  if (!confirmed) {
    logDebug("response", "Workspace reset cancelled");
    return;
  }
  closeMenus();
  const removed = clearAllAppStorage();
  logDebug("action", "Workspace reset to default", `keysRemoved=${removed}`);
  window.location.reload();
}

/** Wipe all saved data AND seed an empty project so even the default welcome
 *  workspace is gone on reload — a blank slate for quick tests. */
async function emptyEverything() {
  const confirmed = await showConfirmDialog({
    title: "Empty Everything",
    message: "This deletes your workspace, chat history, and settings, then reloads into a completely empty workspace (no welcome files). This cannot be undone.",
    acceptLabel: "Empty Everything"
  });
  if (!confirmed) {
    logDebug("response", "Empty everything cancelled");
    return;
  }
  closeMenus();
  clearAllAppStorage();
  // Persist an empty project so the boot path doesn't fall back to loading the
  // default Template welcome workspace.
  saveProject(createProject("Workspace"));
  forgetViewStates();
  logDebug("action", "Workspace emptied");
  window.location.reload();
}

async function clearAllCache() {
  const confirmed = await showConfirmDialog({
    title: "Clear Cached App Data",
    message: "This clears the app's cached shell files and unregisters its service worker, then reloads the page. Your workspace content and settings will stay intact.",
    acceptLabel: "Clear Cache"
  });
  if (!confirmed) {
    logDebug("response", "Cache clear cancelled");
    return;
  }

  closeMenus();
  forgetViewStates(); // also drop cached resume positions
  try {
    const result = await clearOfflineShellData();
    logDebug(
      "action",
      "App cache cleared",
      `caches=${result.deletedCacheKeys.length} ; registrations=${result.unregisteredScopes.length}`
    );
    window.location.reload();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logDebug("response", "Cache clear failed", message);
    notify(`Failed to clear cache: ${message}`);
  }
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
// Update the welcome (no-file) page's contextual actions: a Resume button for
// the last cloud workspace, and Open-a-workspace only when signed in.
function renderWelcomeState() {
  const last = settings.lastWorkspace;
  const target = rememberedWorkspace(last);
  const alreadyOpen = target && settings.syncedProjectId === `${target.team}/${target.path}`
    && syncMode.get().workspaceMode === "synced"
    && (["connected", "reconnecting"].includes(syncState.status) || sessionRestorer?.isPending());
  const canResume = Boolean(target) && !alreadyOpen;
  if (elements.welcomeResume) {
    elements.welcomeResume.hidden = !canResume;
    if (canResume) {
      const label = rememberedWorkspace(last).path.split("/").pop() || last.team;
      elements.welcomeResume.textContent = `Resume ${label}`;
    }
  }
  if (elements.welcomeOpenServer) {
    elements.welcomeOpenServer.hidden = !identity.account();
  }
}

elements.welcomeNewFile?.addEventListener("click", openNewFileDialog);
elements.welcomeOpenLocal?.addEventListener("click", () => void shell.run("workspace.import-folder"));
elements.welcomeOpenServer?.addEventListener("click", () => elements.openServerDirectoryButton?.click());
elements.welcomeResume?.addEventListener("click", () => {
  void sessionRestorer.run({ manual: true });
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
// The diagram's settings (until diagrams are a module).
shell.settingsDialog.fields.add({ page: "appearance", id: "bmap-generate-scope-select", order: 110, label: "Bmap Generate Context",
  key: "bmapGenerateScope", control: "select", options: [["connected", "Connected nodes only"], ["all", "All linked files"]],
  read: (s) => (s.bmapGenerateScope === "all" ? "all" : "connected") });
shell.settingsDialog.fields.add({ page: "appearance", id: "bmap-auto-pan-input", order: 120, label: "Auto-pan diagrams to content on open",
  key: "bmapAutoPan", control: "checkbox", read: (s) => s.bmapAutoPan !== false });
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
shell.commands.add({ id: "workspace.reset", title: "Reset to Default Workspace", menu: { id: "settings", group: 0, order: 3 }, run: () => {
  void resetToDefaultWorkspace();
} });
shell.commands.add({ id: "workspace.empty-everything", title: "Empty Everything", menu: { id: "settings", group: 0, order: 4 }, danger: true, run: () => {
  void emptyEverything();
} });
shell.commands.add({ id: "shell.clear-cache", title: "Clear All Cache", menu: { id: "settings", group: 0, order: 5 }, danger: true, run: () => {
  void clearAllCache();
} });

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

// Turning auto-reconnect off cancels any pending retry and forgets the session.
settings.on((view, changed) => {
  if (!changed.includes("autoReconnect") || view.autoReconnect) return;
  clearReconnectTimer();
  settings.change({ wasConnected: false }, "auto-reconnect turned off");
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

// ── Auto-reconnect ──────────────────────────────────────────────────────────
// Remember the last intended session (settings.wasConnected) and transparently
// re-establish it on startup and after a dropped connection, with backoff.
const reconnectState = { timer: null, attempts: 0, connecting: false };
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;

function clearReconnectTimer() {
  if (reconnectState.timer) {
    window.clearTimeout(reconnectState.timer);
    reconnectState.timer = null;
  }
}

/** Connect using the saved credentials. `auto` skips the confirm dialog (the
 *  user already consented to this session when they first connected). */
async function establishConnection({ auto = false } = {}) {
  if (reconnectState.connecting) return false;
  if (!settings.serverPin) {
    if (auto) return false;
    throw new Error("PIN is required.");
  }
  reconnectState.connecting = true;
  try {
    await collaboration.connect(settings.serverUrl, settings.serverPin, settings.displayName);
    settings.change({ wasConnected: true });
    reconnectState.attempts = 0;
    clearReconnectTimer();
    flashStatusPanel("success", elements.sharedSessionSection);
    logDebug("response", "Server connected", settings.displayName || "anonymous");
    await refreshChatStatus({ silent: true });
    return true;
  } finally {
    reconnectState.connecting = false;
  }
}

function scheduleReconnect() {
  if (!settings.autoReconnect || !settings.wasConnected || !settings.serverPin) return;
  if (reconnectState.connecting || reconnectState.timer) return;
  if (reconnectState.attempts >= MAX_RECONNECT_ATTEMPTS) {
    syncState.change({ detail: "Reconnect failed. Open collaboration settings to retry." });
    render(controller.getProject());
    logDebug("response", "Auto-reconnect gave up", `after ${reconnectState.attempts} attempts`);
    return;
  }
  const delay = RECONNECT_DELAYS[Math.min(reconnectState.attempts, RECONNECT_DELAYS.length - 1)];
  reconnectState.attempts += 1;
  syncState.change({ detail: `Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectState.attempts})` });
  render(controller.getProject());
  reconnectState.timer = window.setTimeout(() => {
    reconnectState.timer = null;
    establishConnection({ auto: true }).catch((error) => {
      logDebug("response", "Auto-reconnect attempt failed", error.message);
      scheduleReconnect();
    });
  }, delay);
}

elements.connectServerButton.addEventListener("click", async () => {
  // Persist the latest field values before connecting so reconnect uses them.
  settings.change({ serverUrl: elements.serverUrlInput.value.trim(), serverPin: elements.serverPinInput.value, displayName: elements.displayNameInput.value.trim() });
  // Ask the user to confirm before making any network call or touching the workspace.
  const confirmed = await showAcceptConnectionDialog();
  if (!confirmed) return;
  reconnectState.attempts = 0;
  clearReconnectTimer();
  try {
    logDebug("action", "Server connect requested", settings.serverUrl);
    await establishConnection({ auto: false });
  } catch (error) {
    syncState.change({ status: "offline", detail: error.message });
    logDebug("response", "Server connect failed", error.message);
    flashStatusPanel("error", elements.sharedSessionSection);
    await refreshChatStatus({ silent: true });
    render(controller.getProject());
  }
});

function persistBeforeSuspension() {
  captureViewState();
  cacheWorkspaceView();
  try { saveProject(controller.getProject()); }
  catch (error) { logDebug("response", "Browser recovery save failed", error.message); }
  if (settings.syncedProjectId) patchStoredSettings(stored => stored.syncedProjectId === settings.syncedProjectId
    ? { syncedRevision: settings.syncedRevision } : null);
}
window.addEventListener("pagehide", event => {
  persistBeforeSuspension();
  if (!event.persisted) collaboration.leaveOnPageHide();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistBeforeSuspension();
});

window.addEventListener("beforeunload", (event) => {
  captureViewState(); // remember where the user was before they leave
  // Persist ONLY the in-sync revision, merged into what's stored now — and only
  // for the same workspace. Writing this tab's whole settings object on unload
  // clobbered anything another tab had saved since (font, login, workspace); and
  // pairing our revision with another tab's workspace id would fool the
  // push-vs-pull revision gate into overwriting newer work.
  if (settings.syncedProjectId) {
    patchStoredSettings((stored) => (stored.syncedProjectId === settings.syncedProjectId
      ? { syncedRevision: settings.syncedRevision }
      : null));
  }
  const activeFile = controller.getActiveFile();
  if (activeFile?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

registerOfflineShell();
void refreshChatStatus({ silent: true });

// Re-attach the persistent local (OPFS) workspace opened last time, so a reload
// keeps saving straight back to the same directory (no permission prompt needed).
async function reopenLocalProjectOnBoot() {
  const path = controller.getProject()?.localPath ?? settings.lastLocalProject?.path;
  if (controller.getProject()?.sourceMode !== "opfs" || !path || !supportsOpfs()) {
    return;
  }
  try {
    // Resolve the handle first (async), then attach to whatever the live project
    // is at that moment — an edit racing boot can't strand the handle on a clone.
    const dir = await getOpfsDirectoryHandle(path);
    const project = controller.getProject();
    project.sourceMode = "opfs";
    project.localPath = path;
    project.handles = { [ROOT_ID]: dir };
    logDebug("action", "Reattached local workspace", path);
  } catch (error) {
    // The directory is gone (or OPFS unavailable) — keep the in-browser copy.
    controller.getProject().sourceMode = "memory";
    logDebug("response", "Local workspace reattach failed", error.message);
  }
}

void reopenLocalProjectOnBoot();

// Restore the previous session on boot so a refresh isn't a fresh start:
//   1. Ping the stored server (or same-origin) to learn its capabilities.
//   2. Auto-login the account — but only to a server+username that has
//      succeeded before — then reopen the last cloud workspace.
//   3. Auto-reconnect a PIN session if one was active last time.
async function restoreSessionOnBoot({ manual = false, isCurrent = () => true } = {}) {
  const last = rememberedWorkspace(settings.lastWorkspace);
  if (syncMode.get().workspaceMode === "synced" && collaboration.getConnectionInfo()) {
    const resumed = await collaboration.resumeConnection();
    if (!resumed && settings.autoReconnect && settings.wasConnected && settings.serverPin) await establishConnection({ auto: true });
    if (manual || !controller.getActiveFile()) showResumedFile(cachedWorkspaceView(settings.syncedProjectId));
    return;
  }
  const ping = await pingCurrentServer({ silent: true });
  if (!isCurrent()) return;
  if (!ping) throw new Error("Waiting for the server — your workspace will resume automatically.");
  if (syncState.accountsAvailable && identity.canRestore()) {
    await performLogin(settings.accountUsername, settings.accountPassword, { silent: true, isCurrent });
  }
  const target = rememberedWorkspace(settings.lastWorkspace) ?? last;
  if (target && identity.account()) {
    await handleOpenWorkspace(target.team, target.path, { reason: manual ? "welcome-resume" : "automatic-restore", automatic: true, isCurrent });
    return;
  }
  if (manual && target) {
    openSettingsDialog("collaboration");
    showToast("Sign in to resume this workspace.");
    return;
  }
  if (settings.autoReconnect && settings.wasConnected && settings.serverPin) await establishConnection({ auto: true });
}

sessionRestorer = createSessionRecovery({
  restore: restoreSessionOnBoot,
  onError(error) {
    logDebug("response", "Workspace recovery waiting", error.message);
    syncState.change({ detail: error.message });
    if ([401, 403].includes(error.status)) showToast("Sign in again to resume your workspace. Your local edits are kept.");
  }
});
let suspendedCloudWorkspace = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    suspendedCloudWorkspace = syncMode.get().workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending();
  } else if (suspendedCloudWorkspace) {
    suspendedCloudWorkspace = false;
    void sessionRestorer.run();
  }
});
window.addEventListener("online", () => {
  if (document.visibilityState === "hidden") return;
  if (syncMode.get().workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending()) void sessionRestorer.run();
});
window.addEventListener("pageshow", event => {
  if (event.persisted && (syncMode.get().workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending())) void sessionRestorer.run();
});

void sessionRestorer.run();
// Local/no-server workspaces never fire the cloud open path, so seed the S.E.N
// baselines here too. Harmless for cloud: the open path refreshes them again.
void refreshSnapshotBaselines();