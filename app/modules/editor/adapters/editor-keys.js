// Keys in the editor: indentation (Tab, Shift+Tab, on one line or many) and
// the rest of the editor's key handling.
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { getEditorToolbarFormat } from "./format-toolbar.js";

export function installKeys(ed, app) {

  function getIndentText() {
    return app.settings.indentStyle === "spaces" ? "    " : "\t";
  }

  function getIndentColumnWidth() {
    return app.settings.indentStyle === "spaces" ? 4 : 4;
  }

  function getLineSelectionRange(value, selectionStart, selectionEnd) {
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    let lineEnd = value.indexOf("\n", selectionEnd);
    if (lineEnd < 0) {
      lineEnd = value.length;
    }
    return { lineStart, lineEnd };
  }

  /** Indent/unindent selected lines in the main contenteditable editor. */
  function adjustSelectedLinesIndent(direction) {
    const value = ed.getEditorText();
    const { start: selectionStart, end: selectionEnd } = ed.getEditorSelection();
    const indentText = getIndentText();
    const { lineStart, lineEnd } = getLineSelectionRange(value, selectionStart, selectionEnd);
    const selectedText = value.slice(lineStart, lineEnd);
    const lines = selectedText.split("\n");

    if (direction > 0) {
      const nextLines = lines.map((line) => `${indentText}${line}`);
      const nextText = nextLines.join("\n");
      const nextSelectionStart = selectionStart + indentText.length;
      const nextSelectionEnd = selectionEnd + (indentText.length * lines.length);
      ed.replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
      return;
    }

    let removedBeforeSelectionStart = 0;
    let removedTotal = 0;
    const nextLines = lines.map((line, index) => {
      let removed = 0;
      if (line.startsWith("\t")) {
        removed = 1;
      } else if (line.startsWith(indentText)) {
        removed = indentText.length;
      } else {
        const leadingSpaces = (line.match(/^ +/)?.[0].length) ?? 0;
        removed = Math.min(leadingSpaces, indentText.length);
      }

      if (removed > 0) {
        removedTotal += removed;
        if (index === 0) {
          removedBeforeSelectionStart = removed;
        }
        return line.slice(removed);
      }
      return line;
    });

    const nextText = nextLines.join("\n");
    const nextSelectionStart = Math.max(lineStart, selectionStart - removedBeforeSelectionStart);
    const nextSelectionEnd = Math.max(nextSelectionStart, selectionEnd - removedTotal);
    ed.replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
  }

  /** Indent/unindent selected lines in a plain <textarea> (used by MTREE dialog). */
  function adjustTextareaLinesIndent(textarea, direction) {
    const value = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const indentText = getIndentText();
    const { lineStart, lineEnd } = getLineSelectionRange(value, selectionStart, selectionEnd);
    const selectedText = value.slice(lineStart, lineEnd);
    const lines = selectedText.split("\n");

    if (direction > 0) {
      const nextLines = lines.map((line) => `${indentText}${line}`);
      const nextText = nextLines.join("\n");
      const nextSelectionStart = selectionStart + indentText.length;
      const nextSelectionEnd = selectionEnd + (indentText.length * lines.length);
      ed.replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
      return;
    }

    let removedBeforeSelectionStart = 0;
    let removedTotal = 0;
    const nextLines = lines.map((line, index) => {
      let removed = 0;
      if (line.startsWith("\t")) {
        removed = 1;
      } else if (line.startsWith(indentText)) {
        removed = indentText.length;
      } else {
        const leadingSpaces = (line.match(/^ +/)?.[0].length) ?? 0;
        removed = Math.min(leadingSpaces, indentText.length);
      }

      if (removed > 0) {
        removedTotal += removed;
        if (index === 0) {
          removedBeforeSelectionStart = removed;
        }
        return line.slice(removed);
      }
      return line;
    });

    const nextText = nextLines.join("\n");
    const nextSelectionStart = Math.max(lineStart, selectionStart - removedBeforeSelectionStart);
    const nextSelectionEnd = Math.max(nextSelectionStart, selectionEnd - removedTotal);
    ed.replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
  }

  /** Insert an indent at the caret in the main contenteditable editor. */
  function insertIndentAtCursor() {
    const indentText = getIndentText();
    const { start, end } = ed.getEditorSelection();
    app.traceEditorEvent("Tab indent before", { indent: app.formatEditorDebugValue(indentText) });
    ed.replaceEditorRange(start, end, indentText, start + indentText.length, start + indentText.length);
    app.traceEditorEvent("Tab indent after", { indent: app.formatEditorDebugValue(indentText) });
  }

  /** Insert an indent at the caret in a plain <textarea> (used by MTREE dialog). */
  function insertIndentIntoTextarea(textarea) {
    const indentText = getIndentText();
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const nextCaret = selectionStart + indentText.length;
    textarea.setRangeText(indentText, selectionStart, selectionEnd, "end");
    textarea.setSelectionRange(nextCaret, nextCaret);
    ed.dispatchTextareaInput(textarea, selectionStart === selectionEnd ? "insertText" : "insertReplacementText");
  }

  function handleIndentKeydown(event) {
    if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    app.traceEditorEvent("Tab keydown", { shift: event.shiftKey ? "yes" : "no" });
    event.preventDefault();
    const target = event.currentTarget;
    if (target.tagName === "TEXTAREA") {
      // MTREE output textarea uses the plain-DOM helpers.
      if (target.selectionStart !== target.selectionEnd || event.shiftKey) {
        adjustTextareaLinesIndent(target, event.shiftKey ? -1 : 1);
        return;
      }
      insertIndentIntoTextarea(target);
    } else {
      // Main contenteditable editor.
      const { start, end } = ed.getEditorSelection();
      if (start !== end || event.shiftKey) {
        adjustSelectedLinesIndent(event.shiftKey ? -1 : 1);
        return;
      }
      insertIndentAtCursor();
    }
  }

  function handleEditorKeydown(event) {
    if (event.key === " " || event.key === "Enter") {
      app.traceEditorEvent("Keydown", { key: event.key === " " ? "Space" : event.key });
    }
    if (event.key === "Tab") {
      app.traceEditorEvent("Keydown", { key: "Tab" });
    }
    // Find / Replace (Ctrl/Cmd+F, Ctrl/Cmd+H). With Shift: Find in Files (a command, search-files.js).
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      app.openFindBar(false);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      app.openFindBar(true);
      return;
    }
    // Custom undo/redo — must intercept before the browser's native handler,
    // because innerHTML-rerender destroys the browser's native undo stack.
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
      event.preventDefault();
      ed.editorUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault();
      ed.editorRedo();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key === " ") {
      event.preventDefault();
      app.showEditorAutocomplete(true);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
      const key = event.key.toLowerCase();
      // Bold/italic markers are Markdown-only.
      const isMarkdown = getEditorToolbarFormat(app.controller.getActiveFile()?.name ?? "") === "markdown";
      if (key === "b" && isMarkdown) {
        event.preventDefault();
        ed.applyToolbarAction({ kind: "wrap", before: "**", after: "**", placeholder: "bold text" });
        return;
      }
      if (key === "i" && isMarkdown) {
        event.preventDefault();
        ed.applyToolbarAction({ kind: "wrap", before: "*", after: "*", placeholder: "italic text" });
        return;
      }
    }

    if (!app.elements.editorAutocomplete.hidden) {
      // Space dismisses autocomplete so the user can keep typing freely.
      if (event.key === " ") {
        app.hideEditorAutocomplete();
        // Do not preventDefault — the space character should still be inserted.
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        app.autocompleteState.activeIndex = (app.autocompleteState.activeIndex + 1) % app.autocompleteState.items.length;
        app.autocompleteState.userChose = true;
        app.renderEditorAutocomplete();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        app.autocompleteState.activeIndex = (app.autocompleteState.activeIndex - 1 + app.autocompleteState.items.length) % app.autocompleteState.items.length;
        app.autocompleteState.userChose = true;
        app.renderEditorAutocomplete();
        return;
      }
      // Tab always accepts. Enter only accepts a suggestion the user actually
      // picked; otherwise it inserts a newline and just dismisses the popup.
      // Enter-accepts-by-default silently replaced typed text with a word already
      // in the document (type "zero", press Enter, get "zeroalpha") — it read as
      // the editor corrupting your text.
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        app.traceEditorEvent("Autocomplete accepted from keydown", { key: event.key });
        app.acceptEditorAutocomplete();
        return;
      }
      if (event.key === "Enter") {
        if (app.autocompleteState.userChose) {
          event.preventDefault();
          app.traceEditorEvent("Autocomplete accepted from keydown", { key: event.key });
          app.acceptEditorAutocomplete();
          return;
        }
        app.hideEditorAutocomplete(); // fall through: the newline is inserted normally
      }
      if (event.key === "Escape") {
        event.preventDefault();
        app.hideEditorAutocomplete();
        return;
      }
    }

    handleIndentKeydown(event);
  }


  Object.assign(ed, { getIndentText, getIndentColumnWidth, getLineSelectionRange, adjustSelectedLinesIndent, adjustTextareaLinesIndent, insertIndentAtCursor, insertIndentIntoTextarea, handleIndentKeydown, handleEditorKeydown });
}
