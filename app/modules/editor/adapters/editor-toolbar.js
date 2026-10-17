// The formatting toolbar and the edits it makes (wrap, prefix lines, insert a
// block or a table, a child item in a mind-map tree), and the drop caret shown
// while something is dragged over the editor.
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { isTextFileName } from "../../workspace/index.js";
import { buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./format-toolbar.js";
import { createTableGridPicker } from "./table-picker.js";

export function installToolbar(ed, app) {

  // Keep applyTextareaValue as a shim used only by the MTREE output textarea
  // (which is a real <textarea>, not the contenteditable).
  function applyTextareaValue(textarea, nextValue, selectionStart, selectionEnd = selectionStart) {
    textarea.value = nextValue;
    textarea.selectionStart = selectionStart;
    textarea.selectionEnd = selectionEnd;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function dispatchTextareaInput(textarea, inputType = "insertText") {
    if (typeof InputEvent === "function") {
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType }));
      return;
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function replaceTextareaRange(textarea, start, end, nextText, nextSelectionStart = null, nextSelectionEnd = null) {
    const defaultCursor = start + nextText.length;
    const selectionStart = nextSelectionStart ?? defaultCursor;
    const selectionEnd = nextSelectionEnd ?? selectionStart;
    textarea.setRangeText(nextText, start, end, "end");
    textarea.setSelectionRange(selectionStart, selectionEnd);
    dispatchTextareaInput(textarea, start === end ? "insertText" : "insertReplacementText");
  }

  // ── Markdown formatting toolbar ──────────────────────────────────────────────

  /** Wrap the current selection (or a placeholder) with inline markers and leave
   *  the wrapped text selected so the user can keep typing or replace it. */
  function wrapEditorSelection(before, after, placeholder) {
    const { start, end } = ed.getEditorSelection();
    const text = ed.getEditorText();
    const selected = text.slice(start, end) || placeholder;
    const inserted = `${before}${selected}${after}`;
    const innerStart = start + before.length;
    ed.replaceEditorRange(start, end, inserted, innerStart, innerStart + selected.length);
  }

  /** Prefix every line touched by the selection (line-oriented markdown like
   *  headings, lists, quotes). `numbered` increments the prefix per line. */
  function prefixEditorLines(prefix, numbered = false) {
    const { start, end } = ed.getEditorSelection();
    const text = ed.getEditorText();
    const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let blockEnd = text.indexOf("\n", end);
    if (blockEnd === -1) blockEnd = text.length;
    const lines = text.slice(blockStart, blockEnd).split("\n");
    const newBlock = lines
      .map((line, index) => `${numbered ? `${index + 1}. ` : prefix}${line}`)
      .join("\n");
    ed.replaceEditorRange(blockStart, blockEnd, newBlock, blockStart, blockStart + newBlock.length);
  }

  /** Insert a multi-line block snippet on its own line(s). `caretOffset` (if set)
   *  places the caret at that offset within the inserted snippet. */
  function insertEditorBlock(snippet, caretOffset = null) {
    const { start, end } = ed.getEditorSelection();
    const text = ed.getEditorText();
    const atLineStart = start === 0 || text[start - 1] === "\n";
    const lead = atLineStart ? "" : "\n";
    const inserted = `${lead}${snippet}`;
    const caret = caretOffset === null
      ? start + inserted.length
      : start + lead.length + caretOffset;
    ed.replaceEditorRange(start, end, inserted, caret, caret);
  }

  /** Indent level of an mtree line: one tab or four spaces per level (matches the
   *  mtree parser's indentation rules). */
  function getMtreeIndentLevel(line) {
    let level = 0;
    let spaceRun = 0;
    for (const char of line) {
      if (char === "\t") {
        level += 1;
        spaceRun = 0;
      } else if (char === " ") {
        spaceRun += 1;
        if (spaceRun === 4) {
          level += 1;
          spaceRun = 0;
        }
      } else {
        break;
      }
    }
    return level;
  }

  /** Insert an mtree child node one level deeper than the line at the caret,
   *  placed on the next line so it nests under the current node. */
  function insertMtreeChild(text) {
    const { start } = ed.getEditorSelection();
    const value = ed.getEditorText();
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let lineEnd = value.indexOf("\n", start);
    if (lineEnd === -1) lineEnd = value.length;
    const currentLine = value.slice(lineStart, lineEnd);
    const childIndent = "\t".repeat(getMtreeIndentLevel(currentLine) + 1);
    const inserted = `\n${childIndent}${text}`;
    const caret = lineEnd + inserted.length;
    ed.replaceEditorRange(lineEnd, lineEnd, inserted, caret, caret);
  }

  // Lazily-created floating grid-picker for the Markdown "Insert table" action.
  let tableGridPicker = null;

  function ensureTableGridPicker() {
    if (!tableGridPicker) {
      tableGridPicker = createTableGridPicker({
        onPick({ rows, cols, kind }) {
          app.elements.editorContent.focus({ preventScroll: true });
          insertEditorBlock(buildTableSnippet({ rows, cols, kind }));
          app.logDebug("action", "Toolbar table insert", `${cols}x${rows} ${kind}`);
        }
      });
      document.body.append(tableGridPicker.element);
    }
    return tableGridPicker;
  }

  /** Generic interpreter for a declarative toolbar action (see editor-format-toolbar.js). */
  function applyToolbarAction(action, buttonEl) {
    const activeFile = app.controller.getActiveFile();
    if (!action || !activeFile || !isTextFileName(activeFile.name)) return;

    if (action.kind === "table") {
      ensureTableGridPicker().open(buttonEl);
      return;
    }

    app.elements.editorContent.focus({ preventScroll: true });
    switch (action.kind) {
      case "wrap": wrapEditorSelection(action.before, action.after, action.placeholder); break;
      case "prefix": prefixEditorLines(action.prefix ?? "", action.numbered === true); break;
      case "block": insertEditorBlock(action.snippet, action.caret ?? null); break;
      case "mtree-child": insertMtreeChild(action.text); break;
      default: return;
    }
    app.logDebug("action", "Toolbar insert", action.kind);
  }

  function clearEditorDropCaret() {
    app.editorDragState.dropOffset = null;
    app.elements.editorDropCaret.hidden = true;
  }

  function showEditorDropCaret(clientX, clientY) {
    const offset = ed.getEditorTextOffsetFromPoint(clientX, clientY);
    app.editorDragState.dropOffset = offset;

    const markerRange = document.createRange();
    const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
    const caretPosition = document.caretPositionFromPoint?.(clientX, clientY);
    const container = caretRange?.startContainer ?? caretPosition?.offsetNode;
    const positionOffset = caretRange?.startOffset ?? caretPosition?.offset;
    if (!container) {
      clearEditorDropCaret();
      return;
    }
    markerRange.setStart(container, positionOffset);
    markerRange.setEnd(container, positionOffset);
    const rect = markerRange.getBoundingClientRect();
    const hostRect = app.elements.editorScroll.getBoundingClientRect();
    const height = rect.height || ed.getEditorLineHeight();
    app.elements.editorDropCaret.style.left = `${app.elements.editorContent.scrollLeft + rect.left - hostRect.left}px`;
    app.elements.editorDropCaret.style.top = `${app.elements.editorContent.scrollTop + rect.top - hostRect.top}px`;
    app.elements.editorDropCaret.style.height = `${height}px`;
    app.elements.editorDropCaret.hidden = false;
  }

  // Cached toolbar format so we only rebuild the buttons when it actually changes
  // (renderEditorContent runs on every keystroke). null = toolbar hidden.
  let currentToolbarFormat = undefined;

  /** Show/hide and (re)build the formatting toolbar for the active file. */
  function refreshFormatToolbar() {
    const toolbar = app.elements.editorFormatToolbar;
    if (!toolbar) return;
    const activeFile = app.controller.getActiveFile();
    const format = app.settings.showFormatToolbar ? getEditorToolbarFormat(activeFile?.name ?? "") : null;

    toolbar.hidden = format === null;
    if (format === currentToolbarFormat) return;
    currentToolbarFormat = format;

    if (format === null) {
      toolbar.replaceChildren();
      return;
    }
    renderEditorFormatToolbar(toolbar, format, { onAction: applyToolbarAction });
  }

  Object.assign(ed, { applyTextareaValue, dispatchTextareaInput, replaceTextareaRange, wrapEditorSelection, prefixEditorLines, insertEditorBlock, getMtreeIndentLevel, insertMtreeChild, ensureTableGridPicker, applyToolbarAction, clearEditorDropCaret, showEditorDropCaret, refreshFormatToolbar });
}
