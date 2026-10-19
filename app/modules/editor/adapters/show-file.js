// Showing the active file (or the one part of it that is picked) in the
// source editor, from the app's render: loading a switched-to file with its
// saved caret and scroll, re-syncing the same file after a change from
// elsewhere without losing the caret, and the empty state when nothing is
// open. Moved from main.js's updateStatus with the Editor's other parts.
import { isTextFileName } from "../../workspace/index.js";

export function createShowFile(app, composing) {
  // The part of a file the source editor shows (Workspace's `parts`), or null.
  function getSelectedPart(project) {
    const picked = app.view.get().sourcePart;
    const file = picked ? project.nodes[picked.fileId] : null;
    const parts = file?.kind === "file" ? app.parts.of(file.name) : null;
    const part = parts?.list(file.content).find((candidate) => candidate.id === picked.partId);
    return part ? { file, parts, part } : null;
  }

  // The edited text back into the whole file when the editor shows one part of it.
  function fileContentFromEditor(file, text) {
    const selected = getSelectedPart(app.controller.getProject());
    return selected ? selected.parts.withBody(file.content, selected.part.id, text) : text;
  }

  // Returns the length of the text shown, or null when no text is; the status
  // bar's count is told the same (char-count.js).
  function showActiveFile(project) {
    const length = showFile(project);
    app.showCharCount(length);
    return length;
  }

  function showFile(project) {
    const activeFile = project.activeFileId ? project.nodes[project.activeFileId] : null;
    const elements = app.elements;
    if (!activeFile) {
      // No file open: make the pane non-editable and show the create-a-file overlay
      // instead of a plain (typable) placeholder.
      elements.editorContent.contentEditable = "false";
      elements.editorContent.dataset.noFile = "true";
      if (elements.editorEmptyState) elements.editorEmptyState.hidden = false;
      for (const entry of app.welcome.all()) entry.draw(); // the welcome page's owners keep their parts current
      if (app.shown.fileId !== null) {
        app.shown.fileId = null;
        app.loadEditorContent("");
      }
      app.syncEditorScroll();
      return null;
    }

    const selectedPart = getSelectedPart(project);
    elements.editorContent.dataset.noFile = "false";
    if (elements.editorEmptyState) elements.editorEmptyState.hidden = true;
    const isTextFile = isTextFileName(activeFile.name);
    // A reader may open and read the project but never write to it (the server
    // refuses their operations regardless; this stops the UI inviting edits that
    // would only bounce back).
    const readOnly = app.isReadOnly();
    elements.editorContent.contentEditable = isTextFile && !readOnly ? "true" : "false";
    elements.editorContent.dataset.readonly = readOnly ? "true" : "false";
    elements.editorContent.dataset.placeholder = isTextFile
      ? "Select or create a file"
      : "Image assets are preview-only in the source pane.";
    const nextText = isTextFile
      ? selectedPart
        ? selectedPart.parts.body(selectedPart.file.content, selectedPart.part.id)
        : activeFile.content
      : `[${activeFile.name}]\n\nThis image asset is preview-only in the source pane.\nUse the preview pane to inspect it or Explorer > Add File to replace it.`;
    const fileChanged = activeFile.id !== app.shown.fileId;
    const editorHasFocus = elements.editorContent === document.activeElement;
    if (fileChanged) {
      // Clear stale remote cursors when the viewed file changes.
      app.renderRemoteCursors([]);
    }
    if (!app.isRendering() && fileChanged) {
      const savedSelection = app.savedEditorSelection(activeFile.id, nextText);
      app.shown.fileId = activeFile.id;
      app.loadEditorContent(nextText, savedSelection?.start ?? 0, savedSelection?.end ?? savedSelection?.start ?? 0);
      // Resume the reader's previous scroll position in this document. The real
      // scroller is #editor-content (#editor-scroll is overflow:hidden).
      const savedScroll = app.getViewState(activeFile.id)?.editorScroll;
      if (savedScroll && elements.editorContent) {
        elements.editorContent.scrollTop = savedScroll;
        app.syncEditorScroll();
      }
      // The find bar's matches are offsets into the file it searched. Switching
      // files must re-run the search against the NEW document — otherwise the
      // highlights (and next/prev) point at phantom positions carried over from
      // the old one. Done here, after loadEditorContent, so the DOM we measure is
      // the new file's.
      if (app.searchState.open) {
        app.searchState.currentIndex = -1;
        app.computeSearchMatches();
      }
    } else {
      const domText = app.getEditorText();
      // Never rebuild the editor DOM mid-IME-composition. During composition the
      // DOM holds in-progress characters the model hasn't received yet (the `input`
      // handler defers to compositionend), so nextText !== domText transiently. A
      // rebuild here — triggered by ANY unrelated render (auto-save, presence, a
      // remote op on another file) — would abort the composition and slam the caret
      // to offset 0. The model catches up on compositionend, which re-syncs cleanly.
      if (nextText !== domText && !composing.now) {
        if (editorHasFocus) {
          // External same-file changes invalidate snapshot-based undo history.
          // Keep the caret stable when possible, then fence the history stack at
          // the new synchronized content so Ctrl+Z cannot replay stale text.
          const { start, end } = app.getEditorSelection();
          const nextSelection = app.consumeExternalEditorSelection(activeFile.id, nextText, start, end);
          app.logDebug("response", "caret", `render resync (same file, focused): read sel=${start}-${end} → applyEditorRender at ${nextSelection.start}`);
          app.hideEditorAutocomplete();
          app.applyEditorRender(nextText, nextSelection.start, nextSelection.end);
          app.resetEditorHistory(nextText, nextSelection.start, nextSelection.end);
        } else {
          app.logDebug("response", "caret", "render→loadEditorContent (same file, NOT focused) → caret to 0");
          app.loadEditorContent(nextText);
        }
        // Reposition remote cursor overlays after the DOM re-render.
        app.redrawRemoteCursors();
      }
      app.syncEditorScroll();
    }
    // The total for the footer counter — the source text the editor holds (an
    // image placeholder isn't file content, so the counter hides for those).
    return isTextFile ? nextText.length : null;
  }

  return { getSelectedPart, fileContentFromEditor, showActiveFile };
}
