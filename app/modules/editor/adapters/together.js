// The editor while others work in the same workspace (through Workspace, which
// Sync feeds): their change keeps my caret where it was in the text and moves
// their cursor to the end of what they typed; their carets come and go; a
// reload of the project keeps my view; and the write path edits the file I
// show as if I typed it. Saving waits while an IME composition is under way.
// Part of the Editor: `app` is its shared context (surface.js).
import { PATCH_FILE, getPath } from "../../workspace/index.js";

export function installTogether(app, workspace, composing) {
  const events = workspace.events;

  events.on("remote-change", ({ operation }) => {
    const activeFile = app.controller.getActiveFile();
    if (operation.type !== PATCH_FILE || !activeFile || app.elements.editorContent !== document.activeElement) return;
    if (getPath(app.controller.getProject(), activeFile.id) !== operation.path) return;
    const selection = app.getEditorSelection();
    app.queueExternalEditorSelection(activeFile.id,
      app.transformEditorSelection(selection, Number(operation.start), Number(operation.end), String(operation.text ?? "").length));
  });
  events.on("remote-applied", ({ clientId, operation }) => {
    if (operation.type !== PATCH_FILE || !clientId) return;
    // Their cursor at the end of what they typed, without waiting for their next caret.
    const cached = app.remoteCursorsByClient.get(clientId);
    const position = Number(operation.start) + String(operation.text ?? "").length;
    if (cached) app.remoteCursorsByClient.set(clientId, { ...cached, selStart: position, selEnd: position });
  });
  // Their carets in every editor showing their file (not only the active one).
  events.on("other-caret", (cursor) => {
    if (!cursor?.clientId) return;
    app.remoteCursorsByClient.set(cursor.clientId, cursor);
    app.redrawRemoteCursors();
  });
  events.on("carets-kept", ({ clientIds }) => {
    const alive = new Set(clientIds);
    for (const clientId of [...app.remoteCursorsByClient.keys()]) if (!alive.has(clientId)) app.remoteCursorsByClient.delete(clientId);
    app.redrawRemoteCursors();
  });

  // A reload while reconnecting keeps the open tabs and the shown files (by
  // path), and each editor's caret and scroll (by path too: a file made
  // during the session comes back under the server's id for it; O9).
  let kept = null, carets = null;
  events.on("replacing", ({ keepView }) => {
    kept = keepView ? app.currentWorkspaceView() : null;
    carets = keepView ? app.keptCarets() : null;
  });
  events.on("replaced", () => {
    if (carets) app.carryCarets(carets);
    if (kept) app.restoreResumeState(kept);
    if (carets) app.giveCaretsBack(carets);
    kept = null;
    carets = null;
  });

  // The write path's edit to a file an editor shows whole goes through that
  // editor (the active one first, else the other: editors.js writerFor): it
  // joins the file's undo history, from either editor, and is sent like
  // typing; the caret moves with it.
  workspace.editing.configure({
    shows: (id) => Boolean(app.writerFor(id)),
    apply: (next, id) => app.writerFor(id)?.applyWrite(next)
  });
  workspace.holdSaving(() => composing.now);
}
