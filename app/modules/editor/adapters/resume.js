// Resuming where the reader left off, per file, in this browser: the source
// editors' scroll and caret, and a preview's own view (a diagram's pan and
// zoom: a preview with viewState() offers it, stored under the preview's id).
// Each editor (left, right) keeps its own place in a file while the file is
// open in it (`byEditor`), so the same file in both comes back at two places;
// a file opened anew in an editor starts where the file was last left.
// Moved from main.js (and its view-state service) with the Editor's other parts.
import { ignore } from "../../../kernel/index.js";
import { getPath } from "../../workspace/index.js";

const VIEW_STATE_KEY = "mdnotes.viewstate.v1";

function loadViewStates() {
  try {
    const raw = globalThis.localStorage?.getItem(VIEW_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    ignore(error, "the saved view state is unreadable; starting without it");
    return {};
  }
}

function saveViewStates(states) {
  try {
    globalThis.localStorage?.setItem(VIEW_STATE_KEY, JSON.stringify(states ?? {}));
  } catch (error) {
    ignore(error, "saving the view state failed (storage disabled or full); resuming is best-effort");
  }
}

export function forgetViewStates() {
  try {
    globalThis.localStorage?.removeItem(VIEW_STATE_KEY);
  } catch (error) {
    ignore(error, "clearing the view state failed: storage is disabled");
  }
}

export function createResume(app) {
  const viewStates = loadViewStates();

  // Where a file is (its path in this workspace), kept with its state: a file
  // that comes back under another id finds its state by it (one made during a
  // session, loaded again from the server, which gives it its own id: O9).
  function placeOf(fileId) {
    const project = app.controller.getProject();
    return project?.nodes[fileId]?.kind === "file" ? { path: getPath(project, fileId), scope: app.scope() } : null;
  }

  // A file's state by its id, else the latest kept for its path.
  function fileStateOf(fileId) {
    if (!fileId) return null;
    if (viewStates[fileId]) return viewStates[fileId];
    const place = placeOf(fileId);
    if (!place) return null;
    let found = null;
    for (const state of Object.values(viewStates)) {
      if (state?.path === place.path && state.scope === place.scope && (!found || (state.at ?? 0) > (found.at ?? 0))) found = state;
    }
    return found;
  }

  // A file's state; with a group, that group's editor's own place in it (its
  // caret and scroll) over the file's latest.
  function getViewState(fileId, group = null) {
    const state = fileStateOf(fileId);
    const own = group ? state?.byEditor?.[group] : null;
    return own ? { ...state, ...own } : state;
  }

  // Kept at once in memory; written at most every SAVE_EVERY (the caret moves
  // on every key), and when the page is hidden or left.
  const SAVE_EVERY = 2000;
  let saveTimer = null;
  const saveNow = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    saveViewStates(viewStates);
  };
  globalThis.addEventListener?.("pagehide", () => { if (saveTimer) saveNow(); });
  globalThis.document?.addEventListener("visibilitychange", () => { if (saveTimer && document.visibilityState === "hidden") saveNow(); });

  const saveSoon = () => { saveTimer ??= setTimeout(saveNow, SAVE_EVERY); };
  // (A file back under a new id starts from what its path had.)
  function setViewState(fileId, patch) {
    if (!fileId) return;
    viewStates[fileId] = { ...(viewStates[fileId] ?? fileStateOf(fileId)), ...placeOf(fileId), at: Date.now(), ...patch };
    saveSoon();
  }

  // An editor's place in its file (`editorSelection`, `editorScroll`): its
  // own, and the file's latest.
  function setEditorPlace(fileId, group, place) {
    if (!fileId) return;
    const byEditor = fileStateOf(fileId)?.byEditor ?? {};
    setViewState(fileId, { ...place, byEditor: { ...byEditor, [group]: { ...byEditor[group], ...place } } });
  }

  // A file's tab closed in a group (or moved out of it): that group's own
  // place in it goes, so opening it there again starts where the file was
  // last left (tabs.js).
  function forgetEditorPlace(fileId, group) {
    const state = fileStateOf(fileId);
    if (!state?.byEditor?.[group]) return;
    const byEditor = { ...state.byEditor };
    delete byEditor[group];
    viewStates[fileId] = { ...state, byEditor };
    saveSoon();
  }

  // A file's tab moved or opened to the other group: the editor there starts
  // where this one was in it (unless it has the file open already).
  function carryEditorPlace(fileId, from, to) {
    const state = fileStateOf(fileId);
    const own = state?.byEditor?.[from];
    if (own && !app.view.get().groups.find((group) => group.id === to)?.tabs.some((tab) => tab.fileId === fileId && tab.view === "source")) {
      setViewState(fileId, { byEditor: { ...state.byEditor, [to]: { ...own } } });
    }
  }

  // The editor with the focus, if one has it.
  function focusedEditor() {
    let found = null;
    app.eachEditor((editor) => { if (document.activeElement === editor.elements.editorContent) found = editor; });
    return found;
  }

  // An editor's caret: the page's where it has the focus, else the one it
  // keeps. A blurred contenteditable may retain a ghost range at offset 0. It
  // is not the user's caret and must never replace a position captured before blur.
  function caretOf(editor) {
    const content = editor.elements.editorContent;
    if (document.activeElement !== content) return editor.keptSelection();
    const selection = window.getSelection();
    if (!selection?.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null;
    return editor.getEditorSelection();
  }

  /** Snapshot the preview's own view and each editor's position before a file
   *  switch or page suspension. Selection and pointer-down handlers save the
   *  caret before the editor loses focus. */
  function captureViewState() {
    const project = app.controller.getProject();
    const previewFileId = app.view.get().previewFileId;
    const previewFile = previewFileId ? project.nodes[previewFileId] : null;
    if (previewFile?.kind === "file") {
      const preview = app.previews.all().find((entry) => entry.matches(previewFile));
      const state = preview?.viewState?.();
      if (state) setViewState(previewFile.id, { [preview.id]: state });
    }
    // Each editor on screen, the active one last (the file's latest place is
    // its): its scroll and its caret. A hidden one (its group shows a
    // preview, its area is hidden) measures no scroll.
    const editors = [];
    app.eachEditor((editor) => editors.push(editor));
    editors.sort((a, b) => Number(a.isActiveEditor()) - Number(b.isActiveEditor()));
    for (const editor of editors) {
      const fileId = editor.shown.fileId;
      // The REAL scroller is the editor's content (its .editor-scroll is
      // overflow:hidden and always reports scrollTop 0).
      const content = editor.elements.editorContent;
      if (!fileId || !project.nodes[fileId] || editor.elements.sourceBody.dataset.shown !== "true" || !content.getClientRects().length) continue;
      const caret = caretOf(editor);
      setEditorPlace(fileId, editor.group, { editorScroll: content.scrollTop,
        ...(caret ? { editorSelection: { scope: app.scope(), start: caret.start, end: caret.end } } : {}) });
    }
  }

  function savedEditorSelection(fileId, text, group = null) {
    const saved = getViewState(fileId, group)?.editorSelection;
    if (!saved || saved.scope !== app.scope() || !Number.isInteger(saved.start) || !Number.isInteger(saved.end)) return null;
    return app.clampEditorSelection(text, saved.start, saved.end);
  }

  // The caret of the editor with the focus, kept with the file it shows, and
  // by the editor (a phone may deliver no selectionchange before another
  // control takes the focus: the pointer-down's call is then the last word,
  // and a capture after it reads the editor's kept caret).
  function rememberEditorSelection() {
    const editor = focusedEditor();
    const fileId = editor?.shown.fileId;
    const caret = fileId ? caretOf(editor) : null;
    if (!caret) return;
    const { start, end } = caret;
    editor.keepSelection({ start, end });
    const scope = app.scope();
    const previous = fileStateOf(fileId)?.byEditor?.[editor.group]?.editorSelection;
    if (previous?.scope === scope && previous.start === start && previous.end === end) return;
    setEditorPlace(fileId, editor.group, { editorSelection: { scope, start, end } });
  }

  return { getViewState, setViewState, setEditorPlace, forgetEditorPlace, carryEditorPlace, captureViewState, savedEditorSelection, rememberEditorSelection };
}
