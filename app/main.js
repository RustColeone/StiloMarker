import { rememberedWorkspace, createSessionRecovery } from "./services/session-recovery-service.js";
import { installMobileViewport } from "./services/chat-ui-service.js";
import { snapshotProject, savedFileIds } from "./services/project-save-service.js";
import { APP_VERSION } from "./version.js";
import { ROOT_ID, applyHostCounters, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isMarkdownFileName, isPersonaFileName, isTextFileName, isUrlDbFileName } from "./domain/project-model.js";
import { createProjectController, seedDefaultProject } from "./domain/project-service.js";
import { importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess } from "./services/fs-access-service.js";
import { supportsOpfs, listOpfsDir, mkdirOpfs, createProjectOpfs, getOpfsDirectoryHandle, importOsFolderIntoOpfs, deleteOpfsEntry, exportProjectModelOpfs, importProjectModelOpfs } from "./services/opfs-service.js";
import { createCollaborationRuntime } from "./services/collaboration-service.js";
import { sendGenerationRequest } from "./services/chat-api-service.js";
import { extractMarkdownLinks, renderMarkdown } from "./services/markdown-service.js";
import { PERSONA_SUFFIX, parsePersona, personaTemplate } from "./services/persona-service.js";
import { clearOfflineShellData, registerOfflineShell } from "./services/offline-service.js";
import { applyEditorFont, applyTheme, clampSourceFontSize, loadSettings, patchStoredSettings, saveSettings } from "./services/settings-service.js";
import { loadProject, saveProject } from "./services/storage-service.js";
import { createFileSnapshot, deleteVersion, diffLines, getVersionContent, listFileVersions, listSnapshotPaths } from "./services/snapshot-service.js";
import { clearViewStates, loadViewStates, saveViewStates } from "./services/view-state-service.js";
import { browseServer, createProjectServer, createServerSnapshot, deleteComment, deleteServer, deleteServerSnapshot, exportProjectServer, getServerSnapshotContent, importProjectServer, listComments, listServerSnapshotPaths, listServerSnapshotVersions, mkdirServer, normalizeServerUrl, reanchorComments, saveComment } from "./services/sync-service.js";
import { loadTemplateProject } from "./services/template-service.js";
import { formatUrlDbEntryBody, parseUrlDb, parseUrlDbEntryBody, updateUrlDbEntry } from "./services/urldb-service.js";
import { query } from "./ui/dom.js";
import { createExplorerView } from "./ui/explorer-view.js";
import { buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./ui/editor-format-toolbar.js";
import { createTableGridPicker } from "./ui/table-grid-picker.js";
import { createDefaultBmap } from "./services/bmap-service.js";
import { createCloudBrowser } from "./features/cloud-browser.js";
import { createFileActions } from "./features/file-actions.js";
import { createPanes } from "./features/panes.js";
import { createLayout } from "./ui/layout.js";

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
  noticeDialog: query("#notice-dialog"),
  noticeDialogTitle: query("#notice-dialog-title"),
  noticeDialogMessage: query("#notice-dialog-message"),
  confirmDialog: query("#confirm-dialog"),
  confirmDialogTitle: query("#confirm-dialog-title"),
  confirmDialogMessage: query("#confirm-dialog-message"),
  confirmDialogAcceptButton: query("#confirm-dialog-accept-button"),
  inputDialog: query("#input-dialog"),
  inputDialogTitle: query("#input-dialog-title"),
  inputDialogMessage: query("#input-dialog-message"),
  inputDialogLabel: query("#input-dialog-label"),
  inputDialogInput: query("#input-dialog-input"),
  inputDialogAutoExt: query("#input-dialog-auto-ext"),
  inputDialogAutoExtRow: query(".input-dialog-ext-row"),
  inputDialogSubmitButton: query("#input-dialog-submit-button"),
  inputDialogCancelButton: query("#input-dialog-cancel-button"),
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
  agentStatusLine: query("#agent-status-line"),
  accountLockedNote: query("#account-locked-note"),
  settingsMenuButton: query("#settings-menu-button"),
  settingsMenu: query("#settings-menu"),
  openSettingsMenuButton: query("#open-settings-menu-button"),
  toggleDebugMenuButton: query("#toggle-debug-menu-button"),
  clearCacheMenuButton: query("#clear-cache-menu-button"),
  resetWorkspaceMenuButton: query("#reset-workspace-menu-button"),
  emptyWorkspaceMenuButton: query("#empty-workspace-menu-button"),
  toggleLogButton: query("#toggle-log-button"),
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
  fileMenuButton: query("#file-menu-button"),
  editMenuButton: query("#edit-menu-button"),
  selectionMenuButton: query("#selection-menu-button"),
  viewMenuButton: query("#view-menu-button"),
  fileMenu: query("#file-menu"),
  editMenu: query("#edit-menu"),
  selectionMenu: query("#selection-menu"),
  viewMenu: query("#view-menu"),
  newProjectButton: query("#new-project-button"),
  openDirectoryButton: query("#open-directory-button"),
  openProjectButton: query("#open-project-button"),
  fileManagerButton: query("#file-manager-button"),
  openServerDialog: query("#open-server-dialog"),
  importFileButton: query("#import-file-button"),
  importFileInput: query("#import-file-input"),
  saveButton: query("#save-button"),
  savePdfButton: query("#save-pdf-button"),
  exportButton: query("#export-button"),
  renameSelectedButton: query("#rename-selected-button"),
  findReplaceMenuButton: query("#find-replace-menu-button"),
  createSnapshotButton: query("#create-snapshot-button"),
  snapshotsButton: query("#snapshots-button"),
  workspaceHistoryButton: query("#workspace-history-button"),
  previewDiffView: query("#preview-diff-view"),
  diffBody: query("#diff-body"),
  diffRuler: query("#diff-ruler"),
  diffPrevChange: query("#diff-prev-change"),
  diffNextChange: query("#diff-next-change"),
  previewDiffLabel: query("#preview-diff-label"),
  previewDiffStats: query("#preview-diff-stats"),
  deleteSelectedButton: query("#delete-selected-button"),
  newMarkdownButton: query("#new-markdown-button"),
  newMtreeButton: query("#new-mtree-button"),
  newUrlDbButton: query("#new-urldb-button"),
  newBmapButton: query("#new-bmap-button"),
  newPersonaButton: query("#new-persona-button"),
  exportSelectedButton: query("#export-selected-button"),
  toggleExplorerMenuButton: query("#toggle-explorer-menu-button"),
  togglePreviewButton: query("#toggle-preview-button"),
  toggleSourceButton: query("#toggle-source-button"),
  toggleChatButton: query("#toggle-chat-button"),
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
  chatHistoryPane: query("#chat-history-pane")
};

const settings = loadSettings();
const storedProject = loadProject();
const controller = createProjectController(storedProject ?? seedDefaultProject());
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
// What has changed in the editor DOM since the last render (see
// trackEditorDom). Lets text/caret reads use the render cache instead of
// re-reading every line's textContent — each read allocated a fresh string.
const editorDomTracker = {
  observer: null,
  dirty: new Set(),   // top-level lines whose content changed since the last render
  structural: false,  // lines were added/removed directly under the editor
  text: null          // getEditorText() result, valid until the next mutation
};
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
  // Accounts mode (state 3): whether the last-pinged server supports accounts,
  // and the currently logged-in account (null when signed out).
  accountsAvailable: false,
  hostingAvailable: false,
  account: null // { token, username, teams: [...] }
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
let pendingExternalEditorSelection = null;
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
    const isOriginator = !found.msg.originatorId || found.msg.originatorId === collaboration.getClientId();
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
// The Agent / Roleplay panel lives in app/features/chat-panel.js. It loads the
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
      agentCheckpoints, agentPendingDecorations, buildTextDiffHunks, captureAgentCheckpoint, chatConnectionInfo,
      chatWorkspaceKey, clearAgentDecorations, collaboration, controller, createFileInFolder, elements,
      escapeHtmlAttribute, getSelectedParent, isMobileLayout, jumpToAgentChange, logDebug, notify,
      openFileFromExplorer, openSettingsDialog, personaAvatarSrc, promptForName, publishSnapshot,
      registerAgentDecorations, settings, showConfirmDialog, showToast, storedProject, syncState,
      updateEditorAgentBar,
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

function buildDebugLogText() {
  return debugState.entries.map((entry) => {
    const detail = entry.detail ? ` :: ${entry.detail}` : "";
    return `[${entry.timestamp}] ${entry.kind.toUpperCase()} ${entry.message}${detail}`;
  }).join("\n");
}

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

function logDebug(kind, message, detail = "") {
  debugState.entries.push({
    kind,
    message,
    detail,
    timestamp: new Date().toLocaleTimeString()
  });

  if (debugState.entries.length > debugState.maxEntries) {
    debugState.entries.splice(0, debugState.entries.length - debugState.maxEntries);
  }

  renderDebugPanel();
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

function formatEditorDebugValue(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t");
}

function getEditorTraceDetail(extra = {}) {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const { start, end } = getEditorSelection();
  const lineEls = Array.from(elements.editorContent.children);
  const lineIndex = getEditorLineIndexAtOffset(start);
  const line = lineEls[lineIndex] ?? null;
  const nextLine = lineEls[lineIndex + 1] ?? null;
  const container = range?.startContainer ?? null;
  const containerName = container?.nodeType === Node.TEXT_NODE
    ? "#text"
    : container?.nodeName?.toLowerCase() ?? "null";
  const containerText = container?.nodeType === Node.TEXT_NODE
    ? container.textContent ?? ""
    : "";

  const detail = {
    file: controller.getActiveFile()?.name ?? "",
    active: document.activeElement === elements.editorContent ? "editor" : document.activeElement?.nodeName?.toLowerCase() ?? "null",
    sel: `${start}-${end}`,
    dom: `${containerName}@${range?.startOffset ?? 0}`,
    domText: formatEditorDebugValue(containerText),
    line: lineIndex,
    lineText: formatEditorDebugValue(line?.textContent ?? ""),
    lineHtml: formatEditorDebugValue(line?.innerHTML ?? ""),
    nextLineText: formatEditorDebugValue(nextLine?.textContent ?? ""),
    autocomplete: elements.editorAutocomplete.hidden ? "hidden" : "visible",
    history: `${editorHistory.index}/${editorHistory.stack.length}`,
    ...extra
  };

  return Object.entries(detail)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ; ");
}

function traceEditorEvent(message, extra = {}) {
  // The input handler calls this for every space and Enter, twice. Building the
  // detail walks the whole document, so only do it when someone can see it.
  if (!settings.debugPanel) return;
  logDebug("editor", message, getEditorTraceDetail(extra));
}

function getSelectedTarget() {
  if (sourceUrlDbEntry) {
    return { nodeId: sourceUrlDbEntry.fileId, entryId: sourceUrlDbEntry.entryId };
  }
  return { nodeId: selectionNodeId, entryId: null };
}

/** Flash the server status panel border green (success) or red (error). */
function flashStatusPanel(type, panel = elements.serverStatusPanel) {
  if (!panel) return;
  panel.classList.remove("settings-status-panel--flash-success", "settings-status-panel--flash-error");
  void panel.offsetWidth; // force reflow so restarting mid-animation works
  panel.classList.add(type === "success"
    ? "settings-status-panel--flash-success"
    : "settings-status-panel--flash-error");
}

/** Shown before connecting — resolves true if the user confirms. */
function showAcceptConnectionDialog() {
  return new Promise((resolve) => {
    if (elements.acceptConnectionMessage) {
      elements.acceptConnectionMessage.textContent =
        "If you join as a peer, the host\u2019s workspace will replace your current content. Export your work first if you want to keep it.";
    }
    const handleClose = () => {
      elements.acceptConnectionDialog.removeEventListener("close", handleClose);
      resolve(elements.acceptConnectionDialog.returnValue === "accept");
    };
    elements.acceptConnectionDialog.addEventListener("close", handleClose, { once: true });
    elements.acceptConnectionDialog.showModal();
  });
}

function showNoticeDialog(message, title = "Message") {
  elements.noticeDialogTitle.textContent = title;
  elements.noticeDialogMessage.textContent = String(message);
  if (!elements.noticeDialog.open) {
    elements.noticeDialog.showModal();
  }
}

function showConfirmDialog({ title = "Confirm Action", message, acceptLabel = "Confirm" }) {
  return new Promise((resolve) => {
    elements.confirmDialogTitle.textContent = title;
    elements.confirmDialogMessage.textContent = message;
    elements.confirmDialogAcceptButton.textContent = acceptLabel;

    const handleClose = () => {
      elements.confirmDialog.removeEventListener("close", handleClose);
      resolve(elements.confirmDialog.returnValue === "accept");
    };

    elements.confirmDialog.addEventListener("close", handleClose, { once: true });
    elements.confirmDialog.showModal();
  });
}

function showInputDialog({ title = "Rename Item", message = "Enter a value.", label = "Name", value = "", submitLabel = "Save", extension = "" }) {
  return new Promise((resolve) => {
    elements.inputDialogTitle.textContent = title;
    elements.inputDialogMessage.textContent = message;
    elements.inputDialogLabel.textContent = label;
    elements.inputDialogSubmitButton.textContent = submitLabel;

    // "Auto file extension": only offered when the caller knows the extension
    // (file renames). On by default — the input then shows just the base name so
    // the extension can't be edited by accident; it's re-appended on save.
    const ext = String(extension || "");
    const hasExt = ext.length > 0;
    const endsWithExt = (v) => v.toLowerCase().endsWith(ext.toLowerCase());
    const stripExt = (v) => (hasExt && endsWithExt(v) ? v.slice(0, -ext.length) : v);
    if (elements.inputDialogAutoExtRow) elements.inputDialogAutoExtRow.hidden = !hasExt;
    if (elements.inputDialogAutoExt) elements.inputDialogAutoExt.checked = hasExt;
    elements.inputDialogInput.value = hasExt ? stripExt(value) : value;

    const handleToggle = () => {
      if (!hasExt) return;
      const cur = elements.inputDialogInput.value;
      elements.inputDialogInput.value = elements.inputDialogAutoExt.checked
        ? stripExt(cur)
        : (endsWithExt(cur) ? cur : `${cur}${ext}`);
    };

    const handleCancel = () => {
      elements.inputDialog.close("cancel");
    };

    const handleClose = () => {
      elements.inputDialog.removeEventListener("close", handleClose);
      elements.inputDialogCancelButton.removeEventListener("click", handleCancel);
      elements.inputDialogAutoExt?.removeEventListener("change", handleToggle);
      let result = elements.inputDialog.returnValue === "accept"
        ? elements.inputDialogInput.value.trim() || null
        : null;
      // Re-attach the extension when auto is on and the user didn't type it.
      if (result && hasExt && elements.inputDialogAutoExt?.checked && !endsWithExt(result)) {
        result = `${result}${ext}`;
      }
      resolve(result);
    };

    elements.inputDialog.addEventListener("close", handleClose, { once: true });
    elements.inputDialogCancelButton.addEventListener("click", handleCancel);
    elements.inputDialogAutoExt?.addEventListener("change", handleToggle);
    elements.inputDialog.showModal();
    elements.inputDialogInput.focus();
    elements.inputDialogInput.select();
  });
}

function showBookmarkEntryDialog({ title = "New Bookmark Entry", message = "Add a named image bookmark to this URL album.", name = "", url = "", description = "", submitLabel = "Save" }) {
  return new Promise((resolve) => {
    elements.bookmarkEntryDialogTitle.textContent = title;
    elements.bookmarkEntryDialogMessage.textContent = message;
    elements.bookmarkEntryNameInput.value = name;
    elements.bookmarkEntryUrlInput.value = url;
    elements.bookmarkEntryDescriptionInput.value = description;
    elements.bookmarkEntrySubmitButton.textContent = submitLabel;

    const handleClose = () => {
      elements.bookmarkEntryDialog.removeEventListener("close", handleClose);
      if (elements.bookmarkEntryDialog.returnValue !== "accept") {
        resolve(null);
        return;
      }
      resolve({
        name: elements.bookmarkEntryNameInput.value.trim(),
        url: elements.bookmarkEntryUrlInput.value.trim(),
        description: elements.bookmarkEntryDescriptionInput.value.trim()
      });
    };

    elements.bookmarkEntryDialog.addEventListener("close", handleClose, { once: true });
    elements.bookmarkEntryDialog.showModal();
    elements.bookmarkEntryNameInput.focus();
    elements.bookmarkEntryNameInput.select();
  });
}

function getVisibleDebugEntries() {
  if (debugState.activeTab === "actions") {
    return debugState.entries.filter((entry) => entry.kind === "action");
  }

  if (debugState.activeTab === "responses") {
    return debugState.entries.filter((entry) => entry.kind !== "action");
  }

  return debugState.entries;
}

function renderDebugPanel() {
  debugTabs.forEach((tab) => {
    const active = tab.id === debugState.activeTab;
    tab.element.classList.toggle("is-active", active);
    tab.element.setAttribute("aria-selected", active ? "true" : "false");
  });

  elements.debugLogList.replaceChildren();

  if (!settings.debugPanel) {
    return;
  }

  const visibleEntries = getVisibleDebugEntries();

  if (visibleEntries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "debug-log-entry is-empty";
    empty.textContent = "Log capture is enabled. Matching interactions will appear here.";
    elements.debugLogList.append(empty);
    return;
  }

  visibleEntries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `debug-log-entry is-${entry.kind}`;
    row.innerHTML = `<span class="debug-log-time">${escapeEditorHtml(entry.timestamp)}</span><span class="debug-log-kind">${escapeEditorHtml(entry.kind)}</span><span class="debug-log-message">${escapeEditorHtml(entry.message)}</span>${entry.detail ? `<span class="debug-log-detail">${escapeEditorHtml(entry.detail)}</span>` : ""}`;
    elements.debugLogList.append(row);
  });

  elements.debugLogList.scrollTop = elements.debugLogList.scrollHeight;
}

async function copyDebugLogToClipboard() {
  const text = buildDebugLogText();
  if (!text) {
    notify("There are no debug entries to copy.");
    return;
  }

  await copyTextToClipboard(text);
  notify("Debug log copied to clipboard.");
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "readonly");
  fallback.style.position = "fixed";
  fallback.style.opacity = "0";
  document.body.append(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function notify(message) {
  logDebug("response", String(message));
  showNoticeDialog(message);
}

// The server refused this client as out of date (a stale cached service worker,
// e.g. a long-lived tab). Sync has already been halted upstream; bring the app up
// to the current version by unregistering the SW — so the reload fetches fresh
// files instead of the old cache — then reloading. Guarded to run at most once per
// tab so a misconfigured minimum can't trap the tab in a reload loop.
let _appUpgradeInProgress = false;
async function forceAppUpgrade(detail) {
  if (_appUpgradeInProgress) return;
  _appUpgradeInProgress = true;
  const message = detail || "This app is out of date.";
  logDebug("response", "Upgrade required", message);
  if (sessionStorage.getItem("mdnotes.upgradeReloaded")) {
    // Already auto-refreshed once this tab and still stale — stop and ask the user,
    // rather than looping reloads.
    notify(`${message} Please fully close this tab and reopen it to finish updating.`);
    return;
  }
  try { sessionStorage.setItem("mdnotes.upgradeReloaded", "1"); } catch { /* ignore */ }
  try { showToast("Updating to the latest version…", { duration: 1500 }); } catch { /* ignore */ }
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch { /* ignore */ }
  setTimeout(() => globalThis.location.reload(), 1200);
}

// Lightweight, auto-dismissing feedback for successful actions (open/create/
// rename/…). Unlike notify(), it never blocks — important on mobile where a modal
// for every tap would be heavy. Errors should still use notify().
let toastHost = null;
function showToast(message, { duration = 2200 } = {}) {
  const text = String(message ?? "").trim();
  if (!text) return;
  toastHost = toastHost || document.getElementById("toast-host");
  if (!toastHost) return;
  const toast = document.createElement("div");
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.textContent = text;
  toastHost.append(toast);
  // Trigger the enter transition on the next frame.
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  const remove = () => {
    toast.classList.remove("is-visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    // Fallback in case the transitionend never fires.
    setTimeout(() => toast.remove(), 400);
  };
  setTimeout(remove, duration);
}

async function confirmAction(message) {
  logDebug("action", "Confirm requested", String(message));
  const result = await showConfirmDialog({ message: String(message) });
  logDebug("response", `Confirm ${result ? "accepted" : "cancelled"}`, String(message));
  return result;
}

async function promptForName(message, defaultValue = "", options = {}) {
  logDebug("action", "Prompt requested", `${message} :: ${defaultValue}`);
  const result = await showInputDialog({ title: message, message, value: defaultValue, submitLabel: "Save", ...options });
  logDebug("response", result ? `Prompt value: ${result}` : "Prompt cancelled", message);
  return result;
}

// The extension to manage for a filename ("" for folders / no extension).
function fileExtensionOf(name) {
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

function buildProjectFileSuggestions(project, activeFileId, kind = "path") {
  const activePath = activeFileId ? getPath(project, activeFileId) : "";
  return Object.values(project.nodes)
    .filter((node) => node.kind === "file")
    .filter((node) => node.id !== activeFileId)
    .filter((node) => {
      if (kind === "image") {
        return isImageFileName(node.name);
      }
      return true;
    })
    .map((node) => {
      const fullPath = getPath(project, node.id);
      return {
        fileId: node.id,
        fullPath,
        insertText: getRelativePath(activePath, fullPath),
        label: node.name,
        detail: fullPath,
        kind: isImageFileName(node.name) ? "image" : (node.name.endsWith(".md") ? "note" : "file")
      };
    })
    .sort((left, right) => left.detail.localeCompare(right.detail));
}

/** General word completion: suggest words already present in the document that
 *  share the typed prefix, ranked by frequency. Makes the popup useful beyond
 *  link/path contexts, like an editor's basic word-based IntelliSense. */
function buildWordSuggestions(text, token) {
  const prefix = token.toLowerCase();
  const counts = new Map();
  const wordPattern = /[A-Za-z][A-Za-z0-9_-]{2,}/g;
  let match;
  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    const lower = word.toLowerCase();
    if (lower === prefix || !lower.startsWith(prefix)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([word, count]) => ({
      insertText: word,
      label: word,
      detail: count > 1 ? `${count}×` : "word",
      kind: "word"
    }));
}

// ── .bmap autocomplete helpers ──────────────────────────────────────────────

/** Determine block depth and type at a given cursor position in a .bmap source. */
function findBmapBlockContext(before) {
  let depth = 0;
  let currentBlockType = null;
  const re = /\.(node|connect)\s*\{|\{|\}/g;
  let m;
  while ((m = re.exec(before)) !== null) {
    if (m[1]) {
      if (depth === 0) currentBlockType = m[1];
      depth++;
    } else if (m[0] === "{") {
      depth++;
    } else {
      depth--;
      if (depth <= 0) { depth = 0; currentBlockType = null; }
    }
  }
  return { depth, blockType: currentBlockType, inStylesBlock: depth >= 2 };
}

/** Build an autocomplete context object for .bmap files. */
function findBmapAutocompleteContext(force) {
  const value = getEditorText();
  const cursor = getEditorSelection().start;
  const before = value.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const linePrefix = before.slice(lineStart);
  const trimmedPrefix = linePrefix.trimStart();
  const { depth, blockType, inStylesBlock } = findBmapBlockContext(before);

  // Inside styles sub-block (depth >= 2)
  if (inStylesBlock) {
    const styleKvMatch = linePrefix.match(/^\s*([\w-]+)\s*:\s*(\w*)$/);
    if (styleKvMatch) {
      const key = styleKvMatch[1].toLowerCase();
      const token = styleKvMatch[2];
      if (key === "mode")   return { kind: "bmap-mode-value",   token, start: cursor - token.length, end: cursor };
      if (key === "arrow")  return { kind: "bmap-arrow-value",  token, start: cursor - token.length, end: cursor };
      if (key === "dashed") return { kind: "bmap-dashed-value", token, start: cursor - token.length, end: cursor };
    }
    const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
    if (propKeyMatch && (propKeyMatch[1] || force)) {
      const token = propKeyMatch[1];
      return { kind: "bmap-style-prop", token, start: cursor - token.length, end: cursor };
    }
    return null;
  }

  // Inside a .node or .connect block (depth === 1)
  if (depth === 1 && blockType) {
    if (blockType === "connect") {
      const sideIdxMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.side\.(\d*)$/);
      if (sideIdxMatch) {
        const token = sideIdxMatch[2];
        return { kind: "bmap-side-index", token, start: cursor - token.length, end: cursor };
      }
      const sideKeyMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.(\w*)$/);
      if (sideKeyMatch) {
        const token = sideKeyMatch[2];
        return { kind: "bmap-side-key", token, start: cursor - token.length, end: cursor };
      }
      const endpointMatch = linePrefix.match(/^\s*(from|to)\s*:\s*([A-Za-z0-9_-]*)$/);
      if (endpointMatch) {
        const token = endpointMatch[2];
        return { kind: "bmap-endpoint-node", token, start: cursor - token.length, end: cursor };
      }
    }
    const shapeMatch = linePrefix.match(/^\s*shape\s*:\s*(\w*)$/);
    if (shapeMatch) {
      const token = shapeMatch[1];
      return { kind: "bmap-shape-value", token, start: cursor - token.length, end: cursor };
    }
    if (blockType === "node") {
      const fileMatch = linePrefix.match(/^\s*file\s*:\s*(.*)$/);
      if (fileMatch) {
        const token = fileMatch[1];
        return { kind: "bmap-file-value", token, start: cursor - token.length, end: cursor };
      }
    }
    const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
    if (propKeyMatch && (propKeyMatch[1] || force)) {
      const token = propKeyMatch[1];
      const kind = blockType === "node" ? "bmap-node-prop" : "bmap-connect-prop";
      return { kind, token, start: cursor - token.length, end: cursor };
    }
    return null;
  }

  // Top level (depth === 0): suggest block types after a leading "."
  if (depth === 0) {
    const blockTypeMatch = linePrefix.match(/^\s*\.(\w*)$/);
    if (blockTypeMatch) {
      const token = blockTypeMatch[1];
      return { kind: "bmap-block-type", token, start: cursor - token.length, end: cursor };
    }
    if (force && !trimmedPrefix) {
      return { kind: "bmap-block-type", token: "", start: cursor, end: cursor };
    }
  }

  return null;
}

const BMAP_AUTOCOMPLETE_LABELS = {
  "bmap-block-type":    "Block type",
  "bmap-node-prop":     "Node properties",
  "bmap-connect-prop":  "Connect properties",
  "bmap-style-prop":    "Style properties",
  "bmap-shape-value":   "Shape",
  "bmap-mode-value":    "Connector mode",
  "bmap-arrow-value":   "Arrow style",
  "bmap-dashed-value":  "Dashed line",
  "bmap-side-key":      "Side segment",
  "bmap-side-index":    "Side — 0 top · 1 right · 2 bottom · 3 left",
  "bmap-endpoint-node": "Node ID",
  "bmap-file-value":    "Project files",
};

function getBmapAutocompleteItems(context, project, activeFile) {
  const token = context.token.toLowerCase();
  const filter = (items) =>
    items.filter((item) => !token || item.label.toLowerCase().startsWith(token) || item.insertText.toLowerCase().startsWith(token));

  switch (context.kind) {
    case "bmap-block-type":
      return filter([
        { label: "node",    detail: "Diagram node — id, name, pos, shape, file, styles", insertText: "node {\n  id: \n  name: \n  pos: {x: 0, y: 0}\n}" },
        { label: "connect", detail: "Connector between two nodes",                        insertText: "connect {\n  from: .side.1\n  to: .side.3\n}" },
      ]);

    case "bmap-node-prop":
      return filter([
        { label: "id:",     detail: "Unique node identifier",                        insertText: "id: " },
        { label: "name:",   detail: "Display label shown in the node header",        insertText: "name: " },
        { label: "text:",   detail: "Secondary description text in the node body",   insertText: "text: " },
        { label: "shape:",  detail: "Node shape: rect or circle",                    insertText: "shape: " },
        { label: "pos:",    detail: "Position as {x: N, y: N}",                      insertText: "pos: {x: 0, y: 0}" },
        { label: "file:",   detail: "Link to a project file (shown via ⊞ preview)", insertText: "file: " },
        { label: "styles:", detail: "CSS style overrides block",                     insertText: "styles: {\n  \n}" },
      ]);

    case "bmap-connect-prop":
      return filter([
        { label: "from:",   detail: "Source endpoint — nodeId.side.N", insertText: "from: " },
        { label: "to:",     detail: "Target endpoint — nodeId.side.N", insertText: "to: " },
        { label: "styles:", detail: "Connector appearance block",       insertText: "styles: {\n  \n}" },
      ]);

    case "bmap-style-prop":
      return filter([
        { label: "background:",   detail: "Fill color, e.g. #fff8dc",           insertText: "background: " },
        { label: "border:",       detail: "Border shorthand, e.g. 1px solid #aaa", insertText: "border: " },
        { label: "border-radius:", detail: "Corner radius",                      insertText: "border-radius: " },
        { label: "color:",        detail: "Text or stroke color",                insertText: "color: " },
        { label: "font-size:",    detail: "Font size, e.g. 12px",               insertText: "font-size: " },
        { label: "font-weight:",  detail: "Font weight: bold or normal",        insertText: "font-weight: " },
        { label: "width:",        detail: "Node width in px",                   insertText: "width: " },
        { label: "opacity:",      detail: "Opacity 0–1",                        insertText: "opacity: " },
        { label: "mode:",         detail: "bezier or straight",                 insertText: "mode: " },
        { label: "arrow:",        detail: "end, start, both, or none",          insertText: "arrow: " },
        { label: "dashed:",       detail: "true or false",                      insertText: "dashed: " },
        { label: "thickness:",    detail: "Stroke width in px",                 insertText: "thickness: " },
      ]);

    case "bmap-shape-value":
      return filter([
        { label: "rect",   detail: "Rounded rectangle (default)", insertText: "rect" },
        { label: "circle", detail: "Circle / oval",               insertText: "circle" },
      ]);

    case "bmap-mode-value":
      return filter([
        { label: "bezier",   detail: "Curved connector (default)", insertText: "bezier" },
        { label: "straight", detail: "Straight line connector",    insertText: "straight" },
      ]);

    case "bmap-arrow-value":
      return filter([
        { label: "end",   detail: "Arrow at destination (default)", insertText: "end" },
        { label: "start", detail: "Arrow at source",                insertText: "start" },
        { label: "both",  detail: "Arrows at both ends",            insertText: "both" },
        { label: "none",  detail: "No arrowheads",                  insertText: "none" },
      ]);

    case "bmap-dashed-value":
      return filter([
        { label: "false", detail: "Solid line (default)", insertText: "false" },
        { label: "true",  detail: "Dashed line",          insertText: "true" },
      ]);

    case "bmap-side-key":
      return [{ label: "side", detail: "Side segment — follow with .N (0=top 1=right 2=bottom 3=left)", insertText: "side" }];

    case "bmap-side-index":
      return filter([
        { label: "0", detail: "Top",    insertText: "0" },
        { label: "1", detail: "Right",  insertText: "1" },
        { label: "2", detail: "Bottom", insertText: "2" },
        { label: "3", detail: "Left",   insertText: "3" },
      ]);

    case "bmap-endpoint-node": {
      const content = activeFile?.content ?? "";
      const nodeIds = [...content.matchAll(/^\s*id\s*:\s*(\S+)/gm)].map((nm) => nm[1]);
      return filter(nodeIds.map((id) => ({
        label: id,
        detail: "Node ID — follow with .side.N",
        insertText: id,
      })));
    }

    case "bmap-file-value":
      return buildProjectFileSuggestions(project, activeFile?.id ?? null, "path")
        .filter((item) => !token || item.insertText.toLowerCase().includes(token) || item.label.toLowerCase().includes(token));

    default:
      return [];
  }
}

// ── end .bmap autocomplete helpers ──────────────────────────────────────────

function findAutocompleteContext(force = false) {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    return null;
  }
  if (isBmapFileName(activeFile.name)) {
    return findBmapAutocompleteContext(force);
  }

  const value = getEditorText();
  const cursor = getEditorSelection().start;
  const before = value.slice(0, cursor);
  const lineStart = before.lastIndexOf("\n") + 1;
  const linePrefix = before.slice(lineStart);

  if (isMarkdownFileName(activeFile.name)) {
    const imageMatch = linePrefix.match(/!\[[^\]]*\]\(([^)]*)$/);
    if (imageMatch) {
      const token = imageMatch[1];
      return {
        kind: "image",
        token,
        start: cursor - token.length,
        end: cursor
      };
    }

    const linkMatch = linePrefix.match(/\[[^\]]*\]\(([^)]*)$/);
    if (linkMatch) {
      const token = linkMatch[1];
      return {
        kind: "path",
        token,
        start: cursor - token.length,
        end: cursor
      };
    }
  }

  const genericMatch = linePrefix.match(/([./A-Za-z0-9_-][./A-Za-z0-9_\-/]*)$/);
  if (genericMatch && (force || genericMatch[1].includes("/") || genericMatch[1].startsWith("."))) {
    const token = genericMatch[1];
    return {
      kind: "path",
      token,
      start: cursor - token.length,
      end: cursor
    };
  }

  // General word completion: trigger automatically once a plain word reaches a
  // few characters, so the popup is useful for prose, not just links/paths.
  const wordMatch = linePrefix.match(/([A-Za-z][A-Za-z0-9_-]*)$/);
  if (wordMatch && (force || wordMatch[1].length >= 3)) {
    const token = wordMatch[1];
    return {
      kind: "word",
      token,
      start: cursor - token.length,
      end: cursor
    };
  }

  if (!force) {
    return null;
  }

  return {
    kind: "path",
    token: "",
    start: cursor,
    end: cursor
  };
}

function hideEditorAutocomplete() {
  autocompleteState.items = [];
  autocompleteState.activeIndex = 0;
  autocompleteState.userChose = false;
  autocompleteState.range = null;
  autocompleteState.kind = "";
  elements.editorAutocomplete.hidden = true;
  elements.editorAutocompleteList.replaceChildren();
}

function renderEditorAutocomplete() {
  elements.editorAutocompleteList.replaceChildren();

  autocompleteState.items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `editor-autocomplete-item${index === autocompleteState.activeIndex ? " is-active" : ""}`;
    button.innerHTML = `<span class="editor-autocomplete-item-title">${escapeEditorHtml(item.label)}</span><span class="editor-autocomplete-item-detail">${escapeEditorHtml(item.detail)}</span>`;
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      acceptEditorAutocomplete(index);
    });
    elements.editorAutocompleteList.append(button);
  });

  elements.editorAutocomplete.hidden = autocompleteState.items.length === 0;
  if (!elements.editorAutocomplete.hidden) {
    positionEditorAutocompleteAtCaret();
    // Keep the active row scrolled into view during keyboard navigation.
    elements.editorAutocompleteList
      .querySelector(".editor-autocomplete-item.is-active")
      ?.scrollIntoView({ block: "nearest" });
  }
}

/** Anchor the completion popup directly under the text caret (VSCode-style),
 *  flipping above the caret when it would overflow the editor surface. */
function positionEditorAutocompleteAtCaret() {
  const surface = elements.editorContent.closest(".editor-surface");
  if (!surface) return;

  const selection = globalThis.getSelection?.();
  let caretRect = null;
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length > 0) {
      caretRect = rects[0];
    } else {
      const bounding = range.getBoundingClientRect();
      if (bounding && (bounding.width || bounding.height || bounding.top)) {
        caretRect = bounding;
      }
    }
    if (!caretRect) {
      // Collapsed caret on an empty line yields no rect — fall back to the line.
      const anchor = selection.anchorNode;
      const anchorEl = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
      const lineEl = anchorEl?.closest?.(".editor-line");
      if (lineEl) caretRect = lineEl.getBoundingClientRect();
    }
  }
  if (!caretRect) return;

  const base = surface.getBoundingClientRect();
  const popup = elements.editorAutocomplete;
  const left = Math.max(0, Math.min(caretRect.left - base.left, base.width - popup.offsetWidth - 4));
  popup.style.bottom = "auto";
  popup.style.left = `${left}px`;
  popup.style.top = `${caretRect.bottom - base.top + 2}px`;

  // Flip above the caret if the popup would spill below the editor surface.
  const popupHeight = popup.offsetHeight;
  const caretTop = caretRect.top - base.top;
  if (caretRect.bottom - base.top + 2 + popupHeight > base.height && caretTop > popupHeight) {
    popup.style.top = `${caretTop - popupHeight - 2}px`;
  }
}

function showEditorAutocomplete(force = false) {
  const context = findAutocompleteContext(force);
  if (!context) {
    hideEditorAutocomplete();
    return;
  }

  const activeFile = controller.getActiveFile();
  const project = controller.getProject();
  const tokenLower = context.token.toLowerCase();

  let items;
  if (context.kind.startsWith("bmap-")) {
    items = getBmapAutocompleteItems(context, project, activeFile);
  } else if (context.kind === "word") {
    items = buildWordSuggestions(getEditorText(), context.token);
  } else {
    items = buildProjectFileSuggestions(project, activeFile?.id ?? null, context.kind)
      .filter((item) => !tokenLower || item.insertText.toLowerCase().includes(tokenLower) || item.detail.toLowerCase().includes(tokenLower));
  }

  if (items.length === 0) {
    hideEditorAutocomplete();
    return;
  }

  autocompleteState.items = items.slice(0, 12);
  autocompleteState.activeIndex = 0;
  autocompleteState.userChose = false;
  autocompleteState.range = { start: context.start, end: context.end };
  autocompleteState.kind = context.kind;
  elements.editorAutocompleteLabel.textContent = context.kind.startsWith("bmap-")
    ? (BMAP_AUTOCOMPLETE_LABELS[context.kind] ?? "bmap")
    : context.kind === "image" ? "Image paths" : "Project paths";
  renderEditorAutocomplete();
}

// ---------------------------------------------------------------------------
// Contenteditable editor core API
// ---------------------------------------------------------------------------

/** Return the plain-text content of the editor by reading each logical-line
 *  div's textContent and joining with newlines. */
// A "line" is any direct element child of #editor-content. Normally these are
// all .editor-line (renderEditorContent only makes those), but a mobile keyboard
// / autocorrect / swipe edit can transiently insert a plain <div>; treating those
// as lines too keeps text from being dropped and offsets from collapsing to 0.
function editorLineEls() {
  // .children, not querySelectorAll(":scope > *"): the selector form walks every
  // DESCENDANT (~18k nodes in a long chapter) to find the direct children, and
  // this runs several times per keystroke. Same elements, same order.
  return Array.from(elements.editorContent.children);
}

// ── Editor DOM change tracking ──────────────────────────────────────────────
// A MutationObserver records which lines changed behind our back (native typing,
// IME, mobile keyboards) since the last render. takeRecords() makes it exact and
// synchronous: nothing has to wait for the observer's callback.
function trackEditorDom() {
  const tracker = editorDomTracker;
  if (!tracker.observer) {
    tracker.observer = new MutationObserver(noteEditorMutations);
    tracker.observer.observe(elements.editorContent, { childList: true, subtree: true, characterData: true });
    tracker.structural = true; // nothing is known until the next render syncs it
    tracker.text = null;
  }
  noteEditorMutations(tracker.observer.takeRecords());
  return tracker;
}

function noteEditorMutations(records) {
  if (!records.length) return;
  const tracker = editorDomTracker;
  const root = elements.editorContent;
  tracker.text = null;
  for (const record of records) {
    if (record.target === root) { tracker.structural = true; continue; }
    let node = record.target;
    while (node && node.parentNode !== root) node = node.parentNode;
    if (node) tracker.dirty.add(node);
    else tracker.structural = true; // detached by now: assume the worst
  }
}

// After a render we fully control, the DOM matches the cache exactly. `text` is
// what getEditorText() would now return, or null if that isn't known.
function markEditorDomSynced(text) {
  const tracker = trackEditorDom();
  tracker.observer.takeRecords(); // our own mutations
  tracker.dirty.clear();
  tracker.structural = false;
  tracker.text = text;
}

// Index of a line element if every line before it is unchanged since the last
// render (so the cache's text lengths are exact for them), else -1.
function cleanLineIndex(lineEl) {
  const tracker = trackEditorDom();
  const cache = editorRenderCache;
  const kids = elements.editorContent.children;
  if (tracker.structural || !lineEl || kids.length !== cache.els.length) return -1;
  const index = Array.prototype.indexOf.call(kids, lineEl);
  if (index < 0 || cache.els[index] !== lineEl) return -1;
  for (const dirty of tracker.dirty) {
    const at = Array.prototype.indexOf.call(kids, dirty);
    if (at < 0 || at < index) return -1;
  }
  return index;
}

function getEditorText() {
  const tracker = trackEditorDom();
  if (tracker.text !== null) return tracker.text;
  const lines = elements.editorContent.children;
  if (lines.length === 0) {
    tracker.text = "";
    return "";
  }
  const parts = new Array(lines.length);
  for (let i = 0; i < lines.length; i += 1) parts[i] = lines[i].textContent;
  tracker.text = parts.join("\n");
  return tracker.text;
}

/** Walk text nodes inside `root` counting characters until `targetOffset` is
 *  reached, then return the hosting DOM node + in-node offset. */
function findTextNodeAt(root, targetOffset) {
  if (root.nodeType === Node.TEXT_NODE) {
    return { node: root, offset: Math.min(targetOffset, root.textContent.length) };
  }
  let consumed = 0;
  for (const child of root.childNodes) {
    // A <br> in an empty line represents zero characters but IS a valid cursor
    // position.  If we're right at that spot, position before the <br>.
    if (child.nodeName === "BR") {
      if (targetOffset === consumed) {
        return { node: root, offset: Array.from(root.childNodes).indexOf(child) };
      }
      continue;
    }
    const childLen = child.textContent.length;
    if (consumed + childLen >= targetOffset) {
      return findTextNodeAt(child, targetOffset - consumed);
    }
    consumed += childLen;
  }
  return { node: root, offset: root.childNodes.length };
}

/** Convert an integer plain-text offset to a { node, offset } DOM position
 *  inside the contenteditable. */
function textOffsetToDomPosition(textOffset) {
  // Fast path: nothing changed since the last render, so the cache's line
  // lengths are exact and no line's textContent needs reading.
  const tracker = trackEditorDom();
  const cache = editorRenderCache;
  const kids = elements.editorContent.children;
  if (!tracker.structural && tracker.dirty.size === 0 && kids.length > 0 && kids.length === cache.els.length) {
    let remaining = textOffset;
    for (let i = 0; i < kids.length; i += 1) {
      const line = kids[i];
      const lineLen = cache.texts[i].length;
      if (remaining <= lineLen) return findTextNodeAt(line, remaining);
      remaining -= lineLen + 1;
      if (remaining < 0) return { node: line, offset: line.childNodes.length };
    }
    const last = kids[kids.length - 1];
    return { node: last, offset: last.childNodes.length };
  }
  const lineEls = editorLineEls();
  let remaining = textOffset;
  for (const line of lineEls) {
    const lineLen = line.textContent.length;
    if (remaining <= lineLen) {
      return findTextNodeAt(line, remaining);
    }
    remaining -= lineLen + 1; // +1 for the newline between lines
    if (remaining < 0) {
      // Offset landed exactly on a newline separator — position at end of the
      // previous line.
      return { node: line, offset: line.childNodes.length };
    }
  }
  // Past all content — position at end of last line.
  const last = lineEls[lineEls.length - 1];
  if (last) return { node: last, offset: last.childNodes.length };
  return { node: elements.editorContent, offset: elements.editorContent.childNodes.length };
}

/** Convert a DOM (container, domOffset) position to an integer plain-text
 *  offset relative to the start of the editor content. */
function domPositionToTextOffset(container, domOffset) {
  // A selection boundary can BE the editor root itself: Ctrl+A commonly makes
  // both endpoints the root (#editor-content) with a child index. Summing the
  // preceding lines' text here is essential — without it the offset collapsed to
  // 0, so getEditorSelection() reported an empty selection and Ctrl+A + paste
  // inserted at the top WITHOUT removing the selection (the "everything mixed up"
  // corruption).
  if (container === elements.editorContent) {
    const kids = Array.from(elements.editorContent.childNodes);
    const count = kids.length;
    const limit = Math.min(Math.max(0, domOffset), count);
    let offset = 0;
    for (let i = 0; i < limit; i += 1) {
      offset += kids[i].textContent?.length ?? 0;
      if (i < count - 1) offset += 1; // newline between lines (none after the last)
    }
    return offset;
  }

  // Walk up to the direct child of #editor-content that hosts this position.
  let lineEl = container;
  while (lineEl && lineEl.parentNode !== elements.editorContent) {
    lineEl = lineEl.parentNode;
  }

  // Fast path: lines before the caret are unchanged since the last render.
  const cleanIndex = cleanLineIndex(lineEl);
  if (cleanIndex >= 0) {
    const texts = editorRenderCache.texts;
    let offset = 0;
    for (let i = 0; i < cleanIndex; i += 1) offset += texts[i].length + 1;
    return offset + getOffsetWithinTextRoot(lineEl, container, domOffset);
  }

  const lineEls = editorLineEls();
  const lineIndex = lineEl ? lineEls.indexOf(lineEl) : -1;
  if (lineIndex < 0) {
    // The caret sits in a node that is a DIRECT child of the editor but not an
    // element we indexed (e.g. a bare text node the browser left, common on
    // mobile). Count characters up to it via raw child nodes so we never
    // collapse the caret to offset 0 (the historic caret-jump-to-top bug).
    const kids = Array.from(elements.editorContent.childNodes);
    let node = container;
    while (node && node.parentNode !== elements.editorContent) node = node.parentNode;
    const idx = node ? kids.indexOf(node) : -1;
    if (idx < 0) return 0;
    let offset = 0;
    for (let i = 0; i < idx; i += 1) offset += (kids[i].textContent?.length ?? 0) + 1;
    return offset + getOffsetWithinTextRoot(node, container, domOffset);
  }

  // Characters contributed by all preceding lines + their newlines.
  let offset = 0;
  for (let i = 0; i < lineIndex; i += 1) {
    offset += lineEls[i].textContent.length + 1;
  }
  // Then the in-line character offset using the existing tree-walker helper.
  offset += getOffsetWithinTextRoot(lineEl, container, domOffset);
  return offset;
}

/** Return the current editor selection as integer plain-text {start, end}. */
function getEditorSelection() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  if (!elements.editorContent.contains(range.startContainer)) return { start: 0, end: 0 };
  const start = domPositionToTextOffset(range.startContainer, range.startOffset);
  const end = range.collapsed
    ? start
    : domPositionToTextOffset(range.endContainer, range.endOffset);
  return { start, end };
}

/** Move the browser selection to cover [start, end] in the editor plain text. */
function setEditorSelection(start, end) {
  if (!elements.editorContent.isConnected) return;
  // Only ever move the caret when the editor is the focused element. Adding a
  // Range inside a contenteditable otherwise *steals* focus into it (and lands
  // the caret at offset 0). That bites preview-driven updates: e.g. committing a
  // paste in the .bmap preview re-renders the source here, and without this guard
  // focus would jump to the editor with the caret on the leading "." of the first
  // ".node{}" — so the next Delete would eat that "." and break the file grammar.
  // Every legitimate caller (typing, IME, toolbar, drag) focuses the editor first.
  if (document.activeElement !== elements.editorContent) {
    logDebug("response", "caret", `setEditorSelection SKIPPED (editor not focused; active=${document.activeElement?.id || document.activeElement?.tagName || "none"}) → caret left at DOM default`);
    return;
  }
  try {
    const startPos = textOffsetToDomPosition(start);
    const endPos = start === end ? startPos : textOffsetToDomPosition(end);
    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    // Ignore rare out-of-bound errors (e.g. during rapid file switches).
  }
}

/** Re-render the syntax-highlighted DOM from plain text, then restore the
 *  given selection.  All programmatic edits go through this. */
function applyEditorRender(text, selStart, selEnd) {
  _editorUpdating = true;
  try {
    // renderEditorContent replaces innerHTML, which resets scrollTop to 0. Save
    // and restore it so an in-place edit (e.g. backspacing one char mid-document)
    // doesn't jump the view. caretIntoView() below then only nudges the scroll
    // when the edit actually pushed the caret out of the viewport.
    const savedScroll = elements.editorContent.scrollTop;
    renderEditorContent(text);
    // Setting innerHTML can cause the contenteditable to lose focus in some
    // browsers.  Restore focus explicitly so that the subsequent
    // notifyEditorChanged → updateStatus call still sees the editor as the
    // active element and does not reset the cursor via loadEditorContent.
    if (document.activeElement !== elements.editorContent) {
      elements.editorContent.focus({ preventScroll: true });
    }
    setEditorSelection(selStart, selEnd);
    rememberEditorSelection();
    // Diagnostic: verify the caret actually landed where we asked. When it
    // doesn't (the "jump to line 1 / offset 0" bug), capture WHY — the resolved
    // DOM position, the DOM text length vs the model, and the line count — so we
    // can tell a textOffsetToDomPosition miscalc from a model/DOM drift.
    const _after = getEditorSelection();
    if (_after.start !== selStart || _after.end !== selEnd) {
      const _pos = textOffsetToDomPosition(selStart);
      const _domLen = getEditorText().length;
      logDebug("response", "caret",
        `IMMEDIATE miss: wanted ${selStart}-${selEnd} landed ${_after.start}-${_after.end}; `
        + `modelLen=${text.length} domLen=${_domLen} lines=${editorLineEls().length} `
        + `resolved=${_pos.node?.nodeName || "?"}@${_pos.offset} active=${document.activeElement?.id || document.activeElement?.tagName}`);
    } else if (selStart > 0) {
      // Placement was correct — watch briefly for an ASYNC reset to 0 (e.g. a
      // sync-confirmation render landing a beat later).
      setTimeout(() => {
        if (document.activeElement !== elements.editorContent) return;
        const now = getEditorSelection();
        if (now.start === 0 && now.end === 0) {
          logDebug("response", "caret", `ASYNC reset: caret was ${selStart}, now 0 (~60ms after edit); domLen=${getEditorText().length} lines=${editorLineEls().length}`);
        }
      }, 60);
    }
    elements.editorContent.scrollTop = savedScroll;
    syncEditorScroll();
    caretIntoView();
  } finally {
    _editorUpdating = false;
  }
}

/** Push a history snapshot.  Call at logical "checkpoints" (space, enter,
 *  punctuation, paste, indent, drag-drop). */
// The single changed span between two texts: common prefix and suffix trimmed.
function diffEditorTexts(before, after) {
  const max = Math.min(before.length, after.length);
  let at = 0;
  while (at < max && before.charCodeAt(at) === after.charCodeAt(at)) at += 1;
  let tail = 0;
  while (tail < max - at
    && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) {
    tail += 1;
  }
  return {
    at,
    removed: before.slice(at, before.length - tail),
    inserted: after.slice(at, after.length - tail)
  };
}

function pushEditorHistoryState(text, start, end) {
  // Trim any forward (redo) entries once a new branch starts.
  editorHistory.stack.splice(editorHistory.index + 1);
  const last = editorHistory.stack[editorHistory.index];
  if (last && editorHistory.text === text && last.start === start && last.end === end) {
    return;
  }
  const patch = last ? diffEditorTexts(editorHistory.text, text) : null;
  editorHistory.stack.push({ start, end, patch });
  editorHistory.text = text;
  if (editorHistory.stack.length > editorHistory.maxSize) {
    editorHistory.stack.shift();
    editorHistory.stack[0].patch = null; // nothing older to undo into
  }
  editorHistory.index = editorHistory.stack.length - 1;
}

function clampEditorSelection(text, start, end = start) {
  const limit = text.length;
  const nextStart = Math.max(0, Math.min(start, limit));
  const nextEnd = Math.max(nextStart, Math.min(end, limit));
  return { start: nextStart, end: nextEnd };
}

function resetEditorHistory(text, start = 0, end = start) {
  const selection = clampEditorSelection(text, start, end);
  editorHistory.stack = [{ start: selection.start, end: selection.end, patch: null }];
  editorHistory.index = 0;
  editorHistory.text = text;
  return selection;
}

function transformEditorOffset(offset, appliedStart, appliedEnd, insertedLength) {
  if (offset <= appliedStart) return offset;
  if (offset <= appliedEnd) return appliedStart + insertedLength;
  return offset + insertedLength - (appliedEnd - appliedStart);
}

function transformEditorSelection(selection, appliedStart, appliedEnd, insertedLength) {
  return {
    start: transformEditorOffset(selection.start, appliedStart, appliedEnd, insertedLength),
    end: transformEditorOffset(selection.end, appliedStart, appliedEnd, insertedLength)
  };
}

function queueExternalEditorSelection(fileId, selection) {
  pendingExternalEditorSelection = { fileId, start: selection.start, end: selection.end };
}

function consumeExternalEditorSelection(fileId, text, fallbackStart, fallbackEnd = fallbackStart) {
  const selection = pendingExternalEditorSelection?.fileId === fileId
    ? pendingExternalEditorSelection
    : { start: fallbackStart, end: fallbackEnd };
  pendingExternalEditorSelection = null;
  return clampEditorSelection(text, selection.start, selection.end);
}

function pushEditorHistoryCheckpoint() {
  const text = getEditorText();
  const { start, end } = getEditorSelection();
  pushEditorHistoryState(text, start, end);
}

function editorUndo() {
  if (editorHistory.index <= 0) return;
  traceEditorEvent("Undo requested");
  // Reverse this entry's patch to get the previous text.
  const { patch } = editorHistory.stack[editorHistory.index];
  const current = editorHistory.text;
  const text = current.slice(0, patch.at) + patch.removed + current.slice(patch.at + patch.inserted.length);
  editorHistory.index -= 1;
  editorHistory.text = text;
  const state = editorHistory.stack[editorHistory.index];
  applyEditorRender(text, state.start, state.end);
  notifyEditorChanged(text);
  traceEditorEvent("Undo applied", { restored: `${state.start}-${state.end}` });
}

function editorRedo() {
  if (editorHistory.index >= editorHistory.stack.length - 1) return;
  traceEditorEvent("Redo requested");
  editorHistory.index += 1;
  const state = editorHistory.stack[editorHistory.index];
  // Replay the next entry's patch.
  const { patch } = state;
  const current = editorHistory.text;
  const text = current.slice(0, patch.at) + patch.inserted + current.slice(patch.at + patch.removed.length);
  editorHistory.text = text;
  applyEditorRender(text, state.start, state.end);
  notifyEditorChanged(text);
  traceEditorEvent("Redo applied", { restored: `${state.start}-${state.end}` });
}

/** Apply a programmatic text change (autocomplete, indent, drag-drop, etc.)
 *  Pushes a history checkpoint, performs the edit, and fires the content
 *  update callback so the domain model stays in sync. */
function applyEditorEdit(newText, newStart, newEnd) {
  pushEditorHistoryCheckpoint(); // snapshot BEFORE the edit
  applyEditorRender(newText, newStart, newEnd);
  pushEditorHistoryState(newText, newStart, newEnd); // snapshot AFTER the edit
  notifyEditorChanged(newText);
}

/** Load a file's content into the editor, resetting undo history.
 *  Does NOT notify the domain model — used exclusively by updateStatus
 *  when the active file changes so we don't trigger a render feedback loop. */
function loadEditorContent(text, start = 0, end = start) {
  const selection = resetEditorHistory(text, start, end);
  pendingExternalEditorSelection = null;
  hideEditorAutocomplete();
  renderEditorContent(text);
  setEditorSelection(selection.start, selection.end);
}

/** Convenience: replace a [start, end) range in the current editor text. */
function replaceEditorRange(start, end, insertText, nextStart = null, nextEnd = null) {
  const value = getEditorText();
  const newText = `${value.slice(0, start)}${insertText}${value.slice(end)}`;
  const defaultCursor = start + insertText.length;
  applyEditorEdit(newText, nextStart ?? defaultCursor, nextEnd ?? (nextStart ?? defaultCursor));
}

/** Notify the domain model that the editor content changed.
 *  Split from the render path so collaboration can be wired here later
 *  without touching the rendering logic. */
function notifyEditorChanged(text) {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) return;
  const selectedEntry = getSelectedUrlDbEntry(controller.getProject());
  let nextContent = text;
  if (selectedEntry) {
    const parsed = parseUrlDbEntryBody(text);
    nextContent = updateUrlDbEntry(activeFile.content, selectedEntry.entry.id, parsed);
  }
  // The editor DOM already shows this text (every caller renders or reads it
  // first), so the app-wide render this triggers can catch up a moment later
  // instead of running synchronously inside the keystroke. See render().
  typingUpdate = true;
  try {
    controller.updateContent(activeFile.id, nextContent);
  } finally {
    typingUpdate = false;
  }
  if (collaboration.isConnected() && workspaceMode === "synced") {
    collaboration.scheduleTextPatch(getPath(controller.getProject(), activeFile.id), activeFile.content, nextContent);
  }
  // Keep find matches/highlights accurate as the text changes underneath them.
  if (searchState.open) computeSearchMatches();
  // Line comments follow the text: re-find any whose line moved.
  scheduleCommentReanchor();
}

// Stable palette for coloring remote cursor lines + labels by client index.
const CURSOR_COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

function clientColor(clientId) {
  let hash = 0;
  for (let i = 0; i < clientId.length; i++) {
    hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
  }
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

/** Render remote peer cursor overlays inside #editor-cursors.
 *  `cursors` is an array of { clientId, displayName, fileId, selStart, selEnd }.
 *  Only cursors for the currently active file are shown.
 *  When selEnd > selStart a per-line selection highlight is drawn in addition
 *  to the caret so peers can see highlighted text. */
function renderRemoteCursors(cursors) {
  scheduleOverviewRuler(); // peer markers live on the ruler too
  const activeFile = controller.getActiveFile();
  const container = elements.editorCursors;
  container.textContent = "";
  if (!activeFile) return;

  // Match peers by PATH, not node id: the server generates its own node ids on
  // create-file/-folder, so the creating client and everyone else hold DIFFERENT
  // ids for the same file. Paths are stable across sessions (content sync already
  // uses them), so a path match is what actually lines cursors up.
  const activePath = getPath(controller.getProject(), activeFile.id);
  const scrollEl = elements.editorScroll;
  const scrollRect = elements.editorScroll.getBoundingClientRect();

  for (const cursor of cursors) {
    if (cursor.fileId !== activePath) continue;
    const color = clientColor(cursor.clientId);
    const selStart = Number(cursor.selStart);
    const selEnd = Number(cursor.selEnd);
    const hasSelection = selEnd > selStart;

    try {
      // --- Draw selection highlight (one rect per visual line) ---
      if (hasSelection) {
        const startPos = textOffsetToDomPosition(selStart);
        const endPos = textOffsetToDomPosition(selEnd);
        const selRange = document.createRange();
        selRange.setStart(startPos.node, startPos.offset);
        selRange.setEnd(endPos.node, endPos.offset);
        // getClientRects() on a range spanning block-level .editor-line divs
        // returns BOTH the block line-box and the inline text-box for the same
        // span. Drawing both (each at opacity 0.25) stacks into a visibly doubled
        // highlight. Keep the tighter rects and drop any that substantially
        // overlap one already kept — a genuine multi-line selection has one
        // non-overlapping rect per line.
        const rawRects = Array.from(selRange.getClientRects())
          .filter((r) => r.width > 0 && r.height > 0)
          .sort((a, b) => a.width * a.height - b.width * b.height); // tighter first
        const keptRects = [];
        for (const rect of rawRects) {
          const overlapsKept = keptRects.some((k) => {
            const ix = Math.min(k.right, rect.right) - Math.max(k.left, rect.left);
            const iy = Math.min(k.bottom, rect.bottom) - Math.max(k.top, rect.top);
            if (ix <= 0 || iy <= 0) return false;
            const minArea = Math.min(k.width * k.height, rect.width * rect.height) || 1;
            return ix * iy > 0.5 * minArea;
          });
          if (overlapsKept) continue;
          keptRects.push(rect);
          // An empty line yields the full-width block box (no inline text box).
          // The source shows the native empty-line selection as a small sliver —
          // match it by clamping to a space width when the line has no content.
          let width = rect.width;
          const probe = document.elementFromPoint(rect.left + 2, (rect.top + rect.bottom) / 2);
          const probeLine = probe?.closest?.(".editor-line");
          if (probeLine && (probeLine.textContent ?? "").length === 0) {
            width = getEditorSpaceWidth();
          }
          const highlightEl = document.createElement("div");
          highlightEl.className = "remote-selection";
          highlightEl.style.top = `${rect.top - scrollRect.top + scrollEl.scrollTop}px`;
          highlightEl.style.left = `${rect.left - scrollRect.left + scrollEl.scrollLeft}px`;
          highlightEl.style.width = `${width}px`;
          highlightEl.style.height = `${rect.height}px`;
          highlightEl.style.background = color;
          container.appendChild(highlightEl);
        }
      }

      // --- Draw caret at the end (anchor) of the selection ---
      const caretOffset = selEnd;
      const pos = textOffsetToDomPosition(caretOffset);
      const anchorRange = document.createRange();
      anchorRange.setStart(pos.node, pos.offset);
      anchorRange.collapse(true);
      // A collapsed range's getBoundingClientRect() is EMPTY (all zeros) at a line
      // start / empty line in Chrome — which planted the caret off-screen at
      // negative coords, so no remote caret was ever visible. Prefer getClientRects
      // and fall back to the hosting line box.
      let rect = anchorRange.getClientRects()[0] || anchorRange.getBoundingClientRect();
      if (!rect || (!rect.height && !rect.width && !rect.top && !rect.left)) {
        const anchorEl = pos.node.nodeType === Node.ELEMENT_NODE ? pos.node : pos.node.parentElement;
        const lineEl = anchorEl?.closest?.(".editor-line");
        if (lineEl) rect = lineEl.getBoundingClientRect();
      }
      if (!rect) continue;

      const top = rect.top - scrollRect.top + scrollEl.scrollTop;
      const left = rect.left - scrollRect.left + scrollEl.scrollLeft;
      const height = rect.height || getEditorLineHeight();

      const cursorEl = document.createElement("div");
      cursorEl.className = "remote-cursor";
      cursorEl.style.top = `${top}px`;
      cursorEl.style.left = `${left}px`;
      cursorEl.style.height = `${height}px`;
      cursorEl.style.background = color;

      const label = document.createElement("div");
      label.className = "remote-cursor-label";
      label.style.background = color;
      label.textContent = cursor.displayName || cursor.clientId;
      cursorEl.appendChild(label);

      container.appendChild(cursorEl);
    } catch (err) {
      // Surface (throttled) instead of silently swallowing — this is how a
      // remote caret can vanish without a trace.
      logCursorDebug(`caret render error: ${err?.message || err}`);
    }
  }
}

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

// Build the RegExp for the current query + toggles, or null on empty/invalid.
function buildSearchRegex() {
  const raw = elements.findInput?.value ?? "";
  if (!raw) return null;
  let source = searchState.regex ? raw : raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (searchState.wholeWord) source = `\\b(?:${source})\\b`;
  const flags = "g" + (searchState.caseSensitive ? "" : "i");
  try {
    return new RegExp(source, flags);
  } catch {
    return null; // invalid regex — caller shows the error state
  }
}

// Scan the active file's text for all matches. Preserves the current match near
// the caret when possible so re-computing (e.g. after an edit) doesn't jump.
function computeSearchMatches({ keepCaret = false } = {}) {
  const activeFile = controller.getActiveFile();
  const canSearch = Boolean(activeFile && isTextFileName(activeFile.name));
  const regex = canSearch ? buildSearchRegex() : null;
  const invalid = canSearch && searchState.regex && Boolean(elements.findInput?.value) && !regex;
  elements.findInput?.classList.toggle("is-error", invalid);
  searchState.matches = [];
  if (regex) {
    const text = getEditorText();
    let m;
    let guard = 0;
    while ((m = regex.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      searchState.matches.push({ start, end });
      if (m[0].length === 0) regex.lastIndex += 1; // avoid an infinite loop on zero-width
      if (++guard > 20000) break;                  // sanity cap on pathological patterns
    }
  }
  if (searchState.matches.length === 0) {
    searchState.currentIndex = -1;
  } else if (keepCaret) {
    const caret = getEditorSelection().start;
    const idx = searchState.matches.findIndex((mm) => mm.start >= caret);
    searchState.currentIndex = idx >= 0 ? idx : 0;
  } else if (searchState.currentIndex < 0 || searchState.currentIndex >= searchState.matches.length) {
    searchState.currentIndex = 0;
  }
  updateFindCount();
  renderSearchHighlights();
}

function updateFindCount() {
  if (!elements.findCount) return;
  const total = searchState.matches.length;
  if (elements.findInput && !elements.findInput.value) {
    elements.findCount.textContent = "No results";
  } else if (total === 0) {
    elements.findCount.textContent = elements.findInput?.classList.contains("is-error") ? "Bad pattern" : "No results";
  } else {
    elements.findCount.textContent = `${searchState.currentIndex + 1} of ${total}`;
  }
}

// Draw a highlight box (one per visual line) over each match, reusing the remote-
// cursor rect technique. Positioned relative to #editor-scroll so it tracks the
// content as #editor-content scrolls.
function renderSearchHighlights() {
  const layer = elements.editorSearchHighlights;
  if (!layer) return;
  layer.textContent = "";
  if (!searchState.open || !searchState.matches.length) return;
  const scrollRect = elements.editorScroll.getBoundingClientRect();
  const MAX = 500;
  searchState.matches.slice(0, MAX).forEach((match, index) => {
    try {
      const s = textOffsetToDomPosition(match.start);
      const e = textOffsetToDomPosition(match.end);
      const range = document.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
      const isCurrent = index === searchState.currentIndex;
      for (const rect of rects) {
        // Skip rects entirely outside the visible band (cheap virtualization).
        if (rect.bottom < scrollRect.top - 40 || rect.top > scrollRect.bottom + 40) continue;
        const box = document.createElement("div");
        box.className = `search-match${isCurrent ? " is-current" : ""}`;
        box.style.left = `${rect.left - scrollRect.left}px`;
        box.style.top = `${rect.top - scrollRect.top}px`;
        box.style.width = `${rect.width}px`;
        box.style.height = `${rect.height}px`;
        layer.append(box);
      }
    } catch { /* offset transiently out of range during a re-render */ }
  });
  scheduleOverviewRuler(); // search hits are ruler markers too
}

function gotoMatch(index) {
  if (!searchState.matches.length) return;
  // A match that runs past the end of the current text is a leftover from a
  // document we are no longer showing; re-search before moving the caret rather
  // than selecting a phantom range.
  const textLength = getEditorText().length;
  if (searchState.matches.some((m) => m.end > textLength)) {
    searchState.currentIndex = -1;
    computeSearchMatches();
    if (!searchState.matches.length) return;
  }
  const total = searchState.matches.length;
  searchState.currentIndex = ((index % total) + total) % total;
  const match = searchState.matches[searchState.currentIndex];
  // Select the match IN the editor even though the find box has focus, then
  // scroll it into view. Focusing the editor briefly is what lets the selection
  // land; we return focus to the find input so the user keeps typing.
  elements.editorContent.focus({ preventScroll: true });
  setEditorSelection(match.start, match.end);
  caretIntoView(getEditorLineHeight() * 2);
  elements.findInput?.focus();
  updateFindCount();
  renderSearchHighlights();
}

function findNext() {
  if (!searchState.matches.length) { computeSearchMatches(); }
  if (searchState.matches.length) gotoMatch(searchState.currentIndex + 1);
}

function findPrev() {
  if (!searchState.matches.length) { computeSearchMatches(); }
  if (searchState.matches.length) gotoMatch(searchState.currentIndex - 1);
}

// The replacement text for one match (regex mode honors $1, $&, … via a scoped
// re-run of the pattern on just that match).
function replacementFor(matchText) {
  const replaceRaw = elements.replaceInput?.value ?? "";
  if (!searchState.regex) return replaceRaw;
  const single = buildSearchRegex();
  if (!single) return replaceRaw;
  // matchText is exactly one match, so a single replace applies the templates.
  return matchText.replace(new RegExp(single.source, single.flags.replace("g", "")), replaceRaw);
}

function replaceCurrent() {
  if (searchState.currentIndex < 0 || !searchState.matches.length) { findNext(); return; }
  const match = searchState.matches[searchState.currentIndex];
  const text = getEditorText();
  const matchText = text.slice(match.start, match.end);
  const replacement = replacementFor(matchText);
  const newText = text.slice(0, match.start) + replacement + text.slice(match.end);
  const caret = match.start + replacement.length;
  applyEditorEdit(newText, caret, caret);
  computeSearchMatches();
  // Move to the next match at/after where we just replaced.
  const nextIdx = searchState.matches.findIndex((mm) => mm.start >= caret);
  if (searchState.matches.length) gotoMatch(nextIdx >= 0 ? nextIdx : 0);
  elements.findInput?.focus();
}

function replaceAllMatches() {
  const regex = buildSearchRegex();
  if (!regex || !searchState.matches.length) return;
  const text = getEditorText();
  const replaceRaw = elements.replaceInput?.value ?? "";
  const count = searchState.matches.length;
  // String.replace with a global regex applies $1/$& templates in regex mode;
  // in plain mode the pattern is escaped so it's a literal replace.
  const newText = text.replace(regex, replaceRaw);
  applyEditorEdit(newText, 0, 0);
  computeSearchMatches();
  showToast(`Replaced ${count} occurrence${count === 1 ? "" : "s"}`);
  elements.findInput?.focus();
}

function openFindBar(replaceMode = false) {
  if (!elements.editorFindBar) return;
  searchState.open = true;
  searchState.replaceMode = replaceMode;
  elements.editorFindBar.hidden = false;
  if (elements.findReplaceRow) elements.findReplaceRow.hidden = !replaceMode;
  // Seed the find box with the current selection (VS Code behaviour).
  const sel = getEditorSelection();
  if (sel.end > sel.start) {
    const selected = getEditorText().slice(sel.start, sel.end);
    if (!selected.includes("\n")) elements.findInput.value = selected;
  }
  computeSearchMatches({ keepCaret: true });
  elements.findInput?.focus();
  elements.findInput?.select();
}

function closeFindBar() {
  searchState.open = false;
  if (elements.editorFindBar) elements.editorFindBar.hidden = true;
  if (elements.editorSearchHighlights) elements.editorSearchHighlights.textContent = "";
  elements.editorContent?.focus({ preventScroll: true });
}

function toggleFindOption(key, buttonEl) {
  searchState[key] = !searchState[key];
  buttonEl?.setAttribute("aria-pressed", String(searchState[key]));
  computeSearchMatches({ keepCaret: true });
}

// ============================ Snapshots + Diff ==============================
// Per-file, content-addressed history (see snapshot-service). Diff state caches
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


// ---- Editor overview ruler ---------------------------------------------------
// Markers down the right edge showing every point of interest in the document,
// the way VS Code decorates its scrollbar: your own caret, line comments,
// collaborators' carets and the ranges they have selected (in each peer's own
// colour, matching their cursor), and current search hits. Clicking a marker
// jumps there, so finding "where is my stuff" never means scrolling blindly.

/** Which line a text offset falls on (0-based). */
// Counting with indexOf rather than text[i]: indexing a CJK string allocates a
// one-character string per position, tens of thousands per call, per marker.
function lineIndexForOffset(text, offset) {
  const capped = Math.max(0, Math.min(Number(offset) || 0, text.length));
  let line = 0;
  for (let at = text.indexOf("\n"); at !== -1 && at < capped; at = text.indexOf("\n", at + 1)) line += 1;
  return line;
}

/** Vertical position of a line inside the scrollable content, in px. */
function editorLineTop(lineIndex) {
  const lines = elements.editorContent.children; // not a fresh array per marker
  if (!lines.length) return 0;
  const el = lines[Math.max(0, Math.min(lineIndex, lines.length - 1))];
  return el ? el.offsetTop : 0;
}

let overviewRulerFrame = 0;
function scheduleOverviewRuler() {
  if (overviewRulerFrame) return;
  overviewRulerFrame = requestAnimationFrame(() => {
    overviewRulerFrame = 0;
    renderOverviewRuler();
  });
}

function renderOverviewRuler() {
  const ruler = elements.editorOverviewRuler;
  const content = elements.editorContent;
  if (!ruler || !content) return;
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    ruler.replaceChildren();
    ruler.hidden = true;
    return;
  }
  ruler.hidden = false;

  const contentHeight = content.scrollHeight || 1;
  const rulerHeight = ruler.clientHeight || content.clientHeight || 1;
  const text = getEditorText();
  const ticks = [];

  const add = ({ line, endLine = null, color = null, className, title }) => {
    const top = (editorLineTop(line) / contentHeight) * rulerHeight;
    let height = 3;
    if (endLine != null && endLine > line) {
      const bottom = (editorLineTop(endLine) / contentHeight) * rulerHeight;
      height = Math.max(3, bottom - top);
    }
    ticks.push({ top, height, color, className, title, line });
  };

  // Collaborators' selections first, so their caret marks sit on top of them.
  const activePath = getPath(controller.getProject(), activeFile.id);
  for (const cursor of remoteCursorsByClient.values()) {
    if (cursor.fileId !== activePath) continue;
    const color = clientColor(cursor.clientId);
    const who = cursor.displayName || "A collaborator";
    const startLine = lineIndexForOffset(text, cursor.selStart);
    const endLine = lineIndexForOffset(text, cursor.selEnd);
    if (Number(cursor.selEnd) > Number(cursor.selStart)) {
      add({ line: startLine, endLine, color, className: "editor-overview-tick is-peer-selection",
            title: `${who} — selection` });
    }
    add({ line: startLine, color, className: "editor-overview-tick is-peer",
          title: `${who} — line ${startLine + 1}` });
  }

  // Search hits.
  if (searchState.open) {
    for (const match of searchState.matches) {
      add({ line: lineIndexForOffset(text, match.start), className: "editor-overview-tick is-search",
            title: "Search match" });
    }
  }

  // Line comments.
  for (const comment of commentsForActiveFile()) {
    add({ line: comment.line, className: "editor-overview-tick is-comment",
          title: `${comment.author ?? "Comment"}: ${comment.text}` });
  }

  // My own caret last so it is never hidden behind another marker.
  if (elements.editorContent === document.activeElement) {
    const { start } = getEditorSelection();
    add({ line: lineIndexForOffset(text, start), className: "editor-overview-tick is-caret",
          title: "Your cursor" });
  }

  ruler.replaceChildren(...ticks.map((tick) => {
    const el = document.createElement("div");
    el.className = tick.className;
    el.style.top = `${Math.max(0, tick.top)}px`;
    el.style.height = `${tick.height}px`;
    if (tick.color) el.style.background = tick.color;
    el.title = tick.title;
    el.addEventListener("click", (event) => {
      event.stopPropagation();
      // Centre that line in the viewport.
      const target = editorLineTop(tick.line) - (content.clientHeight / 2);
      content.scrollTop = Math.max(0, target);
      syncEditorScroll();
      scheduleOverviewRuler();
    });
    return el;
  }));
}

// ---- Line comments -----------------------------------------------------------
// A note attached to a LINE, like a breakpoint: it lives in metadata beside the
// project on the server (comments.json), never in the document text. Shared with
// everyone who can open the workspace. Comments follow the text: each one stores
// the line's own content, so after edits shift it we re-find it rather than
// leaving the note stranded on a line number that now means something else.
const lineComments = { byFile: new Map(), loadedFor: null };

function commentsAvailable() {
  // settings alone aren't enough: during boot (before the workspace has actually
  // opened) they still name the cloud workspace while a LOCAL project is on
  // screen — commenting then would file that project's lines under the cloud
  // workspace. Require that we are genuinely in the synced session.
  return Boolean(cloudWorkspaceTarget()) && workspaceMode === "synced" && Boolean(collaboration.isConnected?.());
}

function commentsForPath(path) {
  return lineComments.byFile.get(path) ?? [];
}

function commentsForActiveFile() {
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile) return [];
  return commentsForPath(getPath(project, activeFile.id));
}

async function loadLineComments({ force = false } = {}) {
  const target = commentsAvailable() ? cloudWorkspaceTarget() : null;
  if (!target) {
    lineComments.byFile.clear();
    lineComments.loadedFor = null;
    return;
  }
  const workspaceId = `${target.team}/${target.path}`;
  if (!force && lineComments.loadedFor === workspaceId) return;
  try {
    const data = await listComments(target.serverUrl, target.token, target.team, target.path);
    lineComments.byFile = new Map(Object.entries(data?.files ?? {}));
    lineComments.loadedFor = workspaceId;
    renderEditorFromModel();
  } catch (error) {
    logDebug("response", "Could not load line comments", error.message);
  }
}

// Re-render the editor (and therefore the gutter markers) from the current model
// without disturbing the caret.
function renderEditorFromModel() {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) return;
  if (elements.editorContent !== document.activeElement) {
    renderEditorContent(getEditorText());
    return;
  }
  const { start, end } = getEditorSelection();
  renderEditorContent(getEditorText());
  setEditorSelection(start, end);
}

// Follow the text: if a commented line moved, find it again by its own content.
// Searching OUTWARD from the old position lands on the nearest match, which is
// what you want when lines were inserted or removed above it.
let reanchorTimer = null;
function scheduleCommentReanchor() {
  if (!commentsAvailable() || reanchorTimer) return;
  reanchorTimer = setTimeout(() => {
    reanchorTimer = null;
    void reanchorActiveFileComments();
  }, 400);
}

async function reanchorActiveFileComments() {
  const target = commentsAvailable() ? cloudWorkspaceTarget() : null;
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!target || !activeFile || !isTextFileName(activeFile.name)) return;
  const path = getPath(project, activeFile.id);
  const list = commentsForPath(path);
  if (!list.length) return;

  const lines = String(activeFile.content ?? "").split("\n");
  const moves = [];
  for (const comment of list) {
    const anchor = String(comment.anchorText ?? "");
    // A blank anchor can't be matched (every empty line looks alike), so leave it.
    if (!anchor.trim()) continue;
    if (lines[comment.line] === anchor) continue; // still where we left it
    let found = -1;
    for (let distance = 1; distance <= lines.length; distance += 1) {
      const above = comment.line - distance;
      const below = comment.line + distance;
      if (above >= 0 && lines[above] === anchor) { found = above; break; }
      if (below < lines.length && lines[below] === anchor) { found = below; break; }
      if (above < 0 && below >= lines.length) break;
    }
    if (found >= 0 && found !== comment.line) {
      comment.line = found;
      moves.push({ id: comment.id, line: found, anchorText: anchor });
    }
  }
  if (!moves.length) return;
  renderEditorFromModel();
  try {
    await reanchorComments(target.serverUrl, target.token, target.team, target.path, path, moves);
  } catch (error) {
    logDebug("response", "Could not persist comment anchors", error.message);
  }
}

// ---- Comment editor popover --------------------------------------------------
let commentPopoverLine = null;

function closeCommentPopover() {
  commentPopoverLine = null;
  if (elements.lineCommentPopover) elements.lineCommentPopover.hidden = true;
}

function openCommentPopover(lineIndex) {
  const popover = elements.lineCommentPopover;
  if (!popover) return;
  if (!commentsAvailable()) {
    showToast("Line comments need a cloud workspace");
    return;
  }
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) return;
  const path = getPath(project, activeFile.id);
  const existing = commentsForPath(path).find((c) => c.line === lineIndex) ?? null;

  commentPopoverLine = lineIndex;
  elements.lineCommentInput.value = existing?.text ?? "";
  elements.lineCommentMeta.textContent = existing
    ? `Line ${lineIndex + 1} · ${existing.author ?? "unknown"}`
    : `Line ${lineIndex + 1}`;
  elements.lineCommentDelete.hidden = !existing;
  popover.dataset.commentId = existing?.id ?? "";
  popover.hidden = false;

  // Sit beside the line being commented, clamped to the viewport.
  const row = elements.editorGutter?.querySelectorAll(".editor-gutter-line")[lineIndex];
  const rect = (row ?? elements.editorGutter).getBoundingClientRect();
  popover.style.top = `${Math.min(rect.top, window.innerHeight - popover.offsetHeight - 12)}px`;
  popover.style.left = `${rect.right + 8}px`;
  elements.lineCommentInput.focus();
}

async function submitLineComment() {
  const target = commentsAvailable() ? cloudWorkspaceTarget() : null;
  const popover = elements.lineCommentPopover;
  if (!target || !popover || commentPopoverLine == null) return;
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile) return;
  const path = getPath(project, activeFile.id);
  const text = elements.lineCommentInput.value.trim();
  const id = popover.dataset.commentId || undefined;
  if (!text) {
    if (id) await removeLineComment(id);
    else closeCommentPopover();
    return;
  }
  const lines = String(activeFile.content ?? "").split("\n");
  try {
    const result = await saveComment(target.serverUrl, target.token, target.team, target.path, {
      file: path, id, line: commentPopoverLine, anchorText: lines[commentPopoverLine] ?? "", text
    });
    const list = commentsForPath(path).filter((c) => c.id !== result.comment.id);
    list.push(result.comment);
    list.sort((a, b) => a.line - b.line);
    lineComments.byFile.set(path, list);
    closeCommentPopover();
    renderEditorFromModel();
    showToast(id ? "Comment updated" : "Comment added");
  } catch (error) {
    notify(error.message);
  }
}

async function removeLineComment(id) {
  const target = commentsAvailable() ? cloudWorkspaceTarget() : null;
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!target || !activeFile) return;
  const path = getPath(project, activeFile.id);
  try {
    await deleteComment(target.serverUrl, target.token, target.team, target.path, id);
    lineComments.byFile.set(path, commentsForPath(path).filter((c) => c.id !== id));
    closeCommentPopover();
    renderEditorFromModel();
    showToast("Comment removed");
  } catch (error) {
    notify(error.message);
  }
}

// ---- Where snapshots live ----------------------------------------------------
// A cloud workspace keeps snapshots ON THE SERVER, so they follow you to any
// device. A local/private project (no account, or not a cloud workspace) keeps
// them in this browser's IndexedDB as before. Everything goes through this one
// adapter so the dialog and diff code never care which backend they talk to.
function cloudWorkspaceTarget() {
  const token = syncState.account?.token;
  const ws = settings.lastWorkspace;
  if (!token || !ws?.team || !ws?.path) return null;
  if (settings.syncedProjectId !== `${ws.team}/${ws.path}`) return null; // on-screen project IS that workspace
  return { serverUrl: settings.serverUrl, token, team: ws.team, path: ws.path };
}

// ---- Version label (S.E.N) --------------------------------------------------
// S — snapshots you have deliberately cut of this file
// E — writing sittings since that snapshot
// N — edits in the current sitting
//
// None of these is the `revision`. Revision is a Lamport clock: one integer per
// workspace, monotonic forever, compared in ~170 places to order writes and
// refuse stale ones. It must never reset, and it is plumbing — users should not
// be reading a five-digit counter they cannot influence. These three they can:
// snapshotting bumps S, walking away bumps E. Nothing compares them, which is
// exactly why they are free to reset.

function setSnapshotBaselines(baselines) {
  snapshotBaselines = new Map(Object.entries(baselines ?? {}));
  scheduleVersionLabel();
}

function refreshSnapshotBaselines() {
  if (snapshotBaselinesInFlight) return snapshotBaselinesInFlight;
  snapshotBaselinesInFlight = (async () => {
    try {
      const listing = await snapshotStore().paths();
      setSnapshotBaselines(listing?.baselines);
    } catch {
      /* history is unavailable — the label just falls back to "no snapshots". */
    } finally {
      snapshotBaselinesInFlight = null;
    }
  })();
  return snapshotBaselinesInFlight;
}

// Snapshots taken before this feature carry no baseline, so E/N count from 0
// and read high once. That self-heals the next time the file is snapshotted.
function fileVersionLabel(file, path) {
  if (!file || file.kind !== "file") return null;
  const base = (path && snapshotBaselines.get(path)) || null;
  const sessions = Number(file.editSessions) || 0;
  const edits = Number(file.sessionEdits) || 0;
  const s = base ? Number(base.count) || 0 : 0;
  // clamp: a workspace restored from a backup can sit behind its own snapshots.
  const e = Math.max(0, sessions - (base ? Number(base.editSessions) || 0 : 0));
  // Within the sitting the snapshot was taken in, subtract so a fresh snapshot
  // reads x.0.0; once a new sitting starts, N is simply that sitting's count.
  const n = e > 0 ? edits : Math.max(0, edits - (base ? Number(base.sessionEdits) || 0 : 0));
  return `${s}.${e}.${n}`;
}

let versionLabelHandle = null;
function scheduleVersionLabel() {
  if (versionLabelHandle) return;
  versionLabelHandle = requestAnimationFrame(() => {
    versionLabelHandle = null;
    renderVersionLabel();
  });
}

function renderVersionLabel() {
  const item = elements.statusVersionItem;
  const label = elements.statusVersionText;
  if (!item || !label) return;
  const project = controller.getProject();
  const file = controller.getActiveFile();
  if (!file || file.kind !== "file" || !isTextFileName(file.name)) {
    item.hidden = true;
    return;
  }
  const path = getPath(project, file.id);
  const text = fileVersionLabel(file, path);
  if (!text) {
    item.hidden = true;
    return;
  }
  const [s, e, n] = text.split(".");
  const total = Number(file.sourceVersion) || 0;
  item.hidden = false;
  label.textContent = `v${text}`;
  item.title = `${file.name}\n`
    + `${s} snapshot${s === "1" ? "" : "s"} · ${e} sitting${e === "1" ? "" : "s"} since the last one · ${n} edit${n === "1" ? "" : "s"} this sitting\n`
    + `${total} edit${total === 1 ? "" : "s"} in total`;
}

function snapshotStore() {
  const target = cloudWorkspaceTarget();
  if (!target) {
    const key = snapshotProjectKey();
    return {
      remote: false,
      // No server here, so this browser is the host: it owns the counters and
      // stamps them onto the snapshot itself.
      create: (file, content, label, counters) => createFileSnapshot(key, file, content, label, counters),
      paths: () => listSnapshotPaths(key),
      versions: (file) => listFileVersions(key, file),
      content: (id) => getVersionContent(id),
      remove: (id) => deleteVersion(id)
    };
  }
  const { serverUrl, token, team, path } = target;
  return {
    remote: true,
    // The server reads the file's counters itself — it is the host, so its
    // numbers are the ones every peer must agree on.
    create: (file, content, label) => createServerSnapshot(serverUrl, token, team, path, file, content, label),
    paths: async () => {
      const result = await listServerSnapshotPaths(serverUrl, token, team, path);
      return { paths: result.paths ?? [], baselines: result.baselines ?? {} };
    },
    versions: async (file) => (await listServerSnapshotVersions(serverUrl, token, team, path, file)).versions ?? [],
    content: async (id) => {
      try {
        return (await getServerSnapshotContent(serverUrl, token, team, path, id)).content;
      } catch {
        return null; // gone or unreadable — callers already handle null
      }
    },
    remove: (id) => deleteServerSnapshot(serverUrl, token, team, path, id)
  };
}

// Snapshots made before they moved to the server still sit in this browser's
// IndexedDB — under this workspace's id, or under "server-project", the project
// id most server workspaces share (which is why they seemed to vanish). Upload
// them once so no history is lost. From that shared key only files that exist in
// THIS workspace are taken, so another workspace's history can't leak in. Safe
// to repeat: the server skips anything already recorded (same time + content).
let snapshotMigrationPromise = null;

function ensureSnapshotsMigrated() {
  const target = cloudWorkspaceTarget();
  if (!target) return Promise.resolve(0);
  if (!snapshotMigrationPromise) {
    snapshotMigrationPromise = migrateLocalSnapshotsToServer(target)
      .catch((error) => {
        logDebug("response", "Snapshot migration failed", error?.message ?? String(error));
        return 0;
      })
      .finally(() => { snapshotMigrationPromise = null; });
  }
  return snapshotMigrationPromise;
}

async function migrateLocalSnapshotsToServer(target) {
  const workspaceId = `${target.team}/${target.path}`;
  const flag = `mdnotes.snapshots.migrated.${workspaceId}`;
  try {
    if (localStorage.getItem(flag)) return 0;
  } catch { /* storage blocked — just try */ }

  const project = controller.getProject();
  const workspaceFiles = new Set(Object.values(project?.nodes ?? {})
    .filter((node) => node?.kind === "file")
    .map((node) => getPath(project, node.id)));
  let uploaded = 0;
  for (const key of new Set([workspaceId, project?.id].filter(Boolean))) {
    let files = [];
    try { files = await listSnapshotPaths(key); } catch { continue; }
    for (const file of files) {
      if (key !== workspaceId && !workspaceFiles.has(file)) continue; // shared key: this workspace's files only
      let versions = [];
      try { versions = await listFileVersions(key, file); } catch { continue; }
      for (const version of [...versions].reverse()) { // oldest first
        const content = await getVersionContent(version.id).catch(() => null);
        if (content == null) continue;
        // A network failure throws out of here: the flag stays unset, so the next
        // open retries and the server de-duplicates whatever already arrived.
        const result = await createServerSnapshot(
          target.serverUrl, target.token, target.team, target.path,
          file, content, version.label || "", version.createdAt
        );
        if (result?.created) uploaded += 1;
      }
    }
  }
  try { localStorage.setItem(flag, String(Date.now())); } catch { /* ignore */ }
  if (uploaded) logDebug("action", "Migrated local snapshots to server", `${uploaded} version(s) -> ${workspaceId}`);
  return uploaded;
}


// A snapshot is always of the CURRENT file only — the intuitive "save this file's
// version" action. (The project-wide createFileSnapshots stays in the service for
// possible future use.)
async function createSnapshotNow(label = "") {
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    showToast("Open a text file to snapshot it");
    return;
  }
  const path = getPath(project, activeFile.id);
  try {
    const result = await snapshotStore().create(path, activeFile.content, label, activeFile);
    void refreshSnapshotBaselines();
    showToast(result.created ? `Snapshot saved: ${path.split("/").pop()}` : "Snapshot — no changes since the last one");
    logDebug("action", "Snapshot created", `${path} ${result.created ? "saved" : "unchanged"}`);
  } catch (error) {
    logDebug("response", "Snapshot failed", error.message);
    showToast("Couldn't save snapshot (storage unavailable)");
  }
}

// Snapshot every file with unsaved local changes, so a pull that adopts newer
// server content can never make those edits unrecoverable. Best-effort: snapshot
// storage problems must not block opening a workspace.
async function snapshotDirtyFiles(label) {
  const project = controller.getProject();
  const store = snapshotStore();
  let saved = 0;
  for (const node of Object.values(project?.nodes ?? {})) {
    if (node?.kind !== "file" || !node.dirty || !isTextFileName(node.name)) continue;
    try {
      const result = await store.create(getPath(project, node.id), node.content ?? "", label);
      if (result?.created) saved += 1;
    } catch { /* storage unavailable — never block the open */ }
  }
  if (saved) logDebug("action", "Snapshotted unsaved files", `${saved} file(s) — ${label}`);
  return saved;
}

function formatSnapshotTime(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---- Workspace History (whole-workspace backups) ---------------------------
// The dialog lives in app/features/workspace-history.js and loads on first use.
// These restore helpers stay here: per-file Snapshots restores use them too.
function projectPaths(project) {
  const folders = new Set();
  const files = new Map();
  for (const node of Object.values(project.nodes ?? {})) {
    if (!node || node.id === project.rootId) continue;
    const path = getPath(project, node.id);
    if (node.kind === "folder") folders.add(path);
    else files.set(path, node);
  }
  return { folders, files };
}

// Apply restore operations through the server, one at a time, each based on
// the revision the previous one produced. Images upload their bytes first, the
// same way a normal image write does in a directory-backed workspace.
async function applyHistoryOperations(ops) {
  let revision = collaboration.getRevision?.() ?? 0;
  for (const op of ops) {
    let operation = op;
    if (typeof operation.content === "string" && operation.content.startsWith("data:")
        && collaboration.isDirectoryBacked?.()) {
      const path = operation.type === "create-file"
        ? [operation.parentPath, operation.name].filter(Boolean).join("/") : operation.path;
      await collaboration.uploadAsset(path, operation.content);
      operation = { ...operation, content: "" };
    }
    const result = await collaboration.publishOperation(
      { ...operation, baseRevision: revision, expectedRevision: revision }, { optimistic: false });
    if (!result) throw new Error("The workspace connection changed");
    revision = result.revision;
  }
}

// Operations that write `content` at `path`, creating missing folders first.
function writeAtPathOperations(path, content, existingFolders) {
  const segments = path.split("/");
  const name = segments.pop();
  const ops = [];
  for (let i = 1; i <= segments.length; i += 1) {
    const folder = segments.slice(0, i).join("/");
    if (!existingFolders.has(folder)) {
      ops.push({ type: "create-folder", parentPath: segments.slice(0, i - 1).join("/"), name: segments[i - 1] });
      existingFolders.add(folder);
    }
  }
  ops.push({ type: "create-file", parentPath: segments.join("/"), name, content });
  return ops;
}

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
      applyHistoryOperations, isTextFileName, applyEditorEdit, publishOperation
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

// Compare the ACTIVE file's current content with one of its stored versions,
// rendering the diff in the preview pane.
async function showFileDiff(path, versionId, createdAt) {
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  const activePath = activeFile ? getPath(project, activeFile.id) : null;
  if (activePath !== path) { showToast("Open that file to compare it"); return; }
  const oldText = await snapshotStore().content(versionId);
  if (oldText == null) { showToast("That version is no longer available"); return; }
  diffState.active = true;
  diffState.fileId = activeFile.id; // diff tracks the file by id (survives the editor switching files)
  diffState.path = path;
  diffState.versionId = versionId;
  diffState.oldText = oldText;
  diffState.createdAt = createdAt;
  diffState.currentChange = -1;
  if (settings.preview === "hidden") togglePreview();
  previewFileId = DIFF_TAB_ID; // make the diff the active preview tab
  updateStatus(project); // renders the tab strip + shows the diff pane
  renderDiff(); // immediate full render so blocks are fresh (updateStatus may have debounced)
  if (diffState.blocks.length) gotoChange(1); // jump to the first change
}

// Tear down the diff tab's state + hide the overlay WITHOUT re-rendering (safe to
// call from inside updateStatus, e.g. when the diffed file is gone).
function resetDiffState() {
  diffState.active = false;
  diffState.fileId = null;
  diffState.path = null;
  diffState.versionId = null;
  diffState.oldText = "";
  diffState.blocks = [];
  diffState.currentChange = -1;
  if (elements.previewDiffView) elements.previewDiffView.hidden = true;
  if (elements.preview) elements.preview.hidden = false;
}

// Close the diff tab (its × button, or when its file disappears). Falls the
// preview back to whatever file tab was last open.
function closeDiff() {
  resetDiffState();
  if (previewFileId === DIFF_TAB_ID) {
    previewFileId = previewOpenTabIds[previewOpenTabIds.length - 1] ?? null;
  }
  render(controller.getProject());
}

// Rebuild the diff into #diff-body, group changes into blocks, and draw the
// overview ruler. `preserveScroll` keeps the reader's place on a live re-render
// (e.g. while they edit the file with the diff open).
function renderDiff({ preserveScroll = false } = {}) {
  if (!diffState.active || !elements.diffBody) return;
  const project = controller.getProject();
  const node = project.nodes[diffState.fileId];
  // The diffed file was deleted → close the diff tab.
  if (!node || node.kind !== "file") {
    closeDiff();
    return;
  }
  const savedScroll = preserveScroll ? elements.diffBody.scrollTop : 0;
  const ops = diffLines(diffState.oldText, String(node.content ?? ""));

  // Group consecutive changed lines into blocks (for navigation + the ruler).
  const blocks = [];
  let cur = null;
  ops.forEach((op, i) => {
    if (op.type === "same") { cur = null; return; }
    if (!cur) { cur = { start: i, end: i, hasAdd: false, hasDel: false }; blocks.push(cur); }
    cur.end = i;
    if (op.type === "add") cur.hasAdd = true;
    if (op.type === "del") cur.hasDel = true;
  });
  diffState.blocks = blocks;

  let added = 0;
  let removed = 0;
  const rowsHtml = ops.map((op) => {
    if (op.type === "add") added += 1;
    if (op.type === "del") removed += 1;
    const marker = op.type === "add" ? "+" : op.type === "del" ? "−" : " ";
    // One line-number column: the current-file line for kept/added rows, the old
    // line for deleted rows (which have no current-file position).
    const lineNo = op.newLine != null ? String(op.newLine) : (op.oldLine != null ? String(op.oldLine) : "");
    return `<div class="diff-line diff-${op.type}"><span class="diff-gutter">${lineNo}</span><span class="diff-mark">${marker}</span><span class="diff-text">${escapeHtmlAttribute(op.text)}</span></div>`;
  }).join("");
  elements.diffBody.innerHTML = rowsHtml || '<div class="diff-line diff-same"><span class="diff-text">(identical to the current file)</span></div>';

  if (elements.previewDiffLabel) elements.previewDiffLabel.textContent = `Current vs snapshot · ${formatSnapshotTime(diffState.createdAt)}`;
  if (elements.previewDiffStats) elements.previewDiffStats.textContent = `+${added} −${removed} · ${blocks.length} change${blocks.length === 1 ? "" : "s"}`;

  renderDiffRuler();
  if (preserveScroll) elements.diffBody.scrollTop = savedScroll;
  // Re-apply the current-change highlight after the rebuild.
  if (diffState.currentChange >= 0 && diffState.currentChange < blocks.length) {
    highlightChange(diffState.currentChange, { scroll: false });
  }
}

function renderDiffRuler() {
  const ruler = elements.diffRuler;
  const body = elements.diffBody;
  if (!ruler || !body) return;
  ruler.replaceChildren();
  const scrollHeight = body.scrollHeight || 1;
  const rulerHeight = body.clientHeight || 1;
  const rows = body.children;
  diffState.blocks.forEach((block, index) => {
    const firstRow = rows[block.start];
    if (!firstRow) return;
    const lastRow = rows[block.end] ?? firstRow;
    const topPx = (firstRow.offsetTop / scrollHeight) * rulerHeight;
    const heightPx = Math.max(3, ((lastRow.offsetTop + lastRow.offsetHeight - firstRow.offsetTop) / scrollHeight) * rulerHeight);
    const tick = document.createElement("div");
    tick.className = `diff-ruler-tick ${block.hasAdd && block.hasDel ? "tick-mix" : block.hasAdd ? "tick-add" : "tick-del"}`;
    tick.style.top = `${topPx}px`;
    tick.style.height = `${heightPx}px`;
    tick.title = `Change ${index + 1} of ${diffState.blocks.length}`;
    tick.addEventListener("click", () => { diffState.currentChange = index; highlightChange(index, { scroll: true }); });
    ruler.append(tick);
  });
}

function highlightChange(index, { scroll = true } = {}) {
  const body = elements.diffBody;
  if (!body) return;
  body.querySelectorAll(".is-current-change").forEach((el) => el.classList.remove("is-current-change"));
  const block = diffState.blocks[index];
  if (!block) return;
  const rows = body.children;
  for (let i = block.start; i <= block.end; i += 1) rows[i]?.classList.add("is-current-change");
  if (scroll) rows[block.start]?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function gotoChange(delta) {
  const total = diffState.blocks.length;
  if (!total) { showToast("No changes"); return; }
  const next = diffState.currentChange < 0
    ? (delta > 0 ? 0 : total - 1)
    : (((diffState.currentChange + delta) % total) + total) % total;
  diffState.currentChange = next;
  highlightChange(next, { scroll: true });
}

// Debounced live refresh so editing the file with the diff open stays smooth and
// keeps the reader's scroll position.
let diffRefreshTimer = null;
function scheduleDiffRefresh() {
  if (diffRefreshTimer) return;
  diffRefreshTimer = setTimeout(() => {
    diffRefreshTimer = null;
    if (diffState.active) renderDiff({ preserveScroll: true });
  }, 180);
}

// Cache of the latest remote cursor events by clientId so we can re-render
// when the user scrolls or file content changes.
const remoteCursorsByClient = new Map();

// Throttled diagnostic (shows in the Log panel) so cursor delivery/rendering can
// be confirmed without flooding.
let _lastCursorLog = 0;
function logCursorDebug(message) {
  const now = Date.now();
  if (now - _lastCursorLog < 1500) return;
  _lastCursorLog = now;
  logDebug("response", "Remote cursor", message);
}

function onRemoteCursor(event) {
  if (!event.clientId) return;
  remoteCursorsByClient.set(event.clientId, event);
  renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
}

// Drop cached cursors for peers that are no longer present — otherwise a
// disconnected peer's caret/selection lingers on screen (e.g. a stale red cursor
// left over after that collaborator left). Reconciled against the presence list,
// which the server updates on join/leave.
function pruneRemoteCursors(presence) {
  const alive = new Set((presence ?? []).map((p) => p.clientId).filter(Boolean));
  let changed = false;
  for (const clientId of Array.from(remoteCursorsByClient.keys())) {
    if (!alive.has(clientId)) {
      remoteCursorsByClient.delete(clientId);
      changed = true;
    }
  }
  if (changed) renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
}

// Remote carets/highlights are positioned from each peer's viewport rect against
// the (overflow:hidden) editor frame, so when THIS user scrolls #editor-content
// the overlay must be recomputed or it stays pinned to the old screen position.
// rAF-coalesced so fast scrolling re-renders at most once per frame.
let _remoteCursorRaf = 0;
function scheduleRemoteCursorRender() {
  if (_remoteCursorRaf) return;
  _remoteCursorRaf = requestAnimationFrame(() => {
    _remoteCursorRaf = 0;
    if (remoteCursorsByClient.size) {
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    }
  });
}

// Broadcast local selection to peers on selectionchange (debounced).
// Note: this listener is registered after `collaboration` is created (see below).
let _selectionChangeListenerAttached = false;
function attachSelectionChangeListener() {
  if (_selectionChangeListenerAttached) return;
  _selectionChangeListenerAttached = true;
  // On touch devices, tapping another control can clear the DOM selection before
  // its click handler switches files. Save it at pointer-down, while the editor
  // still owns the range. The selectionchange event may arrive too late (or not
  // at all when the browser puts the tab to sleep).
  document.addEventListener("pointerdown", (event) => {
    if (!elements.editorContent.contains(event.target)) rememberEditorSelection();
  }, true);
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === elements.editorContent && !_editorUpdating && !editorIsComposing) rememberEditorSelection();
    if (!collaboration.isConnected()) return;
    const activeFile = controller.getActiveFile();
    if (!activeFile) return;
    const sel = getEditorSelection();
    // Suppress cursor broadcast while a text patch is pending for this file —
    // peers would see a stale position (before the text arrives).  The cursor
    // is sent automatically once the patch is confirmed by the server.
    const path = getPath(controller.getProject(), activeFile.id);
    if (collaboration.hasPendingPatch(path)) return;
    // Broadcast the PATH as the file identifier so peers (who may hold a different
    // node id for the same file) can match it — see renderRemoteCursors.
    collaboration.scheduleAwareness(path, sel.start, sel.end);
  });
}

// Keep applyTextareaValue as a shim used only by the MTREE output textarea
// (which is a real <textarea>, not the contenteditable).
function applyTextareaValue(textarea, nextValue, selectionStart, selectionEnd = selectionStart) {
  textarea.value = nextValue;
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchTextareaInput(textarea, inputType = "insertText") {
  if (typeof InputEvent === "function") {
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
    return;
  }
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function replaceTextareaRange(textarea, start, end, nextText, nextSelectionStart = null, nextSelectionEnd = null) {
  const defaultCursor = start + nextText.length;
  const selectionStart = nextSelectionStart ?? defaultCursor;
  const selectionEnd = nextSelectionEnd ?? selectionStart;
  textarea.setRangeText(nextText, start, end, "end");
  textarea.setSelectionRange(selectionStart, selectionEnd);
  dispatchTextareaInput(textarea, start === end ? "insertText" : "insertReplacementText");
}


function acceptEditorAutocomplete(index = autocompleteState.activeIndex) {
  const item = autocompleteState.items[index];
  const range = autocompleteState.range;
  if (!item || !range) {
    hideEditorAutocomplete();
    return;
  }
  replaceEditorRange(range.start, range.end, item.insertText);
  logDebug("action", "Autocomplete accepted", item.detail);
  hideEditorAutocomplete();
}

// ── Markdown formatting toolbar ──────────────────────────────────────────────

/** Wrap the current selection (or a placeholder) with inline markers and leave
 *  the wrapped text selected so the user can keep typing or replace it. */
function wrapEditorSelection(before, after, placeholder) {
  const { start, end } = getEditorSelection();
  const text = getEditorText();
  const selected = text.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  const innerStart = start + before.length;
  replaceEditorRange(start, end, inserted, innerStart, innerStart + selected.length);
}

/** Prefix every line touched by the selection (line-oriented markdown like
 *  headings, lists, quotes). `numbered` increments the prefix per line. */
function prefixEditorLines(prefix, numbered = false) {
  const { start, end } = getEditorSelection();
  const text = getEditorText();
  const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let blockEnd = text.indexOf("\n", end);
  if (blockEnd === -1) blockEnd = text.length;
  const lines = text.slice(blockStart, blockEnd).split("\n");
  const newBlock = lines
    .map((line, index) => `${numbered ? `${index + 1}. ` : prefix}${line}`)
    .join("\n");
  replaceEditorRange(blockStart, blockEnd, newBlock, blockStart, blockStart + newBlock.length);
}

/** Insert a multi-line block snippet on its own line(s). `caretOffset` (if set)
 *  places the caret at that offset within the inserted snippet. */
function insertEditorBlock(snippet, caretOffset = null) {
  const { start, end } = getEditorSelection();
  const text = getEditorText();
  const atLineStart = start === 0 || text[start - 1] === "\n";
  const lead = atLineStart ? "" : "\n";
  const inserted = `${lead}${snippet}`;
  const caret = caretOffset === null
    ? start + inserted.length
    : start + lead.length + caretOffset;
  replaceEditorRange(start, end, inserted, caret, caret);
}

/** Indent level of an mtree line: one tab or four spaces per level (matches the
 *  mtree parser's indentation rules). */
function getMtreeIndentLevel(line) {
  let level = 0;
  let spaceRun = 0;
  for (const char of line) {
    if (char === "\t") {
      level += 1;
      spaceRun = 0;
    } else if (char === " ") {
      spaceRun += 1;
      if (spaceRun === 4) {
        level += 1;
        spaceRun = 0;
      }
    } else {
      break;
    }
  }
  return level;
}

/** Insert an mtree child node one level deeper than the line at the caret,
 *  placed on the next line so it nests under the current node. */
function insertMtreeChild(text) {
  const { start } = getEditorSelection();
  const value = getEditorText();
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf("\n", start);
  if (lineEnd === -1) lineEnd = value.length;
  const currentLine = value.slice(lineStart, lineEnd);
  const childIndent = "\t".repeat(getMtreeIndentLevel(currentLine) + 1);
  const inserted = `\n${childIndent}${text}`;
  const caret = lineEnd + inserted.length;
  replaceEditorRange(lineEnd, lineEnd, inserted, caret, caret);
}

// Lazily-created floating grid-picker for the Markdown "Insert table" action.
let tableGridPicker = null;

function ensureTableGridPicker() {
  if (!tableGridPicker) {
    tableGridPicker = createTableGridPicker({
      onPick({ rows, cols, kind }) {
        elements.editorContent.focus({ preventScroll: true });
        insertEditorBlock(buildTableSnippet({ rows, cols, kind }));
        logDebug("action", "Toolbar table insert", `${cols}x${rows} ${kind}`);
      }
    });
    document.body.append(tableGridPicker.element);
  }
  return tableGridPicker;
}

/** Generic interpreter for a declarative toolbar action (see editor-format-toolbar.js). */
function applyToolbarAction(action, buttonEl) {
  const activeFile = controller.getActiveFile();
  if (!action || !activeFile || !isTextFileName(activeFile.name)) return;

  if (action.kind === "table") {
    ensureTableGridPicker().open(buttonEl);
    return;
  }

  elements.editorContent.focus({ preventScroll: true });
  switch (action.kind) {
    case "wrap": wrapEditorSelection(action.before, action.after, action.placeholder); break;
    case "prefix": prefixEditorLines(action.prefix ?? "", action.numbered === true); break;
    case "block": insertEditorBlock(action.snippet, action.caret ?? null); break;
    case "mtree-child": insertMtreeChild(action.text); break;
    default: return;
  }
  logDebug("action", "Toolbar insert", action.kind);
}

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
// batchId → { project: deepClone, baseRevision: number, soleAuthored: boolean }
// Capped at last 10 turns (subtask 6.5).
const agentCheckpoints = new Map();
const CHECKPOINT_MAX = 10;

function captureAgentCheckpoint(batchId, baseRevision) {
  agentCheckpoints.set(batchId, {
    project: structuredClone(controller.getProject()),
    baseRevision,
    soleAuthored: true
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
    // When a foreign peer op arrives, mark all open checkpoints as no-longer
    // sole-authored so the Drop button can be disabled (Phase 6 / subtask 6.4).
    if (clientId && clientId !== collaboration.getClientId()) {
      for (const checkpoint of agentCheckpoints.values()) {
        checkpoint.soleAuthored = false;
      }
    }
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
    const serverKey = normalizeServerUrl(settings.serverUrl);
    const proven = settings.accountSuccess?.[serverKey];
    if (!proven || proven !== settings.accountUsername || !settings.accountPassword) return null;
    const token = collaboration.getConnectionInfo()?.token;
    try {
      await performLogin(settings.accountUsername, settings.accountPassword, {
        silent: true, isCurrent: () => Boolean(token) && collaboration.getConnectionInfo()?.token === token
      });
      logDebug("action", "Re-authenticated after token expiry", settings.accountUsername);
      return syncState.account?.token ?? null;
    } catch (error) {
      logDebug("response", "Re-authentication failed", error.message);
      if (![401, 403].includes(error.status)) throw error;
      return null;
    }
  },
  onCommentsUpdate(files) {
    if (!commentsAvailable()) return;
    lineComments.byFile = new Map(Object.entries(files ?? {}));
    renderEditorFromModel();
  },
  onChatWorkspaceUpdate(workspace) {
    // Without the panel loaded nothing listens; it fetches the latest on load.
    chat?.receiveChatWorkspace(controller.getProject(), workspace);
  }
});

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
    return Boolean(syncState.account)
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

const menuPairs = [
  [elements.fileMenuButton, elements.fileMenu],
  [elements.editMenuButton, elements.editMenu],
  [elements.selectionMenuButton, elements.selectionMenu],
  [elements.viewMenuButton, elements.viewMenu],
  [elements.settingsMenuButton, elements.settingsMenu]
];

// Module map tools (.mtree → Markdown) load the first time their dialog opens.
let moduleMapTools = null;
let moduleMapToolsLoading = null;

function loadModuleMapTools() {
  moduleMapToolsLoading ??= import("./features/module-map-tools.js").then(({ createModuleMapTools }) => {
    moduleMapTools = createModuleMapTools({
      controller, getPath, getNode, findChildByName, notify, publishOperation,
      setActiveSourceFile, setPreviewFile, highlightMarkdownSource, renderMarkdown,
      typesetPreview, handleIndentKeydown
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

function escapeEditorHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function applyInlineHighlighting(value) {
  return value
    .replace(/(`[^`]*`)/g, '<span class="token-inline-code">$1</span>')
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, text, href) => {
      const attrHref = href.replace(/"/g, '&quot;');
      return `<span class="token-link" data-href="${attrHref}">[${text}](${href})</span>`;
    })
    .replace(/(\*\*[^*]+\*\*)/g, '<span class="token-strong">$1</span>')
    .replace(/(^|[^*])(\*[^*]+\*)/g, '$1<span class="token-emphasis">$2</span>');
}

function renderWhitespaceOnlyEditorLine(rawLine) {
  if (rawLine.length === 0) {
    return '<div class="editor-line"></div>';
  }
  return `<div class="editor-line">${escapeEditorHtml(rawLine)}</div>`;
}

/** Highlight an mtree chain ("Parent -> Child", indentation, or a single name).
 *  Splits on the literal "->" arrows and tokenises each segment separately so we
 *  never run name-matching regexes over already-inserted span markup. */
function highlightMtreeChain(chainPart) {
  const segments = chainPart.split("->");
  return segments
    .map((segment, index) => {
      const leading = segment.match(/^\s*/)[0];
      const trailing = segment.match(/\s*$/)[0];
      const core = segment.slice(leading.length, segment.length - trailing.length);
      let coreHtml = "";
      if (core === "...") {
        coreHtml = '<span class="token-mtree-continuation">...</span>';
      } else if (core) {
        coreHtml = `<span class="token-mtree-name">${escapeEditorHtml(core)}</span>`;
      }
      const arrow = index < segments.length - 1
        ? '<span class="token-mtree-chain-arrow">-&gt;</span>'
        : "";
      return `${escapeEditorHtml(leading)}${coreHtml}${escapeEditorHtml(trailing)}${arrow}`;
    })
    .join("");
}

function highlightMtreeLines(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");

  return lines.map((rawLine) => {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

    if (!trimmed) {
      return renderWhitespaceOnlyEditorLine(rawLine);
    }

    if (trimmed.startsWith("#")) {
      return `<div class="editor-line"><span class="token-mtree-comment">${escaped}</span></div>`;
    }

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      const [, name] = trimmed.match(/^\[([^\]]+)\]$/);
      const indent = escapeEditorHtml(rawLine.slice(0, rawLine.indexOf("[")));
      return `<div class="editor-line">${indent}<span class="token-mtree-section-mark">[</span><span class="token-mtree-section-name">${escapeEditorHtml(name)}</span><span class="token-mtree-section-mark">]</span></div>`;
    }

    if (trimmed.startsWith("|")) {
      const indent = escapeEditorHtml(rawLine.slice(0, rawLine.indexOf("|")));
      return `<div class="editor-line">${indent}<span class="token-mtree-continuation">|</span><span class="token-mtree-description">${escapeEditorHtml(trimmed.slice(1))}</span></div>`;
    }

    const semicolonIndex = rawLine.indexOf(";");
    const chainPart = semicolonIndex >= 0 ? rawLine.slice(0, semicolonIndex) : rawLine;
    const descriptionPart = semicolonIndex >= 0 ? rawLine.slice(semicolonIndex + 1) : "";
    const chainHtml = highlightMtreeChain(chainPart);

    const descriptionHtml = semicolonIndex >= 0
      ? `<span class="token-mtree-section-mark">;</span><span class="token-mtree-description">${escapeEditorHtml(descriptionPart)}</span>`
      : "";

    return `<div class="editor-line">${chainHtml}${descriptionHtml}</div>`;
  });
}

function highlightUrlDbLines(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");

  return lines.map((rawLine) => {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

    if (!trimmed) {
      return renderWhitespaceOnlyEditorLine(rawLine);
    }

    if (trimmed.startsWith("#")) {
      return `<div class="editor-line"><span class="token-mtree-comment">${escaped}</span></div>`;
    }

    if (/^\[[^\]]+\]$/.test(trimmed)) {
      const [, name] = trimmed.match(/^\[([^\]]+)\]$/);
      const indent = escapeEditorHtml(rawLine.slice(0, rawLine.indexOf("[")));
      return `<div class="editor-line">${indent}<span class="token-urldb-bracket">[</span><span class="token-urldb-name">${escapeEditorHtml(name)}</span><span class="token-urldb-bracket">]</span></div>`;
    }

    const keyValueMatch = rawLine.match(/^(\s*)(url|description)(\s*=\s*)(.*)$/i);
    if (keyValueMatch) {
      const [, indent, key, separator, valuePart] = keyValueMatch;
      const valueClass = key.toLowerCase() === "url" ? "token-link" : "token-urldb-description";
      return `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-urldb-key">${escapeEditorHtml(key)}</span><span class="token-urldb-separator">${escapeEditorHtml(separator)}</span><span class="${valueClass}">${escapeEditorHtml(valuePart)}</span></div>`;
    }

    return `<div class="editor-line">${escaped}</div>`;
  });
}

function highlightBmapValue(rawVal) {
  const trimmed = rawVal.trim();
  if (!trimmed) return "";

  // Opening brace for styles: { sub-block
  if (trimmed === "{") {
    return `<span class="token-bmap-brace">${escapeEditorHtml(rawVal)}</span>`;
  }

  // Inline object: {x: 120, y: 80}
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const leading = escapeEditorHtml(rawVal.slice(0, rawVal.indexOf("{")));
    const inner = trimmed.slice(1, -1);
    const highlightedInner = inner.replace(/([a-zA-Z]\w*)(\s*:\s*)(-?\d+\.?\d*)/g, (m, k, sep, v) =>
      `<span class="token-bmap-style-key">${escapeEditorHtml(k)}</span><span class="token-bmap-sep">${escapeEditorHtml(sep)}</span><span class="token-bmap-number">${escapeEditorHtml(v)}</span>`
    );
    return `${leading}<span class="token-bmap-brace">{</span>${highlightedInner}<span class="token-bmap-brace">}</span>`;
  }

  // Keywords
  const BMAP_KEYWORDS = new Set(["rect", "circle", "bezier", "straight", "end", "start", "both", "none", "true", "false"]);
  if (BMAP_KEYWORDS.has(trimmed)) {
    return `<span class="token-bmap-keyword">${escapeEditorHtml(rawVal)}</span>`;
  }

  // Connector endpoint: nodeId.side.N
  const endpointMatch = trimmed.match(/^(\S+?)\.side\.([0-3])$/);
  if (endpointMatch) {
    const [, nodeId, idx] = endpointMatch;
    const leading = escapeEditorHtml(rawVal.slice(0, rawVal.indexOf(nodeId)));
    return `${leading}<span class="token-bmap-endpoint-node">${escapeEditorHtml(nodeId)}</span><span class="token-bmap-sep">.side.</span><span class="token-bmap-endpoint-side">${escapeEditorHtml(idx)}</span>`;
  }

  // Scan for hex color values (may appear mid-string, e.g., "1px solid #aaa")
  const colorPattern = /#([0-9a-fA-F]{3,8})\b/g;
  const parts = [];
  let lastIdx = 0;
  let m;
  while ((m = colorPattern.exec(rawVal)) !== null) {
    if (m.index > lastIdx) {
      parts.push(`<span class="token-bmap-value">${escapeEditorHtml(rawVal.slice(lastIdx, m.index))}</span>`);
    }
    const hex = m[0];
    parts.push(`<span class="token-color-swatch" style="background:${escapeHtmlAttribute(hex)}"></span><span class="token-bmap-color">${escapeEditorHtml(hex)}</span>`);
    lastIdx = m.index + hex.length;
  }
  if (parts.length > 0) {
    if (lastIdx < rawVal.length) {
      parts.push(`<span class="token-bmap-value">${escapeEditorHtml(rawVal.slice(lastIdx))}</span>`);
    }
    return parts.join("");
  }

  // Plain number (with optional unit)
  if (/^\s*-?\d+(\.\d+)?(px|em|rem|%|pt)?\s*$/.test(rawVal)) {
    return `<span class="token-bmap-number">${escapeEditorHtml(rawVal)}</span>`;
  }

  return `<span class="token-bmap-value">${escapeEditorHtml(rawVal)}</span>`;
}

function highlightBmapLines(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  return lines.map((rawLine) => {
    const trimmed = rawLine.trimStart();
    const indent = escapeEditorHtml(rawLine.slice(0, rawLine.length - trimmed.length));

    if (!trimmed) return renderWhitespaceOnlyEditorLine(rawLine);

    // Comment
    if (trimmed.startsWith("//")) {
      return `<div class="editor-line"><span class="token-bmap-comment">${escapeEditorHtml(rawLine)}</span></div>`;
    }

    // Block opener: .node { or .connect {
    const blockOpenMatch = trimmed.match(/^(\.(node|connect))(\s*\{.*)$/);
    if (blockOpenMatch) {
      const [, selector, , rest] = blockOpenMatch;
      return `<div class="editor-line">${indent}<span class="token-bmap-selector">${escapeEditorHtml(selector)}</span><span class="token-bmap-brace">${escapeEditorHtml(rest)}</span></div>`;
    }

    // Closing brace
    if (trimmed === "}") {
      return `<div class="editor-line">${indent}<span class="token-bmap-brace">}</span></div>`;
    }

    // Key: value line
    const kvMatch = trimmed.match(/^([a-zA-Z][\w-]*)(\s*:\s*)(.*)$/);
    if (kvMatch) {
      const [, key, sep, val] = kvMatch;
      return `<div class="editor-line">${indent}<span class="token-bmap-key">${escapeEditorHtml(key)}</span><span class="token-bmap-sep">${escapeEditorHtml(sep)}</span>${highlightBmapValue(val)}</div>`;
    }

    return `<div class="editor-line">${escapeEditorHtml(rawLine)}</div>`;
  });
}

// One markdown source line → its editor HTML, given whether it starts inside a
// ``` fence. Returns the fence state after it. Highlighting is otherwise
// line-local, which is what lets renderEditorContent memoize it per line.
function highlightMarkdownLine(rawLine, inFence) {
  const escaped = escapeEditorHtml(rawLine);
  const trimmed = rawLine.trimStart();

  if (!trimmed) {
    return { html: renderWhitespaceOnlyEditorLine(rawLine), inFence };
  }

  if (trimmed.startsWith("```")) {
    return { html: `<div class="editor-line"><span class="token-fence">${escaped}</span></div>`, inFence: !inFence };
  }

  if (inFence) {
    return { html: `<div class="editor-line"><span class="token-code-block">${escaped}</span></div>`, inFence };
  }

  if (/^\s*#{1,6}\s/.test(rawLine)) {
    const [, indent, hashes, space, text] = rawLine.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
    return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-heading-mark">${escapeEditorHtml(hashes)}</span>${escapeEditorHtml(space)}<span class="token-heading-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`, inFence };
  }

  if (/^\s*-\s+/.test(rawLine)) {
    const [, indent, marker, text] = rawLine.match(/^(\s*)(-)\s+(.*)$/);
    return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-list-mark">${marker}</span> ${applyInlineHighlighting(escapeEditorHtml(text || ""))}</div>`, inFence };
  }

  if (/^\s*>\s?/.test(rawLine)) {
    const [, indent, marker, text] = rawLine.match(/^(\s*)(>)(\s?.*)$/);
    return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-quote-mark">${marker}</span><span class="token-quote-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`, inFence };
  }

  return { html: `<div class="editor-line">${applyInlineHighlighting(escaped)}</div>`, inFence };
}

function highlightMarkdownLines(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  return lines.map((rawLine) => {
    const result = highlightMarkdownLine(rawLine, inFence);
    inFence = result.inFence;
    return result.html;
  });
}

function highlightMarkdownSource(value) {
  return highlightMarkdownLines(value).join("");
}

function getEditorLineHeight() {
  const lineHeight = Number.parseFloat(globalThis.getComputedStyle(elements.editorContent).lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : 20.8;
}

// Width of a single space in the editor font — used to render a remote selection
// on an EMPTY line as a small sliver (matching the browser's native empty-line
// selection on the source), instead of the full-width block box getClientRects
// hands back for a contentless line. Cached per font string.
let _editorSpaceWidthCache = null;
function getEditorSpaceWidth() {
  const cs = globalThis.getComputedStyle(elements.editorContent);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  if (_editorSpaceWidthCache && _editorSpaceWidthCache.font === font) return _editorSpaceWidthCache.width;
  const canvas = _editorSpaceWidthCache?.canvas || document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  const width = ctx.measureText(" ").width || Number.parseFloat(cs.fontSize) * 0.3 || 4;
  _editorSpaceWidthCache = { font, width, canvas };
  return width;
}

function getLeadingIndentColumns(line) {
  let columns = 0;
  for (const character of line) {
    if (character === "\t") {
      columns += getIndentColumnWidth();
      continue;
    }
    if (character === " ") {
      columns += 1;
      continue;
    }
    break;
  }
  return columns;
}

function getOffsetWithinTextRoot(root, container, offset) {
  if (!root) {
    return 0;
  }

  if (container.nodeType === Node.TEXT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (current === container) {
        return total + Math.min(offset, current.textContent?.length ?? 0);
      }
      total += current.textContent?.length ?? 0;
    }
    return total;
  }

  const childNodes = Array.from(container.childNodes).slice(0, offset);
  return childNodes.reduce((total, child) => total + (child.textContent?.length ?? 0), 0);
}

function getEditorTextOffsetFromPoint(clientX, clientY) {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    return getEditorSelection().start;
  }
  const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
  const caretPosition = document.caretPositionFromPoint?.(clientX, clientY);
  const container = caretRange?.startContainer ?? caretPosition?.offsetNode;
  const posOffset = caretRange?.startOffset ?? caretPosition?.offset;
  if (!container) {
    return getEditorSelection().start;
  }
  return domPositionToTextOffset(container, posOffset ?? 0);
}

function clearEditorDropCaret() {
  editorDragState.dropOffset = null;
  elements.editorDropCaret.hidden = true;
}

function showEditorDropCaret(clientX, clientY) {
  const offset = getEditorTextOffsetFromPoint(clientX, clientY);
  editorDragState.dropOffset = offset;

  const markerRange = document.createRange();
  const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
  const caretPosition = document.caretPositionFromPoint?.(clientX, clientY);
  const container = caretRange?.startContainer ?? caretPosition?.offsetNode;
  const positionOffset = caretRange?.startOffset ?? caretPosition?.offset;
  if (!container) {
    clearEditorDropCaret();
    return;
  }
  markerRange.setStart(container, positionOffset);
  markerRange.setEnd(container, positionOffset);
  const rect = markerRange.getBoundingClientRect();
  const hostRect = elements.editorScroll.getBoundingClientRect();
  const height = rect.height || getEditorLineHeight();
  elements.editorDropCaret.style.left = `${elements.editorContent.scrollLeft + rect.left - hostRect.left}px`;
  elements.editorDropCaret.style.top = `${elements.editorContent.scrollTop + rect.top - hostRect.top}px`;
  elements.editorDropCaret.style.height = `${height}px`;
  elements.editorDropCaret.hidden = false;
}

// Cached toolbar format so we only rebuild the buttons when it actually changes
// (renderEditorContent runs on every keystroke). null = toolbar hidden.
let currentToolbarFormat = undefined;

/** Show/hide and (re)build the formatting toolbar for the active file. */
function refreshFormatToolbar() {
  const toolbar = elements.editorFormatToolbar;
  if (!toolbar) return;
  const activeFile = controller.getActiveFile();
  const format = settings.showFormatToolbar ? getEditorToolbarFormat(activeFile?.name ?? "") : null;

  toolbar.hidden = format === null;
  if (format === currentToolbarFormat) return;
  currentToolbarFormat = format;

  if (format === null) {
    toolbar.replaceChildren();
    return;
  }
  renderEditorFormatToolbar(toolbar, format, { onAction: applyToolbarAction });
}

/** Re-render syntax-highlighted DOM from plain text and rebuild the gutter.
 *  Does NOT modify the selection — callers are responsible for restoring it. */
// ── Incremental editor rendering ────────────────────────────────────────────
// Every keystroke used to rebuild the whole editor (innerHTML of every line) and
// then measure every line's height for the gutter. On a novel-length chapter
// (~90k chars, ~2,400 lines) that discarded and re-laid-out ~18k nodes per key,
// and every later layout read in the same task — scroll sync, caret, chat panel —
// paid for a full-document relayout again: ~10 forced layouts per keystroke.
//
// Now each line's HTML is computed as before (whole text, so multi-line state
// like ``` fences stays correct) but only DOM lines whose HTML actually changed
// are replaced. Unchanged lines keep their element, their layout, and their
// cached gutter height, so a keystroke re-lays-out one line instead of all.
//
// Correctness rests on knowing the DOM still matches the cache. Native edits
// (and mobile keyboards, which can inject bare <div>s) mutate it behind our back,
// so a line is reused only if it is the same element we rendered AND its text and
// child count are still what we rendered. Anything else is re-rendered, and any
// doubt — new file, different highlighter, stray text nodes, a count mismatch
// afterwards — falls back to the old full rebuild.

function editorHighlightKind(name) {
  if (name?.endsWith(".mtree")) return "mtree";
  if (name?.endsWith(".urldb")) return "urldb";
  if (isBmapFileName(name ?? "")) return "bmap";
  return "markdown";
}

function highlightEditorLines(kind, normalized) {
  if (kind === "mtree") return highlightMtreeLines(normalized);
  if (kind === "urldb") return highlightUrlDbLines(normalized);
  if (kind === "bmap") return highlightBmapLines(normalized);
  return highlightMarkdownLines(normalized);
}

// Highlighted HTML per distinct source line. Re-highlighting every line on every
// keystroke allocated tens of thousands of short-lived strings per key on a
// long chapter, and the garbage collector's pauses (up to ~200ms) became most
// of the typing latency. A line's HTML depends only on its text — plus, for
// markdown, whether it starts inside a ``` fence — so it is computed once.
const editorLineMemo = { kind: null, maps: [new Map(), new Map()] };

function highlightEditorLinesMemo(kind, lines) {
  if (editorLineMemo.kind !== kind) {
    editorLineMemo.kind = kind;
    editorLineMemo.maps = [new Map(), new Map()];
  }
  const maps = editorLineMemo.maps;
  if (maps[0].size + maps[1].size > Math.max(20000, lines.length * 4)) {
    maps[0].clear();
    maps[1].clear();
  }
  const out = new Array(lines.length);
  if (kind === "markdown") {
    let inFence = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const map = maps[inFence ? 1 : 0];
      let hit = map.get(line);
      if (hit === undefined) {
        const result = highlightMarkdownLine(line, inFence);
        hit = { html: result.html, inFence: result.inFence, plain: null };
        map.set(line, hit);
      }
      out[i] = hit;
      inFence = hit.inFence;
    }
  } else {
    const map = maps[0];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      let hit = map.get(line);
      if (hit === undefined) {
        // The other highlighters are stateless per line.
        hit = { html: highlightEditorLines(kind, line)[0], inFence: false, plain: null };
        map.set(line, hit);
      }
      out[i] = hit;
    }
  }
  return out;
}

// Fold the per-line wrap indent and agent decoration into the line's own HTML,
// so a line's HTML is a pure function of its content and can be compared.
function decorateEditorLineHtml(html, rawLine, decorated) {
  const indentCols = getLeadingIndentColumns(rawLine ?? "");
  if (!indentCols && !decorated) return html;
  const classes = `editor-line${indentCols > 0 ? " has-wrapped-indent" : ""}${decorated ? " is-agent-pending" : ""}`;
  const style = indentCols > 0 ? ` style="--wrapped-indent-columns:${indentCols}"` : "";
  return html.replace('<div class="editor-line"', `<div class="${classes}"${style}`);
}

// Empty lines need a <br> to render at full height and accept a caret.
function normalizeEditorLineElement(line) {
  if (line.childNodes.length === 0 ||
      (line.childNodes.length === 1 &&
       line.firstChild?.nodeName !== "BR" &&
       line.firstChild?.textContent === "")) {
    line.innerHTML = "<br>";
  }
}

function parseEditorLines(htmlList) {
  const tpl = document.createElement("template");
  tpl.innerHTML = htmlList.join("");
  const els = Array.from(tpl.content.children);
  els.forEach(normalizeEditorLineElement);
  return { fragment: tpl.content, els };
}

// Replace DOM lines [from, to) with freshly rendered lines for new indices
// [from, from + count) and splice the cache to match. Returns the new elements.
function spliceEditorLines(from, to, htmlSlice, textSlice) {
  const container = elements.editorContent;
  const before = container.children[to] ?? null;
  for (let i = to - 1; i >= from; i -= 1) container.children[i]?.remove();
  const { fragment, els } = parseEditorLines(htmlSlice);
  container.insertBefore(fragment, before);
  const cache = editorRenderCache;
  const removed = to - from;
  cache.els.splice(from, removed, ...els);
  // The DOM's own text for each new line (normally identical to the source).
  cache.texts.splice(from, removed, ...els.map((el, i) => {
    const actual = el.textContent;
    if (actual !== textSlice[i]) cache.textExact = false;
    return actual;
  }));
  cache.html.splice(from, removed, ...htmlSlice);
  cache.heights.splice(from, removed, ...els.map(() => null)); // measured below
  return els;
}

document.fonts?.addEventListener?.("loadingdone", () => {
  if (!editorRenderCache.els.length) return;
  editorRenderCache.metricsKey = "";
  renderEditorContent(getEditorText());
});

function renderEditorContent(text, { full = false } = {}) {
  refreshFormatToolbar();
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const activeFile = controller.getActiveFile();
  const kind = editorHighlightKind(activeFile?.name);

  const activeFilePath = activeFile ? getPath(controller.getProject(), activeFile.id) : null;
  const activeDecoration = activeFilePath ? agentPendingDecorations.get(activeFilePath) : null;
  const isDecorated = (index) => Boolean(activeDecoration)
    && index >= activeDecoration.lineStart && index <= activeDecoration.lineEnd;
  const lineHtml = highlightEditorLinesMemo(kind, lines).map((hit, index) => {
    if (isDecorated(index)) return decorateEditorLineHtml(hit.html, lines[index], true);
    if (hit.plain === null) hit.plain = decorateEditorLineHtml(hit.html, lines[index], false);
    return hit.plain;
  });

  const container = elements.editorContent;
  const cache = editorRenderCache;
  const tracker = trackEditorDom();
  const incremental = !full
    && cache.fileId === (activeFile?.id ?? null)
    && cache.kind === kind
    && cache.els.length > 0
    // Stray text nodes directly under the editor (some mobile edits) aren't
    // lines we can diff against; rebuild.
    && container.childNodes.length === container.children.length;

  if (incremental) {
    const dom = container.children;
    const domLen = dom.length;
    const cacheLen = cache.els.length;
    const newLen = lineHtml.length;
    // Unchanged leading lines: same element, untouched, same HTML.
    let prefix = 0;
    const maxPrefix = Math.min(domLen, cacheLen, newLen);
    while (prefix < maxPrefix
      && dom[prefix] === cache.els[prefix]
      && cache.html[prefix] === lineHtml[prefix]
      && !tracker.dirty.has(dom[prefix])) {
      prefix += 1;
    }
    // Unchanged trailing lines, matched from each end independently: a native
    // Enter can add an element the cache has never seen.
    let suffix = 0;
    const maxSuffix = Math.min(domLen, cacheLen, newLen) - prefix;
    while (suffix < maxSuffix) {
      const d = domLen - 1 - suffix;
      const c = cacheLen - 1 - suffix;
      const n = newLen - 1 - suffix;
      if (dom[d] === cache.els[c] && cache.html[c] === lineHtml[n] && !tracker.dirty.has(dom[d])) {
        suffix += 1;
      } else {
        break;
      }
    }
    // The cache must describe the same leading elements as the DOM for the
    // splice indices to line up; drop cache entries for DOM-only elements.
    const domEnd = domLen - suffix;
    const cacheEnd = cacheLen - suffix;
    if (domEnd - prefix !== cacheEnd - prefix) {
      // Native edits added/removed elements in the middle. Re-sync the cache's
      // middle section to the DOM's actual elements before splicing.
      const middle = Array.from(dom).slice(prefix, domEnd);
      cache.els.splice(prefix, cacheEnd - prefix, ...middle);
      cache.texts.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
      cache.html.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
      cache.heights.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
    }
    spliceEditorLines(prefix, domEnd, lineHtml.slice(prefix, newLen - suffix), lines.slice(prefix, newLen - suffix));
    // Safety net: if the DOM and the text disagree on the line count, the diff
    // assumptions failed somewhere — rebuild rather than show wrong text.
    if (container.children.length !== newLen) {
      return renderEditorContent(text, { full: true });
    }
  } else {
    container.innerHTML = lineHtml.join("");
    const els = Array.from(container.children);
    els.forEach(normalizeEditorLineElement);
    cache.fileId = activeFile?.id ?? null;
    cache.kind = kind;
    cache.els = els;
    cache.texts = els.map((el) => el.textContent);
    cache.textExact = cache.texts.length === lines.length && cache.texts.every((t, i) => t === lines[i]);
    cache.html = lineHtml.slice(0, els.length);
    cache.heights = els.map(() => null);
    cache.gutter = [];
    cache.metricsKey = "";
  }

  // Gutter heights. Reading geometry forces layout, but after an incremental
  // splice only the replaced lines are dirty, so it is cheap; and only lines
  // without a cached height are measured. A width change invalidates them all.
  const metrics = globalThis.getComputedStyle(container);
  const parsedLineHeight = Number.parseFloat(metrics.lineHeight);
  const minimumLineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 20.8;
  const metricsKey = `${container.clientWidth}|${metrics.lineHeight}|${metrics.fontSize}|${metrics.fontFamily}|${elements.app.dataset.wordWrap ?? ""}`;
  if (metricsKey !== cache.metricsKey) {
    cache.heights = cache.els.map(() => null);
    cache.metricsKey = metricsKey;
  }
  const heights = cache.heights;
  const remeasured = [];
  for (let i = 0; i < cache.els.length; i += 1) {
    if (heights[i] == null) {
      heights[i] = Math.max(minimumLineHeight, cache.els[i].getBoundingClientRect().height);
      remeasured.push(i);
    }
  }

  // Gutter rows, diffed the same way. The gutter is entirely ours (no native
  // edits), so plain index comparison is enough. A line-count change shifts the
  // numbers of every following row, which then re-render — rare (Enter/paste).
  const comments = commentsForActiveFile();
  const commentByLine = new Map(comments.map((comment) => [comment.line, comment]));
  // Row strings depend on the row index, its height, comments and the agent
  // range. A changed line count renumbers every following row, so rebuild all;
  // otherwise only rows that were just (re)measured can differ.
  const gutterEpoch = `${cache.els.length}|${activeDecoration ? `${activeDecoration.lineStart}-${activeDecoration.lineEnd}` : ""}|${comments.map((c) => `${c.line}:${c.author ?? ""}:${c.text}`).join("\u0001")}`;
  const gutterRow = (index) => {
    const decorated = isDecorated(index);
    const marker = decorated ? `<span class="editor-gutter-agent-mark" aria-hidden="true">◦</span>` : "";
    const comment = commentByLine.get(index);
    const commentMark = comment
      ? `<span class="editor-gutter-comment-mark" title="${escapeHtmlAttribute(`${comment.author ?? ""}: ${comment.text}`.trim())}" aria-hidden="true">●</span>`
      : "";
    return `<div class="editor-gutter-line${decorated ? " is-agent-pending" : ""}${comment ? " has-comment" : ""}" data-line="${index}" style="height:${heights[index].toFixed(3)}px">${marker}${commentMark}${index + 1}</div>`;
  };
  let gutterHtml;
  if (gutterEpoch !== cache.gutterEpoch || cache.gutter.length !== cache.els.length) {
    gutterHtml = cache.els.map((_, index) => gutterRow(index));
  } else {
    gutterHtml = cache.gutter.slice();
    for (const index of remeasured) gutterHtml[index] = gutterRow(index);
  }
  cache.gutterEpoch = gutterEpoch;
  let gutterContent = elements.editorGutter.firstElementChild;
  if (!gutterContent || !gutterContent.classList.contains("editor-gutter-content")
      || gutterContent.children.length !== cache.gutter.length) {
    elements.editorGutter.innerHTML = `<div class="editor-gutter-content">${gutterHtml.join("")}</div>`;
  } else {
    const rows = gutterContent.children;
    const oldLen = cache.gutter.length;
    const newLen = gutterHtml.length;
    let gp = 0;
    while (gp < oldLen && gp < newLen && cache.gutter[gp] === gutterHtml[gp]) gp += 1;
    let gs = 0;
    while (gs < oldLen - gp && gs < newLen - gp && cache.gutter[oldLen - 1 - gs] === gutterHtml[newLen - 1 - gs]) gs += 1;
    const before = rows[oldLen - gs] ?? null;
    for (let i = oldLen - gs - 1; i >= gp; i -= 1) rows[i].remove();
    if (newLen - gs > gp) {
      const tpl = document.createElement("template");
      tpl.innerHTML = gutterHtml.slice(gp, newLen - gs).join("");
      gutterContent.insertBefore(tpl.content, before);
    }
  }
  cache.gutter = gutterHtml;
  scheduleOverviewRuler(); // line geometry just changed

  // Sync gutter scroll position.
  syncEditorScroll();

  // Keep placeholder visible when content is empty.
  container.dataset.empty = normalized.length === 0 ? "true" : "false";

  // The DOM now matches the cache; reads can use it until the next mutation.
  markEditorDomSynced(cache.textExact ? normalized : null);

  // Update the floating in-editor agent action bar.
  updateEditorAgentBar();
}

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

let _linkTooltipTimer = null;
let _linkTooltipHideTimer = null;
let _linkTooltipCurrentHref = null;
let _lastHoveredLinkEl = null;

function resolveEditorLinkHref(href) {
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile || !href) return null;
  if (/^(https?:\/\/|mailto:|data:|blob:|#|\/)/i.test(href)) return null;
  const basePath = getPath(project, activeFile.id);
  const baseSegments = basePath.split("/").filter(Boolean);
  baseSegments.pop();
  const resolvedPath = normalizePath([...baseSegments, href].join("/"));
  const nodeId = getNodeIdByPath(project, resolvedPath);
  const node = nodeId ? project.nodes[nodeId] : null;
  return node?.kind === "file" ? { nodeId, node, path: resolvedPath } : null;
}

function openLinkFromEditor(href) {
  if (!href) return;
  if (/^https?:\/\//i.test(href)) {
    window.open(href, "_blank", "noreferrer");
    return;
  }
  const resolved = resolveEditorLinkHref(href);
  if (!resolved) {
    notify(`Cannot resolve link: ${href}`);
    return;
  }
  openFileFromExplorer(resolved.nodeId);
}

function showLinkTooltipContent(linkEl) {
  const href = linkEl.dataset.href ?? "";
  _linkTooltipCurrentHref = href;

  const project = controller.getProject();
  const resolved = resolveEditorLinkHref(href);

  if (!resolved) {
    editorLinkTooltip.nameEl.textContent = href || "(empty link)";
    if (/^https?:\/\//i.test(href)) {
      editorLinkTooltip.nameEl.className = "editor-link-tooltip-name";
      editorLinkTooltip.hintEl.textContent = "External — Ctrl+Click to open in browser";
      if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(href)) {
        editorLinkTooltip.previewEl.innerHTML = `<img src="${escapeHtmlAttribute(href)}" alt="" style="max-width:100%;height:auto">`;
        editorLinkTooltip.previewEl.hidden = false;
      } else {
        editorLinkTooltip.previewEl.innerHTML = "";
        editorLinkTooltip.previewEl.hidden = true;
      }
    } else {
      editorLinkTooltip.nameEl.className = "editor-link-tooltip-name is-unresolved";
      editorLinkTooltip.hintEl.textContent = "File not found in project";
      editorLinkTooltip.previewEl.innerHTML = "";
      editorLinkTooltip.previewEl.hidden = true;
    }
    return;
  }

  const { node, nodeId } = resolved;
  editorLinkTooltip.nameEl.textContent = resolved.path;
  editorLinkTooltip.nameEl.className = "editor-link-tooltip-name";
  editorLinkTooltip.hintEl.textContent = "Follow Link (Ctrl+Click)";
  editorLinkTooltip.previewEl.hidden = false;

  if (isMarkdownFileName(node.name)) {
    editorLinkTooltip.previewEl.innerHTML = renderMarkdown(node.content, {
      resolveUrl(url) { return resolveProjectAssetUrl(project, nodeId, url); }
    });
  } else if (isImageFileName(node.name)) {
    editorLinkTooltip.previewEl.innerHTML = `<img src="${escapeHtmlAttribute(imageSrcFor(project, node))}" alt="${escapeHtmlAttribute(node.name)}" style="max-width:100%;height:auto">`;
  } else {
    editorLinkTooltip.previewEl.innerHTML = `<pre><code>${escapeEditorHtml(node.content ?? "")}</code></pre>`;
  }
}

function positionLinkTooltip(clientX, clientY) {
  const el = editorLinkTooltip.el;
  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const ttW = 380;
  const ttMaxH = 320;
  let left = clientX + 14;
  let top = clientY + 18;
  if (left + ttW > vpW - 8) left = clientX - ttW - 14;
  if (top + ttMaxH > vpH - 8) top = Math.max(8, clientY - ttMaxH - 8);
  el.style.left = `${Math.max(4, left)}px`;
  el.style.top = `${Math.max(4, top)}px`;
}

function showLinkTooltip(linkEl, clientX, clientY) {
  clearTimeout(_linkTooltipTimer);
  clearTimeout(_linkTooltipHideTimer);
  const href = linkEl.dataset.href ?? "";
  if (!href) return;
  _linkTooltipTimer = setTimeout(() => {
    if (_lastHoveredLinkEl !== linkEl) return;
    showLinkTooltipContent(linkEl);
    editorLinkTooltip.el.hidden = false;
    positionLinkTooltip(clientX, clientY);
  }, 400);
}

function hideLinkTooltip(immediate = false) {
  clearTimeout(_linkTooltipTimer);
  if (immediate) {
    editorLinkTooltip.el.hidden = true;
    _linkTooltipCurrentHref = null;
    return;
  }
  clearTimeout(_linkTooltipHideTimer);
  _linkTooltipHideTimer = setTimeout(() => {
    if (!editorLinkTooltip.el.matches(":hover")) {
      editorLinkTooltip.el.hidden = true;
      _linkTooltipCurrentHref = null;
    }
  }, 120);
}

function handleEditorLinkHover(event) {
  const activeFile = controller.getActiveFile();
  if (!isMarkdownFileName(activeFile?.name ?? "")) {
    if (!editorLinkTooltip.el.hidden) hideLinkTooltip(true);
    _lastHoveredLinkEl = null;
    return;
  }
  const linkEl = event.target?.closest?.(".token-link[data-href]") ?? null;
  if (linkEl !== _lastHoveredLinkEl) {
    _lastHoveredLinkEl = linkEl;
    if (linkEl) {
      showLinkTooltip(linkEl, event.clientX, event.clientY);
    } else if (!editorLinkTooltip.el.matches(":hover")) {
      hideLinkTooltip();
    }
  }
}

function handleEditorMouseLeave() {
  _lastHoveredLinkEl = null;
  hideLinkTooltip();
}

editorLinkTooltip.el.addEventListener("mouseleave", () => hideLinkTooltip(true));

// ── Links panel (outgoing + backlinks) ───────────────────────────────────────

const linksPanelEl = document.getElementById("links-panel");
const outgoingLinksListEl = document.getElementById("outgoing-links-list");
const backlinksListEl = document.getElementById("backlinks-list");

// Links found in each file, reused while its text is unchanged. Backlinks scan
// every markdown file in the workspace, so this panel re-parsed the inline
// markdown of the whole project on every render — more work than the preview.
// File contents are shared between project versions now, so an unchanged file
// is usually the very same string and the check is free.
const markdownLinksCache = new Map(); // node id -> { content, links }

function cachedMarkdownLinks(nodeId, content) {
  const text = content ?? "";
  const hit = markdownLinksCache.get(nodeId);
  if (hit && hit.content === text) return hit.links;
  const links = extractMarkdownLinks(text);
  if (markdownLinksCache.size > 2000) markdownLinksCache.clear();
  markdownLinksCache.set(nodeId, { content: text, links });
  return links;
}

function renderLinksPanel(project, activeFile) {
  if (!linksPanelEl) return;
  if (!activeFile || !isMarkdownFileName(activeFile.name)) {
    linksPanelEl.hidden = true;
    return;
  }
  linksPanelEl.hidden = false;

  const activePath = getPath(project, activeFile.id);
  const activeSegments = activePath.split("/").filter(Boolean);
  activeSegments.pop();

  // Outgoing links
  const outgoingLinks = cachedMarkdownLinks(activeFile.id, activeFile.content);
  outgoingLinksListEl.replaceChildren();
  if (outgoingLinks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "links-item links-item-empty";
    empty.textContent = "No outgoing links";
    outgoingLinksListEl.append(empty);
  } else {
    outgoingLinks.forEach(({ label, href }) => {
      const item = document.createElement("div");
      item.className = "links-item";
      const isExternal = /^(https?:\/\/|mailto:)/i.test(href);
      let resolvedId = null;
      if (!isExternal) {
        const resolvedPath = normalizePath([...activeSegments, href].join("/"));
        resolvedId = getNodeIdByPath(project, resolvedPath);
      }
      const missing = !isExternal && !resolvedId;
      item.classList.toggle("links-item-unresolved", missing);

      const labelEl = document.createElement("span");
      labelEl.className = "links-item-label";
      labelEl.textContent = label !== href ? label : "";

      const hrefEl = document.createElement("span");
      hrefEl.className = "links-item-href";
      hrefEl.textContent = href;

      item.append(labelEl, hrefEl);

      if (resolvedId) {
        item.title = getPath(project, resolvedId);
        item.classList.add("links-item-clickable");
        item.addEventListener("click", () => openFileFromExplorer(resolvedId));
      } else if (isExternal) {
        item.classList.add("links-item-clickable");
        item.addEventListener("click", () => window.open(href, "_blank", "noreferrer"));
      }
      outgoingLinksListEl.append(item);
    });
  }

  // Backlinks — scan all .md files for links pointing to the active file
  const backlinks = [];
  Object.values(project.nodes).forEach((node) => {
    if (node.kind !== "file" || !isMarkdownFileName(node.name) || node.id === activeFile.id) return;
    const nodePath = getPath(project, node.id);
    const nodeSegments = nodePath.split("/").filter(Boolean);
    nodeSegments.pop();
    const links = cachedMarkdownLinks(node.id, node.content);
    const matchCount = links.filter(({ href }) => {
      if (/^(https?:\/\/|mailto:)/i.test(href)) return false;
      return normalizePath([...nodeSegments, href].join("/")) === activePath;
    }).length;
    if (matchCount > 0) backlinks.push({ node, nodePath, matchCount });
  });

  backlinksListEl.replaceChildren();
  if (backlinks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "links-item links-item-empty";
    empty.textContent = "No backlinks";
    backlinksListEl.append(empty);
  } else {
    backlinks.forEach(({ node, nodePath, matchCount }) => {
      const item = document.createElement("div");
      item.className = "links-item links-item-clickable";
      item.title = nodePath;
      const labelEl = document.createElement("span");
      labelEl.className = "links-item-label";
      labelEl.textContent = node.name;
      const countEl = document.createElement("span");
      countEl.className = "links-item-count";
      countEl.textContent = matchCount > 1 ? `${matchCount}×` : "";
      item.append(labelEl, countEl);
      item.addEventListener("click", () => openFileFromExplorer(node.id));
      backlinksListEl.append(item);
    });
  }
}

function syncEditorScroll() {
  const scrollTop = elements.editorContent.scrollTop;
  const gutterContent = elements.editorGutter.firstElementChild;
  if (gutterContent) {
    gutterContent.style.transform = `translateY(${-scrollTop}px)`;
  }
}

// Keep the caret visible while typing. The per-keystroke innerHTML rebuild +
// focus({preventScroll:true}) suppresses the browser's native "scroll caret into
// view", so after Enter/typing the caret can sit below the fold. This re-adds it
// but as a NO-OP whenever the caret is already visible, so it never fights
// mouse-driven scrolling. The real scroller is #editor-content (not #editor-scroll,
// which is overflow:hidden).
function caretIntoView(margin = getEditorLineHeight()) {
  if (document.activeElement !== elements.editorContent) return;
  const sel = globalThis.getSelection?.();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0).cloneRange();
  if (!elements.editorContent.contains(range.startContainer)) return;
  range.collapse(false); // track the focus/end offset — where the caret lands after the edit
  let caretRect = range.getClientRects()[0];
  if (!caretRect) {
    const b = range.getBoundingClientRect();
    if (b && (b.height || b.top)) caretRect = b;
  }
  if (!caretRect) {
    // Empty line: fall back to the line box (same pattern as the autocomplete positioner).
    const anchor = sel.focusNode;
    const el = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    const lineEl = el?.closest?.(".editor-line");
    if (lineEl) caretRect = lineEl.getBoundingClientRect();
  }
  if (!caretRect) return;
  const view = elements.editorContent.getBoundingClientRect();
  const topLimit = view.top + margin;
  const bottomLimit = view.bottom - margin;
  let delta = 0;
  if (caretRect.bottom > bottomLimit) delta = caretRect.bottom - bottomLimit; // below → scroll down
  else if (caretRect.top < topLimit) delta = caretRect.top - topLimit;        // above → scroll up
  if (delta === 0) return; // already visible → leave the user's scroll position alone
  elements.editorContent.scrollTop += delta;
  syncEditorScroll();
}

function forwardEditorWheel(event) {
  const hasVertical = event.deltaY !== 0;
  const hasHorizontal = event.deltaX !== 0;
  if (!hasVertical && !hasHorizontal) {
    return;
  }
  elements.editorContent.scrollTop += event.deltaY;
  elements.editorContent.scrollLeft += event.deltaX;
  syncEditorScroll();
  event.preventDefault();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getIndentText() {
  return settings.indentStyle === "spaces" ? "    " : "\t";
}

function getIndentColumnWidth() {
  return settings.indentStyle === "spaces" ? 4 : 4;
}

function getLineSelectionRange(value, selectionStart, selectionEnd) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  let lineEnd = value.indexOf("\n", selectionEnd);
  if (lineEnd < 0) {
    lineEnd = value.length;
  }
  return { lineStart, lineEnd };
}

/** Indent/unindent selected lines in the main contenteditable editor. */
function adjustSelectedLinesIndent(direction) {
  const value = getEditorText();
  const { start: selectionStart, end: selectionEnd } = getEditorSelection();
  const indentText = getIndentText();
  const { lineStart, lineEnd } = getLineSelectionRange(value, selectionStart, selectionEnd);
  const selectedText = value.slice(lineStart, lineEnd);
  const lines = selectedText.split("\n");

  if (direction > 0) {
    const nextLines = lines.map((line) => `${indentText}${line}`);
    const nextText = nextLines.join("\n");
    const nextSelectionStart = selectionStart + indentText.length;
    const nextSelectionEnd = selectionEnd + (indentText.length * lines.length);
    replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
    return;
  }

  let removedBeforeSelectionStart = 0;
  let removedTotal = 0;
  const nextLines = lines.map((line, index) => {
    let removed = 0;
    if (line.startsWith("\t")) {
      removed = 1;
    } else if (line.startsWith(indentText)) {
      removed = indentText.length;
    } else {
      const leadingSpaces = (line.match(/^ +/)?.[0].length) ?? 0;
      removed = Math.min(leadingSpaces, indentText.length);
    }

    if (removed > 0) {
      removedTotal += removed;
      if (index === 0) {
        removedBeforeSelectionStart = removed;
      }
      return line.slice(removed);
    }
    return line;
  });

  const nextText = nextLines.join("\n");
  const nextSelectionStart = Math.max(lineStart, selectionStart - removedBeforeSelectionStart);
  const nextSelectionEnd = Math.max(nextSelectionStart, selectionEnd - removedTotal);
  replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
}

/** Indent/unindent selected lines in a plain <textarea> (used by MTREE dialog). */
function adjustTextareaLinesIndent(textarea, direction) {
  const value = textarea.value;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const indentText = getIndentText();
  const { lineStart, lineEnd } = getLineSelectionRange(value, selectionStart, selectionEnd);
  const selectedText = value.slice(lineStart, lineEnd);
  const lines = selectedText.split("\n");

  if (direction > 0) {
    const nextLines = lines.map((line) => `${indentText}${line}`);
    const nextText = nextLines.join("\n");
    const nextSelectionStart = selectionStart + indentText.length;
    const nextSelectionEnd = selectionEnd + (indentText.length * lines.length);
    replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
    return;
  }

  let removedBeforeSelectionStart = 0;
  let removedTotal = 0;
  const nextLines = lines.map((line, index) => {
    let removed = 0;
    if (line.startsWith("\t")) {
      removed = 1;
    } else if (line.startsWith(indentText)) {
      removed = indentText.length;
    } else {
      const leadingSpaces = (line.match(/^ +/)?.[0].length) ?? 0;
      removed = Math.min(leadingSpaces, indentText.length);
    }

    if (removed > 0) {
      removedTotal += removed;
      if (index === 0) {
        removedBeforeSelectionStart = removed;
      }
      return line.slice(removed);
    }
    return line;
  });

  const nextText = nextLines.join("\n");
  const nextSelectionStart = Math.max(lineStart, selectionStart - removedBeforeSelectionStart);
  const nextSelectionEnd = Math.max(nextSelectionStart, selectionEnd - removedTotal);
  replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
}

/** Insert an indent at the caret in the main contenteditable editor. */
function insertIndentAtCursor() {
  const indentText = getIndentText();
  const { start, end } = getEditorSelection();
  traceEditorEvent("Tab indent before", { indent: formatEditorDebugValue(indentText) });
  replaceEditorRange(start, end, indentText, start + indentText.length, start + indentText.length);
  traceEditorEvent("Tab indent after", { indent: formatEditorDebugValue(indentText) });
}

/** Insert an indent at the caret in a plain <textarea> (used by MTREE dialog). */
function insertIndentIntoTextarea(textarea) {
  const indentText = getIndentText();
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const nextCaret = selectionStart + indentText.length;
  textarea.setRangeText(indentText, selectionStart, selectionEnd, "end");
  textarea.setSelectionRange(nextCaret, nextCaret);
  dispatchTextareaInput(textarea, selectionStart === selectionEnd ? "insertText" : "insertReplacementText");
}

function handleIndentKeydown(event) {
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }
  traceEditorEvent("Tab keydown", { shift: event.shiftKey ? "yes" : "no" });
  event.preventDefault();
  const target = event.currentTarget;
  if (target.tagName === "TEXTAREA") {
    // MTREE output textarea uses the plain-DOM helpers.
    if (target.selectionStart !== target.selectionEnd || event.shiftKey) {
      adjustTextareaLinesIndent(target, event.shiftKey ? -1 : 1);
      return;
    }
    insertIndentIntoTextarea(target);
  } else {
    // Main contenteditable editor.
    const { start, end } = getEditorSelection();
    if (start !== end || event.shiftKey) {
      adjustSelectedLinesIndent(event.shiftKey ? -1 : 1);
      return;
    }
    insertIndentAtCursor();
  }
}

function handleEditorKeydown(event) {
  if (event.key === " " || event.key === "Enter") {
    traceEditorEvent("Keydown", { key: event.key === " " ? "Space" : event.key });
  }
  if (event.key === "Tab") {
    traceEditorEvent("Keydown", { key: "Tab" });
  }
  // Find / Replace (Ctrl/Cmd+F, Ctrl/Cmd+H).
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openFindBar(false);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "h") {
    event.preventDefault();
    openFindBar(true);
    return;
  }
  // Custom undo/redo — must intercept before the browser's native handler,
  // because innerHTML-rerender destroys the browser's native undo stack.
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
    event.preventDefault();
    editorUndo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) &&
      (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
    event.preventDefault();
    editorRedo();
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === " ") {
    event.preventDefault();
    showEditorAutocomplete(true);
    return;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
    const key = event.key.toLowerCase();
    // Bold/italic markers are Markdown-only.
    const isMarkdown = getEditorToolbarFormat(controller.getActiveFile()?.name ?? "") === "markdown";
    if (key === "b" && isMarkdown) {
      event.preventDefault();
      applyToolbarAction({ kind: "wrap", before: "**", after: "**", placeholder: "bold text" });
      return;
    }
    if (key === "i" && isMarkdown) {
      event.preventDefault();
      applyToolbarAction({ kind: "wrap", before: "*", after: "*", placeholder: "italic text" });
      return;
    }
  }

  if (!elements.editorAutocomplete.hidden) {
    // Space dismisses autocomplete so the user can keep typing freely.
    if (event.key === " ") {
      hideEditorAutocomplete();
      // Do not preventDefault — the space character should still be inserted.
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      autocompleteState.activeIndex = (autocompleteState.activeIndex + 1) % autocompleteState.items.length;
      autocompleteState.userChose = true;
      renderEditorAutocomplete();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      autocompleteState.activeIndex = (autocompleteState.activeIndex - 1 + autocompleteState.items.length) % autocompleteState.items.length;
      autocompleteState.userChose = true;
      renderEditorAutocomplete();
      return;
    }
    // Tab always accepts. Enter only accepts a suggestion the user actually
    // picked; otherwise it inserts a newline and just dismisses the popup.
    // Enter-accepts-by-default silently replaced typed text with a word already
    // in the document (type "zero", press Enter, get "zeroalpha") — it read as
    // the editor corrupting your text.
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      traceEditorEvent("Autocomplete accepted from keydown", { key: event.key });
      acceptEditorAutocomplete();
      return;
    }
    if (event.key === "Enter") {
      if (autocompleteState.userChose) {
        event.preventDefault();
        traceEditorEvent("Autocomplete accepted from keydown", { key: event.key });
        acceptEditorAutocomplete();
        return;
      }
      hideEditorAutocomplete(); // fall through: the newline is inserted normally
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideEditorAutocomplete();
      return;
    }
  }

  handleIndentKeydown(event);
}
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
  elements.toggleDebugMenuButton.textContent = settings.debugPanel ? "Hide Log Panel" : "Show Log Panel";
  elements.toggleChatButton.textContent = settings.chatPanel === "shown" ? "Hide Chat" : "Show Chat";
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

function closeMenus() {
  menuPairs.forEach(([button, menu]) => {
    button.classList.remove("is-open");
    menu.hidden = true;
  });
}

function toggleMenu(button, menu) {
  const shouldOpen = menu.hidden;
  closeMenus();
  if (shouldOpen) {
    button.classList.add("is-open");
    menu.hidden = false;
  }
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-group")) {
    closeMenus();
  }
});

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

menuPairs.forEach(([button, menu]) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMenu(button, menu);
  });
  menu.querySelectorAll("button").forEach((menuButton) => {
    menuButton.addEventListener("click", closeMenus);
  });
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
  elements.serverStatusBarText.textContent = syncState.status === "sync-error" ? "Sync paused" : syncState.account
    ? (syncState.status === "connected"
        ? syncState.account.username
        : `Logged in as ${syncState.account.username}`)
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
    ? "Select or create a .md, .mtree, .urldb, or image file"
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

  // The preview view already re-rendered itself for this edit; suppress the
  // redundant preview re-render in the synchronous updateStatus that follows.
  _previewUpdating = true;
  try {
    controller.updateContent(fileId, nextContent);
  } finally {
    _previewUpdating = false;
  }
  publishOperation({
    type: "update-file",
    path: getPath(project, fileId),
    content: nextContent
  });
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
      accountToken: syncState.account?.token
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

elements.saveButton.addEventListener("click", async () => {
  await handleSaveCommand();
});

elements.savePdfButton.addEventListener("click", printPreviewAsPdf);
elements.exportButton.addEventListener("click", () => exportNode(controller.getProject().rootId));
elements.exportSelectedButton.addEventListener("click", () => exportNode(getSelectedNode(controller.getProject())?.id ?? controller.getProject().rootId));

elements.newProjectButton.addEventListener("click", async () => {
  logDebug("action", "New project requested");
  closeMenus();
  // No local store and no server account: keep the legacy in-browser workspace.
  if (!supportsOpfs() && !syncState.account) {
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
});

elements.openDirectoryButton.addEventListener("click", async () => {
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
});

elements.openProjectButton?.addEventListener("click", () => {
  closeMenus();
  logDebug("action", "Open project browser");
  // Default to the server side when signed in (it replaces the old "Open Server
  // Directory"), else start on this device. The in-dialog toggle switches sides.
  openFileBrowser({ side: syncState.account ? "server" : "local", intent: "open" });
});

elements.fileManagerButton?.addEventListener("click", () => {
  closeMenus();
  logDebug("action", "Open file manager");
  openFileBrowser({ side: syncState.account ? "server" : "local", mode: "manage" });
});

elements.importFileButton.addEventListener("click", () => elements.importFileInput.click());

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

elements.findReplaceMenuButton?.addEventListener("click", () => openFindBar(true));
elements.createSnapshotButton?.addEventListener("click", () => void createSnapshotNow());
elements.snapshotsButton?.addEventListener("click", () => void openSnapshotsDialog());
elements.workspaceHistoryButton?.addEventListener("click", () => void openWorkspaceHistory());
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
elements.renameSelectedButton.addEventListener("click", () => {
  void renameSelected();
});
elements.deleteSelectedButton.addEventListener("click", () => {
  void deleteSelected();
});
elements.newMarkdownButton.addEventListener("click", () => createItem("md"));
elements.newMtreeButton.addEventListener("click", () => createItem("mtree"));
elements.newUrlDbButton.addEventListener("click", () => createItem("urldb"));
elements.newBmapButton.addEventListener("click", () => createItem("bmap"));
elements.newPersonaButton.addEventListener("click", () => createItem("persona"));
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
document.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() !== "s" || (!event.ctrlKey && !event.metaKey) || event.altKey) {
    return;
  }
  event.preventDefault();
  void handleSaveCommand();
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
  elements.settingsMenu.hidden = true;
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
  elements.settingsMenu.hidden = true;
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

  elements.settingsMenu.hidden = true;
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

elements.toggleExplorerMenuButton.addEventListener("click", toggleExplorer);
elements.togglePreviewButton.addEventListener("click", togglePreview);
elements.toggleSourceButton?.addEventListener("click", toggleSource);
elements.toggleChatButton.addEventListener("click", toggleChat);
elements.toggleLogButton.addEventListener("click", toggleLogPanel);
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
    elements.welcomeOpenServer.hidden = !syncState.account;
  }
}

elements.welcomeNewFile?.addEventListener("click", openNewFileDialog);
elements.welcomeOpenLocal?.addEventListener("click", () => elements.openDirectoryButton?.click());
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

elements.openSettingsMenuButton.addEventListener("click", () => {
  logDebug("action", "Settings dialog opened from menu");
  openSettingsDialog("appearance");
});

// Status-bar footer items double as shortcuts to their related menus/panels.
elements.statusSourceItem.addEventListener("click", () => {
  logDebug("action", "Status bar: open directory");
  elements.openDirectoryButton.click();
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

elements.toggleDebugMenuButton.addEventListener("click", toggleLogPanel);
elements.resetWorkspaceMenuButton.addEventListener("click", () => {
  void resetToDefaultWorkspace();
});
elements.emptyWorkspaceMenuButton.addEventListener("click", () => {
  void emptyEverything();
});
elements.clearCacheMenuButton.addEventListener("click", () => {
  void clearAllCache();
});

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
    const data = await browseServer(settings.serverUrl, syncState.account.token, team, rel);
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
    await mkdirServer(settings.serverUrl, syncState.account.token, team, rel, name);
  },
  async createProject(path, name) {
    const { team, rel } = splitServerPath(path);
    const created = await createProjectServer(settings.serverUrl, syncState.account.token, team, rel, name);
    return { path: `${team}/${created.path}`, name };
  },
  async openProject(entry) {
    const { team, rel } = splitServerPath(entry.path);
    await handleOpenWorkspace(team, rel, { reason: "file-manager-open" });
  },
  async delete(entry) {
    const { team, rel } = splitServerPath(entry.path);
    await deleteServer(settings.serverUrl, syncState.account.token, team, rel);
  },
  async exportModel(entry) {
    const { team, rel } = splitServerPath(entry.path);
    const data = await exportProjectServer(settings.serverUrl, syncState.account.token, team, rel);
    return { name: data.name ?? entry.name, project: data.project };
  },
  async importModel(destPath, name, project) {
    const { team, rel } = splitServerPath(destPath);
    const created = await importProjectServer(settings.serverUrl, syncState.account.token, team, rel, name, project);
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
  const proven = settings.accountSuccess?.[normalizeServerUrl(settings.serverUrl)];
  if (syncState.accountsAvailable && proven === settings.accountUsername && proven && settings.accountPassword) {
    await performLogin(settings.accountUsername, settings.accountPassword, { silent: true, isCurrent });
  }
  const target = rememberedWorkspace(settings.lastWorkspace) ?? last;
  if (target && syncState.account) {
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