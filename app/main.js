import { ROOT_ID, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isAllowedFileName, isBmapFileName, isImageFileName, isTextFileName, isUrlDbFileName } from "./domain/project-model.js";
import { createProjectController, seedDefaultProject } from "./domain/project-service.js";
import { importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess } from "./services/fs-access-service.js";
import { createCollaborationRuntime } from "./services/collaboration-service.js";
import { fetchChatStatus, fetchServerChatWorkspace, pushServerChatWorkspace, sendChatRequest, sendGenerationRequest } from "./services/chat-api-service.js";
import { createChatMessage, createChatThread, deriveChatTitle, loadChatWorkspace, saveChatWorkspace } from "./services/chat-storage-service.js";
import { dataUrlToBlob, getExportBytes, getMimeTypeForFileName, readFileAsProjectContent } from "./services/file-content-service.js";
import { extractMarkdownLinks, renderMarkdown } from "./services/markdown-service.js";
import { buildModuleMapSection, replaceOrAppendModuleMap } from "./services/mtree-module-map-service.js";
import { clearOfflineShellData, registerOfflineShell } from "./services/offline-service.js";
import { applyTheme, loadSettings, saveSettings } from "./services/settings-service.js";
import { loadProject, saveProject } from "./services/storage-service.js";
import { createWorkspace, listWorkspaces, loginToServer, normalizeServerUrl, pingServer } from "./services/sync-service.js";
import { loadTemplateProject } from "./services/template-service.js";
import { appendUrlDbEntry, formatUrlDbEntryBody, moveUrlDbEntry, moveUrlDbEntryBetweenFiles, parseUrlDb, parseUrlDbEntryBody, removeUrlDbEntry, serializeUrlDb, updateUrlDbEntry } from "./services/urldb-service.js";
import { createZip, downloadBlob } from "./services/zip-service.js";
import { query } from "./ui/dom.js";
import { createExplorerView } from "./ui/explorer-view.js";
import { createBmapView, renderBmapToSvg } from "./ui/bmap-view.js";
import { buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./ui/editor-format-toolbar.js";
import { createTableGridPicker } from "./ui/table-grid-picker.js";
import { createDefaultBmap, normalizeBmapAst, parseBmap } from "./services/bmap-service.js";

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
  explorerTree: query("#explorer-tree"),
  explorerContextMenu: query("#explorer-context-menu"),
  explorerFilterButton: query("#explorer-filter-button"),
  explorerAddButton: query("#explorer-add-button"),
  projectNameLabel: query("#project-name-label"),
  editorGutter: query("#editor-gutter"),
  editorScroll: query("#editor-scroll"),
  editorContent: query("#editor-content"),
  editorDropCaret: query("#editor-drop-caret"),
  editorAgentBar: query("#editor-agent-bar"),
  editorCursors: query("#editor-cursors"),
  editorAutocomplete: query("#editor-autocomplete"),
  editorFormatToolbar: query("#editor-format-toolbar"),
  formatToolbarInput: query("#format-toolbar-input"),
  editorAutocompleteLabel: query("#editor-autocomplete-label"),
  editorAutocompleteList: query("#editor-autocomplete-list"),
  preview: query("#preview-output"),
  mtreeToolsDialog: query("#mtree-tools-dialog"),
  mtreeSourceText: query("#mtree-source-text"),
  mtreeSimplifyInput: query("#mtree-simplify-input"),
  mtreeContinuationInput: query("#mtree-continuation-input"),
  mtreeIncludeNavigationInput: query("#mtree-include-navigation-input"),
  mtreeIncludeModulesInput: query("#mtree-include-modules-input"),
  mtreeIncludeParentsInput: query("#mtree-include-parents-input"),
  mtreeIncludeChildrenInput: query("#mtree-include-children-input"),
  mtreeIncludeDescriptionsInput: query("#mtree-include-descriptions-input"),
  mtreeIncludeEmptyInput: query("#mtree-include-empty-input"),
  mtreeTargetFileSelect: query("#mtree-target-file-select"),
  mtreeOutputNameInput: query("#mtree-output-name-input"),
  mtreeQualityText: query("#mtree-quality-text"),
  mtreeWarningList: query("#mtree-warning-list"),
  mtreeOutputHighlight: query("#mtree-output-highlight"),
  mtreeOutputText: query("#mtree-output-text"),
  mtreeRenderPreview: query("#mtree-render-preview"),
  mtreeCreateButton: query("#mtree-create-button"),
  mtreeKeepButton: query("#mtree-keep-button"),
  mtreeUndoButton: query("#mtree-undo-button"),
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
  inputDialogSubmitButton: query("#input-dialog-submit-button"),
  inputDialogCancelButton: query("#input-dialog-cancel-button"),
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
  previewSelect: query("#preview-select"),
  wordWrapSelect: query("#word-wrap-select"),
  indentStyleSelect: query("#indent-style-select"),
  bmapGenerateScopeSelect: query("#bmap-generate-scope-select"),
  serverUrlInput: query("#server-url-input"),
  autoReconnectInput: query("#auto-reconnect-input"),
  serverPinInput: query("#server-pin-input"),
  displayNameInput: query("#display-name-input"),
  pingServerButton: query("#ping-server-button"),
  connectServerButton: query("#connect-server-button"),
  accountLoginRow: query("#account-login-row"),
  accountUsernameInput: query("#account-username-input"),
  accountPasswordInput: query("#account-password-input"),
  accountLoginButton: query("#account-login-button"),
  accountLogoutButton: query("#account-logout-button"),
  accountStatusText: query("#account-status-text"),
  workspaceSwitcher: query("#workspace-switcher"),
  workspaceList: query("#workspace-list"),
  workspaceTeamSelect: query("#workspace-team-select"),
  workspaceNameInput: query("#workspace-name-input"),
  workspaceShareTeam: query("#workspace-share-team"),
  workspaceCreateButton: query("#workspace-create-button"),
  collabHosting: query("#collab-hosting"),
  hostTeamSelect: query("#host-team-select"),
  hostButton: query("#host-button"),
  hostPinText: query("#host-pin-text"),
  serverStatusText: query("#server-status-text"),
  serverStatusPanel: query("#server-status-text")?.closest(".settings-status-panel"),
  acceptConnectionDialog: query("#accept-connection-dialog"),
  acceptConnectionMessage: query("#accept-connection-message"),
  acceptConnectionAcceptButton: query("#accept-connection-accept-button"),
  sessionDetailText: query("#session-detail-text"),
  presenceList: query("#presence-list"),
  presenceStrip: query("#presence-strip"),
  workspaceModeRow: query("#workspace-mode-row"),
  workspaceModeToggle: query("#workspace-mode-toggle"),
  sessionIdLabel: query("#session-id-label"),
  explorerToggleButton: query("#explorer-toggle-button"),
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
  importFileButton: query("#import-file-button"),
  importFileInput: query("#import-file-input"),
  saveButton: query("#save-button"),
  savePdfButton: query("#save-pdf-button"),
  exportButton: query("#export-button"),
  renameSelectedButton: query("#rename-selected-button"),
  deleteSelectedButton: query("#delete-selected-button"),
  newMarkdownButton: query("#new-markdown-button"),
  newMtreeButton: query("#new-mtree-button"),
  newUrlDbButton: query("#new-urldb-button"),
  newBmapButton: query("#new-bmap-button"),
  exportSelectedButton: query("#export-selected-button"),
  toggleExplorerMenuButton: query("#toggle-explorer-menu-button"),
  togglePreviewButton: query("#toggle-preview-button"),
  toggleChatButton: query("#toggle-chat-button"),
  previewCollapseButton: query("#preview-collapse-button"),
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
let previewUrlDbEntry = null;
let sourceUrlDbEntry = null;
let mathJaxLoadPromise = null;
let previewBmapView = null;

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
let privateProjectSnapshot = null;
// Forward declaration — assigned after `collaboration` is created.
let switchWorkspaceMode;

const mtreeToolState = {
  sourceFileId: null,
  generatedSection: "",
  draftSection: "",
  warnings: [],
  quality: null,
  selectedTargetFileId: "__new__"
};

const addFileState = {
  parentId: null,
  fileName: "",
  content: null,
  sourceLabel: ""
};

const chatState = {
  projectId: null,
  activeThreadId: null,
  threads: [],
  configured: false,
  localOnly: true,
  provider: null,
  model: null,
  models: [],
  selectedModel: null,
  status: "idle",
  detail: "Checking chat backend...",
  sending: false,
  activity: [],
  activityExpanded: false,
  streamingText: "",
  shouldScrollToBottom: false
};
const autocompleteState = {
  items: [],
  activeIndex: 0,
  range: null,
  kind: ""
};

const editorDragState = {
  selection: null,
  dropOffset: null
};

// Undo/redo history for the contenteditable editor.
// Each entry: { text: string, start: number, end: number }
const editorHistory = {
  stack: [],
  index: -1,
  maxSize: 400
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

function renderProposalDiff(op) {
  if (op.type === "create-file") {
    const lines = (op.content ?? "").split("\n").slice(0, 20);
    const more = (op.content ?? "").split("\n").length > 20 ? `<span class="proposal-diff-more">…${(op.content ?? "").split("\n").length - 20} more lines</span>` : "";
    return `<pre class="proposal-diff-block proposal-diff-add">${lines.map((l) => escapeHtmlAttribute(l)).join("\n")}</pre>${more}`;
  }
  if (op.type === "delete-node") {
    return `<div class="proposal-diff-warning">⚠ This will permanently delete the file or folder.</div>`;
  }
  if (op.type === "rename-node") {
    return `<div class="proposal-diff-rename"><span class="proposal-diff-del">${escapeHtmlAttribute(op.preImage ?? op.path)}</span> → <span class="proposal-diff-add">${escapeHtmlAttribute(op.name ?? "")}</span></div>`;
  }
  if (op.type === "move-node") {
    return `<div class="proposal-diff-rename"><span class="proposal-diff-del">${escapeHtmlAttribute(op.path ?? "")}</span> → <span class="proposal-diff-add">${escapeHtmlAttribute(op.parentPath ?? "(root)")}/${escapeHtmlAttribute(op.path?.split("/").pop() ?? "")}</span></div>`;
  }
  if (op.type === "update-file" && typeof op.preImage === "string") {
    const hunks = buildTextDiffHunks(op.preImage, op.content ?? "");
    if (hunks.length === 0) {
      return `<div class="proposal-diff-warning">No content change detected.</div>`;
    }
    const lines = hunks.map((h) => {
      const cls = h.op === "-" ? "proposal-diff-del" : h.op === "+" ? "proposal-diff-add" : "proposal-diff-ctx";
      return `<div class="proposal-diff-line ${cls}">${escapeHtmlAttribute(h.op + " " + h.text)}</div>`;
    }).join("");
    return `<div class="proposal-diff-block">${lines}</div>`;
  }
  return "";
}

const OP_ICONS = {
  "create-file": "+",
  "update-file": "~",
  "rename-node": "r",
  "delete-node": "×",
  "create-folder": "+",
  "move-node": "→"
};

/** Render a proposal card for an assistant message that has proposedOperations. */
function renderProposalCard(message, isOriginator) {
  const ops = message.proposedOperations ?? [];
  if (ops.length === 0) return "";
  const batchId = escapeHtmlAttribute(message.batchId ?? "");
  const state = message.proposalState ?? "pending";

  // Terminal states: read-only summary
  if (state === "kept") {
    return `<div class="proposal-card is-${state}" data-batch-id="${batchId}">
      <div class="proposal-card-header"><span class="proposal-card-title proposal-card-resolved">✓ Edits kept (${ops.length})</span></div>
    </div>`;
  }
  if (state === "dropped") {
    return `<div class="proposal-card is-${state}" data-batch-id="${batchId}">
      <div class="proposal-card-header"><span class="proposal-card-title proposal-card-resolved">↩ Edits dropped (${ops.length})</span></div>
    </div>`;
  }

  const originatorAttr = isOriginator ? "" : ' disabled title="Only the original requester can act on this proposal"';

  const opRows = ops.map((op) => {
    const opId = escapeHtmlAttribute(op.proposalId ?? "");
    const opType = String(op.type ?? "");
    const opPath = escapeHtmlAttribute(op.path ?? op.name ?? "");
    const icon = OP_ICONS[opType] ?? "?";
    const opState = op.proposalState ?? state;
    const diffHtml = renderProposalDiff(op);
    const diffSection = diffHtml
      ? `<details class="proposal-op-diff"><summary>diff</summary><div class="proposal-op-diff-body">${diffHtml}</div></details>`
      : "";

    if (opState === "stale") {
      return `<div class="proposal-op is-stale" data-proposal-id="${opId}">
        <span class="proposal-op-icon">${escapeHtmlAttribute(icon)}</span>
        <span class="proposal-op-path">${opPath}</span>
        <span class="proposal-op-badge">stale</span>
        ${diffSection}
      </div>`;
    }
    return `<div class="proposal-op is-${escapeHtmlAttribute(opState)}" data-proposal-id="${opId}">
      <span class="proposal-op-icon">${escapeHtmlAttribute(icon)}</span>
      <span class="proposal-op-path">${opPath}</span>
      ${diffSection}
    </div>`;
  }).join("");

  let batchButtons = "";
  {
    const hasDecorations = [...agentPendingDecorations.values()].some((d) => d.batchId === (message.batchId ?? ""));
    const jumpBtn = hasDecorations
      ? `<button class="proposal-btn proposal-btn-jump" type="button" data-batch-jump="${batchId}" title="Jump to change in editor">↕</button>`
      : "";
    batchButtons = `
      ${jumpBtn}
      <button class="proposal-btn proposal-btn-keep" type="button" data-batch-keep="${batchId}"${originatorAttr}>Keep</button>
      <button class="proposal-btn proposal-btn-drop-final" type="button" data-batch-drop-final="${batchId}"${originatorAttr}>Drop</button>`;
  }

  const title = `Applied edits (${ops.length}) — review:`;

  return `<div class="proposal-card is-${escapeHtmlAttribute(state)}" data-batch-id="${batchId}">
    <div class="proposal-card-header">
      <span class="proposal-card-title">${escapeHtmlAttribute(title)}</span>
      <div class="proposal-card-actions">${batchButtons}</div>
    </div>
    <div class="proposal-card-ops">${opRows}</div>
  </div>`;
}

function formatChatTimestamp(value) {
  if (!Number.isFinite(Number(value))) {
    return "Now";
  }
  return new Date(Number(value)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function sortChatThreads() {
  chatState.threads.sort((left, right) => right.updatedAt - left.updatedAt);
}

function ensureChatWorkspaceLoaded(project) {
  if (chatState.projectId === project.id) {
    return;
  }
  const workspace = loadChatWorkspace(project.id);
  chatState.projectId = project.id;
  chatState.threads = workspace.threads;
  chatState.activeThreadId = workspace.activeThreadId;
  sortChatThreads();
  // First load for this project: land on the latest message, not the top.
  chatState.shouldScrollToBottom = true;
}

function persistChatWorkspaceState(project = controller.getProject()) {
  if (!project?.id) {
    return;
  }
  sortChatThreads();
  saveChatWorkspace(project.id, {
    activeThreadId: chatState.activeThreadId,
    threads: chatState.threads
  });
  // Push to the collaboration server when connected so other session members
  // see the updated thread list and new messages in real time.
  const connInfo = collaboration.getConnectionInfo?.();
  if (connInfo) {
    pushServerChatWorkspace(connInfo.serverUrl, connInfo.token, {
      activeThreadId: chatState.activeThreadId,
      threads: chatState.threads
    }).catch(() => { /* non-critical — server may be temporarily unavailable */ });
  }
}

function getActiveChatThread() {
  return chatState.threads.find((thread) => thread.id === chatState.activeThreadId) ?? null;
}

function ensureActiveChatThread() {
  let thread = getActiveChatThread();
  if (thread) {
    return thread;
  }
  thread = createChatThread();
  chatState.threads.unshift(thread);
  chatState.activeThreadId = thread.id;
  persistChatWorkspaceState();
  return thread;
}

function listChatFiles(project) {
  return Object.values(project.nodes)
    .filter((node) => node?.kind === "file")
    .map((node) => ({
      id: node.id,
      name: node.name,
      path: getPath(project, node.id)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function resolveChatContextFiles(project, thread) {
  return (thread?.contextPaths ?? []).map((path) => {
    const nodeId = getNodeIdByPath(project, path);
    const node = nodeId ? project.nodes[nodeId] : null;
    if (!node || node.kind !== "file") {
      return null;
    }
    if (isImageFileName(node.name)) {
      return {
        path,
        kind: "image",
        content: ""
      };
    }
    return {
      path,
      kind: "text",
      content: typeof node.content === "string" ? node.content : ""
    };
  }).filter(Boolean);
}

/** Human-readable line for one agent progress step. */
function describeAgentActivity(event) {
  if (event.type === "status") {
    return event.iteration > 0 ? "Reviewing the workspace…" : "Reading your request…";
  }
  if (event.type === "writing") {
    const verbs = {
      create_file: "Drafting new file",
      update_file: "Editing file",
      rename_node: "Renaming",
      delete_node: "Deleting",
      create_folder: "Creating folder",
      move_node: "Moving"
    };
    const verb = verbs[event.name] || "Working";
    const chars = Number(event.chars) || 0;
    return `${verb}… (${chars.toLocaleString()} chars)`;
  }
  if (event.type === "tool") {
    const target = event.target ? `: ${event.target}` : "";
    const verbs = {
      list_files: "Listing files",
      read_file: "Reading file",
      create_file: "Drafting new file",
      update_file: "Editing file",
      rename_node: "Renaming",
      delete_node: "Deleting",
      create_folder: "Creating folder",
      move_node: "Moving"
    };
    const verb = verbs[event.name] || event.name || "Working";
    return `${verb}${target}`;
  }
  return "Working…";
}

/** Render the live agent activity log shown inside the thinking indicator. */
function renderAgentActivity() {
  if (!chatState.activity.length) {
    return `<div class="chat-activity-line">Working…</div>`;
  }
  const total = chatState.activity.length;
  const COLLAPSED = 6;
  const expanded = chatState.activityExpanded || total <= COLLAPSED;
  const visible = expanded ? chatState.activity : chatState.activity.slice(-COLLAPSED);
  const lines = visible
    .map((line) => `<div class="chat-activity-line">${escapeHtmlAttribute(line)}</div>`)
    .join("");
  if (total <= COLLAPSED) {
    return lines;
  }
  const toggle = expanded
    ? `<button type="button" class="chat-activity-toggle" data-chat-activity-toggle>Show less</button>`
    : `<button type="button" class="chat-activity-toggle" data-chat-activity-toggle>Show all ${total} steps</button>`;
  return lines + toggle;
}

function renderChatPanel(project) {
  ensureChatWorkspaceLoaded(project);

  const activeThread = getActiveChatThread();
  const statusPrefix = chatState.sending ? "Sending…" : chatState.detail;
  const statusSuffix = chatState.configured && chatState.provider && chatState.model && chatState.models.length <= 1
    ? ` · ${chatState.provider} ${chatState.model}`
    : (chatState.configured && chatState.provider ? ` · ${chatState.provider}` : "");
  elements.chatStatusText.textContent = `${statusPrefix}${statusSuffix}`.trim();
  const badgeError = chatState.status === "offline" || chatState.status === "restricted" || chatState.status === "unconfigured";
  elements.chatStatusText.classList.toggle("is-error", badgeError);

  // Model picker — only meaningful when the server offers more than one model.
  if (elements.chatModelSelect) {
    const showPicker = chatState.configured && chatState.models.length > 1;
    elements.chatModelSelect.hidden = !showPicker;
    if (showPicker) {
      const desired = chatState.selectedModel ?? chatState.models[0];
      const optionsHtml = chatState.models
        .map((name) => `<option value="${escapeHtmlAttribute(name)}"${name === desired ? " selected" : ""}>${escapeHtmlAttribute(name)}</option>`)
        .join("");
      if (elements.chatModelSelect.innerHTML !== optionsHtml) {
        elements.chatModelSelect.innerHTML = optionsHtml;
      }
      elements.chatModelSelect.value = desired;
      elements.chatModelSelect.disabled = chatState.sending;
    }
  }

  elements.chatThreadList.innerHTML = chatState.threads.length
    ? chatState.threads.map((thread) => {
      const meta = `${thread.messages.length} msg · ${formatChatTimestamp(thread.updatedAt)}`;
      return `
        <button
          class="chat-thread-button${thread.id === chatState.activeThreadId ? " is-active" : ""}"
          type="button"
          data-chat-thread-id="${escapeHtmlAttribute(thread.id)}"
        >
          <span class="chat-thread-title">${escapeHtmlAttribute(thread.title)}</span>
          <span class="chat-thread-meta">${escapeHtmlAttribute(meta)}</span>
        </button>
      `;
    }).join("")
    : '<div class="chat-empty-state">No conversations yet.<br>Press <strong>+</strong> to start one.</div>';

  // Context chips — empty string collapses the list via CSS :empty rule.
  elements.chatContextList.innerHTML = activeThread?.contextPaths?.length
    ? activeThread.contextPaths.map((path) => `
        <span class="chat-context-chip">
          <span class="chat-context-chip-label">${escapeHtmlAttribute(path)}</span>
          <button type="button" data-chat-remove-context="${escapeHtmlAttribute(path)}" aria-label="Remove ${escapeHtmlAttribute(path)}">×</button>
        </span>
      `).join("")
    : "";

  // Messages: render assistant replies as markdown; plain text for user / system.
  const streamingHtml = chatState.streamingText
    ? `<div class="chat-stream-preview">${renderMarkdown(chatState.streamingText)}</div>`
    : "";
  const thinkingHtml = chatState.sending
    ? `<div class="chat-thinking" aria-label="Agent is working" aria-live="polite">
        ${streamingHtml}
        <div class="chat-thinking-foot">
          <div class="chat-thinking-dots">
            <span class="chat-thinking-dot"></span>
            <span class="chat-thinking-dot"></span>
            <span class="chat-thinking-dot"></span>
          </div>
          ${renderAgentActivity()}
        </div>
       </div>`
    : "";

  elements.chatMessageList.innerHTML = activeThread?.messages?.length
    ? activeThread.messages.map((message) => {
      const roleLabel = message.role === "user" ? "You" : message.role === "assistant" ? "Agent" : "System";
      const contentHtml = message.role === "assistant"
        ? renderMarkdown(message.content)
        : escapeHtmlAttribute(message.content);
      const contextBadgesHtml = message.contextPaths?.length
        ? `<div class="chat-message-context">${
            message.contextPaths.map((p) =>
              `<span class="chat-message-context-file">${escapeHtmlAttribute(p)}</span>`
            ).join("")
          }</div>`
        : "";
      const isOriginator = !message.originatorId || message.originatorId === collaboration.getClientId();
      const proposalCardHtml = message.role === "assistant" && message.proposedOperations?.length
        ? renderProposalCard(message, isOriginator)
        : "";
      // Offer a retry on a failed turn so the user can re-send without retyping.
      const retryHtml = message.error && !chatState.sending
        ? `<button type="button" class="chat-message-retry" data-chat-retry>↻ Retry</button>`
        : "";
      return `
        <article class="chat-message${message.error ? " is-error" : ""}" data-role="${escapeHtmlAttribute(message.role)}" data-msg-id="${escapeHtmlAttribute(message.id)}">
          <div class="chat-message-meta">
            <span class="chat-message-role">${escapeHtmlAttribute(roleLabel)}</span>
            <span class="chat-message-time">${escapeHtmlAttribute(formatChatTimestamp(message.createdAt))}</span>
          </div>
          <div class="chat-message-content">${contentHtml}</div>
          ${contextBadgesHtml}
          ${proposalCardHtml}
          ${retryHtml}
        </article>
      `;
    }).join("") + thinkingHtml
    : '<div class="chat-empty-state">No messages yet.<br>Attach context files below, then send a prompt.</div>';

  const canSend = !chatState.sending && Boolean(elements.chatInput.value.trim());
  elements.chatSendButton.disabled = !canSend;
  elements.chatAddActiveFileButton.disabled = !project.activeFileId;
  elements.chatInput.disabled = chatState.sending;

  if (chatState.shouldScrollToBottom) {
    elements.chatMessageList.scrollTop = elements.chatMessageList.scrollHeight;
    chatState.shouldScrollToBottom = false;
  }

  // Refresh in-editor agent bar whenever proposal state changes.
  updateEditorAgentBar();
}

function setActiveChatThread(threadId) {
  if (!chatState.threads.some((thread) => thread.id === threadId)) {
    return;
  }
  chatState.activeThreadId = threadId;
  chatState.shouldScrollToBottom = true;
  persistChatWorkspaceState();
  renderChatPanel(controller.getProject());
}

function createNewChatConversation() {
  const thread = createChatThread();
  chatState.threads.unshift(thread);
  chatState.activeThreadId = thread.id;
  chatState.shouldScrollToBottom = true;
  persistChatWorkspaceState();
  renderChatPanel(controller.getProject());
  elements.chatInput.focus();
}

function addChatContextPath(path) {
  const thread = ensureActiveChatThread();
  if (!path || thread.contextPaths.includes(path)) {
    renderChatPanel(controller.getProject());
    return;
  }
  thread.contextPaths = [...thread.contextPaths, path];
  thread.updatedAt = Date.now();
  sortChatThreads();
  persistChatWorkspaceState();
  renderChatPanel(controller.getProject());
}

function removeChatContextPath(path) {
  const thread = getActiveChatThread();
  if (!thread) {
    return;
  }
  thread.contextPaths = thread.contextPaths.filter((entry) => entry !== path);
  thread.updatedAt = Date.now();
  sortChatThreads();
  persistChatWorkspaceState();
  renderChatPanel(controller.getProject());
}

function addActiveFileToChatContext() {
  const project = controller.getProject();
  if (!project.activeFileId) {
    notify("Open a file first to add it to the chat context.");
    return;
  }
  addChatContextPath(getPath(project, project.activeFileId));
}

async function refreshChatStatus({ silent = false } = {}) {
  chatState.status = "checking";
  if (!silent) {
    chatState.detail = "Checking chat backend...";
    renderChatPanel(controller.getProject());
  }

  try {
    const status = await fetchChatStatus(settings.serverUrl);
    chatState.configured = Boolean(status.configured);
    chatState.localOnly = status.localOnly !== false;
    chatState.provider = status.provider ?? null;
    chatState.model = status.model ?? null;
    chatState.models = Array.isArray(status.models) && status.models.length
      ? status.models
      : (status.model ? [status.model] : []);
    // Keep the user's saved choice if the server still offers it, else default.
    chatState.selectedModel = chatState.models.includes(settings.chatModel)
      ? settings.chatModel
      : (status.model ?? chatState.models[0] ?? null);
    chatState.status = chatState.configured ? "ready" : "unconfigured";
    chatState.detail = status.message ?? (chatState.configured ? "Chat is ready." : "Chat is not configured.");
  } catch (error) {
    chatState.configured = false;
    chatState.provider = null;
    chatState.model = null;
    chatState.models = [];
    chatState.selectedModel = null;
    chatState.status = error?.status === 403 ? "restricted" : "offline";
    chatState.detail = error instanceof Error ? error.message : String(error);
  }

  renderChatPanel(controller.getProject());
}

/** Build a lean project snapshot for the agent: full tree + text content,
 *  but image file contents stripped (data-URLs are large and the agent can't
 *  edit images anyway). Lets the agent see the user's real files in local mode. */
function buildAgentProjectSnapshot(project) {
  const nodes = {};
  for (const [id, node] of Object.entries(project.nodes ?? {})) {
    if (node.kind === "file" && isImageFileName(node.name)) {
      nodes[id] = { ...node, content: "" };
    } else {
      nodes[id] = { ...node };
    }
  }
  return { rootId: project.rootId, nodes };
}

async function handleChatSubmit() {
  const prompt = elements.chatInput.value.trim();
  if (!prompt || chatState.sending) {
    return;
  }
  const project = controller.getProject();
  const thread = ensureActiveChatThread();
  const contextPaths = (thread.contextPaths ?? []).slice();
  thread.contextPaths = [];
  thread.messages.push(createChatMessage("user", prompt, { contextPaths }));
  thread.title = thread.title === "New Chat" ? deriveChatTitle(prompt) : thread.title;
  thread.updatedAt = Date.now();
  sortChatThreads();
  chatState.activeThreadId = thread.id;
  elements.chatInput.value = "";
  await runAgentTurn(thread, project);
}

/** Re-send the most recent failed turn (clears the trailing error first). */
async function retryLastChatTurn() {
  if (chatState.sending) return;
  const thread = getActiveChatThread();
  if (!thread) return;
  while (thread.messages.length && thread.messages[thread.messages.length - 1].role === "system") {
    thread.messages.pop();
  }
  if (!thread.messages.some((message) => message.role === "user")) return;
  thread.updatedAt = Date.now();
  await runAgentTurn(thread, controller.getProject());
}

/** Send the thread's current messages to the agent and fold the reply (or
 *  error) back in. Shared by the compose box and the retry affordance. */
async function runAgentTurn(thread, project) {
  const contextFiles = resolveChatContextFiles(project, thread);
  chatState.sending = true;
  chatState.activity = [];
  chatState.activityExpanded = false;
  chatState.streamingText = "";
  chatState.shouldScrollToBottom = true;
  persistChatWorkspaceState(project);
  renderChatPanel(project);

  try {
    if (!chatState.configured) {
      await refreshChatStatus({ silent: true });
    }
    if (!chatState.configured) {
      throw new Error(chatState.detail);
    }

    const response = await sendChatRequest(settings.serverUrl, {
      projectName: project.name,
      model: chatState.selectedModel ?? undefined,
      messages: thread.messages
        .filter((message) => message.role === "user" || message.role === "assistant")
        .map((message) => ({ role: message.role, content: message.content })),
      contextFiles,
      project: buildAgentProjectSnapshot(project)
    }, (event) => {
      if (event.type === "delta") {
        chatState.streamingText += event.text || "";
        chatState.shouldScrollToBottom = true;
        renderChatPanel(project);
        return;
      }
      // A new model turn starts fresh: clear any streamed text from the prior turn.
      if (event.type === "status") {
        chatState.streamingText = "";
      }
      const line = describeAgentActivity(event);
      if (!line) {
        return;
      }
      const last = chatState.activity[chatState.activity.length - 1];
      // "writing" events repeat with a growing char count \u2014 update the last
      // line in place instead of flooding the log with near-duplicates.
      if (event.type === "writing" && typeof last === "string" && last.startsWith(line.split("\u2026")[0])) {
        chatState.activity[chatState.activity.length - 1] = line;
        chatState.shouldScrollToBottom = true;
        renderChatPanel(project);
        return;
      }
      if (line !== last) {
        chatState.activity.push(line);
        chatState.shouldScrollToBottom = true;
        renderChatPanel(project);
      }
    });

    chatState.provider = response.provider ?? chatState.provider;
    chatState.model = response.model ?? chatState.model;
    const proposals = Array.isArray(response.proposedOperations) ? response.proposedOperations : [];
    const msgExtra = {};
    if (proposals.length > 0) {
      msgExtra.proposedOperations = proposals;
      msgExtra.batchId = response.batchId ?? null;
      msgExtra.baseRevision = collaboration.getRevision();
      msgExtra.proposalState = "pending";
      msgExtra.originatorId = collaboration.getClientId() ?? null;
    }
    const assistantMessage = createChatMessage("assistant", response.message, msgExtra);
    thread.messages.push(assistantMessage);
    thread.updatedAt = Date.now();
    sortChatThreads();
    persistChatWorkspaceState(project);
    // Agent edits apply immediately so the user can read them in context and
    // then decide Keep or Drop (no separate Accept step — Accept and Keep/Drop
    // were redundant; the user couldn't preview a proposal without applying it).
    if (proposals.length > 0) {
      autoApplyProposals(assistantMessage);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    thread.messages.push(createChatMessage("system", message, { error: true }));
    thread.updatedAt = Date.now();
    sortChatThreads();
    persistChatWorkspaceState(project);
  } finally {
    chatState.sending = false;
    chatState.activity = [];
    chatState.streamingText = "";
    chatState.shouldScrollToBottom = true;
    renderChatPanel(project);
  }
}

function isPreviewableFileName(name) {
  return name.endsWith(".md") || isImageFileName(name) || isUrlDbFileName(name) || isBmapFileName(name);
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
        : "new url album";
  const extension = kind === "md" ? ".md" : kind === "mtree" ? ".mtree" : kind === "bmap" ? ".bmap" : ".urldb";
  let index = 1;
  let candidate = slugTitle(label, index, extension);
  while (findChildByName(project, parentId, candidate)) {
    index += 1;
    candidate = slugTitle(label, index, extension);
  }
  return candidate;
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
    return node.content;
  }

  return trimmed;
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
  const lineEls = Array.from(
    elements.editorContent.querySelectorAll(":scope > .editor-line")
  );
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
  const lineEls = Array.from(
    elements.editorContent.querySelectorAll(":scope > .editor-line")
  );
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
  logDebug("editor", message, getEditorTraceDetail(extra));
}

function getSelectedTarget() {
  if (sourceUrlDbEntry) {
    return { nodeId: sourceUrlDbEntry.fileId, entryId: sourceUrlDbEntry.entryId };
  }
  return { nodeId: selectionNodeId, entryId: null };
}

/** Flash the server status panel border green (success) or red (error). */
function flashStatusPanel(type) {
  const panel = elements.serverStatusPanel;
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

function showInputDialog({ title = "Rename Item", message = "Enter a value.", label = "Name", value = "", submitLabel = "Save" }) {
  return new Promise((resolve) => {
    elements.inputDialogTitle.textContent = title;
    elements.inputDialogMessage.textContent = message;
    elements.inputDialogLabel.textContent = label;
    elements.inputDialogInput.value = value;
    elements.inputDialogSubmitButton.textContent = submitLabel;

    const handleCancel = () => {
      elements.inputDialog.close("cancel");
    };

    const handleClose = () => {
      elements.inputDialog.removeEventListener("close", handleClose);
      elements.inputDialogCancelButton.removeEventListener("click", handleCancel);
      const result = elements.inputDialog.returnValue === "accept"
        ? elements.inputDialogInput.value.trim() || null
        : null;
      resolve(result);
    };

    elements.inputDialog.addEventListener("close", handleClose, { once: true });
    elements.inputDialogCancelButton.addEventListener("click", handleCancel);
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

async function confirmAction(message) {
  logDebug("action", "Confirm requested", String(message));
  const result = await showConfirmDialog({ message: String(message) });
  logDebug("response", `Confirm ${result ? "accepted" : "cancelled"}`, String(message));
  return result;
}

async function promptForName(message, defaultValue = "") {
  logDebug("action", "Prompt requested", `${message} :: ${defaultValue}`);
  const result = await showInputDialog({ title: message, message, value: defaultValue, submitLabel: "Save" });
  logDebug("response", result ? `Prompt value: ${result}` : "Prompt cancelled", message);
  return result;
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

  if (activeFile.name.endsWith(".md")) {
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
function getEditorText() {
  const lines = elements.editorContent.querySelectorAll(":scope > .editor-line");
  if (lines.length === 0) return "";
  return Array.from(lines).map((line) => line.textContent).join("\n");
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
  const lineEls = Array.from(
    elements.editorContent.querySelectorAll(":scope > .editor-line")
  );
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
  // Find the ancestor .editor-line that is a direct child of the editor.
  let lineEl = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : container;
  while (lineEl && lineEl.parentElement !== elements.editorContent) {
    lineEl = lineEl.parentElement;
  }
  if (!lineEl) return 0;

  const lineEls = Array.from(
    elements.editorContent.querySelectorAll(":scope > .editor-line")
  );
  const lineIndex = lineEls.indexOf(lineEl);
  if (lineIndex < 0) return 0;

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
  if (document.activeElement !== elements.editorContent) return;
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
    renderEditorContent(text);
    // Setting innerHTML can cause the contenteditable to lose focus in some
    // browsers.  Restore focus explicitly so that the subsequent
    // notifyEditorChanged → updateStatus call still sees the editor as the
    // active element and does not reset the cursor via loadEditorContent.
    if (document.activeElement !== elements.editorContent) {
      elements.editorContent.focus({ preventScroll: true });
    }
    setEditorSelection(selStart, selEnd);
  } finally {
    _editorUpdating = false;
  }
}

/** Push a history snapshot.  Call at logical "checkpoints" (space, enter,
 *  punctuation, paste, indent, drag-drop). */
function pushEditorHistoryState(text, start, end) {
  // Trim any forward (redo) entries once a new branch starts.
  editorHistory.stack.splice(editorHistory.index + 1);
  const last = editorHistory.stack[editorHistory.index];
  if (last && last.text === text && last.start === start && last.end === end) {
    return;
  }
  editorHistory.stack.push({ text, start, end });
  if (editorHistory.stack.length > editorHistory.maxSize) {
    editorHistory.stack.shift();
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
  editorHistory.stack = [{ text, start: selection.start, end: selection.end }];
  editorHistory.index = 0;
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
  editorHistory.index -= 1;
  const state = editorHistory.stack[editorHistory.index];
  applyEditorRender(state.text, state.start, state.end);
  notifyEditorChanged(state.text);
  traceEditorEvent("Undo applied", { restored: `${state.start}-${state.end}` });
}

function editorRedo() {
  if (editorHistory.index >= editorHistory.stack.length - 1) return;
  traceEditorEvent("Redo requested");
  editorHistory.index += 1;
  const state = editorHistory.stack[editorHistory.index];
  applyEditorRender(state.text, state.start, state.end);
  notifyEditorChanged(state.text);
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
  controller.updateContent(activeFile.id, nextContent);
  if (collaboration.isConnected() && workspaceMode === "synced") {
    collaboration.scheduleTextPatch(getPath(controller.getProject(), activeFile.id), activeFile.content, nextContent);
  }
  // TODO: wire collaboration text-patch here once sync strategy is decided.
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
  const activeFile = controller.getActiveFile();
  const container = elements.editorCursors;
  container.textContent = "";
  if (!activeFile) return;

  const scrollEl = elements.editorScroll;
  const scrollRect = elements.editorScroll.getBoundingClientRect();

  for (const cursor of cursors) {
    if (cursor.fileId !== activeFile.id) continue;
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
        const rects = Array.from(selRange.getClientRects());
        for (const rect of rects) {
          if (rect.width === 0 && rect.height === 0) continue;
          const highlightEl = document.createElement("div");
          highlightEl.className = "remote-selection";
          highlightEl.style.top = `${rect.top - scrollRect.top + scrollEl.scrollTop}px`;
          highlightEl.style.left = `${rect.left - scrollRect.left + scrollEl.scrollLeft}px`;
          highlightEl.style.width = `${rect.width}px`;
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
      const rect = anchorRange.getBoundingClientRect();

      const top = rect.top - scrollRect.top + scrollEl.scrollTop;
      const left = rect.left - scrollRect.left + scrollEl.scrollLeft;
      const height = rect.height || 18;

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
    } catch {
      // ignore positioning errors (file re-renders, rapid navigation, etc.)
    }
  }
}

// Cache of the latest remote cursor events by clientId so we can re-render
// when the user scrolls or file content changes.
const remoteCursorsByClient = new Map();

function onRemoteCursor(event) {
  if (!event.clientId) return;
  remoteCursorsByClient.set(event.clientId, event);
  renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
}

// Broadcast local selection to peers on selectionchange (debounced).
// Note: this listener is registered after `collaboration` is created (see below).
let _selectionChangeListenerAttached = false;
function attachSelectionChangeListener() {
  if (_selectionChangeListenerAttached) return;
  _selectionChangeListenerAttached = true;
  document.addEventListener("selectionchange", () => {
    if (!collaboration.isConnected()) return;
    const activeFile = controller.getActiveFile();
    if (!activeFile) return;
    const sel = getEditorSelection();
    // Suppress cursor broadcast while a text patch is pending for this file —
    // peers would see a stale position (before the text arrives).  The cursor
    // is sent automatically once the patch is confirmed by the server.
    const path = getPath(controller.getProject(), activeFile.id);
    if (collaboration.hasPendingPatch(path)) return;
    collaboration.scheduleAwareness(activeFile.id, sel.start, sel.end);
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

function insertReferenceAtCursor(referenceText) {
  const { start, end } = getEditorSelection();
  replaceEditorRange(start, end, referenceText);
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
if (elements.autoReconnectInput) elements.autoReconnectInput.checked = settings.autoReconnect !== false;
if (elements.formatToolbarInput) elements.formatToolbarInput.checked = Boolean(settings.showFormatToolbar);

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
  getProject() {
    return controller.getProject();
  },
  replaceProject(project) {
    controller.replaceProject(project);
  },
  applyOperation(clientId, operation) {
    // When a foreign peer op arrives, mark all open checkpoints as no-longer
    // sole-authored so the Drop button can be disabled (Phase 6 / subtask 6.4).
    if (clientId && clientId !== collaboration.getClientId()) {
      for (const checkpoint of agentCheckpoints.values()) {
        checkpoint.soleAuthored = false;
      }
    }
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
    const wasConnected = syncState.status === "connected";
    syncState.status = nextState.status;
    syncState.detail = nextState.detail;
    syncState.presence = nextState.presence ?? [];
    syncState.sessionId = nextState.sessionId;
    syncState.revision = nextState.revision ?? 0;
    syncState.displayName = nextState.displayName ?? null;
    syncState.clientId = nextState.clientId ?? null;
    syncState.role = nextState.role ?? null;
    // When first connecting, load the shared chat workspace from the server so
    // all session members share the same conversation history.
    if (!wasConnected && nextState.status === "connected") {
      const connInfo = collaboration.getConnectionInfo?.();
      if (connInfo) {
        fetchServerChatWorkspace(connInfo.serverUrl, connInfo.token).then((workspace) => {
          if (workspace?.threads?.length) {
            chatState.threads = workspace.threads;
            chatState.activeThreadId = workspace.activeThreadId ?? chatState.activeThreadId;
            sortChatThreads();
            renderChatPanel(controller.getProject());
          }
        }).catch(() => { /* non-critical */ });
      }
    }
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
      // Lost connection: restore the user's private workspace.
      switchWorkspaceMode?.("private");
      return;
    }
    render(controller.getProject());
  },
  onRemoteCursor(event) {
    onRemoteCursor(event);
  },
  onPatchConfirmed() {
    // Text confirmed by server — now safe to send the definitive cursor position.
    const activeFile = controller.getActiveFile();
    if (activeFile && collaboration.isConnected()) {
      const sel = getEditorSelection();
      collaboration.scheduleAwareness(activeFile.id, sel.start, sel.end);
    }
  },
  onChatWorkspaceUpdate(workspace) {
    // A peer pushed a chat workspace update — apply it locally and re-render.
    if (!workspace || !Array.isArray(workspace.threads)) return;
    chatState.threads = workspace.threads;
    chatState.activeThreadId = workspace.activeThreadId ?? chatState.activeThreadId;
    chatState.shouldScrollToBottom = true;
    sortChatThreads();
    saveChatWorkspace(chatState.projectId ?? "", {
      activeThreadId: chatState.activeThreadId,
      threads: chatState.threads
    });
    renderChatPanel(controller.getProject());
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
    workspaceMode = nextMode;
    if (privateProjectSnapshot) {
      controller.replaceProject(privateProjectSnapshot);
    }
    privateProjectSnapshot = null;
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
    const file = controller.getProject().nodes[fileId];
    return file?.kind === "file" && isImageFileName(file.name) ? file.content : "";
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

function getDefaultModuleMapName(fileName) {
  const baseName = fileName.replace(/\.mtree$/i, "") || "module-map";
  return `${baseName}.module-map.md`;
}

function renderMtreeWarnings(warnings) {
  elements.mtreeWarningList.replaceChildren();

  if (warnings.length === 0) {
    const empty = document.createElement("span");
    empty.className = "subtle-label";
    empty.textContent = "No warnings.";
    elements.mtreeWarningList.append(empty);
    return;
  }

  warnings.forEach((warning) => {
    const row = document.createElement("div");
    row.className = "subtle-label";
    row.textContent = warning;
    elements.mtreeWarningList.append(row);
  });
}

function renderMtreeQuality(quality) {
  if (!quality) {
    elements.mtreeQualityText.textContent = "No module map generated yet.";
    return;
  }

  const warningCount = quality.missingDescriptionModules.length + quality.recursionModules.length;
  const passedCount = Math.max(0, quality.totalModules - warningCount);
  elements.mtreeQualityText.textContent = `${passedCount}/${quality.totalModules} modules passed checks.`;
}

function listMarkdownTargets(project) {
  return Object.values(project.nodes)
    .filter((node) => node.kind === "file" && node.name.endsWith(".md"))
    .sort((left, right) => getPath(project, left.id).localeCompare(getPath(project, right.id)));
}

function populateMtreeTargetPicker(selectedFileId = "__new__") {
  const project = controller.getProject();
  const markdownFiles = listMarkdownTargets(project);
  elements.mtreeTargetFileSelect.replaceChildren();

  const createNewOption = document.createElement("option");
  createNewOption.value = "__new__";
  createNewOption.textContent = "Create new markdown file";
  elements.mtreeTargetFileSelect.append(createNewOption);

  markdownFiles.forEach((file) => {
    const option = document.createElement("option");
    option.value = file.id;
    option.textContent = getPath(project, file.id);
    elements.mtreeTargetFileSelect.append(option);
  });

  const nextValue = markdownFiles.some((file) => file.id === selectedFileId) ? selectedFileId : "__new__";
  mtreeToolState.selectedTargetFileId = nextValue;
  elements.mtreeTargetFileSelect.value = nextValue;
  elements.mtreeOutputNameInput.disabled = nextValue !== "__new__";
}

function refreshMtreeDraftPresentation() {
  const draft = mtreeToolState.draftSection || "";
  syncMtreeViewportMetrics();
  elements.mtreeOutputHighlight.innerHTML = `${highlightMarkdownSource(draft)}<div class="editor-line"> </div>`;
  elements.mtreeRenderPreview.innerHTML = renderMarkdown(draft);
  void typesetPreview(draft, elements.mtreeRenderPreview);
  syncMtreeOutputScroll();
  elements.mtreeKeepButton.disabled = draft === mtreeToolState.generatedSection;
  elements.mtreeUndoButton.disabled = draft === mtreeToolState.generatedSection;
}

function renderMtreeDraft() {
  const draft = mtreeToolState.draftSection || "";
  elements.mtreeOutputText.value = draft;
  refreshMtreeDraftPresentation();
}

function syncMtreeViewportMetrics() {
  const scrollbarWidth = Math.max(0, elements.mtreeOutputText.offsetWidth - elements.mtreeOutputText.clientWidth);
  elements.mtreeOutputText.style.setProperty("--mtree-scrollbar-width", `${scrollbarWidth}px`);
}

function syncMtreeOutputScroll() {
  const scrollTop = elements.mtreeOutputText.scrollTop;
  const scrollLeft = elements.mtreeOutputText.scrollLeft;
  elements.mtreeOutputHighlight.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
}

function keepMtreeDraft() {
  mtreeToolState.generatedSection = mtreeToolState.draftSection;
  renderMtreeDraft();
}

function undoMtreeDraft() {
  mtreeToolState.draftSection = mtreeToolState.generatedSection;
  renderMtreeDraft();
}

function ensureMtreeOutputName(fileName) {
  const currentValue = elements.mtreeOutputNameInput.value.trim();
  if (currentValue) {
    return currentValue.toLowerCase().endsWith(".md") ? currentValue : `${currentValue}.md`;
  }
  const suggested = getDefaultModuleMapName(fileName);
  elements.mtreeOutputNameInput.value = suggested;
  return suggested;
}

function generateModuleMap() {
  const project = controller.getProject();
  const sourceFile = mtreeToolState.sourceFileId ? project.nodes[mtreeToolState.sourceFileId] : null;
  if (!sourceFile || sourceFile.kind !== "file" || !sourceFile.name.endsWith(".mtree")) {
    throw new Error("Select a .mtree file before generating a module map.");
  }

  const result = buildModuleMapSection(sourceFile.content, {
    simplify: elements.mtreeSimplifyInput.checked,
    splitContinuationTrees: elements.mtreeContinuationInput.checked,
    includeNavigation: elements.mtreeIncludeNavigationInput.checked,
    includeModules: elements.mtreeIncludeModulesInput.checked,
    includeParents: elements.mtreeIncludeParentsInput.checked,
    includeChildren: elements.mtreeIncludeChildrenInput.checked,
    includeDescriptions: elements.mtreeIncludeDescriptionsInput.checked,
    includeEmptySections: elements.mtreeIncludeEmptyInput.checked
  });

  mtreeToolState.generatedSection = result.section;
  mtreeToolState.draftSection = result.section;
  mtreeToolState.warnings = result.warnings;
  mtreeToolState.quality = result.quality;

  renderMtreeWarnings(result.warnings);
  renderMtreeQuality(result.quality);
  renderMtreeDraft();
  ensureMtreeOutputName(sourceFile.name);

  return result;
}

function openMtreeToolsDialog(fileId) {
  const project = controller.getProject();
  const file = project.nodes[fileId];
  if (!file || file.kind !== "file" || !file.name.endsWith(".mtree")) {
    notify("Module map tools are only available for .mtree files.");
    return;
  }

  mtreeToolState.sourceFileId = fileId;
  mtreeToolState.generatedSection = "";
  mtreeToolState.draftSection = "";
  mtreeToolState.warnings = [];
  mtreeToolState.quality = null;
  mtreeToolState.selectedTargetFileId = "__new__";

  elements.mtreeSourceText.textContent = `Generate a module map from ${getPath(project, fileId) || file.name}.`;
  elements.mtreeOutputNameInput.value = getDefaultModuleMapName(file.name);
  populateMtreeTargetPicker();
  renderMtreeWarnings([]);
  renderMtreeQuality(null);
  renderMtreeDraft();
  elements.mtreeToolsDialog.showModal();

  try {
    generateModuleMap();
  } catch (error) {
    notify(error.message);
  }
}

function regenerateModuleMapWithNotification() {
  if (!elements.mtreeToolsDialog.open || !mtreeToolState.sourceFileId) {
    return;
  }
  try {
    generateModuleMap();
  } catch (error) {
    notify(error.message);
  }
}

function upsertModuleMapMarkdown() {
  const project = controller.getProject();
  const sourceFile = mtreeToolState.sourceFileId ? project.nodes[mtreeToolState.sourceFileId] : null;
  if (!sourceFile || sourceFile.kind !== "file" || !sourceFile.name.endsWith(".mtree")) {
    notify("Module map source file is no longer available.");
    return;
  }

  if (!mtreeToolState.generatedSection) {
    try {
      generateModuleMap();
    } catch (error) {
      notify(error.message);
      return;
    }
  }

  const draftSection = elements.mtreeOutputText.value;
  mtreeToolState.draftSection = draftSection;
  const parentId = getNode(project, sourceFile.id).parentId;
  const selectedTargetFileId = elements.mtreeTargetFileSelect.value;

  if (selectedTargetFileId !== "__new__") {
    const targetFile = project.nodes[selectedTargetFileId];
    if (!targetFile || targetFile.kind !== "file" || !targetFile.name.endsWith(".md")) {
      notify("Selected target markdown file is no longer available.");
      populateMtreeTargetPicker();
      return;
    }

    const nextContent = replaceOrAppendModuleMap(targetFile.content, draftSection);
    controller.updateContent(targetFile.id, nextContent);
    publishOperation({ type: "update-file", path: getPath(project, targetFile.id), content: nextContent });
    setActiveSourceFile(targetFile.id);
    setPreviewFile(targetFile.id);
    elements.mtreeToolsDialog.close();
    notify(`Updated ${targetFile.name} with the generated module map.`);
    return;
  }

  const outputName = ensureMtreeOutputName(sourceFile.name);
  const sibling = findChildByName(project, parentId, outputName);

  if (sibling && sibling.kind !== "file") {
    notify(`Cannot write module map to ${outputName} because a folder already uses that name.`);
    return;
  }

  if (sibling && !sibling.name.endsWith(".md")) {
    notify("Module map output must be a .md file.");
    return;
  }

  if (sibling) {
    const nextContent = replaceOrAppendModuleMap(sibling.content, draftSection);
    controller.updateContent(sibling.id, nextContent);
    publishOperation({ type: "update-file", path: getPath(project, sibling.id), content: nextContent });
    setActiveSourceFile(sibling.id);
    setPreviewFile(sibling.id);
    elements.mtreeToolsDialog.close();
    notify(`Updated ${outputName} with the generated module map.`);
    return;
  }

  controller.createFile(parentId, outputName, replaceOrAppendModuleMap("", draftSection));
  const nextProject = controller.getProject();
  const createdFile = findChildByName(nextProject, parentId, outputName);
  if (createdFile) {
    publishOperation({
      type: "create-file",
      parentPath: parentId === nextProject.rootId ? "" : getPath(nextProject, parentId),
      name: outputName,
      content: createdFile.content
    });
    setActiveSourceFile(createdFile.id);
    setPreviewFile(createdFile.id);
  }
  elements.mtreeToolsDialog.close();
  notify(`Created ${outputName} from ${sourceFile.name}.`);
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

function highlightMtreeSource(value) {
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
  }).join("");
}

function highlightUrlDbSource(value) {
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
  }).join("");
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

function highlightBmapSource(value) {
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
  }).join("");
}

function highlightMarkdownSource(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  return lines.map((rawLine) => {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

    if (!trimmed) {
      return renderWhitespaceOnlyEditorLine(rawLine);
    }

    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      return `<div class="editor-line"><span class="token-fence">${escaped}</span></div>`;
    }

    if (inFence) {
      return `<div class="editor-line"><span class="token-code-block">${escaped}</span></div>`;
    }

    if (/^\s*#{1,6}\s/.test(rawLine)) {
      const [, indent, hashes, space, text] = rawLine.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
      return `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-heading-mark">${escapeEditorHtml(hashes)}</span>${escapeEditorHtml(space)}<span class="token-heading-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`;
    }

    if (/^\s*-\s+/.test(rawLine)) {
      const [, indent, marker, text] = rawLine.match(/^(\s*)(-)\s+(.*)$/);
      return `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-list-mark">${marker}</span> ${applyInlineHighlighting(escapeEditorHtml(text || ""))}</div>`;
    }

    if (/^\s*>\s?/.test(rawLine)) {
      const [, indent, marker, text] = rawLine.match(/^(\s*)(>)(\s?.*)$/);
      return `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-quote-mark">${marker}</span><span class="token-quote-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`;
    }

    return `<div class="editor-line">${applyInlineHighlighting(escaped)}</div>`;
  }).join("");
}

function getEditorLineHeight() {
  const lineHeight = Number.parseFloat(globalThis.getComputedStyle(elements.editorContent).lineHeight);
  return Number.isFinite(lineHeight) ? lineHeight : 20.8;
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

function syncEditorViewportMetrics() {
  // No-op retained for call-site compatibility; layout is now native.
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
function renderEditorContent(text) {
  refreshFormatToolbar();
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const activeFile = controller.getActiveFile();
  const highlightMarkup = activeFile?.name.endsWith(".mtree")
    ? highlightMtreeSource(normalized)
    : activeFile?.name.endsWith(".urldb")
      ? highlightUrlDbSource(normalized)
      : isBmapFileName(activeFile?.name ?? "")
        ? highlightBmapSource(normalized)
        : highlightMarkdownSource(normalized);

  elements.editorContent.innerHTML = highlightMarkup;

  // Ensure every empty line has a <br> so the browser renders it at full height
  // and allows cursor placement.
  const allLines = Array.from(elements.editorContent.querySelectorAll(":scope > .editor-line"));
  allLines.forEach((line) => {
    if (line.childNodes.length === 0 ||
        (line.childNodes.length === 1 &&
         line.firstChild?.nodeName !== "BR" &&
         line.firstChild?.textContent === "")) {
      line.innerHTML = "<br>";
    }
  });

  const renderedLines = allLines.slice(0, Math.max(1, lines.length));
  const minimumLineHeight = getEditorLineHeight();

  renderedLines.forEach((line, index) => {
    line.dataset.lineIndex = String(index);
    const indentCols = getLeadingIndentColumns(lines[index] ?? "");
    line.style.setProperty("--wrapped-indent-columns", String(indentCols));
    line.classList.toggle("has-wrapped-indent", indentCols > 0);
  });

  // Phase 5: apply agent-pending decoration to the relevant lines.
  const activeFilePath = controller.getActiveFile()
    ? getPath(controller.getProject(), controller.getActiveFile().id)
    : null;
  const activeDecoration = activeFilePath ? agentPendingDecorations.get(activeFilePath) : null;
  if (activeDecoration) {
    const { lineStart, lineEnd } = activeDecoration;
    renderedLines.forEach((line, index) => {
      line.classList.toggle("is-agent-pending", index >= lineStart && index <= lineEnd);
    });
  }

  // Rebuild the gutter.
  const gutterMarkup = renderedLines.map((line, index) => {
    const height = Math.max(minimumLineHeight, line.getBoundingClientRect().height);
    const isDecorated = activeDecoration && index >= activeDecoration.lineStart && index <= activeDecoration.lineEnd;
    const marker = isDecorated ? `<span class="editor-gutter-agent-mark" aria-hidden="true">◦</span>` : "";
    return `<div class="editor-gutter-line${isDecorated ? " is-agent-pending" : ""}" style="height:${height.toFixed(3)}px">${marker}${index + 1}</div>`;
  }).join("");
  elements.editorGutter.innerHTML = `<div class="editor-gutter-content">${gutterMarkup}</div>`;

  // Sync gutter scroll position.
  syncEditorScroll();

  // Keep placeholder visible when content is empty.
  elements.editorContent.dataset.empty = normalized.length === 0 ? "true" : "false";

  // Update the floating in-editor agent action bar.
  updateEditorAgentBar();
}

// Alias kept so existing call sites that pass `elements.textarea.value` still
// work; TEXT is ignored but extracted from the DOM instead.
function renderEditorDecorations(_text) {
  renderEditorContent(getEditorText());
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

  if (node.name.endsWith(".md")) {
    editorLinkTooltip.previewEl.innerHTML = renderMarkdown(node.content, {
      resolveUrl(url) { return resolveProjectAssetUrl(project, nodeId, url); }
    });
  } else if (isImageFileName(node.name)) {
    editorLinkTooltip.previewEl.innerHTML = `<img src="${escapeHtmlAttribute(node.content)}" alt="${escapeHtmlAttribute(node.name)}" style="max-width:100%;height:auto">`;
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
  if (!activeFile?.name.endsWith(".md")) {
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

function renderLinksPanel(project, activeFile) {
  if (!linksPanelEl) return;
  if (!activeFile || !activeFile.name.endsWith(".md")) {
    linksPanelEl.hidden = true;
    return;
  }
  linksPanelEl.hidden = false;

  const activePath = getPath(project, activeFile.id);
  const activeSegments = activePath.split("/").filter(Boolean);
  activeSegments.pop();

  // Outgoing links
  const outgoingLinks = extractMarkdownLinks(activeFile.content);
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
    if (node.kind !== "file" || !node.name.endsWith(".md") || node.id === activeFile.id) return;
    const nodePath = getPath(project, node.id);
    const nodeSegments = nodePath.split("/").filter(Boolean);
    nodeSegments.pop();
    const links = extractMarkdownLinks(node.content);
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
      renderEditorAutocomplete();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      autocompleteState.activeIndex = (autocompleteState.activeIndex - 1 + autocompleteState.items.length) % autocompleteState.items.length;
      renderEditorAutocomplete();
      return;
    }
    if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) {
      event.preventDefault();
      traceEditorEvent("Autocomplete accepted from keydown", { key: event.key });
      acceptEditorAutocomplete();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideEditorAutocomplete();
      return;
    }
  }

  handleIndentKeydown(event);
}

function hasMathMarkup(value) {
  return /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$(?!\s)[^$\n]+\$/.test(value);
}

function ensureMathJax() {
  if (globalThis.MathJax?.typesetPromise) {
    return Promise.resolve(globalThis.MathJax);
  }

  if (mathJaxLoadPromise) {
    return mathJaxLoadPromise;
  }

  globalThis.MathJax = globalThis.MathJax ?? {
    tex: {
      inlineMath: [["$", "$"], ["\\(", "\\)"]],
      displayMath: [["$$", "$$"], ["\\[", "\\]"]]
    },
    svg: { fontCache: "global" },
    startup: { typeset: false }
  };

  mathJaxLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
    script.async = true;
    script.onload = () => resolve(globalThis.MathJax);
    script.onerror = () => reject(new Error("MathJax failed to load."));
    document.head.append(script);
  });

  return mathJaxLoadPromise;
}

async function typesetPreview(content, target = elements.preview) {
  if (!hasMathMarkup(content)) {
    return;
  }

  try {
    const mathJax = await ensureMathJax();
    if (mathJax?.typesetClear) {
      mathJax.typesetClear([target]);
    }
    if (mathJax?.typesetPromise) {
      await mathJax.typesetPromise([target]);
    }
  } catch {
    // Preview still works without MathJax when offline or blocked.
  }
}

function ensureOpenTabs(project) {
  sourceOpenTabIds = sourceOpenTabIds.filter((fileId) => {
    const node = project.nodes[fileId];
    return node?.kind === "file";
  });

  previewOpenTabIds = previewOpenTabIds.filter((fileId) => {
    const node = project.nodes[fileId];
    return node?.kind === "file";
  });

  if (project.activeFileId && !sourceOpenTabIds.includes(project.activeFileId)) {
    sourceOpenTabIds.push(project.activeFileId);
  }

  if (!project.activeFileId && sourceOpenTabIds.length > 0) {
    sourceOpenTabIds = [];
  }

  if (previewFileId) {
    const previewNode = project.nodes[previewFileId];
    if (previewNode?.kind !== "file") {
      previewFileId = null;
    }
  }

  if (previewFileId && !previewOpenTabIds.includes(previewFileId)) {
    previewOpenTabIds.push(previewFileId);
  }

  if (!previewFileId && previewOpenTabIds.length > 0) {
    previewFileId = previewOpenTabIds[previewOpenTabIds.length - 1] ?? null;
  }
}

function openSourceTab(fileId) {
  const project = controller.getProject();
  const node = project.nodes[fileId];
  if (!node || node.kind !== "file") {
    return;
  }

  if (!sourceOpenTabIds.includes(fileId)) {
    sourceOpenTabIds.push(fileId);
  }
}

function openPreviewTab(fileId) {
  const project = controller.getProject();
  const node = project.nodes[fileId];
  if (!node || node.kind !== "file") {
    return;
  }

  if (!previewOpenTabIds.includes(fileId)) {
    previewOpenTabIds.push(fileId);
  }
}

function setActiveSourceFile(fileId) {
  selectionNodeId = fileId;
  sourceUrlDbEntry = null;
  openSourceTab(fileId);
  controller.setActiveFile(fileId);
}

function setActiveSourceUrlDbEntry(fileId, entryId) {
  selectionNodeId = fileId;
  sourceUrlDbEntry = { fileId, entryId };
  openSourceTab(fileId);
  controller.setActiveFile(fileId);
}

function setPreviewFile(fileId) {
  const project = controller.getProject();
  const node = project.nodes[fileId];
  if (!node || node.kind !== "file") {
    return;
  }
  openPreviewTab(fileId);
  previewFileId = fileId;
  previewUrlDbEntry = null;
  updateStatus(project);
}

function openFileFromExplorer(fileId) {
  const project = controller.getProject();
  const node = project.nodes[fileId];
  if (!node || node.kind !== "file") {
    return;
  }
  logDebug("action", "File opened", getPath(project, fileId));
  setActiveSourceFile(fileId);
  if (isBmapFileName(node.name)) {
    setPreviewFile(fileId);
    if (settings.preview === "hidden") {
      togglePreview();
    }
  } else if (previewFileId === null && isPreviewableFileName(node.name)) {
    setPreviewFile(fileId);
  }
}

function canOpenFileInPane(fileId, pane) {
  const project = controller.getProject();
  const node = project.nodes[fileId];
  if (!node || node.kind !== "file") {
    return false;
  }

  if (pane === "preview") {
    return isPreviewableFileName(node.name);
  }

  return true;
}

function setPaneDropActive(pane, isActive) {
  const target = pane === "preview" ? elements.previewPane : elements.sourcePane;
  target.classList.toggle("is-drop-active", isActive);
}

function clearPaneDropState() {
  elements.sourcePane.classList.remove("is-drop-active");
  elements.previewPane.classList.remove("is-drop-active");
}

function clearExplorerDropState() {
  elements.explorerTree.classList.remove("is-drop-into-root");
  elements.explorerTree.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach((row) => {
    row.classList.remove("is-drop-before", "is-drop-after", "is-drop-into");
  });
}

function setExplorerDropState(row, placement) {
  clearExplorerDropState();
  if (!placement) {
    return;
  }
  if (!row) {
    elements.explorerTree.classList.add("is-drop-into-root");
    return;
  }
  row.classList.add(`is-drop-${placement}`);
}

function getExplorerDropPayloadKind(types) {
  if (types.includes("text/mdnotes-node-id")) {
    return "node";
  }
  if (types.includes("text/mdnotes-file-id")) {
    return "file";
  }
  if (types.includes("text/mdnotes-urldb-entry")) {
    return "urldb-entry";
  }
  return null;
}

function getExplorerDropPlacement(row, node, entryId, payloadKind, event) {
  if (payloadKind === "urldb-entry") {
    if (entryId) {
      const rect = row.getBoundingClientRect();
      return event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
    }
    return node.kind === "file" && isUrlDbFileName(node.name) ? "into" : null;
  }

  if (payloadKind !== "file" && payloadKind !== "node") {
    return null;
  }

  const rect = row.getBoundingClientRect();
  if (node.kind === "folder") {
    const topEdge = rect.top + (rect.height * 0.25);
    const bottomEdge = rect.bottom - (rect.height * 0.25);
    if (event.clientY < topEdge) {
      return "before";
    }
    if (event.clientY > bottomEdge) {
      return "after";
    }
    return "into";
  }

  return event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
}

function resolveNodeDropLocation(project, targetNodeId, placement) {
  if (!targetNodeId) {
    const root = project.nodes[ROOT_ID];
    return { parentId: ROOT_ID, index: root?.children.length ?? 0 };
  }

  const targetNode = project.nodes[targetNodeId];
  if (!targetNode) {
    return null;
  }

  if (placement === "into") {
    if (targetNode.kind !== "folder") {
      return null;
    }
    return { parentId: targetNode.id, index: targetNode.children.length };
  }

  const parent = project.nodes[targetNode.parentId];
  if (!parent || parent.kind !== "folder") {
    return null;
  }

  const targetIndex = parent.children.indexOf(targetNode.id);
  if (targetIndex < 0) {
    return null;
  }

  return {
    parentId: parent.id,
    index: placement === "after" ? targetIndex + 1 : targetIndex
  };
}

function moveExplorerNode(nodeId, targetNodeId, placement) {
  const project = controller.getProject();
  const draggedNode = project.nodes[nodeId];
  if (!draggedNode || (draggedNode.kind !== "file" && draggedNode.kind !== "folder")) {
    return false;
  }

  const destination = resolveNodeDropLocation(project, targetNodeId, placement);
  if (!destination) {
    return false;
  }

  const sourceParent = project.nodes[draggedNode.parentId];
  const sourceIndex = sourceParent?.children.indexOf(nodeId) ?? -1;
  if (sourceIndex < 0) {
    return false;
  }

  const normalizedIndex = sourceParent?.id === destination.parentId && sourceIndex < destination.index
    ? destination.index - 1
    : destination.index;
  if (draggedNode.parentId === destination.parentId && sourceIndex === normalizedIndex) {
    return false;
  }

  controller.move(nodeId, destination.parentId, destination.index);
  selectionNodeId = nodeId;
  sourceUrlDbEntry = null;
  logDebug("action", "Explorer node moved", `${getPath(controller.getProject(), nodeId)} -> ${getPath(controller.getProject(), destination.parentId)}`);
  return true;
}

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

function moveExplorerUrlDbEntry(sourceFileId, sourceEntryId, targetNodeId, targetEntryId, placement) {
  const project = controller.getProject();
  const sourceFile = project.nodes[sourceFileId];
  const targetFile = targetNodeId ? project.nodes[targetNodeId] : null;
  if (!sourceFile || sourceFile.kind !== "file" || !isUrlDbFileName(sourceFile.name)) {
    return false;
  }
  if (!targetFile || targetFile.kind !== "file" || !isUrlDbFileName(targetFile.name)) {
    return false;
  }

  const sourceEntry = getUrlDbEntryById(sourceFile.content, sourceEntryId);
  if (!sourceEntry) {
    return false;
  }

  const targetEntries = getUrlDbEntries(targetFile.content);
  const targetIndex = targetEntryId
    ? (() => {
      const index = targetEntries.findIndex((entry) => entry.id === targetEntryId);
      if (index < 0) {
        return null;
      }
      return placement === "after" ? index + 1 : index;
    })()
    : targetEntries.length;

  if (targetIndex === null) {
    return false;
  }

  let nextTargetContent = targetFile.content;
  if (sourceFileId === targetNodeId) {
    const sourceEntries = getUrlDbEntries(sourceFile.content);
    const sourceIndex = sourceEntries.findIndex((entry) => entry.id === sourceEntryId);
    if (sourceIndex < 0) {
      return false;
    }
    const normalizedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    if (sourceIndex === normalizedIndex) {
      return false;
    }
    nextTargetContent = moveUrlDbEntry(sourceFile.content, sourceEntryId, normalizedIndex);
    applyFileContentUpdates([{ fileId: sourceFileId, content: nextTargetContent }]);
  } else {
    const moved = moveUrlDbEntryBetweenFiles(sourceFile.content, sourceEntryId, targetFile.content, targetIndex);
    nextTargetContent = moved.targetContent;
    applyFileContentUpdates([
      { fileId: sourceFileId, content: moved.sourceContent },
      { fileId: targetNodeId, content: moved.targetContent }
    ]);
  }

  const nextTargetEntries = getUrlDbEntries(nextTargetContent);
  const movedEntry = nextTargetEntries.find((entry) => entry.name === sourceEntry.name);
  if (movedEntry) {
    setActiveSourceUrlDbEntry(targetNodeId, movedEntry.id);
  } else {
    selectionNodeId = targetNodeId;
    sourceUrlDbEntry = null;
    controller.setActiveFile(targetNodeId);
  }
  if (previewFileId === sourceFileId || previewFileId === targetNodeId) {
    previewFileId = targetNodeId;
    previewUrlDbEntry = movedEntry?.id ?? null;
  }
  logDebug("action", "Bookmark entry moved", `${getPath(controller.getProject(), targetNodeId)} :: ${sourceEntry.name}`);
  return true;
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

function openDroppedFileInPane(fileId, pane) {
  if (!canOpenFileInPane(fileId, pane)) {
    return;
  }
  if (pane === "preview") {
    setPreviewFile(fileId);
    logDebug("action", "File dropped into preview pane", getPath(controller.getProject(), fileId));
    return;
  }
  setActiveSourceFile(fileId);
  logDebug("action", "File dropped into source pane", getPath(controller.getProject(), fileId));
}

function openUrlDbEntryInPane(fileId, entryId, pane) {
  const project = controller.getProject();
  const file = project.nodes[fileId];
  if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
    return;
  }

  if (pane === "preview") {
    openPreviewTab(fileId);
    previewFileId = fileId;
    previewUrlDbEntry = entryId;
    updateStatus(project);
    return;
  }

  setActiveSourceUrlDbEntry(fileId, entryId);
  logDebug("action", "Bookmark entry dropped into source pane", `${getPath(project, fileId)} :: ${entryId}`);
}

async function saveActiveWorkspaceFile() {
  const project = controller.getProject();
  const activeFile = controller.getActiveFile();
  if (!activeFile) {
    return;
  }
  const wroteToDisk = await saveProjectToHandles(project);
  controller.markSaved(activeFile.id);
  if (!wroteToDisk) {
    notify("Saved in browser cache. Use Export to download files.");
  }
}

async function handleSaveCommand() {
  if (elements.mtreeToolsDialog.open && elements.mtreeToolsDialog.contains(document.activeElement)) {
    logDebug("action", "Module map written to target");
    upsertModuleMapMarkdown();
    return;
  }

  try {
    logDebug("action", "Workspace save requested");
    await saveActiveWorkspaceFile();
    logDebug("response", "Workspace saved");
  } catch (error) {
    notify(error.message);
  }
}

function bindPaneDropTarget(target, pane) {
  // dragover: getData() is blocked by spec during dragover for security — use types instead.
  target.addEventListener("dragover", (event) => {
    const types = event.dataTransfer?.types ?? [];
    const hasFile = types.includes("text/mdnotes-file-id");
    const hasEntry = types.includes("text/mdnotes-urldb-entry");
    if (!hasFile && !hasEntry) {
      setPaneDropActive(pane, false);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setPaneDropActive(pane, true);
  });

  target.addEventListener("dragleave", (event) => {
    if (event.currentTarget?.contains(event.relatedTarget)) {
      return;
    }
    setPaneDropActive(pane, false);
  });

  target.addEventListener("drop", (event) => {
    setPaneDropActive(pane, false);
    const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
    const urlDbPayload = event.dataTransfer?.getData("text/mdnotes-urldb-entry");
    logDebug("action", `Drop on ${pane} pane`, fileId ? `file=${fileId}` : `entry=${urlDbPayload}`);
    if ((!fileId || !canOpenFileInPane(fileId, pane)) && !urlDbPayload) {
      logDebug("response", `Drop on ${pane} pane rejected`, fileId ? `canOpen=${canOpenFileInPane(fileId, pane)}` : "no payload");
      return;
    }
    event.preventDefault();
    if (fileId && canOpenFileInPane(fileId, pane)) {
      openDroppedFileInPane(fileId, pane);
      return;
    }

    try {
      const parsed = JSON.parse(urlDbPayload);
      openUrlDbEntryInPane(parsed.fileId, parsed.entryId, pane);
    } catch {
      logDebug("response", `Drop on ${pane} pane: malformed urldb payload`);
    }
  });
}

function closeSourceTab(fileId) {
  const project = controller.getProject();
  const wasActive = project.activeFileId === fileId;
  sourceOpenTabIds = sourceOpenTabIds.filter((tabId) => tabId !== fileId);

  if (!wasActive) {
    updateStatus(project);
    return;
  }

  const fallbackId = sourceOpenTabIds[sourceOpenTabIds.length - 1] ?? null;
  if (fallbackId) {
    selectionNodeId = fallbackId;
    controller.setActiveFile(fallbackId);
    return;
  }

  const nextProject = structuredClone(project);
  nextProject.activeFileId = null;
  controller.replaceProject(nextProject);
}

function closePreviewTab(fileId) {
  previewOpenTabIds = previewOpenTabIds.filter((tabId) => tabId !== fileId);
  if (previewFileId === fileId) {
    previewFileId = previewOpenTabIds[previewOpenTabIds.length - 1] ?? null;
  }
  updateStatus(controller.getProject());
}

function moveTabWithinList(tabIds, draggedFileId, targetFileId, placeAfter = false) {
  const next = tabIds.filter((tabId) => tabId !== draggedFileId);
  const targetIndex = next.indexOf(targetFileId);
  if (targetIndex < 0) {
    next.push(draggedFileId);
    return next;
  }

  next.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedFileId);
  return next;
}

function reorderPaneTabs(pane, draggedFileId, targetFileId, placeAfter = false) {
  if (pane === "source") {
    sourceOpenTabIds = moveTabWithinList(sourceOpenTabIds, draggedFileId, targetFileId, placeAfter);
  } else {
    previewOpenTabIds = moveTabWithinList(previewOpenTabIds, draggedFileId, targetFileId, placeAfter);
  }

  renderTabs(controller.getProject());
}

function renderTabStrip({ strip, pane, project, tabIds, activeFileId, emptyText, onActivate, onClose, allowReorder = false }) {
  strip.replaceChildren();

  if (tabIds.length === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-tab is-empty";
    empty.textContent = emptyText;
    strip.append(empty);
    return;
  }

  tabIds.forEach((fileId) => {
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file") {
      return;
    }

    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `editor-tab${activeFileId === fileId ? " is-active" : ""}`;
    tab.dataset.fileId = fileId;
    tab.title = getPath(project, fileId);
    tab.draggable = allowReorder;

    const icon = document.createElement("span");
    icon.className = "tab-file-icon";
    icon.setAttribute("aria-hidden", "true");

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = file.name;

    const dirty = document.createElement("span");
    dirty.className = `tab-dirty${file.dirty ? " is-dirty" : ""}`;
    dirty.textContent = file.dirty ? "●" : "";

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "×";
    close.setAttribute("aria-hidden", "true");

    const filePath = getPath(project, fileId);
    if (agentPendingDecorations.has(filePath)) {
      const badge = document.createElement("span");
      badge.className = "tab-agent-badge";
      badge.title = "Pending agent edit — review in chat";
      tab.append(icon, title, badge, dirty, close);
    } else {
      tab.append(icon, title, dirty, close);
    }
    tab.addEventListener("click", () => onActivate(fileId));
    if (allowReorder) {
      tab.addEventListener("dragstart", (event) => {
        draggingTabState = { pane, fileId };
        event.dataTransfer?.setData("text/mdnotes-tab", JSON.stringify(draggingTabState));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      tab.addEventListener("dragend", () => {
        draggingTabState = null;
      });
      tab.addEventListener("dragover", (event) => {
        if (draggingTabState?.pane !== pane || draggingTabState.fileId === fileId) {
          return;
        }
        event.preventDefault();
      });
      tab.addEventListener("drop", (event) => {
        if (draggingTabState?.pane !== pane || draggingTabState.fileId === fileId) {
          return;
        }
        event.preventDefault();
        const rect = tab.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + (rect.width / 2);
        reorderPaneTabs(pane, draggingTabState.fileId, fileId, placeAfter);
      });
    }
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(fileId);
    });
    strip.append(tab);
  });
}

function renderTabs(project) {
  renderTabStrip({
    strip: elements.sourceTabStrip,
    pane: "source",
    project,
    tabIds: sourceOpenTabIds,
    activeFileId: project.activeFileId,
    emptyText: "No source file selected",
    onActivate: setActiveSourceFile,
    onClose: closeSourceTab,
    allowReorder: true
  });

  renderTabStrip({
    strip: elements.previewTabStrip,
    pane: "preview",
    project,
    tabIds: previewOpenTabIds,
    activeFileId: previewFileId,
    emptyText: "No preview file selected",
    onActivate: setPreviewFile,
    onClose: closePreviewTab,
    allowReorder: true
  });
}

function bindTabStripReorderTarget(strip, pane) {
  strip.addEventListener("dragover", (event) => {
    if (draggingTabState?.pane !== pane) {
      return;
    }
    event.preventDefault();
  });

  strip.addEventListener("drop", (event) => {
    if (draggingTabState?.pane !== pane) {
      return;
    }
    const targetTab = event.target.closest(".editor-tab[data-file-id]");
    if (targetTab) {
      return;
    }

    event.preventDefault();
    const targetList = pane === "source" ? sourceOpenTabIds : previewOpenTabIds;
    const draggedId = draggingTabState.fileId;
    const next = targetList.filter((tabId) => tabId !== draggedId);
    next.push(draggedId);
    if (pane === "source") {
      sourceOpenTabIds = next;
    } else {
      previewOpenTabIds = next;
    }
    renderTabs(controller.getProject());
  });
}

function renderUrlDbTable(target, file) {
  const entries = getUrlDbEntries(file.content);
  const frame = document.createElement("div");
  frame.className = "urldb-preview";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "editor-readonly-note";
    empty.textContent = "No valid bookmark entries yet. Add sections like [Name] and url = https://...";
    frame.append(empty);
    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  const table = document.createElement("table");
  table.className = "urldb-table";
  table.innerHTML = "<thead><tr><th>Preview</th><th>Name</th><th>URL</th><th>Description</th></tr></thead>";
  const body = document.createElement("tbody");

  entries.forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td><img src="${escapeHtmlAttribute(entry.url)}" alt="${escapeHtmlAttribute(entry.name)}"></td><td>${escapeEditorHtml(entry.name)}</td><td><a href="${escapeHtmlAttribute(entry.url)}" target="_blank" rel="noreferrer">${escapeEditorHtml(entry.url)}</a></td><td>${escapeEditorHtml(entry.description || "")}</td>`;
    body.append(row);
  });

  table.append(body);
  frame.append(table);
  target.append(frame);
  return { shouldTypeset: false, content: "" };
}

function renderUrlDbEntryPreview(target, file, entryId) {
  const entry = getUrlDbEntryById(file.content, entryId);
  if (!entry) {
    previewUrlDbEntry = null;
    return renderUrlDbTable(target, file);
  }

  const frame = document.createElement("div");
  frame.className = "asset-preview remote-asset-preview";

  const image = document.createElement("img");
  image.src = entry.url;
  image.alt = entry.name;
  frame.append(image);

  const meta = document.createElement("div");
  meta.className = "remote-asset-meta";
  meta.innerHTML = `<strong>${escapeEditorHtml(entry.name)}</strong><span>${escapeEditorHtml(entry.description || entry.url)}</span>`;
  frame.append(meta);

  target.append(frame);
  return { shouldTypeset: false, content: "" };
}

function renderPreviewContent(target, project, file) {
  target.replaceChildren();

  if (!file) {
    return { shouldTypeset: false, content: "" };
  }

  if (isImageFileName(file.name)) {
    const frame = document.createElement("div");
    frame.className = "asset-preview";
    const image = document.createElement("img");
    image.src = file.content;
    image.alt = file.name;
    frame.append(image);
    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  if (isUrlDbFileName(file.name)) {
    if (previewUrlDbEntry && previewFileId === file.id) {
      return renderUrlDbEntryPreview(target, file, previewUrlDbEntry);
    }
    return renderUrlDbTable(target, file);
  }

  if (file.name.endsWith(".mtree")) {
    target.innerHTML = `<pre><code>${escapeEditorHtml(file.content)}</code></pre>`;
    return { shouldTypeset: false, content: "" };
  }

  if (isBmapFileName(file.name)) {
    if (!previewBmapView) {
      previewBmapView = createBmapView({ container: target });
    }
    const basePath = getPath(project, file.id);
    previewBmapView.render({
      documentKey: file.id,
      source: file.content,
      onOpenLinkedFile(filePath) {
        const baseSegments = basePath.split("/").filter(Boolean);
        baseSegments.pop();
        const resolvedPath = normalizePath([...baseSegments, filePath].join("/"));
        const nodeId = getNodeIdByPath(project, resolvedPath);
        if (nodeId) {
          openFileFromExplorer(nodeId);
        }
      },
      resolveFileContent(filePath) {
        const baseSegments = basePath.split("/").filter(Boolean);
        baseSegments.pop();
        const resolvedPath = normalizePath([...baseSegments, filePath].join("/"));
        const nodeId = getNodeIdByPath(project, resolvedPath);
        if (!nodeId) {
          return null;
        }
        const node = project.nodes[nodeId];
        return node?.kind === "file" ? (node.content ?? null) : null;
      },
      listProjectFiles() {
        return Object.values(project.nodes)
          .filter((node) => node?.kind === "file" && node.id !== file.id)
          .map((node) => {
            const path = getPath(project, node.id);
            return {
              fileId: node.id,
              kind: isImageFileName(node.name) ? "image" : "file",
              label: path,
              path: getRelativeProjectPath(basePath, path)
            };
          })
          .sort((left, right) => left.label.localeCompare(right.label));
      },
      resolveRelativeFilePath(targetFileId) {
        const targetNode = project.nodes[targetFileId];
        if (!targetNode || targetNode.kind !== "file" || targetNode.id === file.id) {
          return null;
        }
        return getRelativeProjectPath(basePath, getPath(project, targetNode.id));
      },
      onCommit(nextSource, detail) {
        updateFileContentFromPreview(file.id, nextSource, detail?.reason ?? "bmap preview edit");
      },
      generateScope: settings.bmapGenerateScope,
      onQuickGenerate(request) {
        return quickGenerateBmapFile(file.id, request);
      },
      logDebug,
    });
    return { shouldTypeset: false, content: "" };
  }

  target.innerHTML = renderMarkdown(file.content, {
    resolveUrl(url) {
      return resolveProjectAssetUrl(project, file.id, url);
    },
    resolveLink(token) {
      const url = token.href;
      if (token.type === "image") {
        return resolveProjectAssetUrl(project, file.id, url);
      }
      if (/^(https?:\/\/|mailto:|data:|blob:)/i.test(url)) {
        return { href: url, external: true };
      }
      if (url.startsWith("#")) {
        return { href: url, external: false };
      }
      const basePath = getPath(project, file.id);
      const baseSegments = basePath.split("/").filter(Boolean);
      baseSegments.pop();
      const resolvedPath = normalizePath([...baseSegments, url].join("/"));
      const nodeId = getNodeIdByPath(project, resolvedPath);
      if (nodeId) {
        return { href: "#", external: false, attributes: { "data-open-file-id": nodeId } };
      }
      return { href: "#", external: false, attributes: { "data-unresolved-link": url } };
    }
  });

  return { shouldTypeset: true, content: file.content };
}

function printPreviewAsPdf() {
  const project = controller.getProject();
  const previewFile = previewFileId ? project.nodes[previewFileId] : null;
  if (!previewFile) {
    notify("Open a markdown or image file before exporting PDF.");
    return;
  }

  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.position = "fixed";
  printFrame.style.right = "0";
  printFrame.style.bottom = "0";
  printFrame.style.width = "0";
  printFrame.style.height = "0";
  printFrame.style.border = "0";
  printFrame.style.opacity = "0";
  printFrame.style.pointerEvents = "none";
  document.body.append(printFrame);

  const printWindow = printFrame.contentWindow;
  if (!printWindow) {
    printFrame.remove();
    notify("Unable to prepare PDF export in this browser.");
    return;
  }

  const previewHtml = isImageFileName(previewFile.name)
    ? `<div class="asset-preview"><img src="${escapeHtmlAttribute(previewFile.content)}" alt="${escapeHtmlAttribute(previewFile.name)}"></div>`
    : isUrlDbFileName(previewFile.name)
      ? elements.preview.innerHTML
    : previewFile.name.endsWith(".mtree")
      ? `<pre><code>${escapeEditorHtml(previewFile.content)}</code></pre>`
    : renderMarkdown(previewFile.content, {
      resolveUrl(url) {
        return resolveProjectAssetUrl(project, previewFile.id, url);
      }
    });
  const title = previewFile.name.replace(/\.md$/i, "") || "MDNotes";
  const includeMath = previewFile.name.endsWith(".md") && hasMathMarkup(previewFile.content);

  const cleanupPrintFrame = () => {
    globalThis.setTimeout(() => {
      printFrame.remove();
    }, 250);
  };

  printWindow.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { font-family: "Segoe UI", sans-serif; margin: 32px; color: #1f1f1f; line-height: 1.6; }
      pre, code { font-family: "Cascadia Code", Consolas, monospace; }
      pre { padding: 12px; background: #f5f5f5; border: 1px solid #ddd; overflow: auto; }
      code { background: #f5f5f5; padding: 1px 4px; }
      blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #0e639c; color: #555; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 6px 8px; border: 1px solid #ddd; }
      img { display: block; max-width: 100%; height: auto; }
      mjx-container { break-inside: avoid; page-break-inside: avoid; }
      mjx-container[jax="SVG"] { overflow: visible; }
      mjx-container[jax="SVG"] > svg { max-width: 100%; }
      @page { size: A4; margin: 14mm; }
    </style>
    ${includeMath ? '<script>window.MathJax={tex:{inlineMath:[["$","$"],["\\(","\\)"]],displayMath:[["$$","$$"],["\\[","\\]"]]},svg:{fontCache:"global"},startup:{typeset:false}};<\/script><script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"><\/script>' : ""}
  </head>
  <body>
    <main id="print-root">${previewHtml}</main>
  </body>
</html>`);
  printWindow.document.close();

  const finalizePrint = () => {
    printWindow.addEventListener("afterprint", cleanupPrintFrame, { once: true });
    printWindow.focus();
    printWindow.print();
    globalThis.setTimeout(cleanupPrintFrame, 1500);
  };

  if (includeMath) {
    const waitForMath = () => {
      if (printWindow.MathJax?.typesetPromise) {
        printWindow.MathJax.typesetPromise([printWindow.document.getElementById("print-root")]).finally(finalizePrint);
        return;
      }
      printWindow.setTimeout(waitForMath, 120);
    };
    printWindow.setTimeout(waitForMath, 120);
    return;
  }

  printWindow.setTimeout(finalizePrint, 80);
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
  elements.app.dataset.preview = settings.preview;
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
  renderDebugPanel();
}

const editorResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(() => {
    renderEditorContent(getEditorText());
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

// ---------------------------------------------------------------------------
// Proposal card click handlers (Phase 4 / Phase 3 transport)
// ---------------------------------------------------------------------------

/** Find the thread and message that own a given batchId. */
function findBatchMessage(batchId) {
  for (const thread of chatState.threads) {
    const msg = thread.messages.find((m) => m.batchId === batchId);
    if (msg) return { thread, msg };
  }
  return null;
}

/** Apply an agent batch immediately on arrival, then surface Keep/Drop review.
 *  Deletes still get a one-time confirm (Phase 7 safety) since they're destructive,
 *  but everything is recoverable via Drop (the checkpoint captures pre-apply state). */
function autoApplyProposals(message) {
  const ops = message.proposedOperations ?? [];
  if (ops.length === 0) return;

  const apply = () => {
    acceptAgentOperations(ops, message);
    message.proposalState = "accepted";
    persistChatWorkspaceState(controller.getProject());
    renderChatPanel(controller.getProject());
  };

  const hasDeletes = ops.some((op) => op.type === "delete-node");
  if (hasDeletes) {
    showConfirmDialog({
      title: "Delete included",
      message: "Some of these changes permanently delete files or folders. Apply them now? You can still Drop to undo.",
      acceptLabel: "Apply"
    }).then((confirmed) => {
      if (confirmed) {
        apply();
      } else {
        message.proposalState = "dropped";
        persistChatWorkspaceState(controller.getProject());
        renderChatPanel(controller.getProject());
      }
    });
    return;
  }
  apply();
}

/**
 * Apply a set of agent-proposed operations locally (or via collaboration when
 * synced). Marks each op's proposalState as "accepted" or "stale".
 * Phase 3 will add the full synced transport; this covers the local path.
 */
function acceptAgentOperations(ops, message) {
  // Capture baseRevision at accept time (before any op is applied).
  if (!message.baseRevision) {
    message.baseRevision = collaboration.getRevision();
  }
  // Capture checkpoint BEFORE applying (Phase 6 / subtask 6.1).
  if (message.batchId) {
    captureAgentCheckpoint(message.batchId, message.baseRevision);
  }
  const project = controller.getProject();
  for (const op of ops) {
    // Phase 7: block text ops on image files (safety edge case).
    const opFileName = op.name ?? op.path?.split("/").pop() ?? "";
    if ((op.type === "update-file" || op.type === "create-file") && isImageFileName(opFileName)) {
      op.proposalState = "stale";
      continue;
    }
    // Re-resolve path at accept time to detect staleness (plan §3.2).
    if (op.path) {
      const nodeId = getNodeIdByPath(project, op.path);
      if (!nodeId && op.type !== "create-file" && op.type !== "create-folder") {
        op.proposalState = "stale";
        continue;
      }
    }
    const cleanOp = { ...op };
    delete cleanOp.proposalId;
    delete cleanOp.preImage;
    delete cleanOp.proposalState;
    try {
      if (collaboration.isConnected() && workspaceMode === "synced") {
        collaboration.publishOperation(cleanOp).catch((err) => notify(err.message));
      } else {
        controller.applySyncOperation(cleanOp);
      }
      op.proposalState = "accepted";
    } catch {
      op.proposalState = "stale";
    }
  }
  // Register editor decorations for all accepted ops (Phase 5).
  if (message.batchId) {
    registerAgentDecorations(ops, message.batchId);
  }
}

document.addEventListener("click", (event) => {
  // Retry a failed agent turn.
  if (event.target.closest("[data-chat-retry]")) {
    void retryLastChatTurn();
    return;
  }

  // Expand / collapse the agent activity log.
  if (event.target.closest("[data-chat-activity-toggle]")) {
    chatState.activityExpanded = !chatState.activityExpanded;
    renderChatPanel(controller.getProject());
    return;
  }

  // Jump to first changed line in editor (Phase 5 / subtask 5.3)
  const jumpBtn = event.target.closest("[data-batch-jump]");
  if (jumpBtn) {
    jumpToAgentChange(jumpBtn.dataset.batchJump);
    return;
  }

  // Keep — finalise applied agent edits: clear decorations and mark kept.
  const keepBtn = event.target.closest("[data-batch-keep]");
  if (keepBtn) {
    const batchId = keepBtn.dataset.batchKeep;
    const found = findBatchMessage(batchId);
    if (!found) return;
    found.msg.proposalState = "kept";
    agentCheckpoints.delete(batchId);  // release checkpoint memory (subtask 6.5)
    clearAgentDecorations(batchId);    // Phase 5: remove line tints
    persistChatWorkspaceState(controller.getProject());
    renderChatPanel(controller.getProject());
    return;
  }

  // Drop all (pre-accept dismiss) or Drop post-accept (revert)
  const dropAllBtn = event.target.closest("[data-batch-drop-all]");
  const dropFinalBtn = event.target.closest("[data-batch-drop-final]");
  const dropTarget = dropAllBtn ?? dropFinalBtn;
  if (dropTarget) {
    const batchId = dropTarget.dataset.batchDropAll ?? dropTarget.dataset.batchDropFinal;
    const found = findBatchMessage(batchId);
    if (!found) return;
    const { msg } = found;
    if (msg.proposalState === "accepted") {
      const checkpoint = agentCheckpoints.get(batchId);
      const isMaster = collaboration.getRole() === "master";
      const isSynced = collaboration.isConnected() && workspaceMode === "synced";
      const soleAuthored = checkpoint?.soleAuthored ?? false;

      if (isSynced && !isMaster && soleAuthored && msg.baseRevision != null) {
        // Synced non-master sole-author path: server-authoritative revert (Phase 2).
        collaboration.publishOperation({
          type: "revert-to-revision",
          targetRevision: msg.baseRevision
        }).catch((err) => {
          notify(`Drop failed: ${err.message}`);
          return;
        });
      } else if (isSynced && !isMaster && !soleAuthored) {
        notify("Drop unavailable: another collaborator has edited since this batch was applied.");
        return;
      } else {
        // Local / master / offline path: restore from client checkpoint.
        if (checkpoint) {
          controller.replaceProject(checkpoint.project);
        } else {
          // Fallback: best-effort preImage revert (no checkpoint available).
          const ops = [...(msg.proposedOperations ?? [])].reverse();
          for (const op of ops) {
            if (op.proposalState !== "accepted") continue;
            if (op.type === "update-file" && typeof op.preImage === "string") {
              try { controller.applySyncOperation({ type: "update-file", path: op.path, content: op.preImage }); } catch { /* best-effort */ }
            } else if (op.type === "create-file" || op.type === "create-folder") {
              try { controller.applySyncOperation({ type: "delete-node", path: op.parentPath ? `${op.parentPath}/${op.name}` : op.name }); } catch { /* best-effort */ }
            }
          }
        }
        if (isMaster && isSynced && msg.baseRevision != null) {
          // Master in synced mode: push the reverted state as a replace.
          publishSnapshot();
        }
      }
      agentCheckpoints.delete(batchId);
    }
    msg.proposalState = "dropped";
    clearAgentDecorations(batchId);    // Phase 5: remove line tints on drop
    persistChatWorkspaceState(controller.getProject());
    renderChatPanel(controller.getProject());
    return;
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

function getSelectedNode(project) {
  return project.nodes[selectionNodeId] ?? (project.activeFileId ? project.nodes[project.activeFileId] : project.nodes[project.rootId]);
}

function getSelectedUrlDbEntry(project) {
  if (!sourceUrlDbEntry) {
    return null;
  }

  const file = project.nodes[sourceUrlDbEntry.fileId];
  if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
    return null;
  }

  const entry = getUrlDbEntryById(file.content, sourceUrlDbEntry.entryId);
  if (!entry) {
    return null;
  }

  return { file, entry };
}

function getSelectedParent(project) {
  const selectedNode = getSelectedNode(project);
  if (!selectedNode) {
    return project.nodes[project.rootId];
  }
  if (selectedNode.kind === "folder") {
    return selectedNode;
  }
  return project.nodes[selectedNode.parentId];
}

function getPasteTargetParent(project, targetNodeId) {
  const node = project.nodes[targetNodeId] ?? project.nodes[project.rootId];
  if (!node) {
    return null;
  }
  if (node.kind === "folder") {
    return node;
  }
  return project.nodes[node.parentId] ?? null;
}

function canPasteIntoExplorerTarget(target) {
  const payload = explorerClipboard.payload;
  if (!payload) {
    return false;
  }

  const project = controller.getProject();
  const node = project.nodes[target?.nodeId] ?? project.nodes[project.rootId];
  if (!node) {
    return false;
  }

  if (payload.kind === "node") {
    return !target?.entryId && node.kind === "folder";
  }

  if (payload.kind === "urldb-entry") {
    return node.kind === "file" && isUrlDbFileName(node.name);
  }

  return false;
}

function copyExplorerTarget(target) {
  const project = controller.getProject();
  if (target.entryId) {
    const file = project.nodes[target.nodeId];
    const entry = file?.kind === "file" ? getUrlDbEntryById(file.content, target.entryId) : null;
    if (!entry) {
      return false;
    }
    explorerClipboard.payload = {
      kind: "urldb-entry",
      fileId: target.nodeId,
      entryId: target.entryId,
      entry: structuredClone(entry)
    };
    logDebug("action", "Explorer copied bookmark", `${getPath(project, target.nodeId)} :: ${entry.name}`);
    return true;
  }

  const node = project.nodes[target.nodeId];
  if (!node || node.id === project.rootId) {
    return false;
  }
  explorerClipboard.payload = {
    kind: "node",
    nodeId: node.id
  };
  logDebug("action", "Explorer copied item", getPath(project, node.id));
  return true;
}

function duplicateNodeTree(sourceProject, sourceNodeId, targetParentId) {
  const sourceNode = sourceProject.nodes[sourceNodeId];
  if (!sourceNode) {
    throw new Error("Copied item no longer exists.");
  }

  if (sourceNode.kind === "file") {
    const before = controller.getProject();
    const fileName = suggestUniqueFileName(before, targetParentId, sourceNode.name);
    controller.createFile(targetParentId, fileName, sourceNode.content);
    return findChildByName(controller.getProject(), targetParentId, fileName)?.id ?? null;
  }

  const before = controller.getProject();
  const folderName = suggestUniqueFolderName(before, targetParentId, sourceNode.name);
  controller.createFolder(targetParentId, folderName);
  const createdFolder = findChildByName(controller.getProject(), targetParentId, folderName);
  if (!createdFolder || createdFolder.kind !== "folder") {
    return null;
  }

  sourceNode.children.forEach((childId) => {
    duplicateNodeTree(sourceProject, childId, createdFolder.id);
  });
  return createdFolder.id;
}

function pasteNodeClipboard(target) {
  const payload = explorerClipboard.payload;
  if (!payload || payload.kind !== "node") {
    return false;
  }

  const sourceProject = controller.getProject();
  const parent = getPasteTargetParent(sourceProject, target.nodeId);
  if (!parent) {
    return false;
  }

  const createdId = duplicateNodeTree(sourceProject, payload.nodeId, parent.id);
  if (!createdId) {
    return false;
  }

  selectionNodeId = createdId;
  sourceUrlDbEntry = null;
  const createdNode = controller.getProject().nodes[createdId];
  if (createdNode?.kind === "file") {
    setActiveSourceFile(createdId);
    if (isPreviewableFileName(createdNode.name)) {
      setPreviewFile(createdId);
    }
  }
  publishSnapshot();
  logDebug("action", "Explorer pasted item", getPath(controller.getProject(), createdId));
  return true;
}

function pasteUrlDbEntryClipboard(target) {
  const payload = explorerClipboard.payload;
  if (!payload || payload.kind !== "urldb-entry") {
    return false;
  }

  const project = controller.getProject();
  const targetFile = project.nodes[target.nodeId];
  if (!targetFile || targetFile.kind !== "file" || !isUrlDbFileName(targetFile.name)) {
    return false;
  }

  const entries = getUrlDbEntries(targetFile.content);
  const insertionIndex = target.entryId
    ? (() => {
      const index = entries.findIndex((entry) => entry.id === target.entryId);
      return index < 0 ? entries.length : index + 1;
    })()
    : entries.length;
  const entryDraft = {
    ...payload.entry,
    name: suggestUniqueUrlDbEntryName(entries, payload.entry.name)
  };
  const nextEntries = [...entries];
  nextEntries.splice(insertionIndex, 0, entryDraft);
  const nextContent = serializeUrlDb(nextEntries);
  controller.updateContent(targetFile.id, nextContent);
  publishOperation({ type: "update-file", path: getPath(project, targetFile.id), content: nextContent });
  const pastedEntry = getUrlDbEntries(nextContent).find((entry) => entry.name === entryDraft.name);
  if (pastedEntry) {
    setActiveSourceUrlDbEntry(targetFile.id, pastedEntry.id);
    previewFileId = targetFile.id;
    previewUrlDbEntry = pastedEntry.id;
  }
  logDebug("action", "Explorer pasted bookmark", `${getPath(controller.getProject(), targetFile.id)} :: ${entryDraft.name}`);
  return true;
}

function pasteExplorerClipboard(target) {
  if (!canPasteIntoExplorerTarget(target)) {
    return false;
  }

  if (explorerClipboard.payload?.kind === "node") {
    return pasteNodeClipboard(target);
  }

  if (explorerClipboard.payload?.kind === "urldb-entry") {
    return pasteUrlDbEntryClipboard(target);
  }

  return false;
}

function setAddFileStatus(message) {
  elements.addFileStatusText.textContent = message;
}

function resetAddFileState() {
  addFileState.fileName = "";
  addFileState.content = null;
  addFileState.sourceLabel = "";
  elements.addFileUrlInput.value = "";
  elements.addFileNameInput.value = "";
  elements.addFileSourceText.textContent = "No staged file yet.";
  setAddFileStatus("Supported: .md, .mtree, .urldb, .png, .jpg, .jpeg, .gif, .svg, .webp, .bmp.");
}

function stageAddFileContent({ name, content, sourceLabel }) {
  addFileState.fileName = name;
  addFileState.content = content;
  addFileState.sourceLabel = sourceLabel;
  elements.addFileNameInput.value = name;
  elements.addFileSourceText.textContent = sourceLabel;
  setAddFileStatus(`Ready to add ${name}.`);
}

async function stageAddFileFromLocalFile(file) {
  if (!isAllowedFileName(file.name)) {
    throw new Error("Only markdown, mtree, urldb, and supported image files can be added.");
  }

  const content = await readFileAsProjectContent(file, file.name);
  stageAddFileContent({
    name: file.name,
    content,
    sourceLabel: `Staged from local file: ${file.name}`
  });
}

async function stageAddFileFromUrl() {
  const url = elements.addFileUrlInput.value.trim();
  if (!url) {
    throw new Error("Enter a file URL first.");
  }

  const suggestedName = elements.addFileNameInput.value.trim() || inferNameFromUrl(url);
  if (!isAllowedFileName(suggestedName)) {
    throw new Error("The fetched file name must end with a supported extension.");
  }

  let response;
  try {
    response = await fetch(url);
  } catch {
    if (isImageFileName(suggestedName)) {
      throw new Error("Remote image download was blocked by the source host or browser policy. Add that URL to a .urldb album instead.");
    }
    throw new Error("Unable to fetch file from URL.");
  }
  if (!response.ok) {
    throw new Error(`Unable to fetch file from URL (${response.status}).`);
  }

  const blob = await response.blob();
  const file = new File([blob], suggestedName, { type: blob.type });
  const content = await readFileAsProjectContent(file, suggestedName);
  stageAddFileContent({
    name: suggestedName,
    content,
    sourceLabel: `Fetched from ${url}`
  });
}

async function handleAddFileTransfer(transfer) {
  const directFile = transfer.files?.[0];
  if (directFile) {
    await stageAddFileFromLocalFile(directFile);
    return;
  }

  const itemFile = Array.from(transfer.items ?? [])
    .map((item) => item.kind === "file" ? item.getAsFile() : null)
    .find(Boolean);
  if (itemFile) {
    await stageAddFileFromLocalFile(itemFile);
    return;
  }

  const uri = transfer.getData("text/uri-list")?.trim();
  const text = transfer.getData("text/plain")?.trim();

  if (uri || looksLikeUrl(text || "")) {
    elements.addFileUrlInput.value = uri || text;
    setAddFileStatus("URL staged. Use Add File to fetch it.");
    return;
  }

  if (text) {
    const suggestedName = elements.addFileNameInput.value.trim() || "pasted-note.md";
    const finalName = /\.(md|mtree)$/i.test(suggestedName) ? suggestedName : `${suggestedName}.md`;
    stageAddFileContent({
      name: finalName,
      content: text,
      sourceLabel: "Staged from pasted text"
    });
  }
}

async function addDroppedImageAndInsert(file) {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !activeFile.name.endsWith(".md")) {
    return false;
  }

  if (!await confirmAction(`Add ${file.name} to the current folder and insert a markdown image reference?`)) {
    return false;
  }

  const project = controller.getProject();
  const parentId = project.nodes[activeFile.id].parentId;
  const parentPath = parentId === project.rootId ? "" : getPath(project, parentId);
  const content = await readFileAsProjectContent(file, file.name);
  const fileName = suggestUniqueFileName(project, parentId, file.name);
  controller.createFile(parentId, fileName, content);
  publishOperation({ type: "create-file", parentPath, name: fileName, content });

  const nextProject = controller.getProject();
  const createdFile = findChildByName(nextProject, parentId, fileName);
  if (!createdFile || createdFile.kind !== "file") {
    return false;
  }

  const dropOffset = editorDragState.dropOffset ?? getEditorSelection().start;
  elements.editorContent.focus();
  const ref = createMarkdownReference(activeFile, createdFile);
  replaceEditorRange(dropOffset, dropOffset, ref, dropOffset + ref.length, dropOffset + ref.length);
  logDebug("action", "Dropped image inserted", fileName);
  return true;
}

function moveOrInsertDraggedSelection(payload, insertOffset) {
  const value = getEditorText();
  const sourceStart = Number(payload.start);
  const sourceEnd = Number(payload.end);
  const text = String(payload.text ?? "");
  if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd) || sourceStart < 0 || sourceEnd < sourceStart) {
    return false;
  }
  if (value.slice(sourceStart, sourceEnd) !== text) {
    replaceEditorRange(insertOffset, insertOffset, text, insertOffset + text.length, insertOffset + text.length);
    return true;
  }
  if (insertOffset >= sourceStart && insertOffset <= sourceEnd) {
    setEditorSelection(sourceStart, sourceEnd);
    return false;
  }

  const withoutSelection = `${value.slice(0, sourceStart)}${value.slice(sourceEnd)}`;
  const adjustedOffset = insertOffset > sourceEnd ? insertOffset - (sourceEnd - sourceStart) : insertOffset;
  const nextValue = `${withoutSelection.slice(0, adjustedOffset)}${text}${withoutSelection.slice(adjustedOffset)}`;
  const nextCursor = adjustedOffset + text.length;
  applyEditorEdit(nextValue, nextCursor, nextCursor);
  return true;
}

function insertEditorTextAtDrop(text, event) {
  const insertOffset = editorDragState.dropOffset ?? getEditorTextOffsetFromPoint(event.clientX, event.clientY);
  replaceEditorRange(insertOffset, insertOffset, text, insertOffset + text.length, insertOffset + text.length);
}

async function handleEditorDrop(event) {
  clearEditorDropCaret();
  const internalFileId = event.dataTransfer?.getData("text/mdnotes-file-id");
  if (internalFileId) {
    openDroppedFileInPane(internalFileId, "source");
    return;
  }

  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    return;
  }

  const draggedSelection = event.dataTransfer?.getData("text/mdnotes-editor-selection");
  if (draggedSelection) {
    try {
      moveOrInsertDraggedSelection(JSON.parse(draggedSelection), editorDragState.dropOffset ?? getEditorTextOffsetFromPoint(event.clientX, event.clientY));
    } catch {
      // Ignore malformed editor drag payloads.
    }
    return;
  }

  const urlDbPayload = event.dataTransfer?.getData("text/mdnotes-urldb-entry");
  if (urlDbPayload && activeFile.name.endsWith(".md")) {
    try {
      const parsed = JSON.parse(urlDbPayload);
      const project = controller.getProject();
      const sourceFile = project.nodes[parsed.fileId];
      const entry = sourceFile?.kind === "file" ? getUrlDbEntryById(sourceFile.content, parsed.entryId) : null;
      if (entry) {
        insertEditorTextAtDrop(createMarkdownImageReference(entry.name, entry.url), event);
        logDebug("action", "Bookmark image inserted", `${entry.name} :: ${entry.url}`);
      }
    } catch {
      // Ignore malformed bookmark payloads.
    }
    return;
  }

  const droppedText = event.dataTransfer?.getData("text/plain");
  if (droppedText) {
    insertEditorTextAtDrop(droppedText, event);
    return;
  }

  const file = event.dataTransfer?.files?.[0];
  if (file && isImageFileName(file.name) && activeFile.name.endsWith(".md")) {
    await addDroppedImageAndInsert(file);
  }
}

async function replaceImageFile(targetFileId, file) {
  const project = controller.getProject();
  const targetFile = project.nodes[targetFileId];
  if (!targetFile || targetFile.kind !== "file" || !isImageFileName(targetFile.name)) {
    throw new Error("Replace File is only available for image assets.");
  }

  const targetExtension = targetFile.name.slice(targetFile.name.lastIndexOf(".")).toLowerCase();
  const sourceExtension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (targetExtension !== sourceExtension) {
    throw new Error(`Replacement file must also be ${targetExtension}.`);
  }

  const content = await readFileAsProjectContent(file, targetFile.name);
  controller.updateContent(targetFile.id, content);
  publishOperation({ type: "update-file", path: getPath(project, targetFile.id), content });
  logDebug("action", "Image file replaced", getPath(project, targetFile.id));
}

function openAddFileDialog(nodeId = selectionNodeId) {
  const project = controller.getProject();
  const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
  const parent = node.kind === "folder" ? node : project.nodes[node.parentId];

  addFileState.parentId = parent.id;
  resetAddFileState();
  const targetPath = parent.id === project.rootId ? project.name : getPath(project, parent.id);
  elements.addFileTargetText.textContent = `Add a markdown, mtree, urldb, or image file into ${targetPath}.`;
  elements.addFileDialog.showModal();
}

async function promptAndAddUrlDbEntry(fileId) {
  const project = controller.getProject();
  const file = project.nodes[fileId];
  if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
    notify("Bookmark entries can only be added to .urldb files.");
    return;
  }

  const entryDraft = await showBookmarkEntryDialog({
    name: getNextUrlDbEntryName(file.content),
    url: "https://example.com/image.jpg",
    description: ""
  });

  if (!entryDraft) {
    return;
  }

  if (!entryDraft.name) {
    notify("Bookmark entries require a name.");
    return;
  }

  if (!entryDraft.url || !looksLikeUrl(entryDraft.url)) {
    notify("Bookmark entries require a valid URL.");
    return;
  }

  try {
    const nextContent = appendUrlDbEntry(file.content, entryDraft);
    controller.updateContent(file.id, nextContent);
    publishOperation({ type: "update-file", path: getPath(project, file.id), content: nextContent });
    const nextEntry = getUrlDbEntries(nextContent).find((entry) => entry.name === entryDraft.name);
    if (nextEntry) {
      setActiveSourceUrlDbEntry(file.id, nextEntry.id);
    } else {
      setActiveSourceFile(file.id);
    }
    openPreviewTab(file.id);
    previewFileId = file.id;
    previewUrlDbEntry = null;
    logDebug("action", "Bookmark added", `${getPath(project, file.id)} :: ${entryDraft.name}`);
  } catch (error) {
    notify(error.message);
  }
}

async function submitAddFile() {
  try {
    if (!addFileState.content) {
      await stageAddFileFromUrl();
    }

    const fileName = (elements.addFileNameInput.value.trim() || addFileState.fileName).trim();
    if (!fileName) {
      throw new Error("Provide a file name before adding the file.");
    }
    if (!isAllowedFileName(fileName)) {
      throw new Error("Only markdown, mtree, urldb, and supported image files can be added.");
    }
    if (typeof addFileState.content === "string" && addFileState.content.startsWith("data:image/") && !isImageFileName(fileName)) {
      throw new Error("Image assets must keep an image file extension.");
    }
    if (typeof addFileState.content === "string" && !addFileState.content.startsWith("data:image/") && isImageFileName(fileName)) {
      throw new Error("Image file extensions can only be used with image content.");
    }

    const project = controller.getProject();
    const parent = project.nodes[addFileState.parentId] ?? getSelectedParent(project);
    const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);
    controller.createFile(parent.id, fileName, addFileState.content);
    publishOperation({ type: "create-file", parentPath, name: fileName, content: addFileState.content });
    logDebug("action", "File added", `${parentPath}/${fileName}`.replace(/^\//, ""));

    const nextProject = controller.getProject();
    const createdFile = findChildByName(nextProject, parent.id, fileName);
    if (createdFile?.kind === "file") {
      selectionNodeId = createdFile.id;
      setActiveSourceFile(createdFile.id);
      if (isPreviewableFileName(createdFile.name)) {
        setPreviewFile(createdFile.id);
      }
    }

    elements.addFileDialog.close();
    resetAddFileState();
  } catch (error) {
    notify(error.message);
    setAddFileStatus(error.message);
  }
}

function createPresenceChip(entry) {
  const chip = document.createElement("div");
  chip.className = "presence-chip";
  const avatar = document.createElement("span");
  avatar.className = "presence-avatar";
  const label = document.createElement("span");
  label.textContent = entry.displayName || entry.clientId;
  chip.append(avatar, label);
  return chip;
}

function renderPresence(presence) {
  elements.presenceStrip.replaceChildren();
  elements.presenceList.replaceChildren();

  if (presence.length === 0) {
    const emptyStrip = document.createElement("span");
    emptyStrip.className = "subtle-label";
    emptyStrip.textContent = "No collaborators connected.";
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

function updateStatus(project) {
  const liveDirectory = project.sourceMode === "filesystem";
  const browserSupported = supportsDirectoryAccess();
  const collaboratorCount = syncState.presence.length;
  ensureOpenTabs(project);
  renderTabs(project);

  elements.projectNameLabel.textContent = project.name;
  elements.sourceStatusText.textContent = liveDirectory ? "Live directory" : "In-browser workspace";
  elements.browserStatusText.textContent = browserSupported ? "Chromium directory access available" : "Fallback import/export mode";
  elements.serverStatusBarText.textContent = syncState.account
    ? (syncState.status === "connected"
        ? `${syncState.account.username} · r${syncState.revision}`
        : `Logged in as ${syncState.account.username}`)
    : syncState.status === "connected"
      ? `Connected r${syncState.revision}`
      : syncState.status === "reachable"
        ? "Server reachable"
        : "Server offline";
  elements.serverStatusText.textContent = syncState.detail;
  elements.sessionDetailText.textContent = syncState.sessionId
    ? `Session ${syncState.sessionId} at revision ${syncState.revision}${syncState.displayName ? ` as ${syncState.displayName}` : ""}${syncState.role ? ` (${syncState.role})` : ""}.`
    : "Not connected to a shared session.";
  elements.sessionIdLabel.textContent = syncState.sessionId ? `${syncState.sessionId} · r${syncState.revision}` : "Offline";
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
  setStatusDot(elements.serverIndicator, syncState.status === "connected" ? "is-success" : syncState.status === "reachable" ? "is-warning" : "is-danger");

  renderPresence(syncState.presence);

  const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
  const previewFile = previewFileId ? project.nodes[previewFileId] : null;
  const selectedEntry = getSelectedUrlDbEntry(project);
  if (!activeFile) {
    elements.editorContent.contentEditable = "true";
    elements.editorContent.dataset.placeholder = "Select or create a .md, .mtree, .urldb, or image file";
    if (lastRenderedFileId !== null) {
      lastRenderedFileId = null;
      loadEditorContent("");
    }
    syncEditorScroll();
    const previewState = renderPreviewContent(elements.preview, project, previewFile);
    if (previewState.shouldTypeset) {
      void typesetPreview(previewState.content);
    }
    renderLinksPanel(project, null);
    renderChatPanel(project);
    return;
  }

  const isTextFile = isTextFileName(activeFile.name);
  elements.editorContent.contentEditable = isTextFile ? "true" : "false";
  elements.editorContent.dataset.placeholder = isTextFile
    ? "Select or create a .md, .mtree, .urldb, or image file"
    : "Image assets are preview-only in the source pane.";
  const nextText = isTextFile
    ? selectedEntry
      ? formatUrlDbEntryBody(selectedEntry.entry)
      : activeFile.content
    : `[${activeFile.name}]\n\nThis image asset is preview-only in the source pane.\nUse the preview pane to inspect it or Explorer > Add File to replace it.`;
  const fileChanged = activeFile.id !== lastRenderedFileId;
  const editorHasFocus = elements.editorContent === document.activeElement;
  if (fileChanged) {
    // Clear stale remote cursors when the viewed file changes.
    renderRemoteCursors([]);
  }
  if (!_editorUpdating && fileChanged) {
    lastRenderedFileId = activeFile.id;
    loadEditorContent(nextText);
  } else {
    const domText = getEditorText();
    if (nextText !== domText) {
      if (editorHasFocus) {
        // External same-file changes invalidate snapshot-based undo history.
        // Keep the caret stable when possible, then fence the history stack at
        // the new synchronized content so Ctrl+Z cannot replay stale text.
        const { start, end } = getEditorSelection();
        const nextSelection = consumeExternalEditorSelection(activeFile.id, nextText, start, end);
        hideEditorAutocomplete();
        applyEditorRender(nextText, nextSelection.start, nextSelection.end);
        resetEditorHistory(nextText, nextSelection.start, nextSelection.end);
      } else {
        loadEditorContent(nextText);
      }
      // Reposition remote cursor overlays after the DOM re-render.
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    }
    syncEditorScroll();
  }
  // Skip the redundant preview rebuild when the change came from the preview
  // itself — re-rendering would reset the diagram's scroll position/selection.
  if (!_previewUpdating) {
    const previewState = renderPreviewContent(elements.preview, project, previewFile);
    if (previewState.shouldTypeset) {
      void typesetPreview(previewState.content);
    }
  }
  renderLinksPanel(project, activeFile);
  renderChatPanel(project);
}

function render(project) {
  explorer.render(project, new Set(agentPendingDecorations.keys()));
  updateStatus(project);
  saveProject(project);
}

controller.subscribe(render);

if (!storedProject) {
  void loadTemplateProject()
    .then((project) => {
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

function publishOperation(operation) {
  if (!collaboration.isConnected() || workspaceMode !== "synced") {
    return;
  }
  collaboration.publishOperation(operation).catch((error) => {
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
      projectName: project.name ?? "Workspace"
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

function createItem(kind) {
  const project = controller.getProject();
  const parent = getSelectedParent(project);
  const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);

  try {
    if (kind === "folder") {
      const name = getNextDefaultFolderName(project, parent.id);
      controller.createFolder(parent.id, name);
      publishOperation({ type: "create-folder", parentPath, name });
      return;
    }

    const name = getNextDefaultFileName(project, parent.id, kind);
    const content = kind === "bmap" ? createDefaultBmap() : "";
    controller.createFile(parent.id, name, content);
    publishOperation({ type: "create-file", parentPath, name, content });
  } catch (error) {
    notify(error.message);
  }
}

async function renameSelected() {
  const project = controller.getProject();
  const selectedEntry = getSelectedUrlDbEntry(project);
  if (selectedEntry) {
    const nextName = await promptForName("Rename bookmark", selectedEntry.entry.name);
    if (!nextName) {
      return;
    }

    try {
      const nextContent = updateUrlDbEntry(selectedEntry.file.content, selectedEntry.entry.id, { name: nextName });
      controller.updateContent(selectedEntry.file.id, nextContent);
      publishOperation({ type: "update-file", path: getPath(project, selectedEntry.file.id), content: nextContent });
      const nextEntry = getUrlDbEntries(nextContent).find((entry) => entry.name === nextName);
      if (nextEntry) {
        setActiveSourceUrlDbEntry(selectedEntry.file.id, nextEntry.id);
      }
    } catch (error) {
      notify(error.message);
    }
    return;
  }

  const node = getSelectedNode(project);
  if (!node || node.id === project.rootId) {
    return;
  }
  const currentPath = getPath(project, node.id);
  const name = await promptForName("Rename item", node.name);
  if (!name) {
    return;
  }

  try {
    controller.rename(node.id, name);
    publishOperation({ type: "rename-node", path: currentPath, name });
  } catch (error) {
    notify(error.message);
  }
}

async function deleteSelected() {
  const project = controller.getProject();
  const selectedEntry = getSelectedUrlDbEntry(project);
  if (selectedEntry) {
    if (!await confirmAction(`Delete ${selectedEntry.entry.name}?`)) {
      return;
    }

    try {
      const nextContent = removeUrlDbEntry(selectedEntry.file.content, selectedEntry.entry.id);
      controller.updateContent(selectedEntry.file.id, nextContent);
      publishOperation({ type: "update-file", path: getPath(project, selectedEntry.file.id), content: nextContent });
      sourceUrlDbEntry = null;
      previewUrlDbEntry = null;
      setActiveSourceFile(selectedEntry.file.id);
    } catch (error) {
      notify(error.message);
    }
    return;
  }

  const node = getSelectedNode(project);
  if (!node || node.id === project.rootId) {
    return;
  }
  const path = getPath(project, node.id);
  if (!await confirmAction(`Delete ${node.name}?`)) {
    return;
  }
  controller.remove(node.id);
  publishOperation({ type: "delete-node", path });
}

function collectFileEntries(project, nodeId) {
  const node = project.nodes[nodeId];
  if (!node) {
    return [];
  }

  if (node.kind === "file") {
    return [{ path: node.name, bytes: getExportBytes(node.name, node.content) }];
  }

  const entries = [];
  function walk(currentId, prefix = "") {
    const current = project.nodes[currentId];
    if (current.kind === "file") {
      entries.push({ path: `${prefix}${current.name}`, bytes: getExportBytes(current.name, current.content) });
      return;
    }
    current.children.forEach((childId) => {
      const child = project.nodes[childId];
      const nextPrefix = child.kind === "folder" ? `${prefix}${child.name}/` : prefix;
      walk(childId, nextPrefix);
    });
  }
  walk(nodeId, nodeId === project.rootId ? "" : `${node.name}/`);
  return entries;
}

function exportNode(nodeId) {
  const project = controller.getProject();
  const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
  if (node.kind === "file") {
    const blob = isImageFileName(node.name)
      ? dataUrlToBlob(node.content)
      : new Blob([node.content], { type: getMimeTypeForFileName(node.name) });
    downloadBlob(blob, node.name);
    return;
  }
  downloadBlob(createZip(collectFileEntries(project, node.id)), `${node.name || project.name}.zip`);
}

/** Rasterize an SVG string to a PNG/JPG Blob. `background` (e.g. white) is
 *  painted first for opaque formats; omit it to keep PNG transparency. */
function rasterizeSvgToBlob(svgString, { type, background = null, scale = 2 }) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export produced no data."))),
          type,
          0.92
        );
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to render the diagram for export."));
    };
    image.src = url;
  });
}

/** Export a .bmap file as PNG (transparent), JPG (white background), or SVG. */
async function exportBmapAs(nodeId, format) {
  const project = controller.getProject();
  const node = project.nodes[nodeId];
  if (!node || node.kind !== "file" || !isBmapFileName(node.name)) {
    notify("Export As is only available for .bmap diagrams.");
    return;
  }
  try {
    const ast = normalizeBmapAst(parseBmap(node.content ?? ""));
    if (!ast.nodes.length) {
      notify("This diagram has no nodes to export.");
      return;
    }
    const svgString = renderBmapToSvg(ast);
    const baseName = node.name.replace(/\.bmap$/i, "");

    if (format === "svg") {
      downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), `${baseName}.svg`);
    } else if (format === "png") {
      const blob = await rasterizeSvgToBlob(svgString, { type: "image/png" });
      downloadBlob(blob, `${baseName}.png`);
    } else if (format === "jpg") {
      const blob = await rasterizeSvgToBlob(svgString, { type: "image/jpeg", background: "#ffffff" });
      downloadBlob(blob, `${baseName}.jpg`);
    }
    logDebug("action", "Bmap exported", `${node.name} → ${format}`);
  } catch (error) {
    notify(error instanceof Error ? error.message : String(error));
    logDebug("error", "Bmap export failed", error instanceof Error ? error.message : String(error));
  }
}

async function handleExplorerAction(action, target, options = {}) {
  if (options.dryRun) {
    return false;
  }

  const nodeId = target.nodeId;
  selectionNodeId = nodeId;
  sourceUrlDbEntry = target.entryId ? { fileId: nodeId, entryId: target.entryId } : null;
  logDebug("action", "Explorer action", action);
  if (action === "open-source") {
    setActiveSourceFile(nodeId);
    return;
  }
  if (action === "open-preview") {
    setPreviewFile(nodeId);
    return;
  }
  if (action.startsWith("filter-")) {
    settings.explorerFilter = action.replace("filter-", "");
    persistSettings();
    render(controller.getProject());
    return;
  }
  if (action === "copy") {
    copyExplorerTarget(target);
    return;
  }
  if (action === "paste") {
    if (!pasteExplorerClipboard(target)) {
      notify("Nothing valid to paste here.");
    }
    return;
  }
  if (action === "new-folder") {
    createItem("folder");
    return;
  }
  if (action === "new-md") {
    createItem("md");
    return;
  }
  if (action === "new-mtree") {
    createItem("mtree");
    return;
  }
  if (action === "new-urldb") {
    createItem("urldb");
    return;
  }
  if (action === "new-bmap") {
    createItem("bmap");
    return;
  }
  if (action === "add-file") {
    openAddFileDialog(nodeId);
    return;
  }
  if (action === "add-bookmark-entry") {
    await promptAndAddUrlDbEntry(nodeId);
    return;
  }
  if (action === "rename-entry") {
    await renameSelected();
    return;
  }
  if (action === "delete-entry") {
    await deleteSelected();
    return;
  }
  if (action === "generate-module-map") {
    openMtreeToolsDialog(nodeId);
    return;
  }
  if (action === "replace-file") {
    replaceFileTargetId = nodeId;
    elements.replaceFileInput.click();
    return;
  }
  if (action === "rename") {
    await renameSelected();
    return;
  }
  if (action === "delete") {
    await deleteSelected();
    return;
  }
  if (action === "export") {
    exportNode(nodeId);
    return;
  }
  if (action === "export-bmap-png") {
    await exportBmapAs(nodeId, "png");
    return;
  }
  if (action === "export-bmap-jpg") {
    await exportBmapAs(nodeId, "jpg");
    return;
  }
  if (action === "export-bmap-svg") {
    await exportBmapAs(nodeId, "svg");
  }
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
  // innerHTML replacement destroys the native caret.
  renderEditorContent(currentText);
  // Restore focus if innerHTML replacement caused the contenteditable to lose
  // focus (observed in some browsers); this keeps the caret in place for the
  // next keystroke rather than falling back to page-level focus.
  if (document.activeElement !== elements.editorContent) {
    elements.editorContent.focus({ preventScroll: true });
  }
  setEditorSelection(start, end);
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

elements.editorContent.addEventListener("scroll", syncEditorScroll);
elements.editorContent.addEventListener("keydown", handleEditorKeydown);
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
  const supportsImageUrlDrop = Boolean(activeFile?.name.endsWith(".md") && types.includes("text/mdnotes-urldb-entry"));
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

elements.newProjectButton.addEventListener("click", () => {
  logDebug("action", "New project created");
  controller.replaceProject(seedDefaultProject());
  selectionNodeId = controller.getProject().activeFileId ?? controller.getProject().rootId;
  initializePaneState(controller.getProject());
  publishSnapshot();
});

elements.openDirectoryButton.addEventListener("click", async () => {
  if (!supportsDirectoryAccess()) {
    notify("Directory access is only available in Chromium-based browsers.");
    return;
  }
  try {
    logDebug("action", "Open directory requested");
    const project = await importDirectory();
    controller.replaceProject(project);
    selectionNodeId = project.activeFileId ?? project.rootId;
    initializePaneState(project);
    publishSnapshot();
  } catch (error) {
    notify(error.message);
  }
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
elements.mtreeTargetFileSelect.addEventListener("change", (event) => {
  mtreeToolState.selectedTargetFileId = event.target.value;
  elements.mtreeOutputNameInput.disabled = event.target.value !== "__new__";
});
elements.mtreeOutputText.addEventListener("input", (event) => {
  mtreeToolState.draftSection = event.target.value;
  refreshMtreeDraftPresentation();
});
elements.mtreeOutputText.addEventListener("scroll", syncMtreeOutputScroll);
elements.mtreeOutputText.addEventListener("keydown", handleIndentKeydown);
if (typeof ResizeObserver === "function") {
  new ResizeObserver(() => {
    syncMtreeViewportMetrics();
    syncMtreeOutputScroll();
  }).observe(elements.mtreeOutputText);
}
elements.mtreeKeepButton.addEventListener("click", keepMtreeDraft);
elements.mtreeUndoButton.addEventListener("click", undoMtreeDraft);
elements.mtreeCreateButton.addEventListener("click", upsertModuleMapMarkdown);

[
  elements.mtreeSimplifyInput,
  elements.mtreeContinuationInput,
  elements.mtreeIncludeNavigationInput,
  elements.mtreeIncludeModulesInput,
  elements.mtreeIncludeParentsInput,
  elements.mtreeIncludeChildrenInput,
  elements.mtreeIncludeDescriptionsInput,
  elements.mtreeIncludeEmptyInput
].forEach((input) => {
  input.addEventListener("change", regenerateModuleMapWithNotification);
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

function toggleExplorer() {
  settings.explorer = settings.explorer === "collapsed" ? "expanded" : "collapsed";
  elements.explorerSelect.value = settings.explorer;
  persistSettings();
  logDebug("action", "Explorer toggled", settings.explorer);
}

function togglePreview() {
  settings.preview = settings.preview === "hidden" ? "shown" : "hidden";
  elements.previewSelect.value = settings.preview;
  persistSettings();
  logDebug("action", "Preview toggled", settings.preview);
}

function toggleChat() {
  settings.chatPanel = settings.chatPanel === "hidden" ? "shown" : "hidden";
  persistSettings();
  if (settings.chatPanel === "shown") {
    void refreshChatStatus({ silent: true });
    chatState.shouldScrollToBottom = true;
    renderChatPanel(controller.getProject());
  }
  logDebug("action", "Chat toggled", settings.chatPanel);
}

function toggleChatHistoryPane() {
  if (!elements.chatHistoryPane) return;
  const willShow = elements.chatHistoryPane.hidden;
  elements.chatHistoryPane.hidden = !willShow;
  elements.chatHistoryToggleButton?.setAttribute("aria-pressed", String(willShow));
}

function toggleLogPanel() {
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
elements.toggleChatButton.addEventListener("click", toggleChat);
elements.toggleLogButton.addEventListener("click", toggleLogPanel);
elements.explorerToggleButton.addEventListener("click", toggleExplorer);
elements.previewToggleActivityButton.addEventListener("click", togglePreview);
elements.chatToggleActivityButton.addEventListener("click", toggleChat);
elements.previewCollapseButton.addEventListener("click", togglePreview);
elements.chatCollapseButton.addEventListener("click", toggleChat);
elements.logCollapseButton.addEventListener("click", toggleLogPanel);
elements.chatNewThreadButton.addEventListener("click", createNewChatConversation);
elements.chatHistoryToggleButton?.addEventListener("click", toggleChatHistoryPane);

elements.chatModelSelect?.addEventListener("change", (event) => {
  chatState.selectedModel = event.target.value;
  settings.chatModel = event.target.value;
  saveSettings(settings);
  logDebug("action", "Agent model changed", settings.chatModel);
});

// The status badge doubles as a shortcut: open settings when the agent isn't
// usable, otherwise just re-check the backend.
elements.chatStatusText.addEventListener("click", () => {
  if (chatState.status !== "ready") {
    if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
  }
  void refreshChatStatus({ silent: true });
});
elements.chatAddActiveFileButton.addEventListener("click", addActiveFileToChatContext);
elements.chatComposeForm.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("text/mdnotes-file-id")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.chatComposeForm.classList.add("is-drag-over");
});
elements.chatComposeForm.addEventListener("dragleave", (event) => {
  if (!elements.chatComposeForm.contains(event.relatedTarget)) {
    elements.chatComposeForm.classList.remove("is-drag-over");
  }
});
elements.chatComposeForm.addEventListener("drop", (event) => {
  elements.chatComposeForm.classList.remove("is-drag-over");
  const nodeId = event.dataTransfer?.getData("text/mdnotes-file-id");
  if (!nodeId) return;
  event.preventDefault();
  const path = getPath(controller.getProject(), nodeId);
  if (path) addChatContextPath(path);
});
elements.chatThreadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-thread-id]");
  if (!button) {
    return;
  }
  setActiveChatThread(button.dataset.chatThreadId);
});
elements.chatContextList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-chat-remove-context]");
  if (!button) {
    return;
  }
  removeChatContextPath(button.dataset.chatRemoveContext);
});
elements.chatComposeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void handleChatSubmit();
});
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) {
    return;
  }
  event.preventDefault();
  void handleChatSubmit();
});
elements.chatInput.addEventListener("input", () => {
  renderChatPanel(controller.getProject());
});

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
}

function openSettingsDialog(tab = "appearance") {
  if (!elements.settingsDialog.open) {
    elements.settingsDialog.showModal();
  }
  switchSettingsTab(tab);
}

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

elements.formatToolbarInput?.addEventListener("change", (event) => {
  settings.showFormatToolbar = event.target.checked;
  persistSettings();
  refreshFormatToolbar();
  logDebug("action", "Format toolbar setting changed", settings.showFormatToolbar ? "on" : "off");
});

window.addEventListener("resize", () => {
  renderEditorContent(getEditorText());
  syncEditorScroll();
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

async function pingCurrentServer({ silent = false } = {}) {
  try {
    logDebug("action", "Server ping requested", elements.serverUrlInput.value.trim());
    const result = await pingServer(elements.serverUrlInput.value);
    settings.serverUrl = elements.serverUrlInput.value.trim();
    saveSettings(settings);
    syncState.status = syncState.status === "connected" ? "connected" : "reachable";
    if (!silent) {
      syncState.detail = typeof result === "string" ? result : (result.message || "Server responded to ping.");
    }
    // Capability discovery: reveal the account Login / Share controls only when
    // this server advertises them (state 3).
    syncState.accountsAvailable = Boolean(result && typeof result === "object" && result.accounts);
    syncState.hostingAvailable = Boolean(result && typeof result === "object" && result.hosting);
    logDebug("response", "Server ping succeeded", syncState.detail);
    if (!silent) flashStatusPanel("success");
    renderAccountControls();
    await refreshChatStatus({ silent: true });
    render(controller.getProject());
    return result;
  } catch (error) {
    if (syncState.status !== "connected") {
      syncState.status = "offline";
      syncState.detail = error.message;
    }
    syncState.accountsAvailable = false;
    syncState.hostingAvailable = false;
    logDebug("response", "Server ping failed", error.message);
    if (!silent) flashStatusPanel("error");
    renderAccountControls();
    await refreshChatStatus({ silent: true });
    render(controller.getProject());
    return null;
  }
}

elements.pingServerButton.addEventListener("click", () => { void pingCurrentServer(); });

// ── Account login (accounts mode / state 3) ─────────────────────────────────
function renderAccountControls() {
  const row = elements.accountLoginRow;
  if (!row) return;
  const loggedIn = Boolean(syncState.account);
  // The block is only relevant once a pinged server advertises accounts, or
  // while a session is already active.
  row.hidden = !(syncState.accountsAvailable || loggedIn);
  if (elements.accountLockedNote) {
    elements.accountLockedNote.hidden = syncState.accountsAvailable || loggedIn;
  }
  elements.accountLoginButton.hidden = loggedIn;
  elements.accountLogoutButton.hidden = !loggedIn;
  elements.accountUsernameInput.disabled = loggedIn;
  elements.accountPasswordInput.disabled = loggedIn;
  if (loggedIn) {
    const teams = syncState.account.teams ?? [];
    elements.accountStatusText.textContent = teams.length
      ? `Logged in as ${syncState.account.username} · teams: ${teams.join(", ")}`
      : `Logged in as ${syncState.account.username}`;
  } else {
    elements.accountStatusText.textContent = syncState.accountsAvailable
      ? "This server supports accounts. Log in to access cloud workspaces."
      : "";
  }
  if (elements.workspaceSwitcher) {
    elements.workspaceSwitcher.hidden = !loggedIn;
    if (loggedIn) {
      const teams = syncState.account.teams ?? [];
      elements.workspaceTeamSelect.replaceChildren(...teams.map((team) => {
        const option = document.createElement("option");
        option.value = team;
        option.textContent = team;
        return option;
      }));
    }
  }
  renderHostTargets();
}

// The share dropdown always offers ephemeral hosting ("No team (temporary)");
// logged-in accounts additionally get their teams as persistent publish targets.
function renderHostTargets() {
  if (!elements.hostTeamSelect) return;
  // Only surface hosting once a server advertising it has been pinged (or while
  // a host session is live), so the button can never 404 an older backend.
  if (elements.collabHosting) {
    const hosting = collaboration.isConnected() && workspaceMode === "synced";
    elements.collabHosting.hidden = !(syncState.hostingAvailable || hosting);
  }
  const previous = elements.hostTeamSelect.value;
  const options = [["", "No team (temporary)"]];
  for (const team of (syncState.account?.teams ?? [])) {
    options.push([team, `Team: ${team}`]);
  }
  elements.hostTeamSelect.replaceChildren(...options.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  elements.hostTeamSelect.value = options.some(([v]) => v === previous) ? previous : "";
}

async function handleHost() {
  const team = elements.hostTeamSelect?.value ?? "";
  const displayName = settings.displayName || syncState.account?.username || "";
  try {
    if (workspaceMode === "private") {
      privateProjectSnapshot = controller.getProject();
    }
    if (team === "") {
      // Ephemeral guest session hosting the current local project.
      workspaceMode = "synced";
      const { guestPin } = await collaboration.hostForGuests(settings.serverUrl, displayName);
      settings.wasConnected = false;
      elements.hostPinText.textContent = `Sharing! Guests join with PIN ${guestPin} (enter it under PIN above). Ends when you disconnect.`;
      logDebug("action", "Hosting ephemeral session", `pin=${guestPin}`);
    } else {
      // Publish the current local project into a new persistent team workspace.
      if (!syncState.account) {
        notify("Log in to publish to a team.");
        return;
      }
      const name = await promptForName("Name this cloud workspace", "");
      if (!name) return;
      const localProject = controller.getProject();
      await createWorkspace(settings.serverUrl, syncState.account.token, team, name, false);
      workspaceMode = "synced";
      await collaboration.openWorkspace(settings.serverUrl, syncState.account.token, team, name);
      // The freshly-opened workspace is empty; push our local project into it.
      controller.replaceProject(localProject);
      await collaboration.publishSnapshot(localProject);
      settings.wasConnected = false;
      elements.hostPinText.textContent = `Published to ${team}/${name}.`;
      await refreshWorkspaceList();
      logDebug("action", "Published local project to team workspace", `${team}/${name}`);
    }
    render(controller.getProject());
  } catch (error) {
    workspaceMode = "private";
    if (privateProjectSnapshot) {
      controller.replaceProject(privateProjectSnapshot);
      privateProjectSnapshot = null;
    }
    notify(error.message || "Could not share workspace.");
    logDebug("response", "Host/share failed", error.message);
    render(controller.getProject());
  }
}

async function refreshWorkspaceList() {
  if (!syncState.account || !elements.workspaceList) return;
  try {
    const workspaces = await listWorkspaces(settings.serverUrl, syncState.account.token);
    elements.workspaceList.replaceChildren();
    if (workspaces.length === 0) {
      const empty = document.createElement("li");
      empty.className = "workspace-empty subtle-label";
      empty.textContent = "No workspaces yet. Create one below.";
      elements.workspaceList.append(empty);
      return;
    }
    for (const ws of workspaces) {
      const item = document.createElement("li");
      item.className = "workspace-item";
      const label = document.createElement("span");
      label.className = "workspace-item-label";
      label.textContent = `${ws.team} / ${ws.name}`;
      label.title = `Members: ${(ws.members ?? []).join(", ")}`;
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = syncState.sessionId === ws.id && syncState.status === "connected" ? "Open ✓" : "Open";
      openBtn.addEventListener("click", () => { void handleOpenWorkspace(ws.team, ws.name); });
      item.append(label, openBtn);
      elements.workspaceList.append(item);
    }
  } catch (error) {
    logDebug("response", "Workspace list failed", error.message);
  }
}

async function handleOpenWorkspace(team, name) {
  if (!syncState.account) return;
  try {
    // Preserve the user's local project once, so leaving the cloud workspace
    // restores it. Setting synced mode up-front stops onStatusChange's master
    // auto-switch from snapshotting the (just-pulled) cloud project by mistake.
    if (workspaceMode === "private") {
      privateProjectSnapshot = controller.getProject();
    }
    workspaceMode = "synced";
    await collaboration.openWorkspace(settings.serverUrl, syncState.account.token, team, name);
    settings.wasConnected = false; // cloud opens are account-driven, not PIN auto-reconnect
    settings.lastWorkspace = { team, name }; // reopened on next boot
    saveSettings(settings);
    logDebug("action", "Opened cloud workspace", `${team}/${name}`);
    await refreshWorkspaceList();
    render(controller.getProject());
  } catch (error) {
    workspaceMode = "private";
    if (privateProjectSnapshot) {
      controller.replaceProject(privateProjectSnapshot);
      privateProjectSnapshot = null;
    }
    notify(error.message || "Could not open workspace.");
    logDebug("response", "Open workspace failed", error.message);
    render(controller.getProject());
  }
}

async function handleCreateWorkspace() {
  if (!syncState.account) return;
  const team = elements.workspaceTeamSelect.value;
  const name = elements.workspaceNameInput.value.trim();
  const shareTeam = elements.workspaceShareTeam.checked;
  if (!name) {
    notify("Enter a workspace name.");
    return;
  }
  try {
    await createWorkspace(settings.serverUrl, syncState.account.token, team, name, shareTeam);
    elements.workspaceNameInput.value = "";
    elements.workspaceShareTeam.checked = false;
    logDebug("action", "Created cloud workspace", `${team}/${name}`);
    await refreshWorkspaceList();
  } catch (error) {
    notify(error.message || "Could not create workspace.");
    logDebug("response", "Create workspace failed", error.message);
  }
}

async function performLogin(username, password, { silent = false } = {}) {
  const result = await loginToServer(settings.serverUrl, username, password);
  syncState.account = { token: result.token, username: result.username, teams: result.teams ?? [] };
  // Remember creds + mark this (server, username) as a proven login so boot can
  // auto-restore it. Also default the collaborator display name to the username.
  settings.accountUsername = result.username;
  settings.accountPassword = password;
  settings.accountSuccess = { ...settings.accountSuccess, [normalizeServerUrl(settings.serverUrl)]: result.username };
  if (!settings.displayName) {
    settings.displayName = result.username;
    if (elements.displayNameInput) elements.displayNameInput.value = result.username;
  }
  saveSettings(settings);
  logDebug("response", "Account login succeeded", `${result.username} teams=${(result.teams ?? []).join(",")}`);
  if (!silent) flashStatusPanel("success");
  renderAccountControls();
  await refreshWorkspaceList();
  render(controller.getProject());
}

async function handleAccountLogin() {
  const username = elements.accountUsernameInput.value.trim();
  const password = elements.accountPasswordInput.value;
  if (!username) {
    elements.accountStatusText.textContent = "Username is required.";
    return;
  }
  try {
    logDebug("action", "Account login requested", username);
    await performLogin(username, password);
    elements.accountPasswordInput.value = "";
  } catch (error) {
    syncState.account = null;
    elements.accountStatusText.textContent = error.message || "Login failed.";
    logDebug("response", "Account login failed", error.message);
    flashStatusPanel("error");
    renderAccountControls();
    render(controller.getProject());
  }
}

function handleAccountLogout() {
  // Leaving the account also leaves any cloud workspace it opened.
  if (collaboration.isConnected() && workspaceMode === "synced") {
    collaboration.disconnect("Logged out.");
    switchWorkspaceMode?.("private");
  }
  syncState.account = null;
  // Explicit logout clears the proven-login record + stored password for this
  // server so it won't silently auto-login again (username stays for autofill).
  const { [normalizeServerUrl(settings.serverUrl)]: _dropped, ...rest } = settings.accountSuccess ?? {};
  settings.accountSuccess = rest;
  settings.accountPassword = "";
  settings.lastWorkspace = null;
  saveSettings(settings);
  elements.workspaceList?.replaceChildren();
  logDebug("action", "Account logged out");
  renderAccountControls();
  render(controller.getProject());
}

elements.accountLoginButton?.addEventListener("click", () => { void handleAccountLogin(); });
elements.accountLogoutButton?.addEventListener("click", handleAccountLogout);
elements.workspaceCreateButton?.addEventListener("click", () => { void handleCreateWorkspace(); });
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
    flashStatusPanel("success");
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
    flashStatusPanel("error");
    await refreshChatStatus({ silent: true });
    render(controller.getProject());
  }
});

window.addEventListener("beforeunload", (event) => {
  const activeFile = controller.getActiveFile();
  if (activeFile?.dirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});

registerOfflineShell();
void refreshChatStatus({ silent: true });

// Restore the previous session on boot so a refresh isn't a fresh start:
//   1. Ping the stored server (or same-origin) to learn its capabilities.
//   2. Auto-login the account — but only to a server+username that has
//      succeeded before — then reopen the last cloud workspace.
//   3. Auto-reconnect a PIN session if one was active last time.
async function restoreSessionOnBoot() {
  const ping = await pingCurrentServer({ silent: true });
  if (ping) {
    const serverKey = normalizeServerUrl(settings.serverUrl);
    const provenUser = settings.accountSuccess?.[serverKey];
    if (
      syncState.accountsAvailable &&
      provenUser &&
      provenUser === settings.accountUsername &&
      settings.accountPassword
    ) {
      try {
        await performLogin(settings.accountUsername, settings.accountPassword, { silent: true });
        const last = settings.lastWorkspace;
        if (last?.team && last?.name && syncState.account) {
          await handleOpenWorkspace(last.team, last.name);
        }
      } catch (error) {
        logDebug("response", "Startup auto-login failed", error.message);
      }
    }
  }
  // A PIN guest session takes over the collaboration connection; only auto-join
  // one if we aren't already in a cloud workspace from the account restore.
  if (
    settings.autoReconnect && settings.wasConnected && settings.serverPin &&
    !(collaboration.isConnected() && workspaceMode === "synced")
  ) {
    logDebug("action", "Auto-reconnect on startup", settings.serverUrl || "(same origin)");
    try {
      await establishConnection({ auto: true });
    } catch (error) {
      logDebug("response", "Startup auto-reconnect failed", error.message);
      scheduleReconnect();
    }
  }
}

void restoreSessionOnBoot();