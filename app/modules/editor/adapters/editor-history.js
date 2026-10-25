// Edits and undo: every programmatic edit goes through applyEditorEdit,
// history checkpoints, undo / redo, keeping a selection in place across
// someone else's edit, and telling the app a file's text changed. The history
// (app.editorHistory) is the file's (and part's), kept while its text is what
// it holds, and shared by both editors when they show it (editors.js).
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { getPath, isTextFileName } from "../../workspace/index.js";

export function installHistory(ed, app) {
  let pendingExternalEditorSelection = null;

  /** Push a history snapshot.  Call at logical "checkpoints" (space, enter,
   *  punctuation, paste, indent, drag-drop). */
  // The single changed span between two texts: common prefix and suffix trimmed.
  // Compared a chunk at a time (the engine's own string comparison), then one
  // character at a time inside the chunk that differs: a keystroke in a
  // 450 KB file took ~25 ms character by character.
  const CHUNK = 4096;
  function diffEditorTexts(before, after) {
    const max = Math.min(before.length, after.length);
    let at = 0;
    while (at + CHUNK <= max && before.slice(at, at + CHUNK) === after.slice(at, at + CHUNK)) at += CHUNK;
    while (at < max && before.charCodeAt(at) === after.charCodeAt(at)) at += 1;
    let tail = 0;
    while (tail + CHUNK <= max - at
      && before.slice(before.length - tail - CHUNK, before.length - tail) === after.slice(after.length - tail - CHUNK, after.length - tail)) {
      tail += CHUNK;
    }
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
    app.editorHistory.stack.splice(app.editorHistory.index + 1);
    const last = app.editorHistory.stack[app.editorHistory.index];
    if (last && app.editorHistory.text === text && last.start === start && last.end === end) {
      return;
    }
    const patch = last ? diffEditorTexts(app.editorHistory.text, text) : null;
    app.editorHistory.stack.push({ start, end, patch });
    app.editorHistory.text = text;
    if (app.editorHistory.stack.length > app.editorHistory.maxSize) {
      app.editorHistory.stack.shift();
      app.editorHistory.stack[0].patch = null; // nothing older to undo into
    }
    app.editorHistory.index = app.editorHistory.stack.length - 1;
  }

  function clampEditorSelection(text, start, end = start) {
    const limit = text.length;
    const nextStart = Math.max(0, Math.min(start, limit));
    const nextEnd = Math.max(nextStart, Math.min(end, limit));
    return { start: nextStart, end: nextEnd };
  }

  function resetEditorHistory(text, start = 0, end = start) {
    const selection = clampEditorSelection(text, start, end);
    app.editorHistory.stack = [{ start: selection.start, end: selection.end, patch: null }];
    app.editorHistory.index = 0;
    app.editorHistory.text = text;
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
    const text = ed.getEditorText();
    const { start, end } = ed.getEditorSelection();
    pushEditorHistoryState(text, start, end);
  }

  function editorUndo() {
    if (app.editorHistory.index <= 0) return;
    app.traceEditorEvent("Undo requested");
    // Reverse this entry's patch to get the previous text.
    const { patch } = app.editorHistory.stack[app.editorHistory.index];
    const current = app.editorHistory.text;
    const text = current.slice(0, patch.at) + patch.removed + current.slice(patch.at + patch.inserted.length);
    app.editorHistory.index -= 1;
    app.editorHistory.text = text;
    const state = app.editorHistory.stack[app.editorHistory.index];
    ed.applyEditorRender(text, state.start, state.end);
    notifyEditorChanged(text);
    app.traceEditorEvent("Undo applied", { restored: `${state.start}-${state.end}` });
  }

  function editorRedo() {
    if (app.editorHistory.index >= app.editorHistory.stack.length - 1) return;
    app.traceEditorEvent("Redo requested");
    app.editorHistory.index += 1;
    const state = app.editorHistory.stack[app.editorHistory.index];
    // Replay the next entry's patch.
    const { patch } = state;
    const current = app.editorHistory.text;
    const text = current.slice(0, patch.at) + patch.inserted + current.slice(patch.at + patch.removed.length);
    app.editorHistory.text = text;
    ed.applyEditorRender(text, state.start, state.end);
    notifyEditorChanged(text);
    app.traceEditorEvent("Redo applied", { restored: `${state.start}-${state.end}` });
  }

  /** Apply a programmatic text change (autocomplete, indent, drag-drop, etc.)
   *  Pushes a history checkpoint, performs the edit, and fires the content
   *  update callback so the domain model stays in sync. */
  function applyEditorEdit(newText, newStart, newEnd) {
    pushEditorHistoryCheckpoint(); // snapshot BEFORE the edit
    ed.applyEditorRender(newText, newStart, newEnd);
    pushEditorHistoryState(newText, newStart, newEnd); // snapshot AFTER the edit
    notifyEditorChanged(newText);
  }

  /** Load a file's content into the editor; its undo history starts again
   *  unless it holds this text (a file switched back to, or shown in the other
   *  editor too: undo goes on as it was).
   *  Does NOT notify the domain model — used exclusively by updateStatus
   *  when the active file changes so we don't trigger a render feedback loop. */
  function loadEditorContent(text, start = 0, end = start) {
    const kept = app.editorHistory.stack.length > 0 && app.editorHistory.text === text;
    const selection = kept ? clampEditorSelection(text, start, end) : resetEditorHistory(text, start, end);
    app.keepSelection?.(selection);
    pendingExternalEditorSelection = null;
    app.hideEditorAutocomplete();
    ed.renderEditorContent(text);
    ed.setEditorSelection(selection.start, selection.end);
  }

  /** Convenience: replace a [start, end) range in the current editor text. */
  function replaceEditorRange(start, end, insertText, nextStart = null, nextEnd = null) {
    const value = ed.getEditorText();
    const newText = `${value.slice(0, start)}${insertText}${value.slice(end)}`;
    const defaultCursor = start + insertText.length;
    applyEditorEdit(newText, nextStart ?? defaultCursor, nextEnd ?? (nextStart ?? defaultCursor));
  }

  /** Notify the domain model that the editor content changed.
   *  Split from the render path so collaboration can be wired here later
   *  without touching the rendering logic. */
  function notifyEditorChanged(text) {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) return;
    // The editor may show part of a file (a URL album entry): the app maps the
    // edited text back into the whole file.
    const nextContent = app.fileContentFromEditor(activeFile, text);
    // The editor DOM already shows this text (every caller renders or reads it
    // first), so the app-wide render this triggers can catch up a moment later
    // instead of running synchronously inside the keystroke. See render().
    ed.typing = true;
    try {
      app.controller.updateContent(activeFile.id, nextContent);
    } finally {
      ed.typing = false;
    }
    // Typed: Workspace says so, and Sync sends the patch when the workspace is shared.
    app.workspace.typed(getPath(app.controller.getProject(), activeFile.id), activeFile.content, nextContent);
    // The other editor showing this file follows at once (editors.js).
    app.editorTyped?.(app);
    // Keep find matches/highlights accurate as the text changes underneath them.
    if (app.searchState.open) app.computeSearchMatches();
  }

  Object.assign(ed, { diffEditorTexts, pushEditorHistoryState, clampEditorSelection, resetEditorHistory, transformEditorOffset, transformEditorSelection, queueExternalEditorSelection, consumeExternalEditorSelection, pushEditorHistoryCheckpoint, editorUndo, editorRedo, applyEditorEdit, loadEditorContent, replaceEditorRange, notifyEditorChanged });
}
