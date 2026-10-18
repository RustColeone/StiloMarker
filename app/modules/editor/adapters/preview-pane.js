// The preview pane as a whole: it shows the preview of a file, or a pane view
// (editor.paneViews: a tab that is not a file, such as History's diff), and
// the two hide each other. Also edits made inside a preview (a diagram's),
// written back to the file without the preview drawing itself again.
import { getPath } from "../../workspace/index.js";

export function createPreviewPane(app) {
  let updatingFromPreview = false;

  // The pane view whose tab is shown in the preview, if one is.
  function shownView() {
    const id = app.view.get().previewFileId;
    const view = id ? app.paneViews.get(id) : null;
    return view?.tab() ? view : null;
  }

  function drawPreviewPane(project, previewFile) {
    const shown = shownView();
    for (const view of app.paneViews.all()) {
      if (view === shown) continue;
      if (view.element && !view.element.hidden) view.element.hidden = true;
    }
    const preview = app.elements.preview;
    if (shown) {
      const fresh = shown.element ? shown.element.hidden : true;
      if (shown.element) shown.element.hidden = false;
      if (preview) preview.hidden = true;
      shown.show({ fresh }); // in full when just shown, else a light refresh
      return;
    }
    if (preview) preview.hidden = false;
    // Not drawn again when the change came from the preview itself, nor while
    // the user edits inside it (a diagram node's fields): drawing replaces its
    // contents, which would reset its scroll and take focus out of the field.
    const editingInPreview = preview.contains(document.activeElement) && document.activeElement !== preview;
    if (updatingFromPreview || editingInPreview) return;
    const state = app.renderPreviewContent(preview, project, previewFile);
    if (state.shouldTypeset) void app.typesetPreview(state.content);
  }

  function updateFileContentFromPreview(fileId, nextContent, reason = "preview edit") {
    const project = app.controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || file.content === nextContent) return;
    // The preview already shows this; the write's redraw (which runs at once) skips it.
    updatingFromPreview = true;
    try {
      app.workspace.write(getPath(project, fileId), nextContent, { source: "preview" }).catch((error) => app.notify(error.message));
    } finally {
      updatingFromPreview = false;
    }
    app.logDebug("action", "Bmap preview updated", reason);
  }

  return { drawPreviewPane, updateFileContentFromPreview, shownPaneView: shownView };
}
