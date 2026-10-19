// The Explorer's parts, created and wired here (main.js used to create the
// tree and file actions with long lists of its values): the tree, moving and
// copying, adding files, creating, renaming and deleting, exporting, the
// context-menu actions, and the explorer's events. They share one context,
// `app`: the Explorer's own state (the clipboard, a file being added), every
// part's functions, the editor's functions it uses, Shell's dialogs and
// settings, and its elements on the page (elements.js).
import { getPath, isImageFileName } from "../../workspace/index.js";
import {
  createMarkdownReference, fileExtensionOf, getNextDefaultFileName, getNextDefaultFolderName, inferNameFromUrl,
  looksLikeUrl, suggestUniqueFileName, suggestUniqueFolderName
} from "../model/names.js";
import { createActions } from "./actions.js";
import { createAdding } from "./adding.js";
import { installExplorerEvents } from "./events.js";
import { createExporting } from "./exporting.js";
import { createMoves } from "./moves.js";
import { createNaming } from "./naming.js";
import { createExplorerView } from "./tree.js";
import { findElements } from "./elements.js";

// The editor's functions the explorer calls (editor.parts()).
const EDITOR = [
  "applyEditorEdit", "clearEditorDropCaret", "getEditorSelection", "getEditorText", "getEditorTextOffsetFromPoint",
  "isPreviewableFileName", "openDroppedFileInPane", "openFileFromExplorer", "openPreviewTab", "replaceEditorRange",
  "setActiveSourceFile", "setActiveSourcePart", "setEditorSelection", "setPreviewFile", "focusEditor"
];

export function createSurface({ workspace, editor, shell, sync, types, fileMenus, rootMenus, newFiles, events }) {
  const editorParts = editor.parts();

  const app = {
    // A file staged in the Add File dialog.
    addFileState: { parentId: null, fileName: "", content: null, sourceLabel: "" },
    // What Copy put aside for Paste.
    explorerClipboard: { payload: null },
    workspace, view: editor.view, parts: workspace.parts,
    // A file type's own context-menu entries, and a new file's first content (extension points).
    fileMenuOf: (name) => fileMenus.get(types.typeOf(name)?.id ?? "") ?? null,
    newFileContent: (kind, name) => newFiles.get(kind)?.content(name) ?? "",
    // Other modules' entries on the project's root (an extension point): the one that offers `action`.
    rootMenuOf: (action) => rootMenus.all().find((menu) => menu.entries().some(([, id]) => id === action)) ?? null,
    // A file or folder renamed or moved: announced ("path-changed"; Chats follows its characters).
    pathChanged: (from, to) => { if (from && from !== to) events.emit("path-changed", { from, to }); },
    imageSrcFor: (project, node) => workspace.location.assetSrc(project, node), // an image's address (Workspace's location)
    logDebug: (...args) => shell.log(...args), // the log panel (Shell's)
    // Changes made here reach the shared workspace through Sync.
    publishOperation: (operation) => sync.publish(operation),
    publishSnapshot: () => sync.publishSnapshot(),
    notify: (message) => shell.notify(message),
    showToast: (message, options) => shell.toast(message, options),
    confirmAction: (message) => shell.confirm(String(message)),
    // Drawing the app again is asked of Shell; the app listens.
    render: (project) => shell.render(project),
    updateStatus: (project) => shell.render(project, { only: "status" }),
    promptForName: (message, value = "", options = {}) => shell.input({ title: message, message, value, submitLabel: "Save", ...options }),
    shell,
    fileExtensionOf, getNextDefaultFileName, getNextDefaultFolderName, suggestUniqueFileName, suggestUniqueFolderName,
    looksLikeUrl, inferNameFromUrl,
    createMarkdownReference: (activeFile, targetFile) => createMarkdownReference(workspace.project().getProject(), activeFile, targetFile),
    editorDropOffset: () => editorParts.dropOffset(),
    getSelectedTarget
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "collaboration", { get: () => sync.session(), enumerable: true });
  app.settings = shell.settings;
  app.elements = findElements();
  for (const name of EDITOR) app[name] = editorParts[name];

  const add = (part) => {
    for (const [name, fn] of Object.entries(part)) {
      if (name in app) throw new Error(`explorer: "${name}" is defined twice`);
      app[name] = fn;
    }
  };
  add(createMoves(app));
  add(createAdding(app));
  add(createNaming(app));
  add(createExporting(app));
  add(createActions(app));
  app.tree = createExplorerView({
    container: app.elements.explorerTree,
    surface: app.elements.explorerPanel,
    contextMenu: app.elements.explorerContextMenu,
    markOf: (path) => editor.marks.get(path),
    extraEntriesFor: (node) => app.fileMenuOf(node.name)?.entries ?? [],
    onOpenFile(fileId) {
      app.openFileFromExplorer(fileId);
    },
    onOpenPart(fileId, partId) {
      const project = app.controller.getProject();
      const file = project.nodes[fileId];
      if (!file || file.kind !== "file" || !app.parts.of(file.name)) return;
      app.setActiveSourcePart(fileId, partId);
      app.openPreviewTab(fileId);
      app.view.showPreview(fileId, partId);
      app.updateStatus(project);
    },
    onToggleFolder(nodeId) {
      app.view.pick(nodeId);
      app.controller.toggleFolder(nodeId);
    },
    onSelectNode(target) {
      app.view.pick(target.nodeId, target.partId);
      app.render(app.controller.getProject());
    },
    canPasteTarget(target) {
      return app.canPasteIntoExplorerTarget(target);
    },
    canPreviewFile(nodeId) {
      const node = app.controller.getProject().nodes[nodeId];
      return node?.kind === "file" && app.isPreviewableFileName(node.name);
    },
    rootEntries: () => rootMenus.all().flatMap((menu) => menu.entries()),
    onAction(action, target, options) {
      app.view.pick(target.nodeId, target.partId);
      return app.handleExplorerAction(action, target, options);
    },
    onDragNodeStart(nodeId, event) {
      const project = app.controller.getProject();
      const node = project.nodes[nodeId];
      if (!node) return;
      event.dataTransfer?.setData("text/mdnotes-node-id", nodeId);
      if (node.kind === "file") {
        event.dataTransfer?.setData("text/mdnotes-file-id", nodeId);
        event.dataTransfer?.setData("text/plain", nodeId);
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copyMove";
      }
      app.logDebug("action", "Explorer drag started", getPath(project, nodeId));
    },
    onDragPartStart(fileId, partId, event) {
      const project = app.controller.getProject();
      const file = project.nodes[fileId];
      const parts = file?.kind === "file" ? app.parts.of(file.name) : null;
      const part = parts?.list(file.content).find((candidate) => candidate.id === partId);
      if (!part) return;
      event.dataTransfer?.setData("text/stilo-file-part", JSON.stringify({ fileId, partId }));
      event.dataTransfer?.setData("text/plain", part.image || part.name);
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copyMove";
      }
    },
    getFilterMode() {
      return app.settings.explorerFilter;
    },
    getAssetPreviewSrc(fileId) {
      const project = app.controller.getProject();
      const file = project.nodes[fileId];
      return file?.kind === "file" && isImageFileName(file.name) ? app.imageSrcFor(project, file) : "";
    },
    listParts(fileId) {
      const file = app.controller.getProject().nodes[fileId];
      const parts = file?.kind === "file" ? app.parts.of(file.name) : null;
      return parts ? parts.list(file.content) : null;
    },
    getPartAdder(fileId) {
      const file = app.controller.getProject().nodes[fileId];
      return file?.kind === "file" ? app.parts.of(file.name)?.add?.label ?? null : null;
    },
    getSelectedTarget() {
      return getSelectedTarget();
    }
  });
  // The tree, on each full redraw (Shell's).
  shell.events.on("render", ({ project, only }) => { if (project && only !== "status") app.tree.render(project); });
  // A mark put on a file or taken off shows on its row at once.
  editor.marks.on(() => app.tree.render(app.controller.getProject()));
  installExplorerEvents(app);
  // Files, text and images dropped into the source editor are added or inserted here.
  editor.drops.configure((event) => app.handleEditorDrop(event));
  shell.commands.add({ id: "explorer.export", title: "Export Project Zipped", menu: { id: "file", group: 0, order: 8 },
    run: () => app.exportNode(app.controller.getProject().rootId) });
  shell.commands.add({ id: "explorer.export-selected", title: "Export Selected", menu: { id: "file", group: 0, order: 9 },
    run: () => app.exportNode(app.getSelectedNode(app.controller.getProject())?.id ?? app.controller.getProject().rootId) });
  // The phone's pen renames the file on screen (Shell's frame asks with its id).
  shell.commands.add({ id: "explorer.rename-file", title: "Rename File", run: (nodeId) => app.renameFileById(nodeId) });
  // A drag that ended anywhere leaves no drop marks on the tree.
  document.addEventListener("dragend", () => app.clearExplorerDropState());
  document.addEventListener("drop", () => app.clearExplorerDropState());
  // The filter button shows when a filter is on.
  const drawFilter = () => app.elements.explorerFilterButton?.classList.toggle("is-active", app.settings.explorerFilter !== "all");
  app.settings.on((view, changed) => { if (changed.includes("explorerFilter")) drawFilter(); });
  drawFilter();
  // The welcome page's "New file".
  document.getElementById("welcome-new-file")?.addEventListener("click", () => app.openNewFileDialog());

  // The explorer's target: the part open in the source editor, else the selected node.
  function getSelectedTarget() {
    const { sourcePart, selectionNodeId } = editor.view.get();
    return sourcePart ? { nodeId: sourcePart.fileId, partId: sourcePart.partId } : { nodeId: selectionNodeId, partId: null };
  }

  return Object.freeze({
    ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
      .filter(([name, d]) => typeof d.value === "function" && !EDITOR.includes(name)
        && !["notify", "showToast", "confirmAction", "promptForName", "render", "updateStatus"].includes(name))
      .map(([name, d]) => [name, d.value])),
    // The tree, with other modules' marks on files (editor.marks).
    renderTree: (project) => app.tree.render(project)
  });
}
