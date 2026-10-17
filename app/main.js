import { startModules } from "./kernel/index.js";
import shellModule from "./modules/shell/index.js";
import fileTypesModule from "./modules/file-types/index.js";
import workspaceModule from "./modules/workspace/index.js";
import identityModule from "./modules/identity/index.js";
import historyModule from "./modules/history/index.js";
import { createWorkspacePorts } from "./features/workspace-ports.js";
import { rememberedWorkspace, createSessionRecovery } from "./services/session-recovery-service.js";
import { installMobileViewport } from "./services/chat-ui-service.js";
import { snapshotProject, savedFileIds } from "./services/project-save-service.js";
import { APP_VERSION } from "./version.js";
import { ROOT_ID, seedDefaultProject, applyHostCounters, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isMarkdownFileName, isPersonaFileName, isTextFileName, isUrlDbFileName } from "./domain/project-model.js";
import { importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess } from "./services/fs-access-service.js";
import { supportsOpfs, listOpfsDir, mkdirOpfs, createProjectOpfs, getOpfsDirectoryHandle, importOsFolderIntoOpfs, deleteOpfsEntry, exportProjectModelOpfs, importProjectModelOpfs } from "./services/opfs-service.js";
import { createCollaborationRuntime } from "./modules/sync/index.js";
import { sendGenerationRequest } from "./services/chat-api-service.js";
import { renderMarkdown } from "./services/markdown-service.js";
import { PERSONA_SUFFIX, parsePersona, personaTemplate } from "./services/persona-service.js";
import { clearOfflineShellData, registerOfflineShell } from "./services/offline-service.js";
import { applyEditorFont, applyTheme, clampSourceFontSize, loadSettings, patchStoredSettings, saveSettings, signInSettings } from "./services/settings-service.js";
import { loadProject, saveProject } from "./services/storage-service.js";
import { clearViewStates, loadViewStates, saveViewStates } from "./services/view-state-service.js";
import { browseServer, createProjectServer, deleteServer, exportProjectServer, importProjectServer, mkdirServer, normalizeServerUrl, uploadAsset } from "./services/sync-service.js";
import { loadTemplateProject } from "./services/template-service.js";
import { formatUrlDbEntryBody, parseUrlDb } from "./services/urldb-service.js";
import { query } from "./ui/dom.js";
import { createExplorerView } from "./ui/explorer-view.js";
import { createDefaultBmap } from "./services/bmap-service.js";
import { createCloudBrowser } from "./features/cloud-browser.js";
import { createFileActions } from "./features/file-actions.js";
import { createPanes } from "./features/panes.js";
import { createLayout } from "./ui/layout.js";
import { createHighlighter } from "./editor/highlight.js";
import { createFindReplace } from "./editor/find-replace.js";
import { createAutocomplete } from "./editor/autocomplete.js";
import { createLinks } from "./editor/links.js";
import { createEditorCore } from "./editor/editor-core.js";
import { createDialogs } from "./ui/dialogs.js";
import { createLineComments } from "./editor/comments.js";
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
  editorAgentBar: query("#editor-agent-bar"),
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
  formatToolbarInput: query("#format-toolbar-input"),
  autoSaveInput: query("#auto-save-input"),
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
  bookmarkEntryDialog: query("#bookmark-entry-dialog"),
  bookmarkEntryDialogTitle: query("#bookmark-entry-dialog-title"),
  bookmarkEntryDialogMessage: query("#bookmark-entry-dialog-message"),
  bookmarkEntryNameInput: query("#bookmark-entry-name-input"),
  bookmarkEntryUrlInput: query("#bookmark-entry-url-input"),
  bookmarkEntryDescriptionInput: query("#bookmark-entry-description-input"),
  bookmarkEntrySubmitButton: query("#bookmark-entry-submit-button"),
  settingsButton: query("#settings-button"),
  settingsDialog: query("#settings-dialog"),
  settingsTabStrip: query("#settings-tab-strip"),
  settingsTabsButton: query("#settings-tabs-button"),
  agentSourceSelect: query("#agent-source-select"),
  agentSourceNote: query("#agent-source-note"),
  agentOwnFields: query("#agent-own-fields"),
  agentApiKeyInput: query("#agent-api-key-input"),
  agentApiUrlInput: query("#agent-api-url-input"),
  agentModelInput: query("#agent-model-input"),
  agentRunnerSelect: query("#agent-runner-select"),
  agentRunnerNote: query("#agent-runner-note"),
  agentStatusLine: query("#agent-status-line"),
  accountLockedNote: query("#account-locked-note"),
  themeSelect: query("#theme-select"),
  explorerSelect: query("#explorer-select"),
  explorerAnchorSelect: query("#explorer-anchor-select"),
  previewSelect: query("#preview-select"),
  wordWrapSelect: query("#word-wrap-select"),
  indentStyleSelect: query("#indent-style-select"),
  sourceFontSizeSelect: query("#source-font-size-select"),
  sourceFontFamilySelect: query("#source-font-family-select"),
  sourceFontCustomRow: query("#source-font-custom-row"),
  sourceFontCustomInput: query("#source-font-custom-input"),
  sourceFontStatus: query("#source-font-status"),
  bmapGenerateScopeSelect: query("#bmap-generate-scope-select"),
  bmapAutoPanInput: query("#bmap-auto-pan-input"),
  serverUrlInput: query("#server-url-input"),
  autoReconnectInput: query("#auto-reconnect-input"),
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
  serverStatusText: query("#server-status-text"),
  serverStatusPanel: query("#server-status-text")?.closest(".settings-status-panel"),
  accountSection: query("#account-login-row")?.closest(".settings-section"),
  sharedSessionSection: query("#connect-server-button")?.closest(".settings-section"),
  acceptConnectionDialog: query("#accept-connection-dialog"),
  acceptConnectionMessage: query("#accept-connection-message"),
  acceptConnectionAcceptButton: query("#accept-connection-accept-button"),
  sessionDetailText: query("#session-detail-text"),
  presenceList: query("#presence-list"),
  presenceStrip: query("#presence-strip"),
  presenceDots: query("#presence-dots"),
  workspaceModeRow: query("#workspace-mode-row"),
  workspaceModeToggle: query("#workspace-mode-toggle"),
  sessionIdLabel: query("#session-id-label"),
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
  sourceIndicator: query("#source-indicator"),
  sourceStatusText: query("#source-status-text"),
  browserIndicator: query("#browser-indicator"),
  browserStatusText: query("#browser-status-text"),
  serverIndicator: query("#server-indicator"),
  serverStatusBarText: query("#server-status-bar-text"),
  presenceSummaryText: query("#presence-summary-text"),
  statusSourceItem: query("#status-source-item"),
  statusBrowserItem: query("#status-browser-item"),
  statusServerItem: query("#status-server-item"),
  statusPresenceItem: query("#status-presence-item"),
  statusCharCountItem: query("#status-charcount-item"),
  statusCharCountText: query("#status-charcount-text"),
  statusVersionItem: query("#status-version-item"),
  statusVersionText: query("#status-version-text"),
  previewToggleActivityButton: query("#preview-toggle-activity-button"),
  chatToggleActivityButton: query("#chat-toggle-activity-button"),
  debugPanel: query("#debug-panel"),
  debugTabStrip: query("#debug-tab-strip"),
  debugTabAll: query("#debug-tab-all"),
  debugTabActions: query("#debug-tab-actions"),
  debugTabResponses: query("#debug-tab-responses"),
  debugCopyButton: query("#debug-copy-button"),
  debugClearButton: query("#debug-clear-button"),
  logCollapseButton: query("#log-collapse-button"),
  debugLogList: query("#debug-log-list"),
  chatStatusText: query("#chat-status-text"),
  chatModelSelect: query("#chat-model-select"),
  chatNewThreadButton: query("#chat-new-thread-button"),
  chatTabs: query("#chat-tabs"),
  chatCastBar: query("#chat-cast-bar"),
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
const modules = await startModules([shellModule, fileTypesModule, workspaceModule, identityModule, historyModule], {
  log: (owner, ...args) => { try { logDebug("action", `${owner}: ${args.join(" ")}`); } catch { /* log not ready yet */ } }
});
const { shell, workspace, identity } = modules;

const settings = loadSettings();
shell.server.configure({ address: () => settings.serverUrl });
identity.attach(signInSettings(settings));
const storedProject = loadProject();
const controller = workspace.openProject(storedProject ?? seedDefaultProject());
let sourceOpenTabIds = controller.getProject().activeFileId ? [controller.getProject().activeFileId] : [];
let previewOpenTabIds = controller.getProject().activeFileId ? [controller.getProject().activeFileId] : [];
let previewFileId = controller.getProject().activeFileId ?? null;
// Total source characters of the active file, cached for the footer counter by
// updateStatus. null → no text file open (the counter hides). Declared up here so
// the hoisted updateStatus can never touch it inside its temporal dead zone.
let statusCharTotal = null;
// Typing fast path + deferred/debounced work (see render()). Declared up here:
// render() runs during module initialisation, before its own section executes.
let typingUpdate = false;
const DEFERRED_RENDER_IDLE_MS = 250;
const DEFERRED_RENDER_MAX_MS = 1500;
let deferredRenderTimer = null;
let deferredRenderDeadline = 0;
const RECOVERY_SAVE_IDLE_MS = 800;
const RECOVERY_SAVE_MAX_MS = 3000;
let recoverySaveTimer = null;
let recoverySaveDeadline = 0;
let recoverySavePending = null;
// ---- Editor core (./editor/editor-core.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var editorCoreInstance;
function editorCore() {
  return (editorCoreInstance ??= createEditorCore({
    get _editorUpdating() { return _editorUpdating; },
    set _editorUpdating(value) { _editorUpdating = value; },
    get acceptEditorAutocomplete() { return acceptEditorAutocomplete; },
    get agentPendingDecorations() { return agentPendingDecorations; },
    get autocompleteState() { return autocompleteState; },
    get collaboration() { return collaboration; },
    get commentsForActiveFile() { return commentsForActiveFile; },
    get computeSearchMatches() { return computeSearchMatches; },
    get controller() { return controller; },
    get editorDragState() { return editorDragState; },
    get editorHighlightKind() { return editorHighlightKind; },
    get editorHistory() { return editorHistory; },
    get editorIsComposing() { return editorIsComposing; },
    get editorRenderCache() { return editorRenderCache; },
    get elements() { return elements; },
    get escapeHtmlAttribute() { return escapeHtmlAttribute; },
    get formatEditorDebugValue() { return formatEditorDebugValue; },
    get getSelectedUrlDbEntry() { return getSelectedUrlDbEntry; },
    get hideEditorAutocomplete() { return hideEditorAutocomplete; },
    get highlightEditorLinesMemo() { return highlightEditorLinesMemo; },
    get logDebug() { return logDebug; },
    get openFindBar() { return openFindBar; },
    get rememberEditorSelection() { return rememberEditorSelection; },
    get remoteCursorsByClient() { return remoteCursorsByClient; },
    get renderEditorAutocomplete() { return renderEditorAutocomplete; },
    get scheduleCommentReanchor() { return scheduleCommentReanchor; },
    get searchState() { return searchState; },
    get settings() { return settings; },
    get showEditorAutocomplete() { return showEditorAutocomplete; },
    get traceEditorEvent() { return traceEditorEvent; },
    get typingUpdate() { return typingUpdate; },
    set typingUpdate(value) { typingUpdate = value; },
    get updateEditorAgentBar() { return updateEditorAgentBar; },
    get workspaceMode() { return workspaceMode; }
  }));
}
function applyEditorEdit(...args) { return editorCore().applyEditorEdit(...args); }
function applyEditorRender(...args) { return editorCore().applyEditorRender(...args); }
function attachSelectionChangeListener(...args) { return editorCore().attachSelectionChangeListener(...args); }
function caretIntoView(...args) { return editorCore().caretIntoView(...args); }
function clamp(...args) { return editorCore().clamp(...args); }
function clampEditorSelection(...args) { return editorCore().clampEditorSelection(...args); }
function clearEditorDropCaret(...args) { return editorCore().clearEditorDropCaret(...args); }
function clientColor(...args) { return editorCore().clientColor(...args); }
function consumeExternalEditorSelection(...args) { return editorCore().consumeExternalEditorSelection(...args); }
function forwardEditorWheel(...args) { return editorCore().forwardEditorWheel(...args); }
function getEditorLineHeight(...args) { return editorCore().getEditorLineHeight(...args); }
function getEditorSelection(...args) { return editorCore().getEditorSelection(...args); }
function getEditorText(...args) { return editorCore().getEditorText(...args); }
function getEditorTextOffsetFromPoint(...args) { return editorCore().getEditorTextOffsetFromPoint(...args); }
function handleEditorKeydown(...args) { return editorCore().handleEditorKeydown(...args); }
function handleIndentKeydown(...args) { return editorCore().handleIndentKeydown(...args); }
function loadEditorContent(...args) { return editorCore().loadEditorContent(...args); }
function notifyEditorChanged(...args) { return editorCore().notifyEditorChanged(...args); }
function onRemoteCursor(...args) { return editorCore().onRemoteCursor(...args); }
function pruneRemoteCursors(...args) { return editorCore().pruneRemoteCursors(...args); }
function pushEditorHistoryState(...args) { return editorCore().pushEditorHistoryState(...args); }
function queueExternalEditorSelection(...args) { return editorCore().queueExternalEditorSelection(...args); }
function refreshFormatToolbar(...args) { return editorCore().refreshFormatToolbar(...args); }
function renderEditorContent(...args) { return editorCore().renderEditorContent(...args); }
function renderRemoteCursors(...args) { return editorCore().renderRemoteCursors(...args); }
function replaceEditorRange(...args) { return editorCore().replaceEditorRange(...args); }
function resetEditorHistory(...args) { return editorCore().resetEditorHistory(...args); }
function scheduleOverviewRuler(...args) { return editorCore().scheduleOverviewRuler(...args); }
function scheduleRemoteCursorRender(...args) { return editorCore().scheduleRemoteCursorRender(...args); }
function setEditorSelection(...args) { return editorCore().setEditorSelection(...args); }
function showEditorDropCaret(...args) { return editorCore().showEditorDropCaret(...args); }
function syncEditorScroll(...args) { return editorCore().syncEditorScroll(...args); }
function textOffsetToDomPosition(...args) { return editorCore().textOffsetToDomPosition(...args); }
function transformEditorSelection(...args) { return editorCore().transformEditorSelection(...args); }

// Incremental editor render cache (see renderEditorContent). Declared up here
// because the first render runs before that part of the module has executed.
const editorRenderCache = {
  fileId: null,     // file the cache describes
  kind: null,       // highlighter used
  els: [],          // line elements, in DOM order, as rendered
  texts: [],        // each line's text as rendered
  html: [],         // each line's final HTML as rendered
  heights: [],      // gutter heights measured for each line
  gutter: [],       // gutter row HTML as rendered
  metricsKey: "",   // geometry the heights were measured under (see below)
  gutterEpoch: "",  // line count / agent range / comments the gutter rows reflect
  textExact: true   // every line's DOM text equals its source line
};
// Touch-gesture tuning and state. Declared up here because the hoisted mobile
// render helpers reach them during the first render, which would otherwise be
// inside their temporal dead zone.
const MOBILE_MAX_WIDTH = 900;    // must match the CSS breakpoint
const EDGE_ZONE = 24;            // px from the left edge that opens the drawer
const SLOP = 10;                 // px before a gesture is claimed at all
const DIRECTION_BIAS = 1.3;      // |dx| must exceed |dy| by this much
const SNAP_FRACTION = 0.35;      // past this share of travel, snap onward
const FLICK_VELOCITY = 0.45;     // px/ms that snaps regardless of distance
const PANE_ORDER = ["source", "preview", "chat"];
let gesture = null;
let drawerWidth = 1;
let paneDrag = null;
// Newest snapshot per file path: { count, editSessions, sessionEdits }. The
// baseline the S.E.N version label counts from. Refreshed on workspace open and
// whenever snapshots change — never per keystroke.
let snapshotBaselines = new Map();
let snapshotBaselinesInFlight = null;
// Installed-font detection state for the source-font picker (see isFontInstalled).
const fontInstalledCache = new Map();
let fontProbeContext = null;
const fontProbeBase = {};
let previewUrlDbEntry = null;
let sourceUrlDbEntry = null;
// Per-document view state (bmap pan/zoom, editor scroll), cached so users resume
// where they left off; persisted to localStorage.
let viewStates = loadViewStates();

function getViewState(fileId) {
  return fileId ? viewStates[fileId] : null;
}

function setViewState(fileId, patch) {
  if (!fileId) return;
  viewStates[fileId] = { ...viewStates[fileId], ...patch };
  saveViewStates(viewStates);
}

/** Snapshot the current preview bmap and editor position before a file switch
 *  or page suspension. Selection and pointer-down handlers save the caret
 *  before the editor loses focus. */
function captureViewState() {
  const project = controller.getProject();
  if (previewFileId && previewBmapView) {
    const pf = project.nodes[previewFileId];
    if (pf && pf.kind === "file" && isBmapFileName(pf.name)) {
      const view = previewBmapView.getView?.();
      if (view) setViewState(previewFileId, { bmap: view });
    }
  }
  const activeId = project.activeFileId;
  if (activeId && elements.editorContent) {
    // The REAL scroller is #editor-content (#editor-scroll is overflow:hidden and
    // always reports scrollTop 0), so persist the content scroll for this file.
    setViewState(activeId, { editorScroll: elements.editorContent.scrollTop });
    rememberEditorSelection();
  }
}

function savedEditorSelection(fileId, text) {
  const saved = getViewState(fileId)?.editorSelection;
  if (!saved || saved.scope !== chatWorkspaceKey() || !Number.isInteger(saved.start) || !Number.isInteger(saved.end)) return null;
  return clampEditorSelection(text, saved.start, saved.end);
}

function rememberEditorSelection() {
  const fileId = controller.getProject().activeFileId;
  // A blurred contenteditable may retain a ghost range at offset 0. It is not
  // the user's caret and must never replace a position captured before blur.
  if (document.activeElement !== elements.editorContent) return;
  const selection = window.getSelection();
  if (!fileId || lastRenderedFileId !== fileId || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!elements.editorContent.contains(range.startContainer) || !elements.editorContent.contains(range.endContainer)) return;
  const { start, end } = getEditorSelection();
  const scope = chatWorkspaceKey();
  const previous = getViewState(fileId)?.editorSelection;
  if (previous?.scope === scope && previous.start === start && previous.end === end) return;
  setViewState(fileId, { editorSelection: { scope, start, end } });
}
let mathJaxLoadPromise = null;
let previewBmapView = null;
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

let selectionNodeId = controller.getProject().activeFileId ?? controller.getProject().rootId;
const syncState = {
  status: "offline",
  detail: "No server checked yet.",
  presence: [],
  sessionId: null,
  revision: 0,
  displayName: null,
  clientId: null,
  role: null,
  // Whether the last-pinged server has accounts (the account itself: identity.account()).
  accountsAvailable: false,
  hostingAvailable: false
};

// "private" = user's local workspace; "synced" = connected server workspace.
let workspaceMode = "private";
let sessionRestorer = null;

// Mobile pane state (drives #app[data-mobile-view]). Declared here so the layout
// pass that runs during module load can read it before its helpers execute.
let mobileView = "source";         // source | preview | chat
let privateProjectSnapshot = null;
// Forward declaration — assigned after `collaboration` is created.
let switchWorkspaceMode;

const addFileState = {
  parentId: null,
  fileName: "",
  content: null,
  sourceLabel: ""
};
const autocompleteState = {
  items: [],
  activeIndex: 0,
  // True once the user has deliberately chosen an entry (arrow keys or the
  // mouse). Enter only accepts a suggestion when this is set — otherwise Enter
  // means "new line", which is what it means everywhere else in the editor.
  userChose: false,
  range: null,
  kind: ""
};

const editorDragState = {
  selection: null,
  dropOffset: null
};

// Undo/redo history for the contenteditable editor.
// Each entry: { start, end, patch } where `patch` turns the previous entry's
// text into this one's: { at, removed, inserted } (null for the first entry).
// Only `text` — the text of entry `index` — is held in full. Entries used to
// carry a full copy of the document each: on a 90k-character chapter that was
// ~180KB per keystroke, ~72MB at the 400-entry cap, for every open file.
const editorHistory = {
  stack: [],
  index: -1,
  maxSize: 400,
  text: ""
};

let editorIsComposing = false;
let lastRenderedFileId = null;
// Set to true while applyEditorRender is executing so that the synchronous
// updateStatus callback triggered by notifyEditorChanged does not mistake a
// transient focus state during innerHTML replacement for "editor lost focus".
let _editorUpdating = false;
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

const explorerClipboard = {
  payload: null
};

const debugTabs = [
  { id: "all", element: elements.debugTabAll, label: "All" },
  { id: "actions", element: elements.debugTabActions, label: "Actions" },
  { id: "responses", element: elements.debugTabResponses, label: "Responses" }
];

let draggingTabState = null;

let replaceFileTargetId = null;

function initializePaneState(project) {
  sourceOpenTabIds = project.activeFileId ? [project.activeFileId] : [];
  previewOpenTabIds = project.activeFileId ? [project.activeFileId] : [];
  previewFileId = project.activeFileId ?? null;
  sourceUrlDbEntry = null;
  previewUrlDbEntry = null;
}

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// Phase 5 — In-editor decoration state (applied agent ranges only)
// ---------------------------------------------------------------------------

// path → { lineStart: number, lineEnd: number, batchId: string }
// Keyed by file path (not node id) for easy lookup inside renderEditorContent.
const agentPendingDecorations = new Map();

/**
 * Compute the inclusive line range [start, end] in newContent that differs
 * from preImage. Returns null when the content is identical.
 */
function computeChangedLineRange(preImage, newContent) {
  const oldLines = preImage.split("\n");
  const newLines = newContent.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  // If everything up to the shorter length matched and lengths are equal → no change.
  if (oldLines.length === newLines.length && start === oldLines.length) return null;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { lineStart: start, lineEnd: Math.max(start, newEnd - 1) };
}

/** Record decoration ranges for accepted ops and trigger a re-render. */
function registerAgentDecorations(ops, batchId) {
  const project = controller.getProject();
  for (const op of ops) {
    if (op.proposalState !== "accepted") continue;
    if (op.type === "update-file" && typeof op.preImage === "string") {
      const range = computeChangedLineRange(op.preImage, op.content ?? "");
      if (range) {
        agentPendingDecorations.set(op.path, { ...range, batchId });
      }
    } else if (op.type === "create-file") {
      const lineCount = (op.content ?? "").split("\n").length;
      const path = op.parentPath ? `${op.parentPath}/${op.name}` : op.name;
      agentPendingDecorations.set(path, { lineStart: 0, lineEnd: Math.max(0, lineCount - 1), batchId });
    }
  }
  // Re-render the editor so decorations are visible immediately.
  const activeFile = controller.getActiveFile();
  if (activeFile) {
    renderEditorContent(activeFile.content);
  }
  // Refresh explorer and tabs so pending-edit indicators appear.
  explorer.render(project, new Set(agentPendingDecorations.keys()));
  renderTabs(project);
}

/** Remove all decorations for a given batchId and re-render. */
function clearAgentDecorations(batchId) {
  let removed = false;
  for (const [path, entry] of agentPendingDecorations) {
    if (entry.batchId === batchId) {
      agentPendingDecorations.delete(path);
      removed = true;
    }
  }
  if (removed) {
    const activeFile = controller.getActiveFile();
    if (activeFile) renderEditorContent(activeFile.content);
    // Refresh explorer and tabs so pending-edit indicators are cleared.
    const project = controller.getProject();
    explorer.render(project, new Set(agentPendingDecorations.keys()));
    renderTabs(project);
  }
}

/** Update (or hide) the floating in-editor agent action bar. */
function updateEditorAgentBar() {
  if (!elements.editorAgentBar) return;
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile) { elements.editorAgentBar.hidden = true; return; }
  const activeFilePath = getPath(project, activeFile.id);
  const activeDecoration = agentPendingDecorations.get(activeFilePath);

  if (activeDecoration) {
    // Agent edits applied to this file — offer Keep / Drop review.
    const { batchId } = activeDecoration;
    const found = findBatchMessage(batchId);
    if (!found) { elements.editorAgentBar.hidden = true; return; }
    const isOriginator = chat?.isOwnBatch?.(found.msg) ?? true;
    const attr = isOriginator ? "" : " disabled";
    const bid = escapeHtmlAttribute(batchId);
    elements.editorAgentBar.innerHTML =
      `<span class="agent-bar-label">Agent edits applied</span>` +
      `<button class="agent-bar-btn agent-bar-keep" type="button" data-batch-keep="${bid}"${attr} title="Finalise \u2014 keep agent changes">\u2713 Keep</button>` +
      `<button class="agent-bar-btn agent-bar-drop" type="button" data-batch-drop-final="${bid}"${attr} title="Revert agent changes">\u2717 Drop</button>`;
    elements.editorAgentBar.hidden = false;
  } else {
    elements.editorAgentBar.hidden = true;
  }
}

/** Open the source tab for the first decorated file in a batch and scroll to the first tinted line. */
function jumpToAgentChange(batchId) {
  const project = controller.getProject();
  for (const [path, entry] of agentPendingDecorations) {
    if (entry.batchId !== batchId) continue;
    const nodeId = getNodeIdByPath(project, path);
    if (!nodeId) continue;
    openSourceTab(nodeId);
    controller.setActiveFile(nodeId);
    // Scroll after the re-render settles (rAF gives the DOM one paint cycle).
    requestAnimationFrame(() => {
      const lines = elements.editorContent.querySelectorAll(".editor-line.is-agent-pending");
      if (lines.length > 0) {
        lines[0].scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    return;
  }
}

/** Build a simple unified diff hunks array from two text strings. */
function buildTextDiffHunks(oldText, newText) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const hunks = [];
  const ctxCount = 2;
  const ctxStart = Math.max(0, start - ctxCount);
  for (let i = ctxStart; i < start; i++) {
    hunks.push({ op: " ", text: oldLines[i] });
  }
  for (let i = start; i < oldEnd; i++) {
    hunks.push({ op: "-", text: oldLines[i] });
  }
  for (let i = start; i < newEnd; i++) {
    hunks.push({ op: "+", text: newLines[i] });
  }
  const ctxEnd = Math.min(oldLines.length, oldEnd + ctxCount);
  for (let i = oldEnd; i < ctxEnd; i++) {
    hunks.push({ op: " ", text: oldLines[i] });
  }
  return hunks;
}

// ---- Chat panel ------------------------------------------------------------
// The Agent / Chats panel lives in app/features/chat-panel.js. It loads the
// first time it is needed — the panel shown, Settings open (Agent status), or a
// character file renamed — so sessions that never open it don't download it.
let chat = null;
let chatLoading = null;

function chatNeeded() {
  return settings.chatPanel === "shown" || mobileView === "chat" || Boolean(elements.settingsDialog?.open);
}

function loadChat() {
  chatLoading ??= import("./features/chat-panel.js").then(({ createChatPanel }) => {
    chat = createChatPanel({
      cloudWorkspaceTarget,
      agentCheckpoints, agentPendingDecorations, buildTextDiffHunks, captureAgentCheckpoint, chatConnectionInfo,
      chatWorkspaceKey, clearAgentDecorations, collaboration, controller, createFileInFolder, elements,
      escapeHtmlAttribute, getSelectedParent, isMobileLayout, jumpToAgentChange, logDebug, notify,
      openFileFromExplorer, openSettingsDialog, personaAvatarSrc, promptForName, workspace,
      registerAgentDecorations, settings, showConfirmDialog, showToast, storedProject,
      updateEditorAgentBar, identity,
      get workspaceMode() { return workspaceMode; }
    });
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

function applyAgentSettingsStatus() {
  chat?.applyAgentSettingsStatus();
}

function findBatchMessage(batchId) {
  return chat?.findBatchMessage(batchId) ?? null;
}

/** Group chats name their characters by path; follow a rename or move of a
 *  character file, or of a folder holding one. */
function remapPersonaPaths(oldPath, newPath) {
  if (chat) { chat.remapPersonaPaths(oldPath, newPath); return; }
  const project = controller.getProject();
  const holdsPersona = Object.values(project.nodes).some((node) => node.kind === "file" && isPersonaFileName(node.name)
    && (getPath(project, node.id) === newPath || getPath(project, node.id).startsWith(`${newPath}/`)));
  if (holdsPersona) void loadChat().then((loaded) => loaded?.remapPersonaPaths(oldPath, newPath));
}

function chatConnectionInfo() {
  return workspaceMode === "synced" ? collaboration.getConnectionInfo?.() : null;
}

function chatWorkspaceKey(project = controller.getProject()) {
  const connection = chatConnectionInfo();
  if (connection?.sessionId) return `cloud:${normalizeServerUrl(connection.serverUrl)}/${connection.sessionId}`;
  // Keep cloud drafts scoped while its transport reconnects.
  if (workspaceMode === "synced" && settings.syncedProjectId) {
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

// Populate the Agent settings controls from `settings` and toggle the own-key
// fields. Called when the settings dialog opens.
function applyAgentSettingsControls() {
  if (elements.agentSourceSelect) elements.agentSourceSelect.value = settings.agentSource === "own" ? "own" : "server";
  const own = settings.agentSource === "own";
  if (elements.agentOwnFields) elements.agentOwnFields.hidden = !own;
  if (elements.agentRunnerSelect) elements.agentRunnerSelect.value = settings.agentRunner === "browser" ? "browser" : "server";
  if (elements.agentRunnerNote) {
    elements.agentRunnerNote.textContent = settings.agentRunner === "browser"
      ? "Characters' replies call the API URL above straight from this browser, so it can be a model on this computer (e.g. Ollama at http://localhost:11434/v1/chat/completions; allow this site in OLLAMA_ORIGINS). The key may be left empty for a local model. The Agent tab still goes through this server."
      : "Your key is sent over HTTPS to this server's proxy for each request and is never stored server-side. It stays in this browser.";
  }
  if (elements.agentApiKeyInput) elements.agentApiKeyInput.value = settings.agentApiKey || "";
  if (elements.agentApiUrlInput) elements.agentApiUrlInput.value = settings.agentApiUrl || "";
  if (elements.agentModelInput) elements.agentModelInput.value = settings.agentModel || "";
  if (elements.agentSourceNote) {
    elements.agentSourceNote.textContent = own
      ? "The agent uses your key, sent to this server's proxy per request. Works from anywhere; billed to you."
      : "Uses the key configured on the server you're connected to. Requires the server to have a key and to allow your session.";
  }
  applyAgentSettingsStatus();
}

function isPreviewableFileName(name) {
  return isMarkdownFileName(name) || isImageFileName(name) || isUrlDbFileName(name) || isBmapFileName(name);
}

function looksLikeUrl(value) {
  return /^(https?:\/\/|data:)/i.test(value.trim());
}

function normalizePath(path) {
  const nextSegments = [];
  path.split("/").forEach((segment) => {
    if (!segment || segment === ".") {
      return;
    }
    if (segment === "..") {
      nextSegments.pop();
      return;
    }
    nextSegments.push(segment);
  });
  return nextSegments.join("/");
}

function getRelativeProjectPath(fromFilePath, toFilePath) {
  const fromSegments = fromFilePath.split("/").filter(Boolean);
  const toSegments = toFilePath.split("/").filter(Boolean);
  fromSegments.pop();

  while (fromSegments.length > 0 && toSegments.length > 0 && fromSegments[0] === toSegments[0]) {
    fromSegments.shift();
    toSegments.shift();
  }

  const upSegments = fromSegments.map(() => "..");
  const relative = [...upSegments, ...toSegments].join("/");
  return relative || toFilePath.split("/").filter(Boolean).pop() || "";
}

function inferNameFromUrl(value) {
  try {
    const url = new URL(value);
    const rawName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").trim();
    return rawName || "remote-file";
  } catch {
    return "remote-file";
  }
}

function getUrlDbEntries(fileContent) {
  return parseUrlDb(fileContent);
}

function getUrlDbEntryById(fileContent, entryId) {
  return getUrlDbEntries(fileContent).find((entry) => entry.id === entryId) ?? null;
}

function createMarkdownImageReference(name, url) {
  return `![${name}](${url})`;
}

function slugTitle(base, index, extension = "") {
  return `${base} ${index}${extension}`;
}

function getNextDefaultFolderName(project, parentId) {
  let index = 1;
  let candidate = slugTitle("new folder", index);
  while (findChildByName(project, parentId, candidate)) {
    index += 1;
    candidate = slugTitle("new folder", index);
  }
  return candidate;
}

function getNextDefaultFileName(project, parentId, kind) {
  const label = kind === "md"
    ? "new markdown"
    : kind === "mtree"
      ? "new mtree"
      : kind === "bmap"
        ? "new diagram"
        : kind === "persona"
          ? "new character"
          : "new url album";
  const extension = fileExtensionForKind(kind);
  let index = 1;
  let candidate = slugTitle(label, index, extension);
  while (findChildByName(project, parentId, candidate)) {
    index += 1;
    candidate = slugTitle(label, index, extension);
  }
  return candidate;
}

function fileExtensionForKind(kind) {
  return kind === "persona" ? PERSONA_SUFFIX : `.${kind}`;
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

function getNextUrlDbEntryName(fileContent) {
  const entries = getUrlDbEntries(fileContent);
  let index = 1;
  let candidate = `reference image ${index}`;
  while (entries.some((entry) => entry.name.toLowerCase() === candidate.toLowerCase())) {
    index += 1;
    candidate = `reference image ${index}`;
  }
  return candidate;
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
    get editorHistory() { return editorHistory; },
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
function showBookmarkEntryDialog(...args) { return dialogs().showBookmarkEntryDialog(...args); }
function showConfirmDialog(options) { return shell.confirm(options); }
function showNoticeDialog(message, title) { return shell.notice(message, title); }
function showToast(message, options) { return shell.toast(message, options); }
function traceEditorEvent(...args) { return dialogs().traceEditorEvent(...args); }

function resolveProjectAssetUrl(project, sourceFileId, url) {
  const trimmed = String(url ?? "").trim();
  if (!trimmed || /^(https?:\/\/|data:|blob:|#|\/)/i.test(trimmed)) {
    return trimmed;
  }

  const basePath = sourceFileId ? getPath(project, sourceFileId) : "";
  const baseSegments = basePath.split("/").filter(Boolean);
  baseSegments.pop();
  const resolvedPath = normalizePath([...baseSegments, trimmed].join("/"));
  const nodeId = getNodeIdByPath(project, resolvedPath);
  if (!nodeId) {
    return trimmed;
  }

  const node = project.nodes[nodeId];
  if (node?.kind === "file" && isImageFileName(node.name)) {
    return imageSrcFor(project, node);
  }

  return trimmed;
}

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
  if (conn && workspaceMode === "synced") {
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

function getSelectedTarget() {
  if (sourceUrlDbEntry) {
    return { nodeId: sourceUrlDbEntry.fileId, entryId: sourceUrlDbEntry.entryId };
  }
  return { nodeId: selectionNodeId, entryId: null };
}

// The extension to manage for a filename ("" for folders / no extension).
function fileExtensionOf(name) {
  // A character file's extension is the whole ".persona.skill": renaming
  // "aria.persona.skill" to "captain" must keep it a character file.
  if (isPersonaFileName(name) && name.length > PERSONA_SUFFIX.length) return name.slice(-PERSONA_SUFFIX.length);
  const dot = String(name || "").lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

function splitPathSegments(path) {
  return path.split("/").filter(Boolean);
}

function getRelativePath(fromPath, toPath) {
  const fromSegments = splitPathSegments(fromPath);
  fromSegments.pop();
  const toSegments = splitPathSegments(toPath);
  let sharedIndex = 0;

  while (sharedIndex < fromSegments.length && sharedIndex < toSegments.length && fromSegments[sharedIndex] === toSegments[sharedIndex]) {
    sharedIndex += 1;
  }

  const upSegments = Array.from({ length: fromSegments.length - sharedIndex }, () => "..");
  const downSegments = toSegments.slice(sharedIndex);
  const relative = [...upSegments, ...downSegments].join("/");
  return relative || "./";
}
// ---- Source autocomplete (./editor/autocomplete.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var autocompleteInstance;
function autocomplete() {
  return (autocompleteInstance ??= createAutocomplete({
    get autocompleteState() { return autocompleteState; },
    get controller() { return controller; },
    get elements() { return elements; },
    get escapeEditorHtml() { return escapeEditorHtml; },
    get getEditorSelection() { return getEditorSelection; },
    get getEditorText() { return getEditorText; },
    get getRelativePath() { return getRelativePath; },
    get logDebug() { return logDebug; },
    get replaceEditorRange() { return replaceEditorRange; }
  }));
}
function acceptEditorAutocomplete(...args) { return autocomplete().acceptEditorAutocomplete(...args); }
function hideEditorAutocomplete(...args) { return autocomplete().hideEditorAutocomplete(...args); }
function renderEditorAutocomplete(...args) { return autocomplete().renderEditorAutocomplete(...args); }
function showEditorAutocomplete(...args) { return autocomplete().showEditorAutocomplete(...args); }

// ============================ Find / Replace ================================
const searchState = {
  open: false,
  replaceMode: false,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  matches: [],      // [{ start, end }] plain-text offsets into the active file
  currentIndex: -1,
};
// ---- Find and replace (./editor/find-replace.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var findReplaceInstance;
function findReplace() {
  return (findReplaceInstance ??= createFindReplace({
    get applyEditorEdit() { return applyEditorEdit; },
    get caretIntoView() { return caretIntoView; },
    get controller() { return controller; },
    get elements() { return elements; },
    get getEditorLineHeight() { return getEditorLineHeight; },
    get getEditorSelection() { return getEditorSelection; },
    get getEditorText() { return getEditorText; },
    get scheduleOverviewRuler() { return scheduleOverviewRuler; },
    get searchState() { return searchState; },
    get setEditorSelection() { return setEditorSelection; },
    get showToast() { return showToast; },
    get textOffsetToDomPosition() { return textOffsetToDomPosition; }
  }));
}
function closeFindBar(...args) { return findReplace().closeFindBar(...args); }
function computeSearchMatches(...args) { return findReplace().computeSearchMatches(...args); }
function findNext(...args) { return findReplace().findNext(...args); }
function findPrev(...args) { return findReplace().findPrev(...args); }
function gotoMatch(...args) { return findReplace().gotoMatch(...args); }
function openFindBar(...args) { return findReplace().openFindBar(...args); }
function renderSearchHighlights(...args) { return findReplace().renderSearchHighlights(...args); }
function replaceAllMatches(...args) { return findReplace().replaceAllMatches(...args); }
function replaceCurrent(...args) { return findReplace().replaceCurrent(...args); }
function toggleFindOption(...args) { return findReplace().toggleFindOption(...args); }

// ============================ Snapshots + Diff ==============================
// Per-file, content-addressed history (the History module). Diff state caches
// the fetched old-version text so renderDiff() can run synchronously (in the
// diff overlay). `path` is the file whose version being compared.
// The diff lives in the preview pane's tab strip as a single special (non-file)
// tab, keyed by this sentinel id. When it's the active preview tab the pane shows
// the diff overlay instead of #preview-output. It compares the CURRENT content of
// `fileId` against the cached `oldText` snapshot — independent of which file the
// editor has active, so it behaves like any other preview tab.
const DIFF_TAB_ID = "__diff__";
const diffState = { active: false, fileId: null, path: null, versionId: null, oldText: "", createdAt: 0, blocks: [], currentChange: -1 };

// A stable-enough key to group snapshots by project: the cloud workspace id when
// synced, otherwise the local project id.
// True when this session only has read access to the open cloud workspace.
function isReadOnlyWorkspace() {
  return workspaceMode === "synced" && syncState.role === "reader";
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
// ---- Line comments (./editor/comments.js) ----
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
    get workspaceMode() { return workspaceMode; }
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
    get workspace() { return workspace; },
    get DIFF_TAB_ID() { return DIFF_TAB_ID; },
    get cloudWorkspaceTarget() { return cloudWorkspaceTarget; },
    get collaboration() { return collaboration; },
    get controller() { return controller; },
    get diffState() { return diffState; },
    get elements() { return elements; },
    get escapeHtmlAttribute() { return escapeHtmlAttribute; },
    get logDebug() { return logDebug; },
    get previewFileId() { return previewFileId; },
    set previewFileId(value) { previewFileId = value; },
    get previewOpenTabIds() { return previewOpenTabIds; },
    get render() { return render; },
    get settings() { return settings; },
    get showToast() { return showToast; },
    get snapshotBaselines() { return snapshotBaselines; },
    set snapshotBaselines(value) { snapshotBaselines = value; },
    get snapshotBaselinesInFlight() { return snapshotBaselinesInFlight; },
    set snapshotBaselinesInFlight(value) { snapshotBaselinesInFlight = value; },
    get snapshotProjectKey() { return snapshotProjectKey; },
    get togglePreview() { return togglePreview; },
    get updateStatus() { return updateStatus; }
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
      controller, collaboration, getPath, getWorkspaceMode: () => workspaceMode, snapshotStore, ensureSnapshotsMigrated,
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

// Cache of the latest remote cursor events by clientId so we can re-render
// when the user scrolls or file content changes.
const remoteCursorsByClient = new Map();

function suggestUniqueFileName(project, parentId, name) {
  const dotIndex = name.lastIndexOf(".");
  const baseName = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : "";
  let candidate = name;
  let counter = 2;

  while (findChildByName(project, parentId, candidate)) {
    candidate = `${baseName}-${counter}${extension}`;
    counter += 1;
  }

  return candidate;
}

function suggestUniqueFolderName(project, parentId, name) {
  let candidate = name;
  let counter = 2;
  while (findChildByName(project, parentId, candidate)) {
    candidate = `${name}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function suggestUniqueUrlDbEntryName(entries, name) {
  let candidate = name;
  let counter = 2;
  const normalized = () => candidate.toLowerCase();
  while (entries.some((entry) => entry.name.toLowerCase() === normalized())) {
    candidate = `${name}-${counter}`;
    counter += 1;
  }
  return candidate;
}

function createMarkdownReference(activeFile, targetFile) {
  const activePath = getPath(controller.getProject(), activeFile.id);
  const targetPath = getPath(controller.getProject(), targetFile.id);
  const relativePath = getRelativePath(activePath, targetPath);
  return isImageFileName(targetFile.name)
    ? createMarkdownImageReference(targetFile.name, relativePath)
    : `[${targetFile.name}](${relativePath})`;
}

applyTheme(settings);
applyEditorFont(settings);
syncSourceFontControls();
elements.themeSelect.value = settings.theme;
elements.serverUrlInput.value = settings.serverUrl;
elements.serverPinInput.value = settings.serverPin;
elements.displayNameInput.value = settings.displayName;
if (elements.accountUsernameInput) elements.accountUsernameInput.value = settings.accountUsername ?? "";
elements.explorerSelect.value = settings.explorer;
elements.previewSelect.value = settings.preview;
elements.wordWrapSelect.value = settings.wordWrap ? "on" : "off";
elements.indentStyleSelect.value = settings.indentStyle;
elements.bmapGenerateScopeSelect.value = settings.bmapGenerateScope === "all" ? "all" : "connected";
if (elements.bmapAutoPanInput) elements.bmapAutoPanInput.checked = settings.bmapAutoPan !== false;
if (elements.autoReconnectInput) elements.autoReconnectInput.checked = settings.autoReconnect !== false;
if (elements.formatToolbarInput) elements.formatToolbarInput.checked = Boolean(settings.showFormatToolbar);
if (elements.autoSaveInput) elements.autoSaveInput.checked = settings.autoSave !== false;

// Per-turn agent checkpoints (Phase 6 / subtask 6.1).
// batchId → { project: deepClone, baseRevision: number }: what undoing a delete brings back
// Capped at last 10 turns (subtask 6.5).
const agentCheckpoints = new Map();
const CHECKPOINT_MAX = 10;

function captureAgentCheckpoint(batchId, baseRevision) {
  agentCheckpoints.set(batchId, {
    project: structuredClone(controller.getProject()),
    baseRevision
  });
  // Trim to last CHECKPOINT_MAX entries.
  if (agentCheckpoints.size > CHECKPOINT_MAX) {
    const oldest = agentCheckpoints.keys().next().value;
    agentCheckpoints.delete(oldest);
  }
}

const collaboration = createCollaborationRuntime({
  async preserveLocalFiles(files) {
    const store = snapshotStore();
    for (const [path, content] of files) {
      await store.create(path, content, "Recovery: local edits before cloud reload");
    }
    showToast(`Local changes saved in Snapshots (${files.size} file(s)); loading the cloud version.`);
  },
  getProject() {
    return controller.getProject();
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
        const cached = remoteCursorsByClient.get(clientId);
        if (cached) {
          const newPos = Number(operation.start) + String(operation.text ?? "").length;
          remoteCursorsByClient.set(clientId, { ...cached, selStart: newPos, selEnd: newPos });
        }
      }
    } catch (err) {
      collaboration?.reloadFromServer("Sync conflict — reloading from server.").catch(() => {});
    }
  },
  onStatusChange(nextState) {
    const prevStatus = syncState.status;
    const wasConnected = prevStatus === "connected";
    // Server refused this client as too old (stale cached service worker). Stop
    // syncing and force the app up to date rather than letting it clobber content.
    if (nextState.status === "upgrade-required") {
      syncState.status = nextState.status;
      syncState.detail = nextState.detail;
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
      try { sessionStorage.removeItem("mdnotes.upgradeReloaded"); } catch { /* ignore */ }
    }
    syncState.status = nextState.status;
    syncState.detail = nextState.detail;
    syncState.presence = nextState.presence ?? [];
    // Reconcile remote carets against who's actually present, so a departed
    // peer's cursor/selection doesn't linger.
    pruneRemoteCursors(syncState.presence);
    syncState.sessionId = nextState.sessionId;
    syncState.revision = nextState.revision ?? 0;
    // Keep the "what revision is this browser's copy based on" marker current
    // while we're genuinely in sync. It decides, on the next open, whether this
    // device may push its copy over the server or must pull. Persisted on unload;
    // if it's ever missing we treat this device as stale and pull (fail-safe).
    if (nextState.status === "connected" && workspaceMode === "synced" && settings.syncedProjectId) {
      settings.syncedRevision = syncState.revision;
    }
    syncState.displayName = nextState.displayName ?? null;
    syncState.clientId = nextState.clientId ?? null;
    syncState.role = nextState.role ?? null;
    // Auto-switch workspace mode on connect/disconnect.
    if (!wasConnected && nextState.status === "connected" && workspaceMode === "private") {
      if (syncState.role === "client") {
        // User already confirmed before connect() was called; just sync.
        switchWorkspaceMode?.("synced");
        return;
      }
      if (syncState.role === "master") {
        // Master just connected: enter synced mode without reloading from server.
        // The master already pushed its own project as the authoritative state;
        // calling reloadFromServer here would just fetch it back unnecessarily.
        privateProjectSnapshot = controller.getProject();
        workspaceMode = "synced";
        render(controller.getProject());
        return;
      }
    }
    if (nextState.status === "offline") {
      // Dropped while we had an intended session — try to re-establish it.
      // (Guarded against firing during a deliberate reconnect handshake.)
      scheduleReconnect?.();
    }
    if (nextState.status === "offline" && workspaceMode === "synced") {
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
        privateProjectSnapshot = null; // don't later clobber the on-screen content
        syncState.detail = "Offline — edits are saved locally and will sync when the connection returns.";
        render(controller.getProject());
        return;
      }
      switchWorkspaceMode?.("private");
      return;
    }
    render(controller.getProject());
  },
  onRemoteCursor(event) {
    onRemoteCursor(event);
  },
  // The host stamped this file's S.E.N counters on the operation it just
  // accepted. Adopt them verbatim — we never count locally while synced, so
  // everyone in the room shows the same sitting number.
  onHostCounters(path, counters) {
    const project = controller.getProject();
    const nodeId = getNodeIdByPath(project, path);
    if (!nodeId) return;
    applyHostCounters(project, nodeId, counters);
    scheduleVersionLabel();
  },
  onPatchConfirmed() {
    // Text confirmed by server — now safe to send the definitive cursor position.
    const activeFile = controller.getActiveFile();
    if (activeFile && collaboration.isConnected()) {
      const sel = getEditorSelection();
      // Path (not node id) so peers can match it — see renderRemoteCursors.
      const path = getPath(controller.getProject(), activeFile.id);
      collaboration.scheduleAwareness(path, sel.start, sel.end);
    }
  },
  // A collaborator added/edited/moved a comment: adopt the server's list and
  // repaint the gutter + overview ruler without waiting for a reopen.
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
  // Other modules' events on Sync's stream: comments, Chats, the agent's threads.
  onEvent(event, { ownClientId }) {
    if (event.type === "comments") {
      if (!commentsAvailable()) return;
      lineComments.byFile = new Map(Object.entries(event.files ?? {}));
      renderEditorFromModel();
    } else if (event.type === "chat-message" || event.type === "chat-typing" || event.type === "chat-update") {
      chat?.receiveChatEvent(event);
    } else if (event.type === "chat-workspace-update" && event.clientId !== ownClientId) {
      chat?.receiveChatWorkspace(controller.getProject(), event.workspace); // nothing listens until the panel loads
    }
  },
  uploadAsset
});
workspace.attach(createWorkspacePorts({ controller, collaboration, publishOperation, getEditorSelection, applyEditorEdit,
  get workspaceMode() { return workspaceMode; },
  editorShowsWholeFile: () => !sourceUrlDbEntry && isTextFileName(controller.getActiveFile()?.name ?? "") }));

attachSelectionChangeListener();

// Assign the forward-declared switchWorkspaceMode now that `collaboration` exists.
switchWorkspaceMode = function (nextMode) {
  if (nextMode === workspaceMode) return;
  if (nextMode === "synced") {
    privateProjectSnapshot = controller.getProject();
    workspaceMode = nextMode;
    // reloadFromServer replaces the project internally, triggering render.
    collaboration.reloadFromServer("Switched to synced workspace.").catch(() => {});
  } else {
    sessionRestorer?.cancel();
    workspaceMode = nextMode;
    if (privateProjectSnapshot) {
      controller.replaceProject(privateProjectSnapshot);
    }
    privateProjectSnapshot = null;
    // The local project is no longer a cloud workspace's content.
    settings.syncedProjectId = null;
    saveSettings(settings);
    render(controller.getProject());
  }
};

elements.workspaceModeToggle?.addEventListener("click", () => {
  switchWorkspaceMode(workspaceMode === "synced" ? "private" : "synced");
});

const explorer = createExplorerView({
  container: elements.explorerTree,
  surface: elements.explorerPanel,
  contextMenu: elements.explorerContextMenu,
  onOpenFile(fileId) {
    openFileFromExplorer(fileId);
  },
  onOpenUrlDbEntry(fileId, entryId) {
    const project = controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
      return;
    }
    setActiveSourceUrlDbEntry(fileId, entryId);
    openPreviewTab(fileId);
    previewFileId = fileId;
    previewUrlDbEntry = entryId;
    updateStatus(project);
  },
  onToggleFolder(nodeId) {
    selectionNodeId = nodeId;
    sourceUrlDbEntry = null;
    controller.toggleFolder(nodeId);
  },
  onSelectNode(target) {
    selectionNodeId = target.nodeId;
    sourceUrlDbEntry = target.entryId ? { fileId: target.nodeId, entryId: target.entryId } : null;
    render(controller.getProject());
  },
  canPasteTarget(target) {
    return canPasteIntoExplorerTarget(target);
  },
  canPreviewFile(nodeId) {
    const node = controller.getProject().nodes[nodeId];
    return node?.kind === "file" && isPreviewableFileName(node.name);
  },
  canManagePreview() {
    return Boolean(identity.account())
      && workspaceMode === "synced"
      && collaboration.isConnected()
      && Boolean(settings.lastWorkspace?.team);
  },
  onAction(action, target, options) {
    selectionNodeId = target.nodeId;
    sourceUrlDbEntry = target.entryId ? { fileId: target.nodeId, entryId: target.entryId } : null;
    return handleExplorerAction(action, target, options);
  },
  onDragNodeStart(nodeId, event) {
    const project = controller.getProject();
    const node = project.nodes[nodeId];
    if (!node) {
      return;
    }
    event.dataTransfer?.setData("text/mdnotes-node-id", nodeId);
    if (node.kind === "file") {
      event.dataTransfer?.setData("text/mdnotes-file-id", nodeId);
      event.dataTransfer?.setData("text/plain", nodeId);
    }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
    }
    logDebug("action", "Explorer drag started", getPath(project, nodeId));
  },
  onDragUrlDbEntryStart(fileId, entryId, event) {
    const project = controller.getProject();
    const file = project.nodes[fileId];
    const entry = file?.kind === "file" ? getUrlDbEntryById(file.content, entryId) : null;
    if (!entry) {
      return;
    }
    event.dataTransfer?.setData("text/mdnotes-urldb-entry", JSON.stringify({ fileId, entryId }));
    event.dataTransfer?.setData("text/plain", entry.url);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
    }
  },
  getFilterMode() {
    return settings.explorerFilter;
  },
  getAssetPreviewSrc(fileId) {
    const project = controller.getProject();
    const file = project.nodes[fileId];
    return file?.kind === "file" && isImageFileName(file.name) ? imageSrcFor(project, file) : "";
  },
  getUrlDbEntries(fileId) {
    const file = controller.getProject().nodes[fileId];
    if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
      return [];
    }
    return getUrlDbEntries(file.content);
  },
  getSelectedTarget() {
    return getSelectedTarget();
  }
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
// ---- Source highlighting (./editor/highlight.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var highlighterInstance;
function highlighter() {
  return (highlighterInstance ??= createHighlighter({
    get escapeHtmlAttribute() { return escapeHtmlAttribute; }
  }));
}
function editorHighlightKind(...args) { return highlighter().editorHighlightKind(...args); }
function escapeEditorHtml(...args) { return highlighter().escapeEditorHtml(...args); }
function highlightEditorLinesMemo(...args) { return highlighter().highlightEditorLinesMemo(...args); }
function highlightMarkdownSource(...args) { return highlighter().highlightMarkdownSource(...args); }

document.fonts?.addEventListener?.("loadingdone", () => {
  if (!editorRenderCache.els.length) return;
  editorRenderCache.metricsKey = "";
  renderEditorContent(getEditorText());
});

// ── Link hover tooltip ───────────────────────────────────────────────────────

const editorLinkTooltip = (() => {
  const el = document.createElement("div");
  el.className = "editor-link-tooltip";
  el.hidden = true;
  el.setAttribute("aria-hidden", "true");

  const header = document.createElement("div");
  header.className = "editor-link-tooltip-header";

  const nameEl = document.createElement("span");
  nameEl.className = "editor-link-tooltip-name";

  const hintEl = document.createElement("span");
  hintEl.className = "editor-link-tooltip-hint";
  hintEl.textContent = "Follow Link (Ctrl+Click)";

  header.append(nameEl, hintEl);

  const previewEl = document.createElement("div");
  previewEl.className = "editor-link-tooltip-preview preview-output";

  el.append(header, previewEl);
  document.body.append(el);
  return { el, nameEl, hintEl, previewEl };
})();
// ---- Links: editor tooltip and Linked Notes (./editor/links.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var linksInstance;
function links() {
  return (linksInstance ??= createLinks({
    get backlinksListEl() { return backlinksListEl; },
    get controller() { return controller; },
    get editorLinkTooltip() { return editorLinkTooltip; },
    get escapeEditorHtml() { return escapeEditorHtml; },
    get escapeHtmlAttribute() { return escapeHtmlAttribute; },
    get imageSrcFor() { return imageSrcFor; },
    get linksPanelEl() { return linksPanelEl; },
    get normalizePath() { return normalizePath; },
    get notify() { return notify; },
    get openFileFromExplorer() { return openFileFromExplorer; },
    get outgoingLinksListEl() { return outgoingLinksListEl; },
    get resolveProjectAssetUrl() { return resolveProjectAssetUrl; }
  }));
}
function handleEditorLinkHover(...args) { return links().handleEditorLinkHover(...args); }
function handleEditorMouseLeave(...args) { return links().handleEditorMouseLeave(...args); }
function hideLinkTooltip(...args) { return links().hideLinkTooltip(...args); }
function openLinkFromEditor(...args) { return links().openLinkFromEditor(...args); }
function renderLinksPanel(...args) { return links().renderLinksPanel(...args); }

editorLinkTooltip.el.addEventListener("mouseleave", () => hideLinkTooltip(true));

// ── Links panel (outgoing + backlinks) ───────────────────────────────────────

const linksPanelEl = document.getElementById("links-panel");
const outgoingLinksListEl = document.getElementById("outgoing-links-list");
const backlinksListEl = document.getElementById("backlinks-list");
// ---- Tabs, panes and preview (./features/panes.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var panesInstance;
function panes() {
  return (panesInstance ??= createPanes({
    get DIFF_TAB_ID() { return DIFF_TAB_ID; },
    get agentPendingDecorations() { return agentPendingDecorations; },
    get bmapViewModule() { return bmapViewModule; },
    get captureViewState() { return captureViewState; },
    get closeDiff() { return closeDiff; },
    get collaboration() { return collaboration; },
    get controller() { return controller; },
    get diffState() { return diffState; },
    get draggingTabState() { return draggingTabState; },
    set draggingTabState(value) { draggingTabState = value; },
    get elements() { return elements; },
    get escapeEditorHtml() { return escapeEditorHtml; },
    get escapeHtmlAttribute() { return escapeHtmlAttribute; },
    get formatSnapshotTime() { return formatSnapshotTime; },
    get getRelativeProjectPath() { return getRelativeProjectPath; },
    get getUrlDbEntries() { return getUrlDbEntries; },
    get getUrlDbEntryById() { return getUrlDbEntryById; },
    get getViewState() { return getViewState; },
    get imageSrcFor() { return imageSrcFor; },
    get isPreviewableFileName() { return isPreviewableFileName; },
    get loadBmapView() { return loadBmapView; },
    get logDebug() { return logDebug; },
    get mathJaxLoadPromise() { return mathJaxLoadPromise; },
    set mathJaxLoadPromise(value) { mathJaxLoadPromise = value; },
    get normalizePath() { return normalizePath; },
    get notify() { return notify; },
    get personaAvatarSrc() { return personaAvatarSrc; },
    get previewBmapView() { return previewBmapView; },
    set previewBmapView(value) { previewBmapView = value; },
    get previewFileId() { return previewFileId; },
    set previewFileId(value) { previewFileId = value; },
    get previewOpenTabIds() { return previewOpenTabIds; },
    set previewOpenTabIds(value) { previewOpenTabIds = value; },
    get previewUrlDbEntry() { return previewUrlDbEntry; },
    set previewUrlDbEntry(value) { previewUrlDbEntry = value; },
    get quickGenerateBmapFile() { return quickGenerateBmapFile; },
    get render() { return render; },
    get resolveProjectAssetUrl() { return resolveProjectAssetUrl; },
    get selectionNodeId() { return selectionNodeId; },
    set selectionNodeId(value) { selectionNodeId = value; },
    get setMobileExplorerOpen() { return setMobileExplorerOpen; },
    get settings() { return settings; },
    get showToast() { return showToast; },
    get sourceOpenTabIds() { return sourceOpenTabIds; },
    set sourceOpenTabIds(value) { sourceOpenTabIds = value; },
    get sourceUrlDbEntry() { return sourceUrlDbEntry; },
    set sourceUrlDbEntry(value) { sourceUrlDbEntry = value; },
    get syncState() { return syncState; },
    get identity() { return identity; },
    get togglePreview() { return togglePreview; },
    get updateFileContentFromPreview() { return updateFileContentFromPreview; },
    get updateStatus() { return updateStatus; },
    get workspaceMode() { return workspaceMode; }
  }));
}
function bindPaneDropTarget(...args) { return panes().bindPaneDropTarget(...args); }
function bindTabStripReorderTarget(...args) { return panes().bindTabStripReorderTarget(...args); }
function cacheWorkspaceView(...args) { return panes().cacheWorkspaceView(...args); }
function cachedWorkspaceView(...args) { return panes().cachedWorkspaceView(...args); }
function clearPaneDropState(...args) { return panes().clearPaneDropState(...args); }
function closeTabOverflowMenu(...args) { return panes().closeTabOverflowMenu(...args); }
function currentWorkspaceView(...args) { return panes().currentWorkspaceView(...args); }
function ensureOpenTabs(...args) { return panes().ensureOpenTabs(...args); }
function openDroppedFileInPane(...args) { return panes().openDroppedFileInPane(...args); }
function openFileFromExplorer(...args) { return panes().openFileFromExplorer(...args); }
function openPreviewTab(...args) { return panes().openPreviewTab(...args); }
function openSourceTab(...args) { return panes().openSourceTab(...args); }
function openTabOverflowMenu(...args) { return panes().openTabOverflowMenu(...args); }
function printPreviewAsPdf(...args) { return panes().printPreviewAsPdf(...args); }
function renderPreviewContent(...args) { return panes().renderPreviewContent(...args); }
function renderTabs(...args) { return panes().renderTabs(...args); }
function restoreResumeState(...args) { return panes().restoreResumeState(...args); }
function setActiveSourceFile(...args) { return panes().setActiveSourceFile(...args); }
function setActiveSourceUrlDbEntry(...args) { return panes().setActiveSourceUrlDbEntry(...args); }
function setPreviewFile(...args) { return panes().setPreviewFile(...args); }
function showResumedFile(...args) { return panes().showResumedFile(...args); }
function tabOverflowButton(...args) { return panes().tabOverflowButton(...args); }
async function typesetPreview(...args) { return panes().typesetPreview(...args); }

// ---- Explorer and file actions (./features/file-actions.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var fileActionsInstance;
function fileActions() {
  return (fileActionsInstance ??= createFileActions({
    get workspace() { return workspace; },
    get addFileState() { return addFileState; },
    get applyEditorEdit() { return applyEditorEdit; },
    get applyFileContentUpdates() { return applyFileContentUpdates; },
    get clearEditorDropCaret() { return clearEditorDropCaret; },
    get collaboration() { return collaboration; },
    get confirmAction() { return confirmAction; },
    get controller() { return controller; },
    get createMarkdownImageReference() { return createMarkdownImageReference; },
    get createMarkdownReference() { return createMarkdownReference; },
    get editorDragState() { return editorDragState; },
    get elements() { return elements; },
    get explorerClipboard() { return explorerClipboard; },
    get fileExtensionForKind() { return fileExtensionForKind; },
    get fileExtensionOf() { return fileExtensionOf; },
    get getEditorSelection() { return getEditorSelection; },
    get getEditorText() { return getEditorText; },
    get getEditorTextOffsetFromPoint() { return getEditorTextOffsetFromPoint; },
    get getNextDefaultFileName() { return getNextDefaultFileName; },
    get getNextDefaultFolderName() { return getNextDefaultFolderName; },
    get getNextUrlDbEntryName() { return getNextUrlDbEntryName; },
    get getUrlDbEntries() { return getUrlDbEntries; },
    get getUrlDbEntryById() { return getUrlDbEntryById; },
    get inferNameFromUrl() { return inferNameFromUrl; },
    get initialContentForKind() { return initialContentForKind; },
    get isPreviewableFileName() { return isPreviewableFileName; },
    get loadBmapView() { return loadBmapView; },
    get logDebug() { return logDebug; },
    get looksLikeUrl() { return looksLikeUrl; },
    get notify() { return notify; },
    get openAccessEditor() { return openAccessEditor; },
    get openDroppedFileInPane() { return openDroppedFileInPane; },
    get openMtreeToolsDialog() { return openMtreeToolsDialog; },
    get openPreviewTab() { return openPreviewTab; },
    get persistSettings() { return persistSettings; },
    get previewFileId() { return previewFileId; },
    set previewFileId(value) { previewFileId = value; },
    get previewUrlDbEntry() { return previewUrlDbEntry; },
    set previewUrlDbEntry(value) { previewUrlDbEntry = value; },
    get promptForName() { return promptForName; },
    get publishOperation() { return publishOperation; },
    get publishSnapshot() { return publishSnapshot; },
    get remapPersonaPaths() { return remapPersonaPaths; },
    get render() { return render; },
    get replaceEditorRange() { return replaceEditorRange; },
    get replaceFileTargetId() { return replaceFileTargetId; },
    set replaceFileTargetId(value) { replaceFileTargetId = value; },
    get selectionNodeId() { return selectionNodeId; },
    set selectionNodeId(value) { selectionNodeId = value; },
    get setActiveSourceFile() { return setActiveSourceFile; },
    get setActiveSourceUrlDbEntry() { return setActiveSourceUrlDbEntry; },
    get setEditorSelection() { return setEditorSelection; },
    get setPreviewFile() { return setPreviewFile; },
    get settings() { return settings; },
    get showBookmarkEntryDialog() { return showBookmarkEntryDialog; },
    get showToast() { return showToast; },
    get sourceUrlDbEntry() { return sourceUrlDbEntry; },
    set sourceUrlDbEntry(value) { sourceUrlDbEntry = value; },
    get suggestUniqueFileName() { return suggestUniqueFileName; },
    get suggestUniqueFolderName() { return suggestUniqueFolderName; },
    get suggestUniqueUrlDbEntryName() { return suggestUniqueUrlDbEntryName; }
  }));
}
function canPasteIntoExplorerTarget(...args) { return fileActions().canPasteIntoExplorerTarget(...args); }
function clearExplorerDropState(...args) { return fileActions().clearExplorerDropState(...args); }
function createFileInFolder(...args) { return fileActions().createFileInFolder(...args); }
function createItem(...args) { return fileActions().createItem(...args); }
async function deleteSelected(...args) { return fileActions().deleteSelected(...args); }
function exportNode(...args) { return fileActions().exportNode(...args); }
function getExplorerDropPayloadKind(...args) { return fileActions().getExplorerDropPayloadKind(...args); }
function getExplorerDropPlacement(...args) { return fileActions().getExplorerDropPlacement(...args); }
function getSelectedNode(...args) { return fileActions().getSelectedNode(...args); }
function getSelectedParent(...args) { return fileActions().getSelectedParent(...args); }
function getSelectedUrlDbEntry(...args) { return fileActions().getSelectedUrlDbEntry(...args); }
async function handleAddFileTransfer(...args) { return fileActions().handleAddFileTransfer(...args); }
async function handleEditorDrop(...args) { return fileActions().handleEditorDrop(...args); }
async function handleExplorerAction(...args) { return fileActions().handleExplorerAction(...args); }
function handleNewFileSubmit(...args) { return fileActions().handleNewFileSubmit(...args); }
function moveExplorerNode(...args) { return fileActions().moveExplorerNode(...args); }
function moveExplorerUrlDbEntry(...args) { return fileActions().moveExplorerUrlDbEntry(...args); }
function openNewFileDialog(...args) { return fileActions().openNewFileDialog(...args); }
async function renameFileById(...args) { return fileActions().renameFileById(...args); }
async function renameSelected(...args) { return fileActions().renameSelected(...args); }
async function replaceImageFile(...args) { return fileActions().replaceImageFile(...args); }
function resetAddFileState(...args) { return fileActions().resetAddFileState(...args); }
function setAddFileStatus(...args) { return fileActions().setAddFileStatus(...args); }
function setExplorerDropState(...args) { return fileActions().setExplorerDropState(...args); }
async function stageAddFileFromLocalFile(...args) { return fileActions().stageAddFileFromLocalFile(...args); }
async function submitAddFile(...args) { return fileActions().submitAddFile(...args); }

function applyFileContentUpdates(updates) {
  const nextProject = structuredClone(controller.getProject());
  updates.forEach(({ fileId, content }) => {
    const file = nextProject.nodes[fileId];
    if (!file || file.kind !== "file") {
      throw new Error(`File not found: ${fileId}`);
    }
    file.content = content;
    file.dirty = true;
  });
  controller.replaceProject(nextProject);
}

function bindExplorerDropTarget() {
  elements.explorerTree.addEventListener("dragover", (event) => {
    const payloadKind = getExplorerDropPayloadKind(event.dataTransfer?.types ?? []);
    if (!payloadKind) {
      clearExplorerDropState();
      return;
    }

    const row = event.target.closest(".tree-row");
    if (!row) {
      if (payloadKind === "file" || payloadKind === "node") {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        setExplorerDropState(null, "into");
        return;
      }
      clearExplorerDropState();
      return;
    }

    const project = controller.getProject();
    const node = project.nodes[row.dataset.nodeId];
    if (!node) {
      clearExplorerDropState();
      return;
    }

    const placement = getExplorerDropPlacement(row, node, row.dataset.entryId || null, payloadKind, event);
    if (!placement) {
      clearExplorerDropState();
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    setExplorerDropState(row, placement);
  });

  elements.explorerTree.addEventListener("dragleave", (event) => {
    if (event.currentTarget?.contains(event.relatedTarget)) {
      return;
    }
    clearExplorerDropState();
  });

  elements.explorerTree.addEventListener("drop", (event) => {
    clearExplorerDropState();
    const nodeId = event.dataTransfer?.getData("text/mdnotes-node-id");
    const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
    const entryPayload = event.dataTransfer?.getData("text/mdnotes-urldb-entry");
    if (!nodeId && !entryPayload) {
      return;
    }

    const row = event.target.closest(".tree-row");
    const project = controller.getProject();
    const targetNodeId = row?.dataset.nodeId ?? null;
    const targetEntryId = row?.dataset.entryId ?? null;
    const targetNode = targetNodeId ? project.nodes[targetNodeId] : null;
    const placement = row && targetNode
      ? getExplorerDropPlacement(row, targetNode, targetEntryId, entryPayload ? "urldb-entry" : "node", event)
      : (nodeId ? "into" : null);

    if (!placement) {
      return;
    }

    event.preventDefault();
    try {
      if (nodeId) {
        moveExplorerNode(nodeId, targetNodeId, placement);
        return;
      }

      const parsed = JSON.parse(entryPayload);
      moveExplorerUrlDbEntry(parsed.fileId, parsed.entryId, targetNodeId, targetEntryId, placement);
    } catch (error) {
      notify(error.message);
    }
  });
}

async function saveActiveWorkspaceFile() {
  const saved = snapshotProject(controller.getProject());
  const scope = snapshotProjectKey();
  const activeId = saved.activeFileId;
  if (!activeId) return;
  const wroteToDisk = await saveProjectToHandles(saved);
  if (!wroteToDisk) saveProject(saved);
  if (scope !== snapshotProjectKey()) return;
  const current = controller.getProject();
  if (!savedFileIds(current, saved).includes(activeId)) return;
  const confirmed = workspaceMode !== "synced" || (collaboration.isConnected?.()
    && !collaboration.hasUnsyncedText?.(getPath(current, activeId)));
  if (confirmed) {
    controller.markSaved(activeId, workspaceMode !== "synced");
  }
}

async function handleSaveCommand() {
  if (moduleMapTools?.isOpen() && moduleMapTools.contains(document.activeElement)) {
    logDebug("action", "Module map written to target");
    moduleMapTools.write();
    return;
  }

  try {
    logDebug("action", "Workspace save requested");
    await saveActiveWorkspaceFile();
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
  settings.sidebarPanels = next;
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
  if (elements.explorerAnchorSelect) elements.explorerAnchorSelect.value = settings.explorerAnchor;
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

// Re-render on resize ONLY when the WIDTH changes (that's what affects soft-wrap
// and gutter alignment). A height-only change — e.g. the document growing as you
// press Enter — must NOT trigger renderEditorContent(): it rebuilds innerHTML,
// which invalidates the current selection and drops the caret to offset 0 (the
// "Enter/DEL then the caret jumps to line 1" bug, which fired ~16-60ms later via
// this observer). And when a real width change does re-render, preserve the caret.
let _lastEditorObservedWidth = 0;
const editorResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(() => {
    const width = Math.round(elements.editorScroll.getBoundingClientRect().width);
    if (editorIsComposing || width === _lastEditorObservedWidth) {
      syncEditorScroll();
      return;
    }
    _lastEditorObservedWidth = width;
    const sel = getEditorSelection();
    const hadFocus = document.activeElement === elements.editorContent;
    const savedScroll = elements.editorContent.scrollTop;
    renderEditorContent(getEditorText());
    if (hadFocus) {
      elements.editorContent.focus({ preventScroll: true });
      setEditorSelection(sel.start, sel.end);
    }
    elements.editorContent.scrollTop = savedScroll;
    syncEditorScroll();
  })
  : null;

editorResizeObserver?.observe(elements.editorScroll);
editorResizeObserver?.observe(elements.sourcePane);

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
    settings.sidebarWidth = Math.round(nextWidth);
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
    settings.previewWidthCustomized = true;
    settings.previewWidth = Math.round(nextWidth);
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
    settings.chatWidth = Math.round(nextWidth);
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
    settings.debugPanelHeight = Math.round(nextHeight);
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

function setStatusDot(node, kind) {
  node.classList.remove("is-success", "is-warning", "is-danger");
  if (kind) {
    node.classList.add(kind);
  }
}

function persistSettings() {
  saveSettings(settings);
  applyWorkspaceSettings();
}

applyWorkspaceSettings();

function createPresenceChip(entry) {
  const chip = document.createElement("div");
  chip.className = "presence-chip";
  const avatar = document.createElement("span");
  avatar.className = "presence-avatar";
  // Color the avatar by the same palette as the peer's cursor, so the person and
  // their caret are visually linked.
  if (entry.clientId) avatar.style.background = clientColor(entry.clientId);
  const label = document.createElement("span");
  label.textContent = entry.displayName || entry.clientId;
  chip.append(avatar, label);
  return chip;
}

// Colored dots (one per connected session, matching cursor colors) shown next to
// the status-bar collaborator count, so collaboration state — and who is who — is
// visible at a glance.
function renderPeerBadge(presence) {
  const dotsEl = elements.presenceDots;
  if (!dotsEl) return;
  dotsEl.replaceChildren();
  for (const entry of presence.slice(0, 6)) {
    const dot = document.createElement("span");
    dot.className = "peer-badge-dot";
    if (entry.clientId) dot.style.background = clientColor(entry.clientId);
    dotsEl.append(dot);
  }
}

function renderPresence(presence) {
  elements.presenceStrip.replaceChildren();
  elements.presenceList.replaceChildren();
  renderPeerBadge(presence);

  if (presence.length === 0) {
    const connected = syncState.status === "connected";
    const emptyStrip = document.createElement("span");
    emptyStrip.className = "subtle-label";
    emptyStrip.textContent = connected
      ? "Connected — no one else here yet."
      : "No collaborators connected.";
    elements.presenceStrip.append(emptyStrip);

    const emptyList = document.createElement("span");
    emptyList.className = "subtle-label";
    emptyList.textContent = "No active session members.";
    elements.presenceList.append(emptyList);
    return;
  }

  presence.forEach((entry) => {
    elements.presenceStrip.append(createPresenceChip(entry));
    elements.presenceList.append(createPresenceChip(entry));
  });
}

// ---- Footer character count ----------------------------------------------
// The active file's source length, switching to "selected / total" while text is
// highlighted in the editor. It counts SOURCE characters (what the editor holds),
// so highlighting rendered text in the preview doesn't apply. updateStatus caches
// the total so a drag-select only recomputes the cheap selection part.
// (`statusCharTotal` is declared with the other module state near the top, so the
// hoisted updateStatus can never read it inside its temporal dead zone.)
function renderCharCount() {
  const item = elements.statusCharCountItem;
  const label = elements.statusCharCountText;
  if (!item || !label) return;
  if (statusCharTotal == null) {
    item.hidden = true;
    return;
  }
  const { start, end } = getEditorSelection(); // {0,0} unless the editor holds the selection
  const selected = Math.max(0, end - start);
  const total = statusCharTotal.toLocaleString();
  label.textContent = selected > 0 ? `${selected.toLocaleString()} / ${total} chars` : `${total} chars`;
  item.title = selected > 0
    ? `${selected.toLocaleString()} characters selected of ${total}`
    : `${total} characters in this file`;
  item.hidden = false;
}

// selectionchange fires continuously while dragging; coalesce to one update per
// frame so the count stays cheap on large files.
let _charCountFrame = 0;
function scheduleCharCount() {
  if (_charCountFrame) return;
  _charCountFrame = requestAnimationFrame(() => {
    _charCountFrame = 0;
    renderCharCount();
    scheduleOverviewRuler(); // the caret marker follows the selection
  });
}
document.addEventListener("selectionchange", scheduleCharCount);

function updateStatus(project) {
  const liveDirectory = project.sourceMode === "filesystem";
  const localWorkspace = project.sourceMode === "opfs";
  const browserSupported = supportsDirectoryAccess();
  const collaboratorCount = syncState.presence.length;
  ensureOpenTabs(project);
  renderTabs(project);

  elements.projectNameLabel.textContent = project.name;
  elements.sourceStatusText.textContent = liveDirectory
    ? "Live directory"
    : localWorkspace
      ? "Local workspace"
      : "In-browser workspace";
  elements.browserStatusText.textContent = browserSupported ? "Chromium directory access available" : "Fallback import/export mode";
  elements.serverStatusBarText.textContent = syncState.status === "sync-error" ? "Sync paused" : identity.account()
    ? (syncState.status === "connected"
        ? identity.account().username
        : `Logged in as ${identity.account().username}`)
    : syncState.status === "connected"
      ? "Connected"
      : syncState.status === "reachable"
        ? "Server reachable"
        : "Server offline";
  elements.serverStatusText.textContent = syncState.detail;
  // Session panel (also the sole connection readout on mobile, where the status
  // bar is hidden): derive everything from the live connection status, not just
  // a shared-session PIN — a cloud workspace is a "connected" session too.
  const sessionConnected = syncState.status === "connected";
  const sessionReachable = syncState.status === "reachable";
  const sessionName = syncState.sessionId
    ? (syncState.sessionId === "default"
        ? "Shared session"
        : syncState.sessionId.split("/").filter(Boolean).pop() || syncState.sessionId)
    : null;
  if (sessionConnected) {
    elements.sessionIdLabel.textContent = sessionName ?? "Connected";
    elements.sessionIdLabel.title = `${syncState.sessionId ?? "Connected"} (internal revision ${syncState.revision})`;
    elements.sessionDetailText.textContent = sessionName
      ? `${sessionName}${syncState.displayName ? ` as ${syncState.displayName}` : ""}${syncState.role ? ` (${syncState.role})` : ""}.`
      : (syncState.detail || "Connected to the server.");
  } else if (syncState.status === "sync-error") {
    elements.sessionIdLabel.textContent = "Sync paused";
    elements.sessionIdLabel.title = "";
    elements.sessionDetailText.textContent = syncState.detail;
  } else if (sessionReachable) {
    elements.sessionIdLabel.textContent = "Reachable";
    elements.sessionIdLabel.title = "";
    elements.sessionDetailText.textContent = syncState.detail || "Server reachable — not in a shared session.";
  } else {
    elements.sessionIdLabel.textContent = "Offline";
    elements.sessionIdLabel.title = "";
    elements.sessionDetailText.textContent = "Not connected to a shared session.";
  }
  elements.presenceSummaryText.textContent = collaboratorCount === 1 ? "1 collaborator online" : `${collaboratorCount} collaborators online`;

  if (elements.workspaceModeRow) {
    // Only clients get the private/synced toggle — the master IS the workspace.
    const showToggle = syncState.status === "connected" && syncState.role === "client";
    if (showToggle) {
      elements.workspaceModeRow.removeAttribute("hidden");
      if (elements.workspaceModeToggle) {
        elements.workspaceModeToggle.textContent = workspaceMode === "synced" ? "⟳ Synced" : "◑ Private";
        elements.workspaceModeToggle.title = workspaceMode === "synced"
          ? "Click to switch to your private local workspace"
          : "Click to switch back to the shared synced workspace";
      }
    } else {
      elements.workspaceModeRow.setAttribute("hidden", "");
    }
  }

  setStatusDot(elements.sourceIndicator, liveDirectory ? "is-success" : "is-warning");
  setStatusDot(elements.browserIndicator, browserSupported ? "is-success" : "is-warning");
  setStatusDot(elements.serverIndicator, syncState.status === "connected" ? "is-success" : (syncState.status === "reachable" || syncState.status === "reconnecting") ? "is-warning" : "is-danger");

  renderPresence(syncState.presence);
  renderMobilePaneCaption(); // tracks the active/preview file, not just the view

  const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
  const previewFile = previewFileId ? project.nodes[previewFileId] : null;
  const selectedEntry = getSelectedUrlDbEntry(project);
  if (!activeFile) {
    // No file open: make the pane non-editable and show the create-a-file overlay
    // instead of a plain (typable) placeholder.
    elements.editorContent.contentEditable = "false";
    elements.editorContent.dataset.noFile = "true";
    if (elements.editorEmptyState) elements.editorEmptyState.hidden = false;
    renderWelcomeState();
    if (lastRenderedFileId !== null) {
      lastRenderedFileId = null;
      loadEditorContent("");
    }
    syncEditorScroll();
    renderPreviewOrDiff(project, previewFile); // diff tab still shows if it's the active preview tab
    renderLinksPanel(project, null);
    renderChatPanel(project);
    statusCharTotal = null; // nothing open → hide the character count
    renderCharCount();
    renderVersionLabel();
    return;
  }

  elements.editorContent.dataset.noFile = "false";
  if (elements.editorEmptyState) elements.editorEmptyState.hidden = true;
  const isTextFile = isTextFileName(activeFile.name);
  // A reader may open and read the project but never write to it (the server
  // refuses their operations regardless; this stops the UI inviting edits that
  // would only bounce back).
  const readOnly = isReadOnlyWorkspace();
  elements.editorContent.contentEditable = isTextFile && !readOnly ? "true" : "false";
  elements.editorContent.dataset.readonly = readOnly ? "true" : "false";
  elements.editorContent.dataset.placeholder = isTextFile
    ? "Select or create a file"
    : "Image assets are preview-only in the source pane.";
  const nextText = isTextFile
    ? selectedEntry
      ? formatUrlDbEntryBody(selectedEntry.entry)
      : activeFile.content
    : `[${activeFile.name}]\n\nThis image asset is preview-only in the source pane.\nUse the preview pane to inspect it or Explorer > Add File to replace it.`;
  // Cache the total for the footer counter — the source text the editor holds
  // (an image placeholder isn't file content, so the counter hides for those).
  // Painted at the end of this pass, once the editor DOM/selection is in sync.
  statusCharTotal = isTextFile ? nextText.length : null;
  const fileChanged = activeFile.id !== lastRenderedFileId;
  const editorHasFocus = elements.editorContent === document.activeElement;
  if (fileChanged) {
    // Clear stale remote cursors when the viewed file changes.
    renderRemoteCursors([]);
  }
  if (!_editorUpdating && fileChanged) {
    const savedSelection = savedEditorSelection(activeFile.id, nextText);
    lastRenderedFileId = activeFile.id;
    loadEditorContent(nextText, savedSelection?.start ?? 0, savedSelection?.end ?? savedSelection?.start ?? 0);
    // Resume the reader's previous scroll position in this document. The real
    // scroller is #editor-content (#editor-scroll is overflow:hidden).
    const savedScroll = getViewState(activeFile.id)?.editorScroll;
    if (savedScroll && elements.editorContent) {
      elements.editorContent.scrollTop = savedScroll;
      syncEditorScroll();
    }
    // The find bar's matches are offsets into the file it searched. Switching
    // files must re-run the search against the NEW document — otherwise the
    // highlights (and next/prev) point at phantom positions carried over from
    // the old one. Done here, after loadEditorContent, so the DOM we measure is
    // the new file's.
    if (searchState.open) {
      searchState.currentIndex = -1;
      computeSearchMatches();
    }
  } else {
    const domText = getEditorText();
    // Never rebuild the editor DOM mid-IME-composition. During composition the
    // DOM holds in-progress characters the model hasn't received yet (the `input`
    // handler defers to compositionend), so nextText !== domText transiently. A
    // rebuild here — triggered by ANY unrelated render (auto-save, presence, a
    // remote op on another file) — would abort the composition and slam the caret
    // to offset 0. The model catches up on compositionend, which re-syncs cleanly.
    if (nextText !== domText && !editorIsComposing) {
      if (editorHasFocus) {
        // External same-file changes invalidate snapshot-based undo history.
        // Keep the caret stable when possible, then fence the history stack at
        // the new synchronized content so Ctrl+Z cannot replay stale text.
        const { start, end } = getEditorSelection();
        const nextSelection = consumeExternalEditorSelection(activeFile.id, nextText, start, end);
        logDebug("response", "caret", `render resync (same file, focused): read sel=${start}-${end} → applyEditorRender at ${nextSelection.start}`);
        hideEditorAutocomplete();
        applyEditorRender(nextText, nextSelection.start, nextSelection.end);
        resetEditorHistory(nextText, nextSelection.start, nextSelection.end);
      } else {
        logDebug("response", "caret", "render→loadEditorContent (same file, NOT focused) → caret to 0");
        loadEditorContent(nextText);
      }
      // Reposition remote cursor overlays after the DOM re-render.
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    }
    syncEditorScroll();
  }
  // Skip the redundant preview rebuild when the change came from the preview
  // itself — re-rendering would reset the diagram's scroll position/selection.
  // Also skip while the user is actively editing INSIDE the preview (e.g. a bmap
  // node's Name/Text inspector field): renderPreviewContent() does a full
  // replaceChildren(), so rebuilding here would yank focus out of the field. This
  // fires on routine async renders too (a status/patch-confirm callback lands a
  // beat after you moved to the next field), which is exactly the "kicked out of
  // the text field" case. The preview refreshes on the next render once focus
  // leaves it.
  renderPreviewOrDiff(project, previewFile);
  renderLinksPanel(project, activeFile);
  renderChatPanel(project);
  renderCharCount(); // after the editor DOM/selection settled above
  renderVersionLabel();
}

// Paint the preview pane: either the diff overlay (when the diff tab is the active
// preview tab) or the normal preview for `previewFile`. The two are mutually
// exclusive and each hides the other's DOM.
function renderPreviewOrDiff(project, previewFile) {
  const showingDiff = diffState.active && previewFileId === DIFF_TAB_ID;
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

// Local (OPFS) projects mirror changes to disk. Debounce per directory; the
// shared writer serializes background, automatic, and explicit saves.
const opfsFlushTimers = new Map();

function scheduleOpfsFlush(project) {
  if (project?.sourceMode !== "opfs") return;
  const root = project.handles?.[project.rootId];
  if (!root) return;
  const previous = opfsFlushTimers.get(root);
  if (previous) clearTimeout(previous);
  // Capture this workspace. Switching views must not redirect its pending save.
  opfsFlushTimers.set(root, setTimeout(() => {
    opfsFlushTimers.delete(root);
    void saveProjectToHandles(project).catch((error) => {
      logDebug("response", "Local workspace save failed", error.message);
    });
  }, 500));
}

function render(project) {
  if (typingUpdate) {
    // A keystroke. The editor has already drawn it; the explorer, tabs, preview,
    // links, chat and status follow once typing pauses (or every
    // DEFERRED_RENDER_MAX_MS during a long burst). Doing them synchronously here
    // cost a full app render plus a whole-project localStorage write per key.
    scheduleDeferredRender();
    scheduleRecoverySave(project);
    scheduleOpfsFlush(project);
    scheduleAutoSave(project);
    return;
  }
  cancelDeferredRender(); // this full render covers whatever was pending
  explorer.render(project, new Set(agentPendingDecorations.keys()));
  updateStatus(project);
  scheduleRecoverySave(project);
  scheduleOpfsFlush(project);
  scheduleAutoSave(project);
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

// The browser-recovery copy in localStorage (the in-browser workspace's only
// storage, and a crash net for the others). Serialising the whole project used
// to run on every render — every keystroke, and every collaborator's keystroke.
// Now it trails edits slightly and is flushed whenever the page may go away.
function scheduleRecoverySave(project) {
  recoverySavePending = project;
  const now = performance.now();
  if (!recoverySaveDeadline) recoverySaveDeadline = now + RECOVERY_SAVE_MAX_MS;
  if (recoverySaveTimer) clearTimeout(recoverySaveTimer);
  const delay = Math.max(0, Math.min(RECOVERY_SAVE_IDLE_MS, recoverySaveDeadline - now));
  recoverySaveTimer = setTimeout(flushRecoverySave, delay);
}

function flushRecoverySave() {
  if (recoverySaveTimer) clearTimeout(recoverySaveTimer);
  recoverySaveTimer = null;
  recoverySaveDeadline = 0;
  const project = recoverySavePending;
  recoverySavePending = null;
  if (!project) return;
  try { saveProject(project); }
  catch (error) { logDebug("response", "Browser recovery save failed", error.message); }
}

// Anything that might end the page's life gets the pending copy written now.
window.addEventListener("pagehide", () => { flushRecoverySave(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushRecoverySave();
});

// ---- Auto-save: idle + periodic durable flush for non-real-disk workspaces.
// Clears the dirty flag (and thus the ● tab dot + beforeunload nag) once content
// is durably stored: localStorage for memory/import, OPFS for local workspaces,
// the server for synced cloud workspaces. A real OS folder (sourceMode
// "filesystem") still requires an explicit Ctrl+S, so it is left untouched.
// These MUST be declared BEFORE controller.subscribe(render): subscribe() calls
// the listener immediately, and render() calls scheduleAutoSave(), so the timer
// state must already exist — otherwise a temporal-dead-zone ReferenceError at
// startup (the initial project has an active file, so render reaches this).
const AUTOSAVE_IDLE_MS = 1500;
const AUTOSAVE_PERIODIC_MS = 15000;
let autoSaveIdleTimer = null;

controller.subscribe(render);

function dirtyFileIds(project) {
  return Object.values(project.nodes)
    .filter((node) => node.kind === "file" && node.dirty)
    .map((node) => node.id);
}

function scheduleAutoSave(project = controller.getProject()) {
  if (!settings.autoSave || project.sourceMode === "filesystem") return;
  if (!dirtyFileIds(project).length) return;
  if (autoSaveIdleTimer) clearTimeout(autoSaveIdleTimer);
  autoSaveIdleTimer = setTimeout(() => {
    autoSaveIdleTimer = null;
    void runAutoSave("idle");
  }, AUTOSAVE_IDLE_MS);
}

async function runAutoSave(reason) {
  if (!settings.autoSave) return;
  // Don't churn a render (markManySaved) mid-IME-composition; wait until it ends.
  if (editorIsComposing) return;
  const project = snapshotProject(controller.getProject());
  const scope = snapshotProjectKey();
  if (project.sourceMode === "filesystem") return; // explicit save only
  const dirty = dirtyFileIds(project);
  if (!dirty.length) return;
  try {
    if (project.sourceMode === "opfs") {
      await saveProjectToHandles(project);
    } else {
      saveProject(project); // propagate quota/storage errors before clearing dirty
    }
    if (scope !== snapshotProjectKey()) return;
    const unchanged = new Set(savedFileIds(controller.getProject(), project));
    const savedDirty = dirty.filter((id) => unchanged.has(id));
    // memory/import already mirror to localStorage on every render.
    // A cloud workspace's durable home is the SERVER, so only clear dirty once the
    // server confirmed the text (nothing pending / in-flight / mid-reconnect) —
    // the ● must never lie about being saved. While OFFLINE nothing is confirmed,
    // so every edit stays dirty: that flag is exactly what tells a later reconnect
    // (and the pull guards in collaboration-service) which files still need
    // pushing. Clearing it offline is what let a reconnect drop hours of work.
    const cloud = workspaceMode === "synced";
    const savable = cloud
      ? (collaboration.isConnected?.()
          ? savedDirty.filter((id) => !collaboration.hasUnsyncedText?.(getPath(project, id)))
          : [])
      : savedDirty;
    if (savable.length) {
      controller.markManySaved(savable, !cloud);  // host owns the counters when synced
      logDebug("response", `Auto-saved ${savable.length} file(s) (${reason})`);
    }
  } catch (error) {
    logDebug("response", "Auto-save failed", error.message);
  }
}

// Periodic safety net so a long, uninterrupted typing session (idle timer keeps
// resetting) still gets flushed regularly.
window.setInterval(() => {
  if (settings.autoSave && dirtyFileIds(controller.getProject()).length) {
    void runAutoSave("periodic");
  }
}, AUTOSAVE_PERIODIC_MS);

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
      if (workspaceMode === "synced" || current.id !== placeholder.id || edited) {
        logDebug("action", "Default template not installed", "a workspace or edits arrived first");
        return;
      }
      controller.replaceProject(project);
      selectionNodeId = project.activeFileId ?? project.rootId;
      initializePaneState(project);
      logDebug("action", "Default template loaded", project.name);
    })
    .catch((error) => {
      logDebug("response", "Default template load failed", error.message);
    });
}

logDebug("response", "Debug log initialized", `panel=${settings.debugPanel ? "visible" : "hidden"}`);

function publishSnapshot() {
  if (collaboration.isConnected() && workspaceMode === "synced") {
    collaboration.scheduleSnapshot(controller.getProject());
  }
}

async function publishOperation(operation) {
  if (!collaboration.isConnected() || workspaceMode !== "synced") {
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
      collaboration.reloadFromServer?.("Stale write refused — pulled the newer copy.").catch(() => {});
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
  if (mobileView === "chat") return null;
  if (mobileView === "preview") return previewFileId === DIFF_TAB_ID ? null : previewFileId;
  return controller.getActiveFile()?.id ?? null;
}

elements.editorContent.addEventListener("compositionstart", () => {
  editorIsComposing = true;
});

elements.editorContent.addEventListener("compositionend", () => {
  editorIsComposing = false;
  // After IME commit, sync the plain-text representation to the model and
  // restore the cursor position (which the render cycle would otherwise drop).
  const { start, end } = getEditorSelection();
  notifyEditorChanged(getEditorText());
  // The render triggered by notifyEditorChanged may have re-rendered the DOM
  // (if a remote op landed simultaneously); restore cursor explicitly.
  setEditorSelection(start, end);
  rememberEditorSelection();
  showEditorAutocomplete();
});

// Intercept editing operations BEFORE the browser mutates the DOM so we can
// maintain the .editor-line structure that getEditorText() depends on.
// Without this, select-all+type erases the structure and paste loses \n.
elements.editorContent.addEventListener("beforeinput", (event) => {
  if (editorIsComposing) return;
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) return;

  if (
    event.inputType === "insertParagraph" ||
    event.inputType === "insertLineBreak" ||
    (event.inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
  ) {
    traceEditorEvent("beforeinput", {
      inputType: event.inputType,
      data: formatEditorDebugValue(event.data ?? "")
    });
  }

  const { start, end } = getEditorSelection();
  const hasSelection = start !== end;
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" || event.inputType.startsWith("delete")) {
    logDebug("response", "caret", `beforeinput ${event.inputType} reads sel=${start}-${end}`);
  }

  // Paste: always intercept — browser creates non-.editor-line divs for
  // multi-line content which causes \n to be silently dropped.
  if (event.inputType === "insertFromPaste") {
    event.preventDefault();
    const text = (event.dataTransfer?.getData("text/plain") ?? "").replace(/\r\n/g, "\n");
    replaceEditorRange(start, end, text);
    renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    showEditorAutocomplete();
    return;
  }

  // Always intercept Enter — letting the browser handle it natively creates a
  // plain <div> (not .editor-line) inside the contenteditable.  That element
  // is invisible to getEditorText() and causes getEditorSelection() to return
  // offset 0, which corrupts every subsequent edit (Space, Tab, backspace…).
  if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
    event.preventDefault();
    replaceEditorRange(start, end, "\n");
    renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    hideEditorAutocomplete();
    return;
  }

  // Non-empty selection: browser may collapse or destroy .editor-line divs
  // when the operation spans multiple lines. Take over completely.
  if (hasSelection) {
    if (event.inputType === "insertText") {
      event.preventDefault();
      replaceEditorRange(start, end, event.data ?? "");
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
      showEditorAutocomplete();
      return;
    }
    if (
      event.inputType === "deleteByCut" ||
      event.inputType === "deleteContentBackward" ||
      event.inputType === "deleteContentForward" ||
      event.inputType.startsWith("deleteWord") ||
      event.inputType.startsWith("deleteLine") ||
      event.inputType.startsWith("deleteHardLine") ||
      event.inputType.startsWith("deleteSoftLine")
    ) {
      event.preventDefault();
      replaceEditorRange(start, end, "");
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
      return;
    }
  }

  // No selection, single-char delete: intercept when the cursor is right at
  // a line boundary so the browser doesn't merge two .editor-line divs into
  // one (which would drop the \n from getEditorText() and corrupt the model).
  if (!hasSelection) {
    const value = getEditorText();
    if (event.inputType === "deleteContentBackward") {
      // Backspace at the very start of a line (start > 0 and char before is \n)
      if (start > 0 && value[start - 1] === "\n") {
        event.preventDefault();
        replaceEditorRange(start - 1, start, "");
        renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
        return;
      }
    }
    if (event.inputType === "deleteContentForward") {
      // Delete at the very end of a line (char at cursor is \n)
      if (start < value.length && value[start] === "\n") {
        event.preventDefault();
        replaceEditorRange(start, start + 1, "");
        renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
        return;
      }
    }
  }
});

elements.editorContent.addEventListener("input", (event) => {
  if (editorIsComposing) {
    return;
  }
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    hideEditorAutocomplete();
    return;
  }
  const currentText = getEditorText();
  const { start, end } = getEditorSelection();
  const inputType = (event instanceof InputEvent ? event.inputType : "") ?? "";
  if (
    inputType === "insertParagraph" ||
    inputType === "insertLineBreak" ||
    (inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
  ) {
    traceEditorEvent("input", {
      inputType,
      data: formatEditorDebugValue(event.data ?? "")
    });
  }
  // Record every native text edit, including spaces, before the synchronous
  // model update path can disturb DOM focus/selection state.
  pushEditorHistoryState(currentText, start, end);
  notifyEditorChanged(currentText);
  // Re-render syntax highlighting; must restore selection afterward because
  // innerHTML replacement destroys the native caret. Rebuilding innerHTML also
  // resets scrollTop to 0, so save/restore it — otherwise caretIntoView() below
  // re-scrolls from the top and a mid-document edit (e.g. backspace) jumps the
  // view. This is the native-edit path; applyEditorRender has the same guard.
  const savedScroll = elements.editorContent.scrollTop;
  renderEditorContent(currentText);
  // Restore focus if innerHTML replacement caused the contenteditable to lose
  // focus (observed in some browsers); this keeps the caret in place for the
  // next keystroke rather than falling back to page-level focus.
  if (document.activeElement !== elements.editorContent) {
    elements.editorContent.focus({ preventScroll: true });
  }
  setEditorSelection(start, end);
  rememberEditorSelection();
  elements.editorContent.scrollTop = savedScroll;
  syncEditorScroll();
  caretIntoView();
  if (
    inputType === "insertParagraph" ||
    inputType === "insertLineBreak" ||
    (inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
  ) {
    traceEditorEvent("input rendered", {
      inputType,
      data: formatEditorDebugValue(event.data ?? "")
    });
  }
  // Reposition remote cursor overlays now that the DOM has changed.
  renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
  showEditorAutocomplete();
});

// File tabs and workspace opens need not move focus into the editor. Restore the
// saved caret when the user returns with keyboard or pointer focus instead.
elements.editorContent.addEventListener("focus", () => {
  const active = controller.getActiveFile();
  if (!active || lastRenderedFileId !== active.id) return;
  const saved = savedEditorSelection(active.id, getEditorText());
  if (saved) setEditorSelection(saved.start, saved.end);
});

elements.editorContent.addEventListener("scroll", () => {
  syncEditorScroll();
  scheduleRemoteCursorRender(); // keep peer carets/highlights pinned to the text while scrolling
  if (searchState.open) renderSearchHighlights();
});
elements.editorContent.addEventListener("keydown", handleEditorKeydown);

// ── Find / Replace controls ─────────────────────────────────────────────────
let findRecomputeTimer = null;
elements.findInput?.addEventListener("input", () => {
  if (findRecomputeTimer) clearTimeout(findRecomputeTimer);
  findRecomputeTimer = setTimeout(() => {
    findRecomputeTimer = null;
    computeSearchMatches({ keepCaret: true });
    // Jump to the first match as the user refines the query.
    if (searchState.matches.length) gotoMatch(searchState.currentIndex);
  }, 100);
});
elements.findInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) findPrev(); else findNext();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeFindBar();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    elements.findInput.select();
  }
});
elements.replaceInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); replaceCurrent(); }
  else if (event.key === "Escape") { event.preventDefault(); closeFindBar(); }
});
elements.findNext?.addEventListener("click", findNext);
elements.findPrev?.addEventListener("click", findPrev);
elements.findClose?.addEventListener("click", closeFindBar);
elements.findToggleCase?.addEventListener("click", () => toggleFindOption("caseSensitive", elements.findToggleCase));
elements.findToggleWord?.addEventListener("click", () => toggleFindOption("wholeWord", elements.findToggleWord));
elements.findToggleRegex?.addEventListener("click", () => toggleFindOption("regex", elements.findToggleRegex));
elements.findToggleReplace?.addEventListener("click", () => {
  searchState.replaceMode = !searchState.replaceMode;
  if (elements.findReplaceRow) elements.findReplaceRow.hidden = !searchState.replaceMode;
  (searchState.replaceMode ? elements.replaceInput : elements.findInput)?.focus();
});
elements.replaceOne?.addEventListener("click", replaceCurrent);
elements.replaceAll?.addEventListener("click", replaceAllMatches);
elements.editorContent.addEventListener("mousedown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.button === 0) {
    const linkEl = event.target?.closest?.(".token-link[data-href]");
    if (linkEl) {
      event.preventDefault();
      hideLinkTooltip(true);
      openLinkFromEditor(linkEl.dataset.href);
    }
  }
});
elements.editorContent.addEventListener("click", hideEditorAutocomplete);
elements.editorContent.addEventListener("mousemove", handleEditorLinkHover);
elements.editorContent.addEventListener("mouseleave", handleEditorMouseLeave);

elements.preview.addEventListener("click", (event) => {
  const fileLink = event.target.closest("a[data-open-file-id]");
  if (fileLink) {
    event.preventDefault();
    openFileFromExplorer(fileLink.dataset.openFileId);
    return;
  }
  const unresolved = event.target.closest("a[data-unresolved-link]");
  if (unresolved) {
    event.preventDefault();
    notify(`Cannot resolve link: ${unresolved.dataset.unresolvedLink}`);
  }
});

elements.editorContent.addEventListener("dragstart", (event) => {
  const { start: selectionStart, end: selectionEnd } = getEditorSelection();
  if (selectionStart === selectionEnd) {
    editorDragState.selection = null;
    return;
  }
  const text = getEditorText().slice(selectionStart, selectionEnd);
  editorDragState.selection = { start: selectionStart, end: selectionEnd, text };
  event.dataTransfer?.setData("text/mdnotes-editor-selection", JSON.stringify(editorDragState.selection));
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "copyMove";
  }
});
elements.editorContent.addEventListener("dragend", () => {
  editorDragState.selection = null;
  clearEditorDropCaret();
});
elements.editorContent.addEventListener("dragover", (event) => {
  const types = event.dataTransfer?.types ?? [];
  // Explorer file drags: let the pane-level handler accept them (don't steal the event here).
  if (types.includes("text/mdnotes-file-id") || types.includes("text/mdnotes-node-id")) {
    clearEditorDropCaret();
    return;
  }

  const activeFile = controller.getActiveFile();
  const supportsTextDrop = Boolean(activeFile && isTextFileName(activeFile.name));
  const supportsImageUrlDrop = Boolean(activeFile && isMarkdownFileName(activeFile.name) && types.includes("text/mdnotes-urldb-entry"));
  const supportsTextPayload = types.includes("text/plain") || types.includes("text/mdnotes-editor-selection");
  if ((!supportsTextDrop || !supportsTextPayload) && !supportsImageUrlDrop) {
    clearEditorDropCaret();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = types.includes("text/mdnotes-editor-selection") ? "move" : "copy";
  }
  showEditorDropCaret(event.clientX, event.clientY);
});
elements.editorContent.addEventListener("dragleave", (event) => {
  if (event.currentTarget.contains(event.relatedTarget)) {
    return;
  }
  clearEditorDropCaret();
});
elements.editorContent.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  void handleEditorDrop(event).catch((error) => notify(error.message));
});
elements.editorGutter.addEventListener("wheel", forwardEditorWheel, { passive: false });
elements.editorScroll.addEventListener("wheel", (event) => {
  if (event.target === elements.editorContent) {
    return;
  }
  forwardEditorWheel(event);
}, { passive: false });

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
    selectionNodeId = controller.getProject().activeFileId ?? controller.getProject().rootId;
    initializePaneState(controller.getProject());
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
      settings.lastLocalProject = { path: project.localPath };
      saveSettings(settings);
    }
    selectionNodeId = project.activeFileId ?? project.rootId;
    initializePaneState(project);
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
  if (!file) {
    return;
  }
  try {
    logDebug("action", "Import requested", file.name);
    const project = file.name.toLowerCase().endsWith(".zip") ? await importZipArchive(file) : await importSingleFile(file);
    controller.replaceProject(project);
    selectionNodeId = project.activeFileId ?? project.rootId;
    initializePaneState(project);
    publishSnapshot();
  } catch (error) {
    notify(error.message);
  } finally {
    event.target.value = "";
  }
});

elements.replaceFileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file || !replaceFileTargetId) {
    event.target.value = "";
    return;
  }
  try {
    await replaceImageFile(replaceFileTargetId, file);
  } catch (error) {
    notify(error.message);
  } finally {
    replaceFileTargetId = null;
    event.target.value = "";
  }
});

elements.explorerAddButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const project = controller.getProject();
  const parent = getSelectedParent(project);
  selectionNodeId = parent.id;
  const opened = explorer.toggleQuickAddMenu(elements.explorerAddButton, parent.id);
  logDebug("action", opened ? "Explorer add menu opened" : "Explorer add menu closed", getPath(project, parent.id) || project.name);
});

elements.explorerFilterButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const project = controller.getProject();
  const parent = getSelectedParent(project);
  selectionNodeId = parent.id;
  const opened = explorer.toggleFilterMenu(elements.explorerFilterButton, parent.id);
  logDebug("action", opened ? "Explorer filter menu opened" : "Explorer filter menu closed", settings.explorerFilter);
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
shell.commands.add({ id: "workspace.rename-selected", title: "Rename Selected", menu: { id: "edit", group: 0, order: 4 }, run: () => {
  void renameSelected();
} });
shell.commands.add({ id: "workspace.delete-selected", title: "Delete Selected", menu: { id: "edit", group: 0, order: 5 }, run: () => {
  void deleteSelected();
} });
shell.commands.add({ id: "file-types.new-markdown", title: "New Markdown", menu: { id: "create", group: 0, order: 1 }, run: () => createItem("md") });
shell.commands.add({ id: "file-types.new-mtree", title: "New MTREE", menu: { id: "create", group: 0, order: 2 }, run: () => createItem("mtree") });
shell.commands.add({ id: "file-types.new-urldb", title: "New URL Album", menu: { id: "create", group: 0, order: 3 }, run: () => createItem("urldb") });
shell.commands.add({ id: "file-types.new-bmap", title: "New Diagram", menu: { id: "create", group: 0, order: 4 }, run: () => createItem("bmap") });
shell.commands.add({ id: "file-types.new-persona", title: "New Character", menu: { id: "create", group: 0, order: 5 }, run: () => createItem("persona") });
elements.addFilePickerButton.addEventListener("click", () => elements.addFilePickerInput.click());
elements.addFilePickerInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    await stageAddFileFromLocalFile(file);
  } catch (error) {
    notify(error.message);
    setAddFileStatus(error.message);
  } finally {
    event.target.value = "";
  }
});
elements.addFileNameInput.addEventListener("input", (event) => {
  addFileState.fileName = event.target.value.trim();
});
elements.addFileSubmitButton.addEventListener("click", () => {
  void submitAddFile();
});
elements.addFileDropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  elements.addFileDropzone.classList.add("is-active");
});
elements.addFileDropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.addFileDropzone.classList.add("is-active");
});
elements.addFileDropzone.addEventListener("dragleave", (event) => {
  if (event.currentTarget.contains(event.relatedTarget)) {
    return;
  }
  elements.addFileDropzone.classList.remove("is-active");
});
elements.addFileDropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.addFileDropzone.classList.remove("is-active");
  void handleAddFileTransfer(event.dataTransfer).catch((error) => {
    notify(error.message);
    setAddFileStatus(error.message);
  });
});
elements.addFileDropzone.addEventListener("paste", (event) => {
  void handleAddFileTransfer(event.clipboardData).catch((error) => {
    notify(error.message);
    setAddFileStatus(error.message);
  });
});
elements.addFileDialog.addEventListener("close", () => {
  elements.addFileDropzone.classList.remove("is-active");
  resetAddFileState();
});

bindPaneDropTarget(elements.sourcePane, "source");
bindPaneDropTarget(elements.sourceTabStrip, "source");
bindPaneDropTarget(elements.previewPane, "preview");
bindPaneDropTarget(elements.previewTabStrip, "preview");
bindExplorerDropTarget();
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
    get DIFF_TAB_ID() { return DIFF_TAB_ID; },
    get DIRECTION_BIAS() { return DIRECTION_BIAS; },
    get EDGE_ZONE() { return EDGE_ZONE; },
    get FLICK_VELOCITY() { return FLICK_VELOCITY; },
    get PANE_ORDER() { return PANE_ORDER; },
    get SLOP() { return SLOP; },
    get SNAP_FRACTION() { return SNAP_FRACTION; },
    get chat() { return chat; },
    get closeMenus() { return closeMenus; },
    get controller() { return controller; },
    get currentMobileFileId() { return currentMobileFileId; },
    get diffState() { return diffState; },
    get drawerWidth() { return drawerWidth; },
    set drawerWidth(value) { drawerWidth = value; },
    get elements() { return elements; },
    get gesture() { return gesture; },
    set gesture(value) { gesture = value; },
    get isMobileLayout() { return isMobileLayout; },
    get isPreviewableFileName() { return isPreviewableFileName; },
    get logDebug() { return logDebug; },
    get mobileView() { return mobileView; },
    set mobileView(value) { mobileView = value; },
    get paneDrag() { return paneDrag; },
    set paneDrag(value) { paneDrag = value; },
    get persistSettings() { return persistSettings; },
    get previewFileId() { return previewFileId; },
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
  settings.debugPanel = !settings.debugPanel;
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
  clearViewStates();
  viewStates = {};
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
  clearViewStates(); // also drop cached resume positions
  viewStates = {};
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
elements.explorerAnchorSelect?.addEventListener("change", (event) => { setExplorerAnchor(event.target.value); });
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
    && workspaceMode === "synced"
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
elements.newFileDialog?.querySelector("form")?.addEventListener("submit", handleNewFileSubmit);
elements.newFileCancelButton?.addEventListener("click", () => elements.newFileDialog.close("cancel"));
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
elements.statusSourceItem.addEventListener("click", () => {
  logDebug("action", "Status bar: open directory");
  void shell.run("workspace.import-folder");
});
elements.statusBrowserItem.addEventListener("click", () => {
  const supported = supportsDirectoryAccess();
  showNoticeDialog(
    supported
      ? "This browser supports the File System Access API, so you can open and edit a local directory directly."
      : "This browser falls back to import/export mode. Use a Chromium-based browser (Chrome, Edge) to edit a local directory in place.",
    "Browser Support"
  );
});
// ── Settings dialog tabs ────────────────────────────────────────────────────
function switchSettingsTab(tab) {
  const strip = elements.settingsTabStrip;
  if (!strip) return;
  strip.querySelectorAll(".settings-tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  elements.settingsDialog.querySelectorAll(".settings-tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.tabPanel !== tab;
  });
  // On mobile the rail is a ≡ flyout — collapse it once a section is chosen.
  elements.settingsDialog.dataset.tabs = "closed";
  elements.settingsTabsButton?.setAttribute("aria-expanded", "false");
}

function openSettingsDialog(tab = "appearance") {
  if (!elements.settingsDialog.open) {
    elements.settingsDialog.showModal();
  }
  applyAgentSettingsControls();
  chat?.mcpControls.render();
  // Re-check the agent backend so the Agent tab shows fresh status.
  void refreshChatStatus({ silent: true });
  switchSettingsTab(tab);
}

// ── Agent settings ──────────────────────────────────────────────────────────
elements.agentRunnerSelect?.addEventListener("change", (event) => {
  settings.agentRunner = event.target.value === "browser" ? "browser" : "server";
  saveSettings(settings);
  applyAgentSettingsControls();
  logDebug("action", "Character replies run", settings.agentRunner);
});
elements.agentSourceSelect?.addEventListener("change", (event) => {
  settings.agentSource = event.target.value === "own" ? "own" : "server";
  saveSettings(settings);
  applyAgentSettingsControls();
  logDebug("action", "Agent source changed", settings.agentSource);
  void refreshChatStatus({ silent: true });
});
function bindAgentField(inputEl, key) {
  inputEl?.addEventListener("input", (event) => {
    settings[key] = event.target.value;
  });
  // Persist + re-evaluate availability only when the field loses focus, so we
  // don't thrash on every keystroke of a pasted key.
  inputEl?.addEventListener("change", () => {
    settings[key] = settings[key]?.trim() ?? "";
    inputEl.value = settings[key];
    saveSettings(settings);
    applyAgentSettingsStatus();
    void refreshChatStatus({ silent: true });
  });
}
bindAgentField(elements.agentApiKeyInput, "agentApiKey");
bindAgentField(elements.agentApiUrlInput, "agentApiUrl");
bindAgentField(elements.agentModelInput, "agentModel");

elements.settingsTabsButton?.addEventListener("click", () => {
  const open = elements.settingsDialog.dataset.tabs !== "open";
  elements.settingsDialog.dataset.tabs = open ? "open" : "closed";
  elements.settingsTabsButton.setAttribute("aria-expanded", String(open));
});

// While the section rail is open (mobile flyout), a tap anywhere outside it
// should just dismiss the rail — not activate the half-covered control behind
// it. Capture the click first so it never reaches that control.
elements.settingsDialog?.addEventListener("click", (event) => {
  if (elements.settingsDialog.dataset.tabs !== "open") return;
  if (elements.settingsTabStrip?.contains(event.target)) return;
  if (elements.settingsTabsButton?.contains(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  elements.settingsDialog.dataset.tabs = "closed";
  elements.settingsTabsButton?.setAttribute("aria-expanded", "false");
}, true);

elements.settingsTabStrip?.querySelectorAll(".settings-tab").forEach((button) => {
  button.addEventListener("click", () => switchSettingsTab(button.dataset.tab));
});

elements.statusServerItem.addEventListener("click", () => {
  logDebug("action", "Status bar: open collaboration settings");
  openSettingsDialog("collaboration");
  // Clicking the server footer immediately checks the configured server.
  void pingCurrentServer();
});
elements.statusPresenceItem.addEventListener("click", () => {
  // The session/presence panel lives in the explorer sidebar — reveal it.
  if (settings.explorer !== "expanded") {
    settings.explorer = "expanded";
    if (elements.explorerSelect) elements.explorerSelect.value = settings.explorer;
    persistSettings();
  }
  // Revealing a collapsed section would show only its header, so open it.
  if (sidebarPanelCollapsed("session")) toggleSidebarPanel("session");
  document.querySelector(".collaboration-sidebar-panel")?.scrollIntoView({ block: "nearest" });
  logDebug("action", "Status bar: reveal session panel");
});

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

elements.debugClearButton.addEventListener("click", () => {
  debugState.entries = [];
  renderDebugPanel();
});

elements.themeSelect.addEventListener("change", (event) => {
  settings.theme = event.target.value;
  saveSettings(settings);
  applyTheme(settings);
  logDebug("action", "Theme changed", settings.theme);
});

elements.explorerSelect.addEventListener("change", (event) => {
  settings.explorer = event.target.value;
  persistSettings();
  logDebug("action", "Explorer setting changed", settings.explorer);
});

elements.previewSelect.addEventListener("change", (event) => {
  settings.preview = event.target.value;
  persistSettings();
  logDebug("action", "Preview setting changed", settings.preview);
});

elements.wordWrapSelect.addEventListener("change", (event) => {
  settings.wordWrap = event.target.value === "on";
  persistSettings();
  render(controller.getProject());
  logDebug("action", "Word wrap changed", settings.wordWrap ? "on" : "off");
});

// ---- Source typography (Appearance) --------------------------------------
// A font the browser can't find is silently replaced by the fallback, so choosing
// it looked like "the setting does nothing". Detect availability the way font
// detection libraries do: draw a sample with the candidate falling back to each
// generic family; if its width never differs from the bare generic, the browser
// substituted it — it isn't installed on this device. Results are cached.
// (fontInstalledCache / fontProbeContext / fontProbeBase live with the other
// module state near the top: syncSourceFontControls() runs at boot, long before
// this line, and would otherwise hit them inside their temporal dead zone.)
function isFontInstalled(name) {
  const clean = String(name ?? "").replace(/["'\\]/g, "").trim();
  if (!clean) return true;
  if (fontInstalledCache.has(clean)) return fontInstalledCache.get(clean);
  if (!fontProbeContext) fontProbeContext = document.createElement("canvas").getContext("2d");
  const ctx = fontProbeContext;
  if (!ctx) return true; // no canvas — don't claim it's missing
  const sample = "mmmmmmmmmmlli10OoWW@#";
  const measure = (font) => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(sample).width;
  };
  const installed = ["monospace", "serif", "sans-serif"].some((generic) => {
    if (fontProbeBase[generic] == null) fontProbeBase[generic] = measure(generic);
    return measure(`"${clean}", ${generic}`) !== fontProbeBase[generic];
  });
  fontInstalledCache.set(clean, installed);
  return installed;
}

// Mark curated fonts that aren't on this device, so the list reflects what will
// actually render. A missing font stays selectable only if it's the saved choice.
function annotateSourceFontOptions() {
  const select = elements.sourceFontFamilySelect;
  if (!select) return;
  for (const option of select.options) {
    if (!option.value || option.value === "__custom__") continue;
    if (!option.dataset.label) option.dataset.label = option.textContent;
    const installed = isFontInstalled(option.value);
    option.textContent = installed ? option.dataset.label : `${option.dataset.label} (not installed)`;
    option.disabled = !installed && select.value !== option.value;
  }
}

// Tell the user which font is really on screen, and warn plainly when the chosen
// one is missing instead of letting it silently fall back.
function renderSourceFontStatus() {
  const el = elements.sourceFontStatus;
  if (!el) return;
  const family = String(settings.sourceFontFamily ?? "").trim();
  const missing = family && !isFontInstalled(family);
  el.classList.toggle("is-warning", Boolean(missing));
  el.textContent = !family
    ? "Using the default monospace font."
    : missing
      ? `\u201c${family}\u201d isn\u2019t installed on this device, so the default monospace font is shown instead.`
      : `Using ${family}.`;
}
// Reflect the stored settings into the controls. A family that isn't one of the
// curated options is shown as "Custom…" with the name in the text field.
function syncSourceFontControls() {
  if (elements.sourceFontSizeSelect) {
    const size = clampSourceFontSize(settings.sourceFontSize);
    const listed = [...elements.sourceFontSizeSelect.options].some((o) => Number(o.value) === size);
    elements.sourceFontSizeSelect.value = String(listed ? size : 13);
  }
  const select = elements.sourceFontFamilySelect;
  if (!select) return;
  const family = String(settings.sourceFontFamily ?? "").trim();
  const isCurated = [...select.options].some((o) => o.value === family && o.value !== "__custom__");
  if (family && !isCurated) {
    select.value = "__custom__";
    if (elements.sourceFontCustomInput) elements.sourceFontCustomInput.value = family;
  } else {
    select.value = family;
    if (elements.sourceFontCustomInput) elements.sourceFontCustomInput.value = "";
  }
  if (elements.sourceFontCustomRow) elements.sourceFontCustomRow.hidden = select.value !== "__custom__";
  annotateSourceFontOptions();
  renderSourceFontStatus();
}

// Persist + repaint after a typography change. Glyph metrics just changed, so
// every measured overlay (caret, remote cursors, search highlights) and the
// gutter's scroll sync must be recomputed.
function applySourceFontChange(label) {
  persistSettings();
  applyEditorFont(settings);
  render(controller.getProject());
  renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
  if (searchState.open) computeSearchMatches({ keepCaret: true });
  syncEditorScroll();
  syncSourceFontControls(); // refresh availability labels + the status line
  logDebug("action", "Source typography changed", label);
}

elements.sourceFontSizeSelect?.addEventListener("change", (event) => {
  settings.sourceFontSize = clampSourceFontSize(event.target.value);
  applySourceFontChange(`${settings.sourceFontSize}px`);
});

elements.sourceFontFamilySelect?.addEventListener("change", (event) => {
  if (event.target.value === "__custom__") {
    // Reveal the field and wait for a name — don't clear the current font yet.
    if (elements.sourceFontCustomRow) elements.sourceFontCustomRow.hidden = false;
    elements.sourceFontCustomInput?.focus();
    return;
  }
  if (elements.sourceFontCustomRow) elements.sourceFontCustomRow.hidden = true;
  if (elements.sourceFontCustomInput) elements.sourceFontCustomInput.value = "";
  settings.sourceFontFamily = event.target.value;
  applySourceFontChange(settings.sourceFontFamily || "default");
});

// Commit on blur/Enter rather than each keystroke, so a half-typed name doesn't
// repaint the editor on every character.
elements.sourceFontCustomInput?.addEventListener("change", (event) => {
  settings.sourceFontFamily = String(event.target.value ?? "").trim();
  applySourceFontChange(settings.sourceFontFamily || "default");
});

elements.indentStyleSelect.addEventListener("change", (event) => {
  settings.indentStyle = event.target.value;
  persistSettings();
  logDebug("action", "Indent style changed", settings.indentStyle);
});

elements.bmapGenerateScopeSelect.addEventListener("change", (event) => {
  settings.bmapGenerateScope = event.target.value === "all" ? "all" : "connected";
  persistSettings();
  logDebug("action", "Bmap generate scope changed", settings.bmapGenerateScope);
});

elements.autoSaveInput?.addEventListener("change", (event) => {
  settings.autoSave = event.target.checked;
  saveSettings(settings);
  logDebug("action", "Auto-save setting changed", settings.autoSave ? "on" : "off");
  if (settings.autoSave) scheduleAutoSave();
});
elements.formatToolbarInput?.addEventListener("change", (event) => {
  settings.showFormatToolbar = event.target.checked;
  persistSettings();
  refreshFormatToolbar();
  logDebug("action", "Format toolbar setting changed", settings.showFormatToolbar ? "on" : "off");
});

elements.bmapAutoPanInput?.addEventListener("change", (event) => {
  settings.bmapAutoPan = event.target.checked;
  persistSettings();
  logDebug("action", "Bmap auto-pan setting changed", settings.bmapAutoPan ? "on" : "off");
});

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

elements.serverUrlInput.addEventListener("change", (event) => {
  settings.serverUrl = event.target.value.trim();
  saveSettings(settings);
  void refreshChatStatus({ silent: true });
});

elements.serverPinInput.addEventListener("change", (event) => {
  settings.serverPin = event.target.value;
  saveSettings(settings);
});

elements.displayNameInput.addEventListener("change", (event) => {
  settings.displayName = event.target.value.trim();
  saveSettings(settings);
});

elements.autoReconnectInput?.addEventListener("change", (event) => {
  settings.autoReconnect = event.target.checked;
  if (!settings.autoReconnect) {
    // Disabling auto-reconnect cancels any pending retry and forgets the session.
    clearReconnectTimer();
    settings.wasConnected = false;
  }
  saveSettings(settings);
  logDebug("action", "Auto-reconnect setting changed", settings.autoReconnect ? "on" : "off");
});
// ---- Cloud file browser, accounts and hosting (./features/cloud-browser.js) ----
// Created on first use. The module reads main's shared values through this
// context, so it always sees their current values. `var`: a forwarding
// function can run during startup, before this line is reached.
var cloudBrowserInstance;
function cloudBrowser() {
  return (cloudBrowserInstance ??= createCloudBrowser({
    get browserState() { return browserState; },
    get cachedWorkspaceView() { return cachedWorkspaceView; },
    get collaboration() { return collaboration; },
    get controller() { return controller; },
    get currentWorkspaceView() { return currentWorkspaceView; },
    get elements() { return elements; },
    get ensureSnapshotsMigrated() { return ensureSnapshotsMigrated; },
    get flashStatusPanel() { return flashStatusPanel; },
    get initializePaneState() { return initializePaneState; },
    get loadLineComments() { return loadLineComments; },
    get logDebug() { return logDebug; },
    get notify() { return notify; },
    get openSettingsDialog() { return openSettingsDialog; },
    get opfsProvider() { return opfsProvider; },
    get privateProjectSnapshot() { return privateProjectSnapshot; },
    set privateProjectSnapshot(value) { privateProjectSnapshot = value; },
    get promptForName() { return promptForName; },
    get refreshChatStatus() { return refreshChatStatus; },
    get refreshSnapshotBaselines() { return refreshSnapshotBaselines; },
    get render() { return render; },
    get selectionNodeId() { return selectionNodeId; },
    set selectionNodeId(value) { selectionNodeId = value; },
    get serverProvider() { return serverProvider; },
    get sessionRestorer() { return sessionRestorer; },
    get setMobileExplorerOpen() { return setMobileExplorerOpen; },
    get settings() { return settings; },
    get showConfirmDialog() { return showConfirmDialog; },
    get showResumedFile() { return showResumedFile; },
    get showToast() { return showToast; },
    get snapshotDirtyFiles() { return snapshotDirtyFiles; },
    get switchWorkspaceMode() { return switchWorkspaceMode; },
    get syncState() { return syncState; },
    get identity() { return identity; },
    get workspaceMode() { return workspaceMode; },
    set workspaceMode(value) { workspaceMode = value; }
  }));
}
function activateBrowserEntry(...args) { return cloudBrowser().activateBrowserEntry(...args); }
function beginTransfer(...args) { return cloudBrowser().beginTransfer(...args); }
function cancelPick(...args) { return cloudBrowser().cancelPick(...args); }
async function handleAccountLogin(...args) { return cloudBrowser().handleAccountLogin(...args); }
function handleAccountLogout(...args) { return cloudBrowser().handleAccountLogout(...args); }
async function handleDeleteSelected(...args) { return cloudBrowser().handleDeleteSelected(...args); }
async function handleHost(...args) { return cloudBrowser().handleHost(...args); }
async function handleNewFolder(...args) { return cloudBrowser().handleNewFolder(...args); }
async function handleNewProject(...args) { return cloudBrowser().handleNewProject(...args); }
async function handleOpenWorkspace(...args) { return cloudBrowser().handleOpenWorkspace(...args); }
async function handlePublishHere(...args) { return cloudBrowser().handlePublishHere(...args); }
async function handleSelectDestination(...args) { return cloudBrowser().handleSelectDestination(...args); }
async function openAccessEditor(...args) { return cloudBrowser().openAccessEditor(...args); }
function openFileBrowser(...args) { return cloudBrowser().openFileBrowser(...args); }
async function openLocalProjectFromBrowser(...args) { return cloudBrowser().openLocalProjectFromBrowser(...args); }
async function performLogin(...args) { return cloudBrowser().performLogin(...args); }
async function pingCurrentServer(...args) { return cloudBrowser().pingCurrentServer(...args); }
function renderHostTargets(...args) { return cloudBrowser().renderHostTargets(...args); }
async function saveAccessEditor(...args) { return cloudBrowser().saveAccessEditor(...args); }
function splitServerPath(...args) { return cloudBrowser().splitServerPath(...args); }
function switchBrowserSide(...args) { return cloudBrowser().switchBrowserSide(...args); }
function toggleMultiSelect(...args) { return cloudBrowser().toggleMultiSelect(...args); }

elements.pingServerButton.addEventListener("click", () => { void pingCurrentServer(); });

const serverProvider = {
  id: "server",
  rootLabel: "Teams",
  supportsAccess: true,
  supportsPublish: true,
  canCreateAt(path) {
    return splitServerPath(path).team !== "";
  },
  async list(path) {
    const { team, rel } = splitServerPath(path);
    const data = await browseServer(settings.serverUrl, identity.token(), team, rel);
    if (!team) {
      // Team list. Older servers return name strings; newer ones { name, modified }.
      const entries = (data.teams ?? []).map((item) => {
        const name = typeof item === "string" ? item : item.name;
        const modified = typeof item === "string" ? null : item.modified;
        return { name, kind: "team", path: name, modified };
      });
      return { path: "", entries, atRoot: true };
    }
    const entries = (data.entries ?? []).map((entry) => ({ ...entry, path: `${team}/${entry.path}` }));
    return { path, entries, atRoot: false };
  },
  async mkdir(path, name) {
    const { team, rel } = splitServerPath(path);
    await mkdirServer(settings.serverUrl, identity.token(), team, rel, name);
  },
  async createProject(path, name) {
    const { team, rel } = splitServerPath(path);
    const created = await createProjectServer(settings.serverUrl, identity.token(), team, rel, name);
    return { path: `${team}/${created.path}`, name };
  },
  async openProject(entry) {
    const { team, rel } = splitServerPath(entry.path);
    await handleOpenWorkspace(team, rel, { reason: "file-manager-open" });
  },
  async delete(entry) {
    const { team, rel } = splitServerPath(entry.path);
    await deleteServer(settings.serverUrl, identity.token(), team, rel);
  },
  async exportModel(entry) {
    const { team, rel } = splitServerPath(entry.path);
    const data = await exportProjectServer(settings.serverUrl, identity.token(), team, rel);
    return { name: data.name ?? entry.name, project: data.project };
  },
  async importModel(destPath, name, project) {
    const { team, rel } = splitServerPath(destPath);
    const created = await importProjectServer(settings.serverUrl, identity.token(), team, rel, name, project);
    return { path: `${team}/${created.path}`, name: created.name };
  },
  async openAccess(entry) {
    const { team, rel } = splitServerPath(entry.path);
    await openAccessEditor(team, rel, entry.name);
  }
};

const opfsProvider = {
  id: "local",
  rootLabel: "This device",
  supportsAccess: false,
  supportsPublish: false,
  canCreateAt() {
    return true;
  },
  async list(path) {
    const { entries } = await listOpfsDir(path);
    return { path, entries, atRoot: path === "" };
  },
  async mkdir(path, name) {
    await mkdirOpfs(path, name);
  },
  async createProject(path, name) {
    const created = await createProjectOpfs(path, name);
    return { path: created.path, name };
  },
  async openProject(entry) {
    await openLocalProjectFromBrowser(entry);
  },
  async delete(entry) {
    await deleteOpfsEntry(entry.path);
  },
  async exportModel(entry) {
    const pkg = await exportProjectModelOpfs(entry.path);
    return { name: pkg.name ?? entry.name, project: pkg.project };
  },
  async importModel(destPath, name, project) {
    return importProjectModelOpfs(destPath, name, project);
  }
};

// Current browser view. `provider` is one of the objects above, `path` is that
// provider's opaque location, `selection` is the highlighted entry (or null).
let browserState = { provider: opfsProvider, intent: "open", mode: "open", multiSelect: false, checked: new Set(), pendingTransfer: null, path: "", entries: [], atRoot: true, selection: null };

elements.accountLoginButton?.addEventListener("click", () => { void handleAccountLogin(); });
elements.accountLogoutButton?.addEventListener("click", handleAccountLogout);
elements.browserNewFolder?.addEventListener("click", () => { void handleNewFolder(); });
elements.browserNewProject?.addEventListener("click", () => { void handleNewProject(); });
elements.browserPublishHere?.addEventListener("click", () => { void handlePublishHere(); });
elements.browserSideLocal?.addEventListener("click", () => switchBrowserSide("local"));
elements.browserSideServer?.addEventListener("click", () => switchBrowserSide("server"));
elements.browserOpenBtn?.addEventListener("click", () => {
  if (browserState.selection) activateBrowserEntry(browserState.selection);
});
elements.browserAccessBtn?.addEventListener("click", () => {
  const sel = browserState.selection;
  if (sel && browserState.provider?.openAccess) void browserState.provider.openAccess(sel);
});
elements.browserSelectToggle?.addEventListener("click", toggleMultiSelect);
elements.browserDeleteBtn?.addEventListener("click", () => { void handleDeleteSelected(); });
elements.browserMoveBtn?.addEventListener("click", () => beginTransfer("move"));
elements.browserCopyBtn?.addEventListener("click", () => beginTransfer("copy"));
elements.browserPickBtn?.addEventListener("click", () => { void handleSelectDestination(); });
elements.browserPickCancel?.addEventListener("click", cancelPick);
elements.accessDialog?.querySelector("form")?.addEventListener("submit", (event) => {
  // "Cancel" (value=cancel) lets the dialog close normally; Save persists first.
  if (event.submitter && event.submitter.value === "cancel") return;
  event.preventDefault();
  void saveAccessEditor();
});
elements.hostButton?.addEventListener("click", () => { void handleHost(); });
renderHostTargets();
elements.accountPasswordInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void handleAccountLogin();
  }
});

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
    settings.wasConnected = true;
    saveSettings(settings);
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
    syncState.detail = "Reconnect failed. Open collaboration settings to retry.";
    render(controller.getProject());
    logDebug("response", "Auto-reconnect gave up", `after ${reconnectState.attempts} attempts`);
    return;
  }
  const delay = RECONNECT_DELAYS[Math.min(reconnectState.attempts, RECONNECT_DELAYS.length - 1)];
  reconnectState.attempts += 1;
  syncState.detail = `Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectState.attempts})`;
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
  settings.serverUrl = elements.serverUrlInput.value.trim();
  settings.serverPin = elements.serverPinInput.value;
  settings.displayName = elements.displayNameInput.value.trim();
  saveSettings(settings);
  // Ask the user to confirm before making any network call or touching the workspace.
  const confirmed = await showAcceptConnectionDialog();
  if (!confirmed) return;
  reconnectState.attempts = 0;
  clearReconnectTimer();
  try {
    logDebug("action", "Server connect requested", settings.serverUrl);
    await establishConnection({ auto: false });
  } catch (error) {
    syncState.status = "offline";
    syncState.detail = error.message;
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
  if (workspaceMode === "synced" && collaboration.getConnectionInfo()) {
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
    syncState.detail = error.message;
    if ([401, 403].includes(error.status)) showToast("Sign in again to resume your workspace. Your local edits are kept.");
  }
});
let suspendedCloudWorkspace = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    suspendedCloudWorkspace = workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending();
  } else if (suspendedCloudWorkspace) {
    suspendedCloudWorkspace = false;
    void sessionRestorer.run();
  }
});
window.addEventListener("online", () => {
  if (document.visibilityState === "hidden") return;
  if (workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending()) void sessionRestorer.run();
});
window.addEventListener("pageshow", event => {
  if (event.persisted && (workspaceMode === "synced" || !controller.getActiveFile() || sessionRestorer.isPending())) void sessionRestorer.run();
});

void sessionRestorer.run();
// Local/no-server workspaces never fire the cloud open path, so seed the S.E.N
// baselines here too. Harmless for cloud: the open path refreshes them again.
void refreshSnapshotBaselines();