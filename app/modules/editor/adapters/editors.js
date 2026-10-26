// The source editors: one in each group (left and right), each with its own
// text, caret, lazy window, gutter and overlays in its group's body (the
// left's is the page's #source-body; the right's a copy of it made at the
// start, without ids). The active one is the view's hosts.source (the group
// last worked in): it shows the project's active file, and the editor's tools
// act on it (find, completions, the links panel, the character count,
// comments), the find bar and the completions moving into it; the other shows
// its group's source tab. Working in an editor (focusing it, its gutter, a
// drop) makes it the active one.
//
// The same file (and part) in both: typing in one shows in the other at once,
// its caret kept where it was in the text (moved by the edit, as a
// collaborator's edit moves it) and drawn in the first like a collaborator's;
// undo is the file's, one history shared by both (as VS Code does).
//
// Each editor is a context of its own over the Editor's shared one (`app`,
// surface.js), whose values it reads through: its own elements, render cache,
// shown file, history, and its view of "the active file" (its own file), with
// the core's functions (editor-core.js), showing its file (show-file.js) and
// its events (editor-events.js) installed on it.
import { getPath, isTextFileName } from "../../workspace/index.js";
import { filesIn } from "../service/view.js";
import { createEditorCore } from "./editor-core.js";
import { installEditorEvents } from "./editor-events.js";
import { createShowFile } from "./show-file.js";
import { editorElements } from "./elements.js";

const NAMES = { left: "Left editor", right: "Right editor" };

// The render cache (editor-render.js, editor-window.js), empty.
const freshRenderCache = () => ({
  fileId: null, kind: null, els: [], ws: 0, winStart: 0, before: "", after: "", above: 0,
  texts: [], html: [], heights: [], gutter: [], metricsKey: "", gutterEpoch: "", textExact: true
});

// The right editor's body: a copy of the left's as the page has it at the
// start (before anything is drawn in it), without ids (they are the left's),
// without the find bar and the completions (one of each, in the active
// editor) and without the welcome page (it moves to whichever editor shows no file).
function secondBody(first) {
  const body = first.cloneNode(true);
  body.removeAttribute("id");
  for (const element of body.querySelectorAll("[id]")) element.removeAttribute("id");
  body.querySelector(".editor-find-bar")?.remove();
  body.querySelector(".editor-autocomplete")?.remove();
  body.querySelector(".editor-empty-state")?.replaceChildren();
  body.querySelector(".editor-content")?.replaceChildren();
  body.querySelector(".editor-content")?.setAttribute("aria-label", "Source editor (right)");
  body.querySelector(".editor-gutter")?.replaceChildren();
  body.dataset.shown = "false";
  return body;
}

export function createEditors(app, composing, shared) {
  const editors = new Map(); // group id -> its editor's context
  const histories = new Map(); // "fileId#partId" -> { stack, index, maxSize, text }
  const historyOf = (key) => {
    if (!histories.has(key)) histories.set(key, { stack: [], index: -1, maxSize: 400, text: "" });
    return histories.get(key);
  };
  const project = () => app.workspace.project()?.getProject() ?? null;
  const groupState = (group) => app.view.get().groups.find((g) => g.id === group) ?? null;
  const active = () => editors.get(app.view.get().hosts.source) ?? editors.get("left");

  // The file an editor shows: the active one, the project's active file; the
  // other, its group's source tab (none while that group shows a preview).
  function fileOf(editor) {
    const now = project();
    if (!now) return null;
    let id = null;
    if (app.view.get().hosts.source === editor.group) id = now.activeFileId ?? null;
    else {
      const tab = groupState(editor.group)?.active;
      id = tab?.view === "source" ? tab.fileId : null;
    }
    return id ? now.nodes[id] ?? null : null;
  }

  function make(group, body) {
    const editor = Object.create(app);
    const elements = Object.assign(Object.create(shared), editorElements(body));
    body.dataset.group = group;
    const shown = { fileId: null, partId: null };
    let kept = null; // its caret, for while another element has the focus: { start, end }
    Object.defineProperties(editor, {
      group: { value: group, enumerable: true },
      elements: { value: elements, enumerable: true },
      editorRenderCache: { value: freshRenderCache(), enumerable: true },
      shown: { value: shown, enumerable: true },
      editorHistory: { get: () => historyOf(`${shown.fileId ?? ""}#${shown.partId ?? ""}`), enumerable: true },
      // The project's store, its "active file" being this editor's.
      controller: { get: () => Object.create(app.workspace.project(), { getActiveFile: { value: () => fileOf(editor) } }), enumerable: true }
    });
    Object.assign(editor, {
      isActiveEditor: () => active() === editor,
      keptSelection: () => kept,
      keepSelection: (selection) => { kept = selection ? { start: selection.start, end: selection.end } : null; },
      // The other editor's caret, drawn in this one as a collaborator's.
      localPeers: () => peersOf(editor),
      redrawRemoteCursors: () => editor.renderRemoteCursors([...app.remoteCursorsByClient.values()]),
      // The write path's edit (the agent's, Find in Files' Replace) to the
      // file this editor shows whole: it joins the file's undo history and is
      // sent as typing is, the caret moved by it (the page's where this editor
      // has the focus, else its kept one; the view stays).
      applyWrite(next) {
        const content = elements.editorContent;
        const focused = document.activeElement === content;
        const current = editor.getEditorText();
        const was = (focused ? editor.getEditorSelection() : kept) ?? { start: 0, end: 0 };
        const { at, removed, inserted } = editor.diffEditorTexts(current, next);
        const shifted = editor.transformEditorSelection(was, at, at + removed.length, inserted.length);
        const moved = editor.clampEditorSelection(next, shifted.start, shifted.end);
        if (focused) {
          editor.applyEditorEdit(next, moved.start, moved.end);
          return;
        }
        editor.pushEditorHistoryState(current, was.start, was.end);
        kept = moved;
        const scroll = content.scrollTop;
        editor.renderEditorContent(next);
        content.scrollTop = scroll;
        editor.syncEditorScroll();
        editor.pushEditorHistoryState(next, moved.start, moved.end);
        editor.notifyEditorChanged(next);
      }
    });
    Object.assign(editor, createEditorCore(editor));
    Object.assign(editor, createShowFile(editor, composing));
    installEditorEvents(editor, composing);
    // A click on a line number: the editor is the active one, then the line
    // notes' providers have it (comments: add or edit one).
    elements.editorGutter.addEventListener("click", (event) => {
      const row = event.target.closest?.(".editor-gutter-line");
      if (!row || row.dataset.line === undefined) return;
      activateEditor(group);
      app.lineNotes.all().find((provider) => provider.click)?.click(Number(row.dataset.line));
    });
    editor.attachSelectionChangeListener();
    editors.set(group, editor);
    return editor;
  }

  // The other editors' carets in an editor showing the same file and part:
  // the live one of the editor with the focus, else where it was left.
  function peersOf(editor) {
    const now = project();
    if (!editor.shown.fileId || !now?.nodes[editor.shown.fileId]) return [];
    const path = getPath(now, editor.shown.fileId);
    return [...editors.values()].flatMap((other) => {
      if (other === editor || other.shown.fileId !== editor.shown.fileId || other.shown.partId !== editor.shown.partId) return [];
      if (other.elements.sourceBody.dataset.shown !== "true") return [];
      const focused = document.activeElement === other.elements.editorContent;
      const selection = focused ? other.getEditorSelection() : other.keptSelection();
      return selection ? [{ clientId: `editor-${other.group}`, displayName: NAMES[other.group], fileId: path, selStart: selection.start, selEnd: selection.end }] : [];
    });
  }

  // Another editor on screen showing the same file and part.
  const sharing = (editor) => Boolean(editor.shown.fileId) && [...editors.values()].some((other) => other !== editor
    && other.shown.fileId === editor.shown.fileId && other.shown.partId === editor.shown.partId && other.elements.sourceBody.dataset.shown === "true");

  // A caret moved or text followed: the editors sharing a file draw each
  // other's carets again (once a frame; none when no file is shared, so a key
  // costs nothing more); `all`, after a render: every editor (a caret of an
  // editor that moved on to another file goes).
  let peersFrame = 0, peersAll = false;
  function peersMoved({ all = false } = {}) {
    peersAll = peersAll || all;
    if (peersFrame || (!peersAll && ![...editors.values()].some(sharing))) return;
    peersFrame = requestAnimationFrame(() => {
      peersFrame = 0;
      const every = peersAll;
      peersAll = false;
      for (const editor of editors.values()) if (editor.shown.fileId && (every || sharing(editor))) editor.redrawRemoteCursors();
    });
  }

  // Typing (or undo) in an editor: the others showing that file follow, as
  // the typing editor draws its own lines (editor-events.js): once typing
  // pauses (FOLLOW_IDLE), or every FOLLOW_MAX in a long burst (following on
  // every key cost a 20,000-line file a layout of the page each time). While
  // typing, a render of the whole app waits, so this is how they keep up.
  const FOLLOW_IDLE = 90;
  const FOLLOW_MAX = 400;
  const following = new Set();
  let followTimer = null, followDeadline = 0;
  function follow() {
    clearTimeout(followTimer);
    followTimer = null;
    followDeadline = 0;
    const now = project();
    const due = [...following];
    following.clear();
    if (now) for (const other of due) other.showFile(now);
    peersMoved();
  }
  function typedIn(editor) {
    for (const other of editors.values()) {
      if (other !== editor && other.shown.fileId && other.shown.fileId === editor.shown.fileId) following.add(other);
    }
    if (!following.size) return;
    const at = performance.now();
    if (!followDeadline) followDeadline = at + FOLLOW_MAX;
    clearTimeout(followTimer);
    followTimer = setTimeout(follow, Math.max(0, Math.min(FOLLOW_IDLE, followDeadline - at)));
  }

  // Working in a group's editor: it is the active one (its group's source tab
  // the active tab, its file the project's active file, the explorer's
  // selection), keeping the part it shows; the editor's tools move to it.
  function activateEditor(group) {
    const state = app.view.get();
    if (state.hosts.source === group || !editors.has(group)) return;
    const tab = groupState(group)?.active;
    if (tab?.view !== "source") return;
    // Its text caught up first (typing in the other editor may be waiting to
    // be followed): the render below must find nothing to redraw under the caret.
    if (following.has(editors.get(group))) follow();
    app.captureViewState(); // the editor it was: its scroll and caret, kept with its file
    app.view.activate(group, tab);
    app.view.select(tab.fileId);
    const now = app.controller.getProject();
    if (now.activeFileId !== tab.fileId) app.controller.setActiveFile(tab.fileId);
    else app.updateStatus(now);
    app.scheduleSaveUserState(); // the open tabs kept (a cloud workspace's)
  }

  // The find bar and the completions sit in the active editor; moving there,
  // the matches are found again in its text.
  function placeTools() {
    const surface = active().elements.editorSurface;
    if (shared.editorFindBar.parentElement === surface) return;
    surface.prepend(shared.editorFindBar);
    surface.append(shared.editorAutocomplete);
    for (const editor of editors.values()) if (editor !== active()) editor.elements.editorSearchHighlights.textContent = "";
    app.hideEditorAutocomplete?.();
    if (app.searchState.open) app.computeSearchMatches({ keepCaret: true });
  }

  // ── Handing the active file on (tabs.js asks) ──
  // The active editor's file left it (its tab closed, or turned Preview): it
  // shows its group's last source tab (its group shows that tab, unless `show`
  // is false: a tab turned Preview stays on screen); with none, the other
  // group's editor is the active one (its shown source tab, else its last);
  // else no file is open.
  function handOn(group, project, { show = true } = {}) {
    const state = app.view.get();
    const own = filesIn(state, "source").at(-1) ?? null;
    if (own) {
      if (show) {
        app.view.select(own);
        app.view.showSource(own);
      }
      app.controller.setActiveFile(own);
      return;
    }
    const other = state.groups.find((g) => g.id !== group);
    const next = other?.active?.view === "source" ? other.active : other?.tabs.filter((t) => t.view === "source").at(-1);
    if (next) {
      app.view.activate(other.id, next);
      app.view.select(next.fileId);
      if (project.activeFileId !== next.fileId) app.controller.setActiveFile(next.fileId);
      else app.updateStatus(project);
      return;
    }
    const nextProject = structuredClone(project);
    nextProject.activeFileId = null;
    app.controller.replaceProject(nextProject);
  }

  // The active file gone (deleted, by anyone) while the other group's editor
  // shows a file: that editor becomes the active one (O10), as when the
  // active file's tab closes (handOn). Right after this render, not inside
  // it (the hand-on draws again).
  let handingOn = false;
  function handOnWhenGone(project) {
    if (project.activeFileId || handingOn) return;
    const state = app.view.get();
    const shows = (group) => group.id !== state.hosts.source && group.active?.view === "source" && project.nodes[group.active.fileId]?.kind === "file";
    if (!state.groups.some(shows)) return;
    handingOn = true;
    queueMicrotask(() => {
      handingOn = false;
      const now = app.controller.getProject();
      const next = app.view.get().groups.find((group) => group.id !== app.view.get().hosts.source && group.active?.view === "source"
        && now.nodes[group.active.fileId]?.kind === "file");
      if (now.activeFileId || !next) return;
      app.view.activate(next.id, next.active);
      app.view.select(next.active.fileId);
      app.controller.setActiveFile(next.active.fileId);
    });
  }

  // The editor a write to a file goes through: one showing it whole, on
  // screen, a text file; the active one first. None: the write goes to the
  // project, and editors showing a part of it follow.
  function writerFor(id) {
    const candidates = [active(), ...[...editors.values()].filter((editor) => editor !== active())];
    return candidates.find((editor) => editor.shown.fileId === id && editor.shown.partId === null
      && (editor === active() || editor.elements.sourceBody.dataset.shown === "true")
      && isTextFileName(project()?.nodes[id]?.name ?? "")) ?? null;
  }

  // A reconnect that loads the project again (together.js; O9): before it,
  // each editor's file by path, its caret and its scroll (keptCarets); after
  // it, saved again under the file's id as it is now (a file made during the
  // session comes back under the server's own id, and the caret kept per id
  // was lost: it went to the start), so the file opens where it was
  // (carryCarets, before the tabs are restored), then each editor given its
  // own caret back (giveCaretsBack: two editors may show the file).
  function keptCarets() {
    const now = project();
    // The focused editor last, so the file's saved caret ends up being its.
    const focusedLast = (editor) => Number(document.activeElement === editor.elements.editorContent);
    return [...editors.values()].sort((a, b) => focusedLast(a) - focusedLast(b)).flatMap((editor) => {
      const id = editor.shown.fileId;
      if (!id || !now?.nodes[id]) return [];
      const focused = document.activeElement === editor.elements.editorContent;
      const selection = focused ? editor.getEditorSelection() : editor.keptSelection();
      return [{ group: editor.group, path: getPath(now, id), partId: editor.shown.partId, selection, scroll: editor.elements.editorContent.scrollTop }];
    });
  }
  const idByPath = (now, path) => Object.values(now?.nodes ?? {}).find((node) => node.kind === "file" && getPath(now, node.id) === path)?.id ?? null;
  function carryCarets(kept) {
    const now = project();
    for (const entry of kept) {
      const id = idByPath(now, entry.path);
      if (!id || !entry.selection) continue;
      app.setViewState(id, { editorSelection: { scope: app.scope(), start: entry.selection.start, end: entry.selection.end }, editorScroll: entry.scroll });
    }
  }
  function giveCaretsBack(kept) {
    const now = project();
    for (const entry of kept) {
      const editor = editors.get(entry.group);
      const id = editor?.shown.fileId;
      if (!id || !now?.nodes[id] || getPath(now, id) !== entry.path || editor.shown.partId !== entry.partId) continue;
      const content = editor.elements.editorContent;
      content.scrollTop = entry.scroll;
      editor.updateEditorWindow();
      editor.syncEditorScroll();
      if (!entry.selection) continue;
      const selection = editor.clampEditorSelection(editor.getEditorText(), entry.selection.start, entry.selection.end);
      editor.keepSelection(selection);
      if (document.activeElement === content) editor.setEditorSelection(selection.start, selection.end, { reveal: false });
    }
    peersMoved({ all: true });
  }

  // On each render: every editor on screen shows its file (the active one
  // always, as before: the welcome page when none is open), the find bar is
  // in the active one, and histories of files no longer open go. Returns the
  // active editor's text length, for the status bar's count.
  function showFiles(now) {
    const state = app.view.get();
    let length = null;
    for (const editor of editors.values()) {
      const isActive = editor === active();
      const onScreen = isActive || groupState(editor.group)?.active?.view === "source";
      editor.elements.sourceBody.dataset.active = String(isActive);
      if (!onScreen) continue;
      const shownLength = editor.showFile(now);
      if (isActive) length = shownLength;
    }
    placeTools();
    peersMoved({ all: true });
    const open = new Set(state.groups.flatMap((group) => group.tabs.filter((tab) => tab.view === "source").map((tab) => tab.fileId)));
    for (const editor of editors.values()) if (editor.shown.fileId) open.add(editor.shown.fileId);
    for (const key of histories.keys()) if (!open.has(key.slice(0, key.lastIndexOf("#")))) histories.delete(key);
    return length;
  }

  const leftBody = shared.sourcePane.querySelector(".source-body");
  const rightBody = secondBody(leftBody);
  const rightGroup = document.querySelector('.editor-group[data-group="right"]');
  (rightGroup.querySelector(".group-placeholder") ?? rightGroup.firstElementChild).after(rightBody);
  make("left", leftBody);
  make("right", rightBody);

  return {
    active,
    of: (group) => editors.get(group) ?? null,
    all: () => [...editors.values()],
    activateEditor, typedIn, peersMoved, showFiles, keptCarets, carryCarets, giveCaretsBack, handOn, handOnWhenGone, writerFor
  };
}
