// Resuming where the reader left off, per file, in this browser: the source
// editor's scroll and caret, and a preview's own view (a diagram's pan and
// zoom: a preview with viewState() offers it, stored under the preview's id).
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
  function getViewState(fileId) {
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

  function setViewState(fileId, patch) {
    if (!fileId) return;
    viewStates[fileId] = { ...viewStates[fileId], ...placeOf(fileId), at: Date.now(), ...patch };
    saveTimer ??= setTimeout(saveNow, SAVE_EVERY);
  }

  /** Snapshot the preview's own view and the editor position before a file
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
    const activeId = project.activeFileId;
    if (activeId && app.elements.editorContent) {
      // The REAL scroller is #editor-content (#editor-scroll is overflow:hidden and
      // always reports scrollTop 0), so persist the content scroll for this file.
      setViewState(activeId, { editorScroll: app.elements.editorContent.scrollTop });
      rememberEditorSelection();
    }
  }

  function savedEditorSelection(fileId, text) {
    const saved = getViewState(fileId)?.editorSelection;
    if (!saved || saved.scope !== app.scope() || !Number.isInteger(saved.start) || !Number.isInteger(saved.end)) return null;
    return app.clampEditorSelection(text, saved.start, saved.end);
  }

  function rememberEditorSelection() {
    const fileId = app.controller.getProject().activeFileId;
    // A blurred contenteditable may retain a ghost range at offset 0. It is not
    // the user's caret and must never replace a position captured before blur.
    if (document.activeElement !== app.elements.editorContent) return;
    const selection = window.getSelection();
    if (!fileId || app.shown.fileId !== fileId || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!app.elements.editorContent.contains(range.startContainer) || !app.elements.editorContent.contains(range.endContainer)) return;
    const { start, end } = app.getEditorSelection();
    const scope = app.scope();
    const previous = getViewState(fileId)?.editorSelection;
    if (previous?.scope === scope && previous.start === start && previous.end === end) return;
    setViewState(fileId, { editorSelection: { scope, start, end } });
  }

  return { getViewState, setViewState, captureViewState, savedEditorSelection, rememberEditorSelection };
}
