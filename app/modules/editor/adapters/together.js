// The editor while others work in the same workspace (through Workspace, which
// Sync feeds): their change keeps my caret where it was in the text and moves
// their cursor to the end of what they typed; their carets come and go; a
// reload of the project keeps my view; and the write path edits the file I
// show as if I typed it. Saving waits while an IME composition is under way.
// Part of the Editor: `app` is its shared context (surface.js).
import { PATCH_FILE, getPath, isTextFileName } from "../../workspace/index.js";

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
  events.on("other-caret", (cursor) => app.onRemoteCursor(cursor));
  events.on("carets-kept", ({ clientIds }) => app.pruneRemoteCursors(clientIds.map((clientId) => ({ clientId }))));

  // A reload while reconnecting keeps the open tabs and the shown file.
  let kept = null;
  events.on("replacing", ({ keepView }) => { kept = keepView ? app.currentWorkspaceView() : null; });
  events.on("replaced", () => { if (kept) app.restoreResumeState(kept); kept = null; });

  // The write path's edit to the file shown whole goes through the editor: it
  // joins the undo history and is sent like typing.
  workspace.editing.configure({
    shows: (id) => id === app.controller.getProject().activeFileId && !app.view.get().sourcePart
      && isTextFileName(app.controller.getActiveFile()?.name ?? ""),
    apply(next) {
      const { start, end } = app.getEditorSelection();
      app.applyEditorEdit(next, Math.min(start, next.length), Math.min(end, next.length));
    }
  });
  workspace.holdSaving(() => composing.now);
}
