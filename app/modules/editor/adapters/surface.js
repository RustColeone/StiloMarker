// The Editor's parts, created and wired here (main.js used to create each one
// with its own list of main's values): the source editor, highlighting, find
// and replace, autocomplete, links, the tab strips and the preview pane,
// resuming positions, showing the active file, and the editor's events. They
// share one context, `app`, as before the move. It holds
//   - the Editor's own state: undo history, search, autocomplete, the render
//     cache, dragging text, other people's cursors, the file shown;
//   - every part's functions, the view, the project (Workspace) and dialogs (Shell);
//   - PORT: what main.js still provides, because no module owns it yet.
// What other code may call is FUNCTIONS below (editor.parts()).
import { escapeHtmlAttribute } from "../model/html.js";
import { getRelativePath, getRelativeProjectPath, normalizePath } from "../../workspace/index.js";
import { getNodeIdByPath, getPath, isImageFileName, isMarkdownFileName } from "../../workspace/index.js";
import { createAutocomplete } from "./autocomplete.js";
import { createEditorCore } from "./editor-core.js";
import { installEditorEvents } from "./editor-events.js";
import { createFindReplace } from "./find-replace.js";
import { createHighlighter } from "./highlight.js";
import { createLinks } from "./links.js";
import { createPreview } from "./preview.js";
import { createResume } from "./resume.js";
import { createShowFile } from "./show-file.js";
import { createTabs } from "./tabs.js";
import { createCharCount } from "./char-count.js";
import { createPreviewPane } from "./preview-pane.js";
import { installFrameParts } from "./frame-parts.js";
import { createDebugTrace } from "./debug-trace.js";
import { installTogether } from "./together.js";

// What main.js attaches (editor.attach(port)); each entry should move to an
// owner, or become an extension point, and leave this list.
export const PORT = [
  "settings", "elements", "onDrop"
];

export function createSurface({ port, view, marks, paneViews, completions, lineNotes, welcome, identity, openTabsStore, previews, highlighters, toolbars, workspace, shell }) {
  const missing = PORT.filter((name) => !(name in port));
  if (missing.length) throw new Error(`editor.attach: the port lacks ${missing.join(", ")}`);
  const composing = { now: false }; // an IME composition is under way

  const app = {
    // Autocomplete: the list shown under the caret.
    autocompleteState: {
      items: [],
      activeIndex: 0,
      // True once the user has deliberately chosen an entry (arrow keys or the
      // mouse). Enter only accepts a suggestion when this is set — otherwise Enter
      // means "new line", which is what it means everywhere else in the editor.
      userChose: false,
      range: null,
      kind: ""
    },
    // Find and replace.
    searchState: {
      open: false,
      replaceMode: false,
      caseSensitive: false,
      wholeWord: false,
      regex: false,
      matches: [],      // [{ start, end }] plain-text offsets into the active file
      currentIndex: -1
    },
    // Undo/redo history for the contenteditable editor.
    // Each entry: { start, end, patch } where `patch` turns the previous entry's
    // text into this one's: { at, removed, inserted } (null for the first entry).
    // Only `text` — the text of entry `index` — is held in full. Entries used to
    // carry a full copy of the document each: on a 90k-character chapter that was
    // ~180KB per keystroke, ~72MB at the 400-entry cap, for every open file.
    editorHistory: { stack: [], index: -1, maxSize: 400, text: "" },
    // Incremental editor render cache (see renderEditorContent).
    editorRenderCache: {
      fileId: null,     // file the cache describes
      kind: null,       // highlighter used
      els: [],          // line elements, in DOM order, as rendered
      texts: [],        // each line's text as rendered
      html: [],         // each line's final HTML as rendered
      heights: [],      // gutter heights measured for each line
      gutter: [],       // gutter row HTML as rendered
      metricsKey: "",   // geometry the heights were measured under (see below)
      gutterEpoch: "",  // line count / mark range / line notes the gutter rows reflect
      textExact: true   // every line's DOM text equals its source line
    },
    // Text dragged out of the editor, and where a drop would land.
    editorDragState: { selection: null, dropOffset: null },
    // Other people's cursors, by client id.
    remoteCursorsByClient: new Map(),
    // The file the editor's text is (what its DOM shows), or null.
    shown: { fileId: null },

    view, marks, paneViews, completions, lineNotes, welcome, previews, highlighters,
    // The notes on a file's lines from every provider: [{ kind, line, title }].
    lineNotesOf: (file) => (file ? lineNotes.all().flatMap((provider) => provider.notes(file).map((note) => ({ kind: provider.kind, ...note }))) : []), toolbars, workspace, parts: workspace.parts,
    escapeHtmlAttribute, normalizePath, getRelativePath, getRelativeProjectPath,
    notify: (message) => shell.notify(message),
    logDebug: (...args) => shell.log(...args), // the log panel (Shell's)
    showToast: (message, options) => shell.toast(message, options),
    // Drawing the app again is asked of Shell; the app listens.
    render: (project) => shell.render(project),
    updateStatus: (project) => shell.render(project, { only: "status" }),
    // Where the open project lives (Workspace's location, which Sync tells): the
    // key the saved positions are kept under, and an image's address.
    scope: () => workspace.location.key(workspace.project()?.getProject()),
    imageSrcFor: (project, node) => workspace.location.assetSrc(project, node),
    identity,
    // The open tabs kept on the server for a cloud workspace (Cloud says how: openTabsStore).
    saveUserState: (...args) => openTabsStore.save(...args),
    // The frame (Shell's): closing the phone's explorer drawer, showing the preview pane.
    setMobileExplorerOpen: (open) => shell.frame.setExplorerOpen(open),
    togglePreview: () => shell.frame.toggle("preview"),
    redrawRemoteCursors: () => app.renderRemoteCursors(Array.from(app.remoteCursorsByClient.values())),
    isPreviewableFileName,
    resolveProjectAssetUrl,
    editorLinkTooltip: createLinkTooltip(),
    linksPanelEl: document.getElementById("links-panel"),
    outgoingLinksListEl: document.getElementById("outgoing-links-list"),
    backlinksListEl: document.getElementById("backlinks-list")
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "editorIsComposing", { get: () => composing.now, enumerable: true });
  // Shared or this tab's own (Workspace's location, which Sync tells).
  Object.defineProperty(app, "workspaceMode", { get: () => (workspace.location.shared() ? "synced" : "private"), enumerable: true });
  for (const name of PORT) {
    Object.defineProperty(app, name, { get: () => port[name], enumerable: true });
  }

  // The parts. Assigning a function onto a name the context already holds
  // throws: two parts (or a part and the port) never share a name.
  const add = (part) => {
    for (const [name, fn] of Object.entries(part)) {
      if (name in app) throw new Error(`editor: "${name}" is defined twice`);
      app[name] = fn;
    }
    return part;
  };
  add(createDebugTrace(app, shell));
  add(createHighlighter(app));
  add(createEditorCore(app));
  add(createAutocomplete(app));
  add(createFindReplace(app));
  add(createLinks(app));
  add({ ...createTabs(app), ...createPreview(app, previews) });
  add(createResume(app));
  add(createShowFile(app, composing));
  add(createCharCount(app, shell.statusBar));
  add(createPreviewPane(app));
  installEditorEvents(app, composing);
  // A click on a line number goes to the line notes' providers (comments: add or edit one).
  app.elements.editorGutter?.addEventListener("click", (event) => {
    const row = event.target.closest?.(".editor-gutter-line");
    if (!row || row.dataset.line === undefined) return;
    lineNotes.all().find((provider) => provider.click)?.click(Number(row.dataset.line));
  });
  // The editor's settings, whoever changed them: new glyph metrics mean every
  // measured overlay (caret, cursors, search highlights) and the gutter's
  // scroll are worked out again; wrapping redraws the lines.
  shell.settings.on((settings, changed) => {
    const fontChanged = changed.includes("sourceFontSize") || changed.includes("sourceFontFamily");
    if (fontChanged) app.editorRenderCache.metricsKey = "";
    if (changed.includes("wordWrap")) app.elements.app.dataset.wordWrap = settings.wordWrap ? "on" : "off";
    if (fontChanged || changed.includes("wordWrap")) {
      app.render(app.controller.getProject());
      if (fontChanged) {
        app.redrawRemoteCursors();
        if (app.searchState.open) app.computeSearchMatches({ keepCaret: true });
        app.syncEditorScroll();
      }
    }
    if (changed.includes("showFormatToolbar")) app.refreshFormatToolbar();
  });
  shell.commands.add({ id: "preview.save-pdf", title: "Save as PDF", menu: { id: "file", group: 0, order: 7 }, run: () => app.printPreviewAsPdf() });
  // Drawing: while a keystroke is applied the editor has drawn it, and the rest
  // of the app waits (Shell). On each redraw its own parts: the tabs, the shown
  // file, the preview pane (a file's preview or a pane view) and the links.
  shell.holdRendering(() => app.isTyping());
  shell.events.on("render", ({ project }) => {
    if (!project) return;
    app.ensureOpenTabs(project);
    app.renderTabs(project);
    const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
    const previewFileId = app.view.get().previewFileId;
    app.showActiveFile(project);
    app.drawPreviewPane(project, previewFileId ? project.nodes[previewFileId] : null);
    app.renderLinksPanel(project, activeFile);
  });
  installFrameParts(app, shell);
  installTogether(app, workspace, composing);
  // Where the reader was, kept when the page hides or goes (resume.js, tabs.js).
  const keepView = () => { app.captureViewState(); app.cacheWorkspaceView(); };
  window.addEventListener("pagehide", keepView);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keepView(); });
  window.addEventListener("beforeunload", () => app.captureViewState());
  // A mark put or taken off shows at once: the shown file's lines and bar, the tabs' badges.
  marks.on(() => {
    const file = app.controller.getActiveFile();
    if (file) app.renderEditorContent(file.content);
    app.renderTabs(app.controller.getProject());
  });
  app.editorLinkTooltip.el.addEventListener("mouseleave", () => app.hideLinkTooltip(true));

  function isPreviewableFileName(name) {
    return isMarkdownFileName(name) || isImageFileName(name)
      || previews.all().some((preview) => preview.matches({ name, content: "" }));
  }

  function resolveProjectAssetUrl(project, sourceFileId, url) {
    return workspace.location.resolveAsset(project, sourceFileId, url);
  }


  // What other code calls: the parts' functions, and a few questions about the
  // editor's own state (never the state itself).
  return Object.freeze({
    // Plain values only: reading a getter would call main.js's port during the attach.
    ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
      .filter(([name, d]) => typeof d.value === "function" && !["notify", "showToast", "scope", "render", "updateStatus"].includes(name))
      .map(([name, d]) => [name, d.value])),
    isComposing: () => composing.now,
    isFindOpen: () => app.searchState.open,
    dropOffset: () => app.editorDragState.dropOffset,
    historyPosition: () => `${app.editorHistory.index}/${app.editorHistory.stack.length}`, // for the log panel's editor trace
    // A collaborator's patch landed: their cursor moves to the end of what they typed.
    moveRemoteCursor(clientId, position) {
      const cached = app.remoteCursorsByClient.get(clientId);
      if (cached) app.remoteCursorsByClient.set(clientId, { ...cached, selStart: position, selEnd: position });
    },
    // Settings changed the glyph metrics: measure again on the next render.
    forgetMeasurements() { app.editorRenderCache.metricsKey = ""; },
    // Show a marked file (editor.marks) in the source editor, scrolled to its first marked line.
    revealMark(path) {
      const mark = marks.get(path);
      const nodeId = mark ? getNodeIdByPath(app.controller.getProject(), path) : null;
      if (!nodeId) return false;
      app.openSourceTab(nodeId);
      app.controller.setActiveFile(nodeId);
      // After the re-render settles (one paint).
      requestAnimationFrame(() => app.elements.editorContent.querySelector(`.editor-line.is-${mark.kind}`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" }));
      return true;
    }
  });
}

// The tooltip shown over a link in the source editor.
function createLinkTooltip() {
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
}
