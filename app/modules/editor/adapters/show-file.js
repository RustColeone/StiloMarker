// Showing a source editor's file (or the one part of it that is picked), from
// the app's render (editors.js asks each editor on screen): loading a
// switched-to file with its saved caret and scroll, following the same file
// changed from elsewhere (the other editor, someone else, the agent) without
// losing the caret, and the empty state when nothing is open. One editor's
// part: `app` is that editor's context (editors.js).
import { isTextFileName } from "../../workspace/index.js";
import { partOf } from "../service/view.js";

export function createShowFile(app, composing) {
  // The part of a file this editor shows (Workspace's `parts`), or null: a
  // part picked in its group, while it is of the file the editor shows (its
  // group may have moved on to another file since).
  function getSelectedPart(project) {
    const picked = partOf(app.view.get(), app.group);
    const file = picked && picked.fileId === app.controller.getActiveFile()?.id ? project.nodes[picked.fileId] : null;
    const parts = file?.kind === "file" ? app.parts.of(file.name) : null;
    const part = parts?.list(file.content).find((candidate) => candidate.id === picked.partId);
    return part ? { file, parts, part } : null;
  }

  // The edited text back into the whole file when the editor shows one part of it.
  function fileContentFromEditor(file, text) {
    const selected = getSelectedPart(app.controller.getProject());
    return selected ? selected.parts.withBody(file.content, selected.part.id, text) : text;
  }

  // Shows this editor's file; returns the length of the text shown, or null
  // when no text is (the status bar's count is the active editor's).
  function showFile(project) {
    const activeFile = app.controller.getActiveFile();
    const elements = app.elements;
    if (!activeFile) {
      // No file open: make the pane non-editable and show the create-a-file overlay
      // instead of a plain (typable) placeholder (the welcome page: in whichever editor shows none).
      elements.editorContent.contentEditable = "false";
      elements.editorContent.dataset.noFile = "true";
      if (elements.editorEmptyState) {
        const card = document.querySelector(".welcome-card");
        if (card && card.parentElement !== elements.editorEmptyState) elements.editorEmptyState.append(card);
        elements.editorEmptyState.hidden = false;
      }
      for (const entry of app.welcome.all()) entry.draw(); // the welcome page's owners keep their parts current
      if (app.shown.fileId !== null) {
        app.shown.fileId = null;
        app.shown.partId = null;
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
    const readOnly = app.workspace.location.readOnly();
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
    const partId = selectedPart?.part.id ?? null;
    const fileChanged = activeFile.id !== app.shown.fileId || partId !== app.shown.partId;
    const editorHasFocus = elements.editorContent === document.activeElement;
    if (fileChanged) {
      // Clear stale remote cursors when the viewed file changes.
      app.renderRemoteCursors([]);
    }
    if (!app.isRendering() && fileChanged) {
      // Where this editor was in the file, else where the file was last left (resume.js).
      const savedSelection = app.savedEditorSelection(activeFile.id, nextText, app.group);
      app.shown.fileId = activeFile.id;
      app.shown.partId = partId;
      app.loadEditorContent(nextText, savedSelection?.start ?? 0, savedSelection?.end ?? savedSelection?.start ?? 0);
      // Resume the reader's previous scroll position in this document. The real
      // scroller is the editor's content (its .editor-scroll is overflow:hidden).
      const savedScroll = app.getViewState(activeFile.id, app.group)?.editorScroll;
      if (savedScroll && elements.editorContent) {
        elements.editorContent.scrollTop = savedScroll;
        app.syncEditorScroll();
      }
      // The find bar's matches are offsets into the file it searched. Switching
      // files must re-run the search against the NEW document — otherwise the
      // highlights (and next/prev) point at phantom positions carried over from
      // the old one. Done here, after loadEditorContent, so the DOM we measure is
      // the new file's. (The find bar is the active editor's.)
      if (app.searchState.open && app.isActiveEditor()) {
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
      // A part spelled as the user typed it stays: when the editor's text,
      // written back, gives the file as it is, it is the same content (an
      // album trims a description's trailing space; rewriting the editor for
      // that ate the space just typed and, under load, reset the caret to 0:
      // docs/ISSUES.md, fixed in v0.2.7).
      const typedSpelling = Boolean(selectedPart) && nextText !== domText
        && selectedPart.parts.withBody(selectedPart.file.content, selectedPart.part.id, domText) === selectedPart.file.content;
      if (nextText !== domText && !composing.now && !typedSpelling) {
        if (editorHasFocus) {
          // External same-file changes invalidate snapshot-based undo history.
          // Keep the caret stable when possible, then fence the history stack at
          // the new synchronized content so Ctrl+Z cannot replay stale text
          // (unless the history already holds it: the other editor's typing,
          // which is this file's history too).
          // (The page's selection may not be in it yet, as it is focused: its own kept caret then.)
          const page = window.getSelection();
          const inside = page?.rangeCount > 0 && elements.editorContent.contains(page.getRangeAt(0).startContainer);
          const { start, end } = inside ? app.getEditorSelection() : app.keptSelection() ?? { start: 0, end: 0 };
          const nextSelection = app.consumeExternalEditorSelection(activeFile.id, nextText, start, end);
          app.logDebug("response", "caret", `render resync (same file, focused): read sel=${start}-${end} → applyEditorRender at ${nextSelection.start}`);
          app.hideEditorAutocomplete();
          app.applyEditorRender(nextText, nextSelection.start, nextSelection.end, { reveal: false }); // someone else's edit: the view stays
          if (app.editorHistory.text !== nextText) app.resetEditorHistory(nextText, nextSelection.start, nextSelection.end);
        } else {
          followText(nextText);
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

  // The text changed elsewhere while this editor has no focus: drawn where it
  // is (the view stays), its caret kept where it was in the text (moved by the
  // change, as a collaborator's edit moves it), and its history fenced unless
  // it already holds the text (the other editor's typing in the same file).
  // Before, the editor was loaded again with its caret at the start.
  function followText(nextText) {
    const current = app.getEditorText();
    if (current === nextText) return;
    const kept = app.keptSelection();
    if (kept) {
      const { at, removed, inserted } = app.diffEditorTexts(current, nextText);
      const moved = app.transformEditorSelection(kept, at, at + removed.length, inserted.length);
      app.keepSelection(app.clampEditorSelection(nextText, moved.start, moved.end));
    }
    const content = app.elements.editorContent;
    const savedScroll = content.scrollTop;
    app.renderEditorContent(nextText);
    content.scrollTop = savedScroll;
    app.syncEditorScroll();
    if (app.editorHistory.text !== nextText) {
      const at = app.keptSelection() ?? { start: 0, end: 0 };
      app.resetEditorHistory(nextText, at.start, at.end);
    }
    app.logDebug("response", "caret", `followed a change elsewhere (not focused): kept sel=${app.keptSelection()?.start ?? "none"}`);
  }

  return { getSelectedPart, fileContentFromEditor, showFile, followText };
}
