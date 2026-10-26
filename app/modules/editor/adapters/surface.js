// The Editor's parts, created and wired here (main.js used to create each one
// with its own list of main's values): the source editors (one per group:
// editors.js), highlighting, find and replace, autocomplete, links, the tab
// strips and the preview pane, resuming positions, and the editor's events.
// They share one context, `app`, as before the move. It holds
//   - the Editor's own state: search, autocomplete, dragging text, other
//     people's cursors;
//   - every part's functions, the view, the project (Workspace) and dialogs (Shell);
//   - its elements on the page (elements.js) and the settings (Shell's).
// A source editor's own (its elements, render cache, shown file, undo history
// and the core's functions) are the active editor's here: what the shared
// parts and other modules call acts on the editor last worked in.
// What other code may call is FUNCTIONS below (editor.parts()).
import { escapeHtmlAttribute } from "../model/html.js";
import { getRelativePath, getRelativeProjectPath, normalizePath } from "../../workspace/index.js";
import { getNodeIdByPath, getPath, isImageFileName, isMarkdownFileName } from "../../workspace/index.js";
import { createAutocomplete } from "./autocomplete.js";
import { EDITOR_API } from "./editor-core.js";
import { createEditors } from "./editors.js";
import { installSharedEditorEvents } from "./editor-events.js";
import { createFindReplace } from "./find-replace.js";
import { addFindInFiles } from "./search-files.js";
import { createHighlighter } from "./highlight.js";
import { createLinks } from "./links.js";
import { createPreview } from "./preview.js";
import { createResume } from "./resume.js";
import { createTabs } from "./tabs.js";
import { createTabMenu } from "./tab-menu.js";
import { createGroups } from "./groups.js";
import { createCharCount } from "./char-count.js";
import { createPreviewPane } from "./preview-pane.js";
import { installFrameParts } from "./frame-parts.js";
import { createDebugTrace } from "./debug-trace.js";
import { installTogether } from "./together.js";

import { findElements } from "./elements.js";

export function createSurface({ view, marks, paneViews, completions, lineNotes, welcome, identity, openTabsStore, drops, codeBlocks, previews, highlighters, toolbars, workspace, shell }) {
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
    // Each editor's undo history (a file's: editors.js), render cache (see
    // renderEditorContent) and shown file are its own: the active one's below.
    // Text dragged out of an editor, and where a drop would land.
    editorDragState: { selection: null, dropOffset: null },
    // Other people's cursors, by client id.
    remoteCursorsByClient: new Map(),

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
    // Something dropped into the source editor (a file, text, an image): whoever takes drops (drops.configure: the Explorer).
    onDrop: (event) => drops.handle(event),
    // The frame (Shell's): closing the phone's explorer drawer, showing the preview pane.
    setMobileExplorerOpen: (open) => shell.frame.setExplorerOpen(open),
    // The phone's pane on screen (source, preview, chat), or null on the desktop; and showing one.
    phonePane: () => (shell.frame.isPhone() ? shell.frame.phoneView() : null),
    showPhonePane: (id) => shell.frame.showPane(id),
    togglePreview: () => shell.frame.toggle("preview"),
    // A group shown or hidden on the desktop (the frame's "source" and "preview" areas).
    setAreaShown: (area, shown) => { if (!shell.frame.isPhone() && shell.frame.shown(area) !== shown) shell.frame.toggle(area); },
    copyText: (text) => shell.copyText(text),
    isPreviewableFileName,
    resolveProjectAssetUrl,
    editorLinkTooltip: createLinkTooltip(),
    // The Explorer's Linked Notes section (Shell's pages): shown while the open file is a note.
    showLinksPanel: (shown) => shell.pages.available(shell.pages.hostOf("links") ?? "explorer", "links", shown),
    outgoingLinksListEl: document.getElementById("outgoing-links-list"),
    backlinksListEl: document.getElementById("backlinks-list")
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "editorIsComposing", { get: () => composing.now, enumerable: true });
  // Shared or this tab's own (Workspace's location, which Sync tells).
  Object.defineProperty(app, "workspaceMode", { get: () => (workspace.location.shared() ? "synced" : "private"), enumerable: true });
  app.settings = shell.settings;

  // The source editors, and the active one's own values and functions here.
  const editors = createEditors(app, composing, findElements());
  const each = (fn) => { for (const editor of editors.all()) fn(editor); };
  for (const name of ["elements", "editorRenderCache", "shown", "editorHistory"]) {
    Object.defineProperty(app, name, { get: () => editors.active()[name], enumerable: true });
  }
  for (const name of [...EDITOR_API, "getSelectedPart", "fileContentFromEditor"]) app[name] = (...args) => editors.active()[name](...args);
  Object.assign(app, {
    // While any editor applies a keystroke or redraws, the app waits.
    isTyping: () => editors.all().some((editor) => editor.isTyping()),
    isRendering: () => editors.all().some((editor) => editor.isRendering()),
    // Others' carets drawn again in every editor.
    redrawRemoteCursors: () => each((editor) => editor.redrawRemoteCursors()),
    // Each editor on screen shows its file; the count is the active one's.
    showActiveFile(project) {
      const length = editors.showFiles(project);
      app.showCharCount(length);
      return length;
    },
    activateEditor: editors.activateEditor,
    // A reconnect's reload keeps each editor's caret by path (together.js).
    keptCarets: editors.keptCarets,
    carryCarets: editors.carryCarets,
    giveCaretsBack: editors.giveCaretsBack,
    editorOf: editors.of,
    eachEditor: each,
    editorTyped: editors.typedIn,
    peersMoved: editors.peersMoved
  });

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
  add(createAutocomplete(app));
  add(createFindReplace(app));
  add(createLinks(app));
  add({ ...createTabs(app), ...createPreview(app, previews, codeBlocks) });
  add(createTabMenu(app));
  add(createGroups(app));
  add(createResume(app));
  add(createCharCount(app, shell.statusBar));
  add(createPreviewPane(app));
  installSharedEditorEvents(app);
  // The editor's settings, whoever changed them: new glyph metrics mean every
  // measured overlay (caret, cursors, search highlights) and the gutter's
  // scroll are worked out again; wrapping redraws the lines (in every editor).
  shell.settings.on((settings, changed) => {
    const fontChanged = changed.includes("sourceFontSize") || changed.includes("sourceFontFamily");
    if (fontChanged || changed.includes("wordWrap")) each((editor) => { editor.editorRenderCache.metricsKey = ""; });
    if (changed.includes("wordWrap")) app.elements.app.dataset.wordWrap = settings.wordWrap ? "on" : "off";
    if (fontChanged || changed.includes("wordWrap")) {
      app.render(app.controller.getProject());
      if (fontChanged) {
        app.redrawRemoteCursors();
        if (app.searchState.open) app.computeSearchMatches({ keepCaret: true });
        each((editor) => editor.syncEditorScroll());
      }
    }
    if (changed.includes("showFormatToolbar")) each((editor) => editor.refreshFormatToolbar());
    if (changed.includes("spellcheck")) each((editor) => { editor.elements.editorContent.spellcheck = Boolean(settings.spellcheck); });
  });
  shell.commands.add({ id: "preview.save-pdf", title: "Save as PDF", menu: { id: "file", group: 2, order: 2 }, run: () => app.printPreviewAsPdf() });
  // Drawing: while a keystroke is applied the editor has drawn it, and the rest
  // of the app waits (Shell). On each redraw its own parts: the tabs, the shown
  // file, the groups (where the bodies are), the preview pane (a file's preview
  // or a pane view) and the links.
  shell.holdRendering(() => app.isTyping());
  shell.events.on("render", ({ project: given }) => {
    if (!given) return;
    // Drawn from the project as it is now: a redraw handed one read before a
    // change (a stale copy) must not take the editor back to what was active then.
    const project = app.controller.getProject() ?? given;
    app.ensureOpenTabs(project);
    app.renderTabs(project);
    app.drawGroups(project);
    const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
    const previewFileId = app.view.get().previewFileId;
    app.showActiveFile(project);
    app.drawPreviewPane(project, previewFileId ? project.nodes[previewFileId] : null);
    app.renderLinksPanel(project, activeFile);
  });
  // The Explorer's Linked Notes section (Shell's pages), shown while a note is open.
  shell.pages.add({ host: "explorer", id: "links", order: 10, label: "Linked Notes", title: "Linked notes", icon: `<svg class="activity-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>`,
    body: document.getElementById("links-panel-body"), className: "links-sidebar-panel", available: false });
  // Find in Files: the left window's Search tab (it can be moved).
  addFindInFiles({ app, shell, workspace });
  installFrameParts(app, shell);
  installTogether(app, workspace, composing);
  // Where the reader was, kept when the page hides or goes (resume.js, tabs.js).
  const keepView = () => { app.captureViewState(); app.cacheWorkspaceView(); };
  window.addEventListener("pagehide", keepView);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keepView(); });
  window.addEventListener("beforeunload", () => app.captureViewState());
  // Reload Window (Shell) keeps it too, so the reload opens the same tabs at the same place.
  shell.beforeReload.add({ id: "editor.view", label: "Where you were", order: 30, keep() { keepView(); return ""; } });
  // A mark put or taken off shows at once: the shown files' lines and bars, the tabs' badges.
  marks.on(() => {
    each((editor) => { if (editor.shown.fileId) editor.renderEditorContent(editor.getEditorText()); });
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


  // What the editor shows starts from the open project, and starts over with a fresh one (Workspace's template).
  view.reset(workspace.project().getProject());
  // The project was replaced (and drawn) before this: draw again with the new view,
  // or the preview stays empty until the first edit.
  workspace.events.on("started-over", ({ project }) => {
    view.reset(project);
    shell.render(project);
  });
  window.addEventListener("resize", () => each((editor) => editor.scheduleOverviewRuler()));
  // Files dropped on the groups and their tab strips; tabs reordered on a strip.
  app.bindPaneDropTarget(app.elements.sourcePane, "left");
  app.bindPaneDropTarget(app.elements.sourceTabStrip, "left");
  app.bindPaneDropTarget(app.elements.previewPane, "right");
  app.bindPaneDropTarget(app.elements.previewTabStrip, "right");
  app.bindTabStripReorderTarget(app.elements.sourceTabStrip, "left");
  app.bindTabStripReorderTarget(app.elements.previewTabStrip, "right");

  // What other code calls: the parts' functions, and a few questions about the
  // editor's own state (never the state itself).
  return Object.freeze({
    ...Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
      .filter(([name, d]) => typeof d.value === "function" && !["notify", "showToast", "scope", "render", "updateStatus"].includes(name))
      .map(([name, d]) => [name, d.value])),
    isComposing: () => composing.now,
    focusEditor: () => app.elements.editorContent.focus(),
    // The active editor's gutter and text (Comments places its popover by them).
    editorElements: () => ({ editorGutter: app.elements.editorGutter, editorContent: app.elements.editorContent }),
    // Notes on lines changed (comments): every editor's gutter drawn again, carets kept.
    redrawLineNotes() {
      each((editor) => {
        if (!editor.shown.fileId) return;
        const focused = document.activeElement === editor.elements.editorContent;
        const selection = focused ? editor.getEditorSelection() : null;
        editor.renderEditorContent(editor.getEditorText());
        if (selection) editor.setEditorSelection(selection.start, selection.end);
      });
    },
    isFindOpen: () => app.searchState.open,
    dropOffset: () => app.editorDragState.dropOffset,
    historyPosition: () => `${app.editorHistory.index}/${app.editorHistory.stack.length}`, // for the log panel's editor trace
    // A collaborator's patch landed: their cursor moves to the end of what they typed.
    moveRemoteCursor(clientId, position) {
      const cached = app.remoteCursorsByClient.get(clientId);
      if (cached) app.remoteCursorsByClient.set(clientId, { ...cached, selStart: position, selEnd: position });
    },
    // Settings changed the glyph metrics: measure again on the next render.
    forgetMeasurements() { each((editor) => { editor.editorRenderCache.metricsKey = ""; }); },
    // Show a marked file (editor.marks) in the source editor, scrolled to its first marked line.
    revealMark(path) {
      const mark = marks.get(path);
      const nodeId = mark ? getNodeIdByPath(app.controller.getProject(), path) : null;
      if (!nodeId) return false;
      app.openSourceTab(nodeId);
      app.controller.setActiveFile(nodeId);
      // After the re-render settles (one paint).
      requestAnimationFrame(() => app.revealEditorLine(mark.lineStart));
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
