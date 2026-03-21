import { ROOT_ID, findChildByName, getNode, getNodeIdByPath, getPath, isAllowedFileName, isImageFileName, isTextFileName, isUrlDbFileName } from "./domain/project-model.js";
import { createProjectController, seedDefaultProject } from "./domain/project-service.js";
import { importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess } from "./services/fs-access-service.js";
import { createCollaborationRuntime } from "./services/collaboration-service.js";
import { dataUrlToBlob, getExportBytes, getMimeTypeForFileName, readFileAsProjectContent } from "./services/file-content-service.js";
import { renderMarkdown } from "./services/markdown-service.js";
import { buildModuleMapSection, replaceOrAppendModuleMap } from "./services/mtree-module-map-service.js";
import { registerOfflineShell } from "./services/offline-service.js";
import { applyTheme, loadSettings, saveSettings } from "./services/settings-service.js";
import { loadProject, saveProject } from "./services/storage-service.js";
import { pingServer } from "./services/sync-service.js";
import { loadTemplateProject } from "./services/template-service.js";
import { appendUrlDbEntry, formatUrlDbEntryBody, moveUrlDbEntry, moveUrlDbEntryBetweenFiles, parseUrlDb, parseUrlDbEntryBody, removeUrlDbEntry, serializeUrlDb, updateUrlDbEntry } from "./services/urldb-service.js";
import { createZip, downloadBlob } from "./services/zip-service.js";
import { query } from "./ui/dom.js";
import { createExplorerView } from "./ui/explorer-view.js";

const elements = {
  app: query("#app"),
  workspaceShell: query("#workspace-shell"),
  workspaceSplitter: query("#workspace-splitter"),
  editorGrid: query("#editor-grid"),
  editorSplitter: query("#editor-splitter"),
  debugSplitter: query("#debug-splitter"),
  explorerPanel: query("#explorer-panel"),
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
  editorCursors: query("#editor-cursors"),
  editorAutocomplete: query("#editor-autocomplete"),
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
  bookmarkEntryDialog: query("#bookmark-entry-dialog"),
  bookmarkEntryDialogTitle: query("#bookmark-entry-dialog-title"),
  bookmarkEntryDialogMessage: query("#bookmark-entry-dialog-message"),
  bookmarkEntryNameInput: query("#bookmark-entry-name-input"),
  bookmarkEntryUrlInput: query("#bookmark-entry-url-input"),
  bookmarkEntryDescriptionInput: query("#bookmark-entry-description-input"),
  bookmarkEntrySubmitButton: query("#bookmark-entry-submit-button"),
  settingsButton: query("#settings-button"),
  settingsDialog: query("#settings-dialog"),
  settingsMenuButton: query("#settings-menu-button"),
  settingsMenu: query("#settings-menu"),
  openSettingsMenuButton: query("#open-settings-menu-button"),
  toggleDebugMenuButton: query("#toggle-debug-menu-button"),
  toggleLogButton: query("#toggle-log-button"),
  newUrlDbButton: query("#new-urldb-button"),
  themeSelect: query("#theme-select"),
  explorerSelect: query("#explorer-select"),
  previewSelect: query("#preview-select"),
  wordWrapSelect: query("#word-wrap-select"),
  indentStyleSelect: query("#indent-style-select"),
  serverUrlInput: query("#server-url-input"),
  serverPinInput: query("#server-pin-input"),
  displayNameInput: query("#display-name-input"),
  pingServerButton: query("#ping-server-button"),
  connectServerButton: query("#connect-server-button"),
  serverStatusText: query("#server-status-text"),
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
  exportSelectedButton: query("#export-selected-button"),
  toggleExplorerMenuButton: query("#toggle-explorer-menu-button"),
  togglePreviewButton: query("#toggle-preview-button"),
  previewCollapseButton: query("#preview-collapse-button"),
  sourceIndicator: query("#source-indicator"),
  sourceStatusText: query("#source-status-text"),
  browserIndicator: query("#browser-indicator"),
  browserStatusText: query("#browser-status-text"),
  serverIndicator: query("#server-indicator"),
  serverStatusBarText: query("#server-status-bar-text"),
  presenceSummaryText: query("#presence-summary-text"),
  previewToggleActivityButton: query("#preview-toggle-activity-button"),
  debugPanel: query("#debug-panel"),
  debugTabStrip: query("#debug-tab-strip"),
  debugTabAll: query("#debug-tab-all"),
  debugTabActions: query("#debug-tab-actions"),
  debugTabResponses: query("#debug-tab-responses"),
  debugCopyButton: query("#debug-copy-button"),
  debugClearButton: query("#debug-clear-button"),
  logCollapseButton: query("#log-collapse-button"),
  debugLogList: query("#debug-log-list")
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

let selectionNodeId = controller.getProject().activeFileId ?? controller.getProject().rootId;
const syncState = {
  status: "offline",
  detail: "No server checked yet.",
  presence: [],
  sessionId: null,
  revision: 0,
  displayName: null,
  clientId: null,
  role: null
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

function isPreviewableFileName(name) {
  return name.endsWith(".md") || isImageFileName(name) || isUrlDbFileName(name);
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
      : "new url album";
  const extension = kind === "md" ? ".md" : kind === "mtree" ? ".mtree" : ".urldb";
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

function getSelectedTarget() {
  if (sourceUrlDbEntry) {
    return { nodeId: sourceUrlDbEntry.fileId, entryId: sourceUrlDbEntry.entryId };
  }
  return { nodeId: selectionNodeId, entryId: null };
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

    const handleClose = () => {
      elements.inputDialog.removeEventListener("close", handleClose);
      const result = elements.inputDialog.returnValue === "accept"
        ? elements.inputDialogInput.value.trim() || null
        : null;
      resolve(result);
    };

    elements.inputDialog.addEventListener("close", handleClose, { once: true });
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

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    notify("Debug log copied to clipboard.");
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
  notify("Debug log copied to clipboard.");
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

function findAutocompleteContext(force = false) {
  const activeFile = controller.getActiveFile();
  if (!activeFile || !isTextFileName(activeFile.name)) {
    return null;
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

  if (!force) {
    return null;
  }

  return {
    kind: activeFile.name.endsWith(".md") ? "path" : "path",
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
  const items = buildProjectFileSuggestions(project, activeFile?.id ?? null, context.kind)
    .filter((item) => !tokenLower || item.insertText.toLowerCase().includes(tokenLower) || item.detail.toLowerCase().includes(tokenLower));
  if (items.length === 0) {
    hideEditorAutocomplete();
    return;
  }

  autocompleteState.items = items.slice(0, 12);
  autocompleteState.activeIndex = 0;
  autocompleteState.range = { start: context.start, end: context.end };
  autocompleteState.kind = context.kind;
  elements.editorAutocompleteLabel.textContent = context.kind === "image" ? "Image paths" : "Project paths";
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
  renderEditorContent(text);
  setEditorSelection(selStart, selEnd);
}

/** Push a history snapshot.  Call at logical "checkpoints" (space, enter,
 *  punctuation, paste, indent, drag-drop). */
function pushEditorHistoryCheckpoint() {
  const text = getEditorText();
  const { start, end } = getEditorSelection();
  // Trim any forward (redo) entries once a new branch starts.
  editorHistory.stack.splice(editorHistory.index + 1);
  const last = editorHistory.stack[editorHistory.index];
  if (last && last.text === text) return; // no change — skip
  editorHistory.stack.push({ text, start, end });
  if (editorHistory.stack.length > editorHistory.maxSize) {
    editorHistory.stack.shift();
  }
  editorHistory.index = editorHistory.stack.length - 1;
}

function editorUndo() {
  if (editorHistory.index <= 0) return;
  editorHistory.index -= 1;
  const state = editorHistory.stack[editorHistory.index];
  applyEditorRender(state.text, state.start, state.end);
  notifyEditorChanged(state.text);
}

function editorRedo() {
  if (editorHistory.index >= editorHistory.stack.length - 1) return;
  editorHistory.index += 1;
  const state = editorHistory.stack[editorHistory.index];
  applyEditorRender(state.text, state.start, state.end);
  notifyEditorChanged(state.text);
}

/** Apply a programmatic text change (autocomplete, indent, drag-drop, etc.)
 *  Pushes a history checkpoint, performs the edit, and fires the content
 *  update callback so the domain model stays in sync. */
function applyEditorEdit(newText, newStart, newEnd) {
  pushEditorHistoryCheckpoint(); // snapshot BEFORE the edit
  applyEditorRender(newText, newStart, newEnd);
  notifyEditorChanged(newText);
  pushEditorHistoryCheckpoint(); // snapshot AFTER
}

/** Load a file's content into the editor, resetting undo history.
 *  Does NOT notify the domain model — used exclusively by updateStatus
 *  when the active file changes so we don't trigger a render feedback loop. */
function loadEditorContent(text) {
  editorHistory.stack = [];
  editorHistory.index = -1;
  renderEditorContent(text);
  setEditorSelection(0, 0);
  pushEditorHistoryCheckpoint(); // seed initial undo state
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
elements.explorerSelect.value = settings.explorer;
elements.previewSelect.value = settings.preview;
elements.wordWrapSelect.value = settings.wordWrap ? "on" : "off";
elements.indentStyleSelect.value = settings.indentStyle;

const collaboration = createCollaborationRuntime({
  getProject() {
    return controller.getProject();
  },
  replaceProject(project) {
    controller.replaceProject(project);
  },
  applyOperation(clientId, operation) {
    try {
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
    // Auto-switch workspace mode on connect/disconnect.
    if (!wasConnected && nextState.status === "connected" && workspaceMode === "private") {
      if (syncState.role === "client") {
        // Client just connected: save private snapshot and pull server state.
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
    .replace(/(\[[^\]]+\]\([^)]+\))/g, '<span class="token-link">$1</span>')
    .replace(/(\*\*[^*]+\*\*)/g, '<span class="token-strong">$1</span>')
    .replace(/(^|[^*])(\*[^*]+\*)/g, '$1<span class="token-emphasis">$2</span>');
}

function highlightMtreeSource(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");

  return lines.map((rawLine) => {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

    if (!trimmed) {
      return '<div class="editor-line"></div>';
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
    const highlightedChain = escapeEditorHtml(chainPart)
      .replace(/\.\.\./g, '<span class="token-mtree-continuation">...</span>')
      .replace(/-&gt;/g, '<span class="token-mtree-chain-arrow">-&gt;</span>');

    const chainHtml = highlightedChain.replace(/(^|\s)([^\s<][^<&]*?)(?=(?:\s*&gt;|\s*$|<span class="token-mtree-chain-arrow">))/g, (match, prefix, name) => {
      return `${prefix}<span class="token-mtree-name">${name}</span>`;
    });

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
      return '<div class="editor-line"></div>';
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

function highlightMarkdownSource(value) {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;

  return lines.map((rawLine) => {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

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

/** Re-render syntax-highlighted DOM from plain text and rebuild the gutter.
 *  Does NOT modify the selection — callers are responsible for restoring it. */
function renderEditorContent(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const activeFile = controller.getActiveFile();
  const highlightMarkup = activeFile?.name.endsWith(".mtree")
    ? highlightMtreeSource(normalized)
    : activeFile?.name.endsWith(".urldb")
      ? highlightUrlDbSource(normalized)
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

  // Rebuild the gutter.
  const gutterMarkup = renderedLines.map((line, index) => {
    const height = Math.max(minimumLineHeight, line.getBoundingClientRect().height);
    return `<div class="editor-gutter-line" style="height:${height.toFixed(3)}px">${index + 1}</div>`;
  }).join("");
  elements.editorGutter.innerHTML = `<div class="editor-gutter-content">${gutterMarkup}</div>`;

  // Sync gutter scroll position.
  syncEditorScroll();

  // Keep placeholder visible when content is empty.
  elements.editorContent.dataset.empty = normalized.length === 0 ? "true" : "false";
}

// Alias kept so existing call sites that pass `elements.textarea.value` still
// work; TEXT is ignored but extracted from the DOM instead.
function renderEditorDecorations(_text) {
  renderEditorContent(getEditorText());
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
  replaceEditorRange(start, end, indentText, start + indentText.length, start + indentText.length);
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

  if (!elements.editorAutocomplete.hidden) {
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
  if (previewFileId === null && isPreviewableFileName(node.name)) {
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

    tab.append(icon, title, dirty, close);
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

  target.innerHTML = renderMarkdown(file.content, {
    resolveUrl(url) {
      return resolveProjectAssetUrl(project, file.id, url);
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
  elements.app.dataset.explorer = settings.explorer;
  elements.app.dataset.preview = settings.preview;
  elements.app.dataset.wordWrap = settings.wordWrap ? "on" : "off";
  elements.app.dataset.debug = settings.debugPanel ? "on" : "off";
  elements.app.style.setProperty("--sidebar-width", `${settings.sidebarWidth}px`);
  elements.app.style.setProperty("--preview-width", `${settings.previewWidth}px`);
  elements.app.style.setProperty("--debug-height", `${settings.debugPanelHeight}px`);
  elements.app.style.setProperty("--indent-tab-size", "4");
  // Word-wrap is CSS-driven via data-word-wrap; no textarea.wrap needed.
  elements.previewCollapseButton.setAttribute("aria-expanded", settings.preview === "shown" ? "true" : "false");
  elements.debugPanel.hidden = !settings.debugPanel;
  elements.toggleDebugMenuButton.textContent = settings.debugPanel ? "Hide Log Panel" : "Show Log Panel";
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
    settings.previewWidth = Math.round(nextWidth);
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
  elements.serverStatusBarText.textContent = syncState.status === "connected"
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
    return;
  }

  const isTextFile = isTextFileName(activeFile.name);
  elements.editorContent.contentEditable = isTextFile ? "true" : "false";
  elements.editorContent.dataset.placeholder = isTextFile
    ? "Select or create a .md, .mtree, .urldb, or image file"
    : "Image assets are preview-only in the source pane.";
  const fileChanged = activeFile.id !== lastRenderedFileId;
  if (fileChanged) {
    // Clear stale remote cursors when the viewed file changes.
    renderRemoteCursors([]);
  }
  if (fileChanged || elements.editorContent !== document.activeElement) {
    lastRenderedFileId = activeFile.id;
    const nextText = isTextFile
      ? selectedEntry
        ? formatUrlDbEntryBody(selectedEntry.entry)
        : activeFile.content
      : `[${activeFile.name}]\n\nThis image asset is preview-only in the source pane.\nUse the preview pane to inspect it or Explorer > Add File to replace it.`;
    loadEditorContent(nextText);
  } else {
    // Editor has focus and same file is open.
    // Read the canonical text from the model (NOT from the DOM) so that
    // remote operations — which update the model but not the DOM — are
    // always reflected in the editor.
    const modelText = isTextFile
      ? selectedEntry ? formatUrlDbEntryBody(selectedEntry.entry) : activeFile.content
      : "";
    const domText = getEditorText();
    if (modelText !== domText) {
      // Model and DOM diverged (e.g. a remote patch just landed).
      // Re-render from the model and restore the cursor as best we can.
      const { start, end } = getEditorSelection();
      renderEditorContent(modelText);
      setEditorSelection(start, end);
      // Reposition remote cursor overlays after the DOM re-render.
      renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
    }
    // If model === DOM the user's own keystrokes are already in the DOM;
    // the input handler will call renderEditorContent + setEditorSelection
    // itself — skip re-rendering here so we never destroy the caret.
    syncEditorScroll();
  }
  const previewState = renderPreviewContent(elements.preview, project, previewFile);
  if (previewState.shouldTypeset) {
    void typesetPreview(previewState.content);
  }
}

function render(project) {
  explorer.render(project);
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
    controller.createFile(parent.id, name, "");
    publishOperation({ type: "create-file", parentPath, name, content: "" });
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

async function handleExplorerAction(action, target, options = {}) {
  if (options.dryRun) {
    return false;
  }

  const nodeId = target.nodeId;
  selectionNodeId = nodeId;
  sourceUrlDbEntry = target.entryId ? { fileId: nodeId, entryId: target.entryId } : null;
  logDebug("action", "Explorer action", action);
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
  notifyEditorChanged(currentText);
  // Push a history checkpoint at natural "boundary" input types so Ctrl+Z
  // is chunky (word/paragraph) rather than character-by-character.
  const inputType = (event instanceof InputEvent ? event.inputType : "") ?? "";
  const isBoundary =
    inputType === "insertParagraph" ||
    inputType === "insertLineBreak" ||
    inputType === "insertFromPaste" ||
    inputType === "deleteByCut" ||
    inputType === "insertFromDrop" ||
    inputType.startsWith("deleteWord") ||
    inputType.startsWith("deleteLine");
  if (isBoundary) {
    pushEditorHistoryCheckpoint();
  }
  // Re-render syntax highlighting; must restore selection afterward because
  // innerHTML replacement destroys the native caret.
  renderEditorContent(currentText);
  setEditorSelection(start, end);
  // Reposition remote cursor overlays now that the DOM has changed.
  renderRemoteCursors(Array.from(remoteCursorsByClient.values()));
  showEditorAutocomplete();
});

elements.editorContent.addEventListener("scroll", syncEditorScroll);
elements.editorContent.addEventListener("keydown", handleEditorKeydown);
elements.editorContent.addEventListener("click", () => hideEditorAutocomplete());
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

function toggleLogPanel() {
  settings.debugPanel = !settings.debugPanel;
  persistSettings();
  logDebug("action", settings.debugPanel ? "Log panel enabled" : "Log panel disabled");
}

elements.toggleExplorerMenuButton.addEventListener("click", toggleExplorer);
elements.togglePreviewButton.addEventListener("click", togglePreview);
elements.toggleLogButton.addEventListener("click", toggleLogPanel);
elements.explorerToggleButton.addEventListener("click", toggleExplorer);
elements.previewToggleActivityButton.addEventListener("click", togglePreview);
elements.previewCollapseButton.addEventListener("click", togglePreview);
elements.logCollapseButton.addEventListener("click", toggleLogPanel);

elements.settingsButton.addEventListener("click", () => {
  logDebug("action", "Settings dialog opened");
  elements.settingsDialog.showModal();
});

elements.openSettingsMenuButton.addEventListener("click", () => {
  logDebug("action", "Settings dialog opened from menu");
  elements.settingsDialog.showModal();
});

elements.toggleDebugMenuButton.addEventListener("click", toggleLogPanel);

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

window.addEventListener("resize", () => {
  renderEditorContent(getEditorText());
  syncEditorScroll();
});

elements.serverUrlInput.addEventListener("change", (event) => {
  settings.serverUrl = event.target.value.trim();
  saveSettings(settings);
});

elements.serverPinInput.addEventListener("change", (event) => {
  settings.serverPin = event.target.value;
  saveSettings(settings);
});

elements.displayNameInput.addEventListener("change", (event) => {
  settings.displayName = event.target.value.trim();
  saveSettings(settings);
});

elements.pingServerButton.addEventListener("click", async () => {
  try {
    logDebug("action", "Server ping requested", elements.serverUrlInput.value.trim());
    const result = await pingServer(elements.serverUrlInput.value);
    settings.serverUrl = elements.serverUrlInput.value.trim();
    saveSettings(settings);
    syncState.status = "reachable";
    syncState.detail = typeof result === "string" ? result : (result.message || "Server responded to ping.");
    logDebug("response", "Server ping succeeded", syncState.detail);
    render(controller.getProject());
  } catch (error) {
    syncState.status = "offline";
    syncState.detail = error.message;
    logDebug("response", "Server ping failed", error.message);
    render(controller.getProject());
  }
});

elements.connectServerButton.addEventListener("click", async () => {
  try {
    logDebug("action", "Server connect requested", elements.serverUrlInput.value.trim());
    await collaboration.connect(elements.serverUrlInput.value, elements.serverPinInput.value, elements.displayNameInput.value);
    settings.serverUrl = elements.serverUrlInput.value.trim();
    settings.serverPin = elements.serverPinInput.value;
    settings.displayName = elements.displayNameInput.value.trim();
    saveSettings(settings);
    logDebug("response", "Server connected", settings.displayName || "anonymous");
  } catch (error) {
    syncState.status = "offline";
    syncState.detail = error.message;
    logDebug("response", "Server connect failed", error.message);
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