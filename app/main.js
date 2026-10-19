import { startModules, ignore, ignored } from "./kernel/index.js";
import shellModule, { normalizeServerUrl } from "./modules/shell/index.js";
import fileTypesModule from "./modules/file-types/index.js";
import workspaceModule from "./modules/workspace/index.js";
import identityModule from "./modules/identity/index.js";
import historyModule from "./modules/history/index.js";
import extensionModules from "./extensions.js";
import { createWorkspacePorts } from "./features/workspace-ports.js";
import { APP_VERSION } from "./version.js";
import { seedDefaultProject, applyHostCounters, createProject, findChildByName, getNode, getNodeIdByPath, getPath, isImageFileName, isTextFileName } from "./domain/project-model.js";
import { loadProject } from "./modules/workspace/index.js";
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
import editorModule, { escapeHtmlAttribute, forgetViewStates, getRelativeProjectPath, normalizePath, renderMarkdown } from "./modules/editor/index.js";

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
const earlyLog = [];
var modules;
modules = await startModules([shellModule, fileTypesModule, workspaceModule, identityModule, editorModule, syncModule, historyModule, explorerModule, commentsModule, cloudModule, modelsModule, charactersModule, chatsModule, assistantModule, ...extensionModules], {
  // Modules' log lines go to the log panel (Shell's); those from before Shell started wait.
  log: (owner, ...args) => (modules?.shell ? modules.shell.log("action", `${owner}: ${args.join(" ")}`) : earlyLog.push(`${owner}: ${args.join(" ")}`))
});
for (const line of earlyLog.splice(0)) modules.shell.log("action", line);
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
  isReadOnly: () => isReadOnlyWorkspace(), onDrop: (event) => handleEditorDrop(event)
});
// The explorer and file actions, given what no module owns yet (modules/explorer/adapters/surface.js).
var explorerParts = modules.explorer.attach({
  settings, elements,
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
var historyParts = modules.history.attach({});
// The cloud file browser, accounts and hosting (modules/cloud/adapters/surface.js).
var cloudParts = modules.cloud.attach({
  elements, refreshChatStatus
});
var chatsPage = modules.chats.attach({});
// The Agent page (the Assistant's), which loads itself the first time it is needed.
modules.assistant.attach({ elements, storedProject, chatsPage }); // the side panel's Chats page
// Diagrams and character sheets add their previews to the Editor's extension point.
registerPreviews(modules.editor.previews, {
  view: editorView, settings, escapeHtmlAttribute, normalizePath, getRelativeProjectPath,
  personaAvatarSrc: modules.characters.avatarSrc,
  get controller() { return controller; }
});
// ---- The Editor's parts (the Editor module: adapters/surface.js) ----
// Forwarders: code here still calls the editor's functions by name.
function applyEditorEdit(...args) { return editorParts.applyEditorEdit(...args); }
function getViewState(...args) { return editorParts.getViewState(...args); }
function isPreviewableFileName(...args) { return editorParts.isPreviewableFileName(...args); }
function redrawRemoteCursors(...args) { return editorParts.redrawRemoteCursors(...args); }
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









// The agent's status, asked again (Models'; the Agent page redraws as it changes).
function refreshChatStatus(options = {}) { return modules.models.agent.refresh({ signedIn: Boolean(identity.account()), ...options }); }

/** Group chats name their characters by path; follow a rename or move of a
 *  character file, or of a folder holding one. */
function remapPersonaPaths(oldPath, newPath) { chatsPage.remapPersonaPaths(oldPath, newPath); } // Chats follows renamed characters



/** A persona's avatar as an <img> src, or "" when it doesn't resolve. */


async function confirmAction(message) { return shell.confirm(String(message)); }
async function copyTextToClipboard(text) { return shell.copyText(text); }
function logDebug(...args) { return shell.log(...args); } // the log panel (Shell's)
function notify(message) { return shell.notify(message); }
async function promptForName(message, value = "", options = {}) { return shell.input({ title: message, message, value, submitLabel: "Save", ...options }); }
function showConfirmDialog(options) { return shell.confirm(options); }
function showToast(message, options) { return shell.toast(message, options); }

/** Resolve an image node to a usable <img> src. Local/PIN workspaces inline the
 *  bytes as a data: URL in content; directory-backed cloud workspaces keep the
 *  bytes on the server and serve them by the file's workspace path. */


function showEditorAutocomplete(...args) { return editorParts.showEditorAutocomplete(...args); }

function computeSearchMatches(...args) { return editorParts.computeSearchMatches(...args); }
function findNext(...args) { return editorParts.findNext(...args); }
function findPrev(...args) { return editorParts.findPrev(...args); }
function openFindBar(...args) { return editorParts.openFindBar(...args); }

// True when this session only has read access to the open cloud workspace.
function isReadOnlyWorkspace() {
  return syncMode.get().workspaceMode === "synced" && syncState.role === "reader";
}




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
  uploadAsset
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



// ---- Tabs, panes and preview (the Editor module) ----
function bindPaneDropTarget(...args) { return editorParts.bindPaneDropTarget(...args); }
function bindTabStripReorderTarget(...args) { return editorParts.bindTabStripReorderTarget(...args); }
function cachedWorkspaceView(...args) { return editorParts.cachedWorkspaceView(...args); }
function clearPaneDropState(...args) { return editorParts.clearPaneDropState(...args); }
function closeTabOverflowMenu(...args) { return editorParts.closeTabOverflowMenu(...args); }
function currentWorkspaceView(...args) { return editorParts.currentWorkspaceView(...args); }
function openFileFromExplorer(...args) { return editorParts.openFileFromExplorer(...args); }
function openTabOverflowMenu(...args) { return editorParts.openTabOverflowMenu(...args); }
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
function getSelectedParent(...args) { return explorerParts.getSelectedParent(...args); }
async function handleEditorDrop(...args) { return explorerParts.handleEditorDrop(...args); }
function moveExplorerNode(...args) { return explorerParts.moveExplorerNode(...args); }
function openNewFileDialog(...args) { return explorerParts.openNewFileDialog(...args); }
async function renameFileById(...args) { return explorerParts.renameFileById(...args); }


// While the module map tools are open and focused, Ctrl+S writes the map
// (before Shell's shortcut saves the file).
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
  if (!moduleMapTools?.isOpen() || !moduleMapTools.contains(document.activeElement)) return;
  event.preventDefault();
  event.stopPropagation();
  logDebug("action", "Module map written to target");
  moduleMapTools.write();
}, true);

function closeMenus() { shell.closeMenus(); }



// What main.js still draws on each redraw (Shell's): the project's name.
shell.events.on("render", ({ project }) => {
  if (!project) return;
  elements.projectNameLabel.textContent = project.name;
});

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
function publishOperation(operation) { return modules.sync.publish(operation); }

function updateFileContentFromPreview(...args) { return editorParts.updateFileContentFromPreview(...args); }



window.addEventListener("resize", scheduleOverviewRuler);
bindPaneDropTarget(elements.sourcePane, "source");
bindPaneDropTarget(elements.sourceTabStrip, "source");
bindPaneDropTarget(elements.previewPane, "preview");
bindPaneDropTarget(elements.previewTabStrip, "preview");
bindTabStripReorderTarget(elements.sourceTabStrip, "source");
bindTabStripReorderTarget(elements.previewTabStrip, "preview");

// ── Settings (Shell's dialog; its sections and fields are their owners') ──
function openSettingsDialog(tab = "appearance") { shell.settingsDialog.open(tab); }


// ---- The cloud file browser, accounts and hosting (the Cloud module) ----
function handleAccountLogout(...args) { return cloudParts.handleAccountLogout(...args); }
async function handleOpenWorkspace(...args) { return cloudParts.handleOpenWorkspace(...args); }
async function openAccessEditor(...args) { return cloudParts.openAccessEditor(...args); }
async function performLogin(...args) { return cloudParts.performLogin(...args); }
async function pingCurrentServer(...args) { return cloudParts.pingCurrentServer(...args); }
function renderHostTargets(...args) { return cloudParts.renderHostTargets(...args); }





renderHostTargets(); // needs the live session, which exists from here on

void shell.registerOffline();
void refreshChatStatus({ silent: true });

// Resume the last session (Cloud's), so a reload is not a fresh start.
void cloudParts.resumeSession();
