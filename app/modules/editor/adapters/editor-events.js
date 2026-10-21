// The source editor's events: typing (input, IME composition, the edits the
// browser would otherwise do itself), focus and scroll, keys, the find bar's
// controls, links under the mouse, dragging text in and out, the wheel over the
// gutter, and re-rendering when the pane's width or the fonts change. Moved
// from main.js with the Editor's other parts; `app` is the Editor's shared
// context (surface.js), `composing` whether an IME composition is under way.
import { isMarkdownFileName, isTextFileName } from "../../workspace/index.js";

export function installEditorEvents(app, composing) {
  app.elements.editorContent.addEventListener("compositionstart", () => {
    composing.now = true;
  });

  app.elements.editorContent.addEventListener("compositionend", () => {
    composing.now = false;
    // After IME commit, sync the plain-text representation to the model and
    // restore the cursor position (which the render cycle would otherwise drop).
    const { start, end } = app.getEditorSelection();
    app.notifyEditorChanged(app.getEditorText());
    // The render triggered by notifyEditorChanged may have re-rendered the DOM
    // (if a remote op landed simultaneously); restore cursor explicitly.
    app.setEditorSelection(start, end);
    app.rememberEditorSelection();
    app.showEditorAutocomplete();
  });

  // Intercept editing operations BEFORE the browser mutates the DOM so we can
  // maintain the .editor-line structure that getEditorText() depends on.
  // Without this, select-all+type erases the structure and paste loses \n.
  app.elements.editorContent.addEventListener("beforeinput", (event) => {
    if (composing.now) return;
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) return;

    if (
      event.inputType === "insertParagraph" ||
      event.inputType === "insertLineBreak" ||
      (event.inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
    ) {
      app.traceEditorEvent("beforeinput", {
        inputType: event.inputType,
        data: app.formatEditorDebugValue(event.data ?? "")
      });
    }

    const { start, end } = app.getEditorSelection();
    const hasSelection = start !== end;
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak" || event.inputType.startsWith("delete")) {
      app.logDebug("response", "caret", `beforeinput ${event.inputType} reads sel=${start}-${end}`);
    }

    // Paste: always intercept — browser creates non-.editor-line divs for
    // multi-line content which causes \n to be silently dropped.
    if (event.inputType === "insertFromPaste") {
      event.preventDefault();
      const text = (event.dataTransfer?.getData("text/plain") ?? "").replace(/\r\n/g, "\n");
      app.replaceEditorRange(start, end, text);
      app.redrawRemoteCursors();
      app.showEditorAutocomplete();
      return;
    }

    // Always intercept Enter — letting the browser handle it natively creates a
    // plain <div> (not .editor-line) inside the contenteditable.  That element
    // is invisible to getEditorText() and causes getEditorSelection() to return
    // offset 0, which corrupts every subsequent edit (Space, Tab, backspace…).
    if (event.inputType === "insertParagraph" || event.inputType === "insertLineBreak") {
      event.preventDefault();
      app.replaceEditorRange(start, end, "\n");
      app.redrawRemoteCursors();
      app.hideEditorAutocomplete();
      return;
    }

    // Non-empty selection: browser may collapse or destroy .editor-line divs
    // when the operation spans multiple lines. Take over completely.
    if (hasSelection) {
      if (event.inputType === "insertText") {
        event.preventDefault();
        app.replaceEditorRange(start, end, event.data ?? "");
        app.redrawRemoteCursors();
        app.showEditorAutocomplete();
        return;
      }
      if (
        event.inputType === "deleteByCut" ||
        event.inputType === "deleteContentBackward" ||
        event.inputType === "deleteContentForward" ||
        event.inputType.startsWith("deleteWord") ||
        event.inputType.startsWith("deleteLine") ||
        event.inputType.startsWith("deleteHardLine") ||
        event.inputType.startsWith("deleteSoftLine")
      ) {
        event.preventDefault();
        app.replaceEditorRange(start, end, "");
        app.redrawRemoteCursors();
        return;
      }
    }

    // No selection, single-char delete: intercept when the cursor is right at
    // a line boundary so the browser doesn't merge two .editor-line divs into
    // one (which would drop the \n from getEditorText() and corrupt the model).
    if (!hasSelection) {
      const value = app.getEditorText();
      if (event.inputType === "deleteContentBackward") {
        // Backspace at the very start of a line (start > 0 and char before is \n)
        if (start > 0 && value[start - 1] === "\n") {
          event.preventDefault();
          app.replaceEditorRange(start - 1, start, "");
          app.redrawRemoteCursors();
          return;
        }
      }
      if (event.inputType === "deleteContentForward") {
        // Delete at the very end of a line (char at cursor is \n)
        if (start < value.length && value[start] === "\n") {
          event.preventDefault();
          app.replaceEditorRange(start, start + 1, "");
          app.redrawRemoteCursors();
          return;
        }
      }
    }
  });

  // Plain typing within a line, which the browser has already drawn: the
  // model and its history change at once (and the change is sent), while the
  // line's highlighting, the gutter, the caret's overlays and suggestions are
  // drawn once typing pauses (DRAW_IDLE), or every DRAW_MAX in a long burst.
  // Drawing them on every key forced layouts of the whole editor and cost a
  // long chapter hundreds of milliseconds a key. Anything else (a new line, a
  // paste, lines joined: the editor's own beforeinput work, or a browser that
  // added or removed lines) is drawn at once.
  const DRAW_IDLE = 90;
  const DRAW_MAX = 400;
  let drawTimer = null, drawDeadline = 0;

  function drawTyped() {
    if (drawTimer) clearTimeout(drawTimer);
    drawTimer = null;
    drawDeadline = 0;
    if (composing.now) return; // the composition's end draws
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) return;
    const currentText = app.getEditorText();
    const focused = document.activeElement === app.elements.editorContent;
    const { start, end } = app.getEditorSelection();
    // Re-rendering a line replaces its DOM, which drops the native caret and
    // resets scrollTop: both are put back. This is the native-edit path;
    // applyEditorRender has the same guard.
    const savedScroll = app.elements.editorContent.scrollTop;
    app.renderEditorContent(currentText);
    if (focused) {
      // Focus can be lost when lines are replaced (seen in some browsers): kept for the next key.
      if (document.activeElement !== app.elements.editorContent) app.elements.editorContent.focus({ preventScroll: true });
      app.setEditorSelection(start, end);
    }
    app.rememberEditorSelection();
    app.elements.editorContent.scrollTop = savedScroll;
    app.syncEditorScroll();
    if (focused) app.caretIntoView();
    // Peers' carets follow the text; suggestions are for where the caret is now.
    app.redrawRemoteCursors();
    if (focused) app.showEditorAutocomplete();
  }

  function drawTypedSoon() {
    const now = performance.now();
    if (!drawDeadline) drawDeadline = now + DRAW_MAX;
    if (drawTimer) clearTimeout(drawTimer);
    drawTimer = setTimeout(drawTyped, Math.max(0, Math.min(DRAW_IDLE, drawDeadline - now)));
  }
  app.elements.editorContent.addEventListener("input", (event) => {
    if (composing.now) {
      return;
    }
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      app.hideEditorAutocomplete();
      return;
    }
    const currentText = app.getEditorText();
    const { start, end } = app.getEditorSelection();
    const inputType = (event instanceof InputEvent ? event.inputType : "") ?? "";
    if (
      inputType === "insertParagraph" ||
      inputType === "insertLineBreak" ||
      (inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
    ) {
      app.traceEditorEvent("input", {
        inputType,
        data: app.formatEditorDebugValue(event.data ?? "")
      });
    }
    // Record every native text edit, including spaces, before the synchronous
    // model update path can disturb DOM focus/selection state.
    app.pushEditorHistoryState(currentText, start, end);
    app.notifyEditorChanged(currentText);
    // Within one line, nothing added or removed: drawn once typing pauses.
    const withinLine = (inputType === "insertText" && !/[\r\n]/.test(event.data ?? ""))
      || inputType === "deleteContentBackward" || inputType === "deleteContentForward";
    if (withinLine && app.editedOneLine()) {
      drawTypedSoon();
      return;
    }
    drawTyped();
    if (
      inputType === "insertParagraph" ||
      inputType === "insertLineBreak" ||
      (inputType === "insertText" && /^\s+$/.test(event.data ?? ""))
    ) {
      app.traceEditorEvent("input rendered", {
        inputType,
        data: app.formatEditorDebugValue(event.data ?? "")
      });
    }
  });

  // File tabs and workspace opens need not move focus into the editor. Restore the
  // saved caret when the user returns with keyboard or pointer focus instead.
  app.elements.editorContent.addEventListener("focus", () => {
    const active = app.controller.getActiveFile();
    if (!active || app.shown.fileId !== active.id) return;
    const saved = app.savedEditorSelection(active.id, app.getEditorText());
    if (saved) app.setEditorSelection(saved.start, saved.end);
  });

  app.elements.editorContent.addEventListener("scroll", () => {
    app.syncEditorScroll();
    app.scheduleRemoteCursorRender(); // keep peer carets/highlights pinned to the text while scrolling
    if (app.searchState.open) app.renderSearchHighlights();
  });
  app.elements.editorContent.addEventListener("keydown", app.handleEditorKeydown);

  // ── Find / Replace controls ─────────────────────────────────────────────────
  let findRecomputeTimer = null;
  app.elements.findInput?.addEventListener("input", () => {
    if (findRecomputeTimer) clearTimeout(findRecomputeTimer);
    findRecomputeTimer = setTimeout(() => {
      findRecomputeTimer = null;
      app.computeSearchMatches({ keepCaret: true });
      // Jump to the first match as the user refines the query.
      if (app.searchState.matches.length) app.gotoMatch(app.searchState.currentIndex);
    }, 100);
  });
  app.elements.findInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) app.findPrev(); else app.findNext();
    } else if (event.key === "Escape") {
      event.preventDefault();
      app.closeFindBar();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      app.elements.findInput.select();
    }
  });
  app.elements.replaceInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); app.replaceCurrent(); }
    else if (event.key === "Escape") { event.preventDefault(); app.closeFindBar(); }
  });
  app.elements.findNext?.addEventListener("click", app.findNext);
  app.elements.findPrev?.addEventListener("click", app.findPrev);
  app.elements.findClose?.addEventListener("click", app.closeFindBar);
  app.elements.findToggleCase?.addEventListener("click", () => app.toggleFindOption("caseSensitive", app.elements.findToggleCase));
  app.elements.findToggleWord?.addEventListener("click", () => app.toggleFindOption("wholeWord", app.elements.findToggleWord));
  app.elements.findToggleRegex?.addEventListener("click", () => app.toggleFindOption("regex", app.elements.findToggleRegex));
  app.elements.findToggleReplace?.addEventListener("click", () => {
    app.searchState.replaceMode = !app.searchState.replaceMode;
    if (app.elements.findReplaceRow) app.elements.findReplaceRow.hidden = !app.searchState.replaceMode;
    (app.searchState.replaceMode ? app.elements.replaceInput : app.elements.findInput)?.focus();
  });
  app.elements.replaceOne?.addEventListener("click", app.replaceCurrent);
  app.elements.replaceAll?.addEventListener("click", app.replaceAllMatches);
  app.elements.editorContent.addEventListener("mousedown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.button === 0) {
      const linkEl = event.target?.closest?.(".token-link[data-href]");
      if (linkEl) {
        event.preventDefault();
        app.hideLinkTooltip(true);
        app.openLinkFromEditor(linkEl.dataset.href);
      }
    }
  });
  app.elements.editorContent.addEventListener("click", app.hideEditorAutocomplete);
  app.elements.editorContent.addEventListener("mousemove", app.handleEditorLinkHover);
  app.elements.editorContent.addEventListener("mouseleave", app.handleEditorMouseLeave);

  // Links in a preview (the preview, or a group's second one).
  (app.elements.preview.closest(".editor-grid") ?? app.elements.preview).addEventListener("click", (event) => {
    if (!event.target.closest?.(".preview-output")) return;
    const fileLink = event.target.closest("a[data-open-file-id]");
    if (fileLink) {
      event.preventDefault();
      app.openFileFromExplorer(fileLink.dataset.openFileId);
      return;
    }
    const unresolved = event.target.closest("a[data-unresolved-link]");
    if (unresolved) {
      event.preventDefault();
      app.notify(`Cannot resolve link: ${unresolved.dataset.unresolvedLink}`);
    }
  });

  app.elements.editorContent.addEventListener("dragstart", (event) => {
    const { start: selectionStart, end: selectionEnd } = app.getEditorSelection();
    if (selectionStart === selectionEnd) {
      app.editorDragState.selection = null;
      return;
    }
    const text = app.getEditorText().slice(selectionStart, selectionEnd);
    app.editorDragState.selection = { start: selectionStart, end: selectionEnd, text };
    event.dataTransfer?.setData("text/mdnotes-editor-selection", JSON.stringify(app.editorDragState.selection));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "copyMove";
    }
  });
  app.elements.editorContent.addEventListener("dragend", () => {
    app.editorDragState.selection = null;
    app.clearEditorDropCaret();
  });
  app.elements.editorContent.addEventListener("dragover", (event) => {
    const types = event.dataTransfer?.types ?? [];
    // Explorer file drags: let the pane-level handler accept them (don't steal the event here).
    if (types.includes("text/mdnotes-file-id") || types.includes("text/mdnotes-node-id")) {
      app.clearEditorDropCaret();
      return;
    }

    const activeFile = app.controller.getActiveFile();
    const supportsTextDrop = Boolean(activeFile && isTextFileName(activeFile.name));
    const supportsPartDrop = Boolean(activeFile && isMarkdownFileName(activeFile.name) && types.includes("text/stilo-file-part"));
    const supportsTextPayload = types.includes("text/plain") || types.includes("text/mdnotes-editor-selection");
    if ((!supportsTextDrop || !supportsTextPayload) && !supportsPartDrop) {
      app.clearEditorDropCaret();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = types.includes("text/mdnotes-editor-selection") ? "move" : "copy";
    }
    app.showEditorDropCaret(event.clientX, event.clientY);
  });
  app.elements.editorContent.addEventListener("dragleave", (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    app.clearEditorDropCaret();
  });
  app.elements.editorContent.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void app.onDrop(event).catch((error) => app.notify(error.message));
  });
  app.elements.editorGutter.addEventListener("wheel", app.forwardEditorWheel, { passive: false });
  app.elements.editorScroll.addEventListener("wheel", (event) => {
    if (event.target === app.elements.editorContent) {
      return;
    }
    app.forwardEditorWheel(event);
  }, { passive: false });

  // Re-render on resize ONLY when the WIDTH changes (that's what affects soft-wrap
  // and gutter alignment). A height-only change — e.g. the document growing as you
  // press Enter — must NOT trigger renderEditorContent(): it rebuilds innerHTML,
  // which invalidates the current selection and drops the caret to offset 0 (the
  // "Enter/DEL then the caret jumps to line 1" bug, which fired ~16-60ms later via
  // this observer). And when a real width change does re-render, preserve the caret.
  let _lastEditorObservedWidth = 0;
  const editorResizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      const width = Math.round(app.elements.editorScroll.getBoundingClientRect().width);
      if (composing.now || width === _lastEditorObservedWidth) {
        app.syncEditorScroll();
        return;
      }
      _lastEditorObservedWidth = width;
      const sel = app.getEditorSelection();
      const hadFocus = document.activeElement === app.elements.editorContent;
      const savedScroll = app.elements.editorContent.scrollTop;
      app.renderEditorContent(app.getEditorText());
      if (hadFocus) {
        app.elements.editorContent.focus({ preventScroll: true });
        app.setEditorSelection(sel.start, sel.end);
      }
      app.elements.editorContent.scrollTop = savedScroll;
      app.syncEditorScroll();
    })
    : null;

  editorResizeObserver?.observe(app.elements.editorScroll);
  editorResizeObserver?.observe(app.elements.sourceBody);


  // Glyph metrics change when a web font finishes loading: measure again.
  document.fonts?.addEventListener?.("loadingdone", () => {
    if (!app.editorRenderCache.els.length) return;
    app.editorRenderCache.metricsKey = "";
    app.renderEditorContent(app.getEditorText());
  });
}
