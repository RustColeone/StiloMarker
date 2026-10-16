// Legacy (before the module restructure): connects the Workspace module's
// write path to the project, which main.js still holds. When the project
// moves into Workspace (a later step) this file goes away.
//
// commit(): the file open in the editor changes through the editor, so the
// edit joins its undo history and the editor sends the patch as it does for
// typing (except edits made in the preview, which the preview already shows
// and which never joined the editor's undo history). Any other file changes
// in the project, and the change is sent as a text patch through the same
// queue typing uses. replace(): Workspace hands over the operation that
// replaces a binary file (an image) whole; this applies and sends it.
import { getNodeIdByPath } from "../domain/project-model.js";

export function createWorkspacePorts(app) {
  const synced = () => app.collaboration.isConnected() && app.workspaceMode === "synced";

  return {
    commit(path, previous, next, source) {
      const project = app.controller.getProject();
      const id = getNodeIdByPath(project, path);
      if (!id) throw new Error(`No file at ${path}`);
      if (source !== "preview" && id === project.activeFileId && app.editorShowsWholeFile()) {
        const { start, end } = app.getEditorSelection();
        app.applyEditorEdit(next, Math.min(start, next.length), Math.min(end, next.length));
        return;
      }
      app.controller.updateContent(id, next);
      if (synced()) app.collaboration.scheduleTextPatch(path, previous, next);
    },

    async replace(operation) {
      const id = getNodeIdByPath(app.controller.getProject(), operation.path);
      if (!id) throw new Error(`No file at ${operation.path}`);
      app.controller.updateContent(id, operation.content);
      await app.publishOperation(operation);
    }
  };
}
