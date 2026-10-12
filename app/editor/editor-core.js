// The source editor itself: mapping between the text and the contenteditable
// DOM (lines, caret, selection), incremental rendering, undo / redo, remote
// collaborators' cursors, the overview ruler, indentation and key handling,
// and the formatting toolbar's edits.
// main.js creates this on first use and passes its shared values in `app`.
// The typing hot path keeps its state here, read directly rather than via app.
import { getPath, isTextFileName } from "../domain/project-model.js";
import { parseUrlDbEntryBody, updateUrlDbEntry } from "../services/urldb-service.js";
import { buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "../ui/editor-format-toolbar.js";
import { createTableGridPicker } from "../ui/table-grid-picker.js";

export function createEditorCore(app) {
  // What has changed in the editor DOM since the last render (see
  // trackEditorDom). Lets text/caret reads use the render cache instead of
  // re-reading every line's textContent — each read allocated a fresh string.
  const editorDomTracker = {
    observer: null,
    dirty: new Set(),   // top-level lines whose content changed since the last render
    structural: false,  // lines were added/removed directly under the editor
    text: null          // getEditorText() result, valid until the next mutation
  };
  let pendingExternalEditorSelection = null;


  // ---------------------------------------------------------------------------
  // Contenteditable editor core API
  // ---------------------------------------------------------------------------

  /** Return the plain-text content of the editor by reading each logical-line
   *  div's textContent and joining with newlines. */
  // A "line" is any direct element child of #editor-content. Normally these are
  // all .editor-line (renderEditorContent only makes those), but a mobile keyboard
  // / autocorrect / swipe edit can transiently insert a plain <div>; treating those
  // as lines too keeps text from being dropped and offsets from collapsing to 0.
  function editorLineEls() {
    // .children, not querySelectorAll(":scope > *"): the selector form walks every
    // DESCENDANT (~18k nodes in a long chapter) to find the direct children, and
    // this runs several times per keystroke. Same elements, same order.
    return Array.from(app.elements.editorContent.children);
  }

  // ── Editor DOM change tracking ──────────────────────────────────────────────
  // A MutationObserver records which lines changed behind our back (native typing,
  // IME, mobile keyboards) since the last render. takeRecords() makes it exact and
  // synchronous: nothing has to wait for the observer's callback.
  function trackEditorDom() {
    const tracker = editorDomTracker;
    if (!tracker.observer) {
      tracker.observer = new MutationObserver(noteEditorMutations);
      tracker.observer.observe(app.elements.editorContent, { childList: true, subtree: true, characterData: true });
      tracker.structural = true; // nothing is known until the next render syncs it
      tracker.text = null;
    }
    noteEditorMutations(tracker.observer.takeRecords());
    return tracker;
  }

  function noteEditorMutations(records) {
    if (!records.length) return;
    const tracker = editorDomTracker;
    const root = app.elements.editorContent;
    tracker.text = null;
    for (const record of records) {
      if (record.target === root) { tracker.structural = true; continue; }
      let node = record.target;
      while (node && node.parentNode !== root) node = node.parentNode;
      if (node) tracker.dirty.add(node);
      else tracker.structural = true; // detached by now: assume the worst
    }
  }

  // After a render we fully control, the DOM matches the cache exactly. `text` is
  // what getEditorText() would now return, or null if that isn't known.
  function markEditorDomSynced(text) {
    const tracker = trackEditorDom();
    tracker.observer.takeRecords(); // our own mutations
    tracker.dirty.clear();
    tracker.structural = false;
    tracker.text = text;
  }

  // Index of a line element if every line before it is unchanged since the last
  // render (so the cache's text lengths are exact for them), else -1.
  function cleanLineIndex(lineEl) {
    const tracker = trackEditorDom();
    const cache = app.editorRenderCache;
    const kids = app.elements.editorContent.children;
    if (tracker.structural || !lineEl || kids.length !== cache.els.length) return -1;
    const index = Array.prototype.indexOf.call(kids, lineEl);
    if (index < 0 || cache.els[index] !== lineEl) return -1;
    for (const dirty of tracker.dirty) {
      const at = Array.prototype.indexOf.call(kids, dirty);
      if (at < 0 || at < index) return -1;
    }
    return index;
  }

  function getEditorText() {
    const tracker = trackEditorDom();
    if (tracker.text !== null) return tracker.text;
    const lines = app.elements.editorContent.children;
    if (lines.length === 0) {
      tracker.text = "";
      return "";
    }
    const parts = new Array(lines.length);
    for (let i = 0; i < lines.length; i += 1) parts[i] = lines[i].textContent;
    tracker.text = parts.join("\n");
    return tracker.text;
  }

  /** Walk text nodes inside `root` counting characters until `targetOffset` is
   *  reached, then return the hosting DOM node + in-node offset. */
  function findTextNodeAt(root, targetOffset) {
    if (root.nodeType === Node.TEXT_NODE) {
      return { node: root, offset: Math.min(targetOffset, root.textContent.length) };
    }
    let consumed = 0;
    for (const child of root.childNodes) {
      // A <br> in an empty line represents zero characters but IS a valid cursor
      // position.  If we're right at that spot, position before the <br>.
      if (child.nodeName === "BR") {
        if (targetOffset === consumed) {
          return { node: root, offset: Array.from(root.childNodes).indexOf(child) };
        }
        continue;
      }
      const childLen = child.textContent.length;
      if (consumed + childLen >= targetOffset) {
        return findTextNodeAt(child, targetOffset - consumed);
      }
      consumed += childLen;
    }
    return { node: root, offset: root.childNodes.length };
  }

  /** Convert an integer plain-text offset to a { node, offset } DOM position
   *  inside the contenteditable. */
  function textOffsetToDomPosition(textOffset) {
    // Fast path: nothing changed since the last render, so the cache's line
    // lengths are exact and no line's textContent needs reading.
    const tracker = trackEditorDom();
    const cache = app.editorRenderCache;
    const kids = app.elements.editorContent.children;
    if (!tracker.structural && tracker.dirty.size === 0 && kids.length > 0 && kids.length === cache.els.length) {
      let remaining = textOffset;
      for (let i = 0; i < kids.length; i += 1) {
        const line = kids[i];
        const lineLen = cache.texts[i].length;
        if (remaining <= lineLen) return findTextNodeAt(line, remaining);
        remaining -= lineLen + 1;
        if (remaining < 0) return { node: line, offset: line.childNodes.length };
      }
      const last = kids[kids.length - 1];
      return { node: last, offset: last.childNodes.length };
    }
    const lineEls = editorLineEls();
    let remaining = textOffset;
    for (const line of lineEls) {
      const lineLen = line.textContent.length;
      if (remaining <= lineLen) {
        return findTextNodeAt(line, remaining);
      }
      remaining -= lineLen + 1; // +1 for the newline between lines
      if (remaining < 0) {
        // Offset landed exactly on a newline separator — position at end of the
        // previous line.
        return { node: line, offset: line.childNodes.length };
      }
    }
    // Past all content — position at end of last line.
    const last = lineEls[lineEls.length - 1];
    if (last) return { node: last, offset: last.childNodes.length };
    return { node: app.elements.editorContent, offset: app.elements.editorContent.childNodes.length };
  }

  /** Convert a DOM (container, domOffset) position to an integer plain-text
   *  offset relative to the start of the editor content. */
  function domPositionToTextOffset(container, domOffset) {
    // A selection boundary can BE the editor root itself: Ctrl+A commonly makes
    // both endpoints the root (#editor-content) with a child index. Summing the
    // preceding lines' text here is essential — without it the offset collapsed to
    // 0, so getEditorSelection() reported an empty selection and Ctrl+A + paste
    // inserted at the top WITHOUT removing the selection (the "everything mixed up"
    // corruption).
    if (container === app.elements.editorContent) {
      const kids = Array.from(app.elements.editorContent.childNodes);
      const count = kids.length;
      const limit = Math.min(Math.max(0, domOffset), count);
      let offset = 0;
      for (let i = 0; i < limit; i += 1) {
        offset += kids[i].textContent?.length ?? 0;
        if (i < count - 1) offset += 1; // newline between lines (none after the last)
      }
      return offset;
    }

    // Walk up to the direct child of #editor-content that hosts this position.
    let lineEl = container;
    while (lineEl && lineEl.parentNode !== app.elements.editorContent) {
      lineEl = lineEl.parentNode;
    }

    // Fast path: lines before the caret are unchanged since the last render.
    const cleanIndex = cleanLineIndex(lineEl);
    if (cleanIndex >= 0) {
      const texts = app.editorRenderCache.texts;
      let offset = 0;
      for (let i = 0; i < cleanIndex; i += 1) offset += texts[i].length + 1;
      return offset + getOffsetWithinTextRoot(lineEl, container, domOffset);
    }

    const lineEls = editorLineEls();
    const lineIndex = lineEl ? lineEls.indexOf(lineEl) : -1;
    if (lineIndex < 0) {
      // The caret sits in a node that is a DIRECT child of the editor but not an
      // element we indexed (e.g. a bare text node the browser left, common on
      // mobile). Count characters up to it via raw child nodes so we never
      // collapse the caret to offset 0 (the historic caret-jump-to-top bug).
      const kids = Array.from(app.elements.editorContent.childNodes);
      let node = container;
      while (node && node.parentNode !== app.elements.editorContent) node = node.parentNode;
      const idx = node ? kids.indexOf(node) : -1;
      if (idx < 0) return 0;
      let offset = 0;
      for (let i = 0; i < idx; i += 1) offset += (kids[i].textContent?.length ?? 0) + 1;
      return offset + getOffsetWithinTextRoot(node, container, domOffset);
    }

    // Characters contributed by all preceding lines + their newlines.
    let offset = 0;
    for (let i = 0; i < lineIndex; i += 1) {
      offset += lineEls[i].textContent.length + 1;
    }
    // Then the in-line character offset using the existing tree-walker helper.
    offset += getOffsetWithinTextRoot(lineEl, container, domOffset);
    return offset;
  }

  /** Return the current editor selection as integer plain-text {start, end}. */
  function getEditorSelection() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    if (!app.elements.editorContent.contains(range.startContainer)) return { start: 0, end: 0 };
    const start = domPositionToTextOffset(range.startContainer, range.startOffset);
    const end = range.collapsed
      ? start
      : domPositionToTextOffset(range.endContainer, range.endOffset);
    return { start, end };
  }

  /** Move the browser selection to cover [start, end] in the editor plain text. */
  function setEditorSelection(start, end) {
    if (!app.elements.editorContent.isConnected) return;
    // Only ever move the caret when the editor is the focused element. Adding a
    // Range inside a contenteditable otherwise *steals* focus into it (and lands
    // the caret at offset 0). That bites preview-driven updates: e.g. committing a
    // paste in the .bmap preview re-renders the source here, and without this guard
    // focus would jump to the editor with the caret on the leading "." of the first
    // ".node{}" — so the next Delete would eat that "." and break the file grammar.
    // Every legitimate caller (typing, IME, toolbar, drag) focuses the editor first.
    if (document.activeElement !== app.elements.editorContent) {
      app.logDebug("response", "caret", `setEditorSelection SKIPPED (editor not focused; active=${document.activeElement?.id || document.activeElement?.tagName || "none"}) → caret left at DOM default`);
      return;
    }
    try {
      const startPos = textOffsetToDomPosition(start);
      const endPos = start === end ? startPos : textOffsetToDomPosition(end);
      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {
      // Ignore rare out-of-bound errors (e.g. during rapid file switches).
    }
  }

  /** Re-render the syntax-highlighted DOM from plain text, then restore the
   *  given selection.  All programmatic edits go through this. */
  function applyEditorRender(text, selStart, selEnd) {
    app._editorUpdating = true;
    try {
      // renderEditorContent replaces innerHTML, which resets scrollTop to 0. Save
      // and restore it so an in-place edit (e.g. backspacing one char mid-document)
      // doesn't jump the view. caretIntoView() below then only nudges the scroll
      // when the edit actually pushed the caret out of the viewport.
      const savedScroll = app.elements.editorContent.scrollTop;
      renderEditorContent(text);
      // Setting innerHTML can cause the contenteditable to lose focus in some
      // browsers.  Restore focus explicitly so that the subsequent
      // notifyEditorChanged → updateStatus call still sees the editor as the
      // active element and does not reset the cursor via loadEditorContent.
      if (document.activeElement !== app.elements.editorContent) {
        app.elements.editorContent.focus({ preventScroll: true });
      }
      setEditorSelection(selStart, selEnd);
      app.rememberEditorSelection();
      // Diagnostic: verify the caret actually landed where we asked. When it
      // doesn't (the "jump to line 1 / offset 0" bug), capture WHY — the resolved
      // DOM position, the DOM text length vs the model, and the line count — so we
      // can tell a textOffsetToDomPosition miscalc from a model/DOM drift.
      const _after = getEditorSelection();
      if (_after.start !== selStart || _after.end !== selEnd) {
        const _pos = textOffsetToDomPosition(selStart);
        const _domLen = getEditorText().length;
        app.logDebug("response", "caret",
          `IMMEDIATE miss: wanted ${selStart}-${selEnd} landed ${_after.start}-${_after.end}; `
          + `modelLen=${text.length} domLen=${_domLen} lines=${editorLineEls().length} `
          + `resolved=${_pos.node?.nodeName || "?"}@${_pos.offset} active=${document.activeElement?.id || document.activeElement?.tagName}`);
      } else if (selStart > 0) {
        // Placement was correct — watch briefly for an ASYNC reset to 0 (e.g. a
        // sync-confirmation render landing a beat later).
        setTimeout(() => {
          if (document.activeElement !== app.elements.editorContent) return;
          const now = getEditorSelection();
          if (now.start === 0 && now.end === 0) {
            app.logDebug("response", "caret", `ASYNC reset: caret was ${selStart}, now 0 (~60ms after edit); domLen=${getEditorText().length} lines=${editorLineEls().length}`);
          }
        }, 60);
      }
      app.elements.editorContent.scrollTop = savedScroll;
      syncEditorScroll();
      caretIntoView();
    } finally {
      app._editorUpdating = false;
    }
  }

  /** Push a history snapshot.  Call at logical "checkpoints" (space, enter,
   *  punctuation, paste, indent, drag-drop). */
  // The single changed span between two texts: common prefix and suffix trimmed.
  function diffEditorTexts(before, after) {
    const max = Math.min(before.length, after.length);
    let at = 0;
    while (at < max && before.charCodeAt(at) === after.charCodeAt(at)) at += 1;
    let tail = 0;
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
    const text = getEditorText();
    const { start, end } = getEditorSelection();
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
    applyEditorRender(text, state.start, state.end);
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
    applyEditorRender(text, state.start, state.end);
    notifyEditorChanged(text);
    app.traceEditorEvent("Redo applied", { restored: `${state.start}-${state.end}` });
  }

  /** Apply a programmatic text change (autocomplete, indent, drag-drop, etc.)
   *  Pushes a history checkpoint, performs the edit, and fires the content
   *  update callback so the domain model stays in sync. */
  function applyEditorEdit(newText, newStart, newEnd) {
    pushEditorHistoryCheckpoint(); // snapshot BEFORE the edit
    applyEditorRender(newText, newStart, newEnd);
    pushEditorHistoryState(newText, newStart, newEnd); // snapshot AFTER the edit
    notifyEditorChanged(newText);
  }

  /** Load a file's content into the editor, resetting undo history.
   *  Does NOT notify the domain model — used exclusively by updateStatus
   *  when the active file changes so we don't trigger a render feedback loop. */
  function loadEditorContent(text, start = 0, end = start) {
    const selection = resetEditorHistory(text, start, end);
    pendingExternalEditorSelection = null;
    app.hideEditorAutocomplete();
    renderEditorContent(text);
    setEditorSelection(selection.start, selection.end);
  }

  /** Convenience: replace a [start, end) range in the current editor text. */
  function replaceEditorRange(start, end, insertText, nextStart = null, nextEnd = null) {
    const value = getEditorText();
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
    const selectedEntry = app.getSelectedUrlDbEntry(app.controller.getProject());
    let nextContent = text;
    if (selectedEntry) {
      const parsed = parseUrlDbEntryBody(text);
      nextContent = updateUrlDbEntry(activeFile.content, selectedEntry.entry.id, parsed);
    }
    // The editor DOM already shows this text (every caller renders or reads it
    // first), so the app-wide render this triggers can catch up a moment later
    // instead of running synchronously inside the keystroke. See render().
    app.typingUpdate = true;
    try {
      app.controller.updateContent(activeFile.id, nextContent);
    } finally {
      app.typingUpdate = false;
    }
    if (app.collaboration.isConnected() && app.workspaceMode === "synced") {
      app.collaboration.scheduleTextPatch(getPath(app.controller.getProject(), activeFile.id), activeFile.content, nextContent);
    }
    // Keep find matches/highlights accurate as the text changes underneath them.
    if (app.searchState.open) app.computeSearchMatches();
    // Line comments follow the text: re-find any whose line moved.
    app.scheduleCommentReanchor();
  }

  // Stable palette for coloring remote cursor lines + labels by client index.
  const CURSOR_COLORS = ["#e06c75", "#61afef", "#98c379", "#e5c07b", "#c678dd", "#56b6c2", "#d19a66"];

  function clientColor(clientId) {
    let hash = 0;
    for (let i = 0; i < clientId.length; i++) {
      hash = (hash * 31 + clientId.charCodeAt(i)) >>> 0;
    }
    return CURSOR_COLORS[hash % CURSOR_COLORS.length];
  }

  /** Render remote peer cursor overlays inside #editor-cursors.
   *  `cursors` is an array of { clientId, displayName, fileId, selStart, selEnd }.
   *  Only cursors for the currently active file are shown.
   *  When selEnd > selStart a per-line selection highlight is drawn in addition
   *  to the caret so peers can see highlighted text. */
  function renderRemoteCursors(cursors) {
    scheduleOverviewRuler(); // peer markers live on the ruler too
    const activeFile = app.controller.getActiveFile();
    const container = app.elements.editorCursors;
    container.textContent = "";
    if (!activeFile) return;

    // Match peers by PATH, not node id: the server generates its own node ids on
    // create-file/-folder, so the creating client and everyone else hold DIFFERENT
    // ids for the same file. Paths are stable across sessions (content sync already
    // uses them), so a path match is what actually lines cursors up.
    const activePath = getPath(app.controller.getProject(), activeFile.id);
    const scrollEl = app.elements.editorScroll;
    const scrollRect = app.elements.editorScroll.getBoundingClientRect();

    for (const cursor of cursors) {
      if (cursor.fileId !== activePath) continue;
      const color = clientColor(cursor.clientId);
      const selStart = Number(cursor.selStart);
      const selEnd = Number(cursor.selEnd);
      const hasSelection = selEnd > selStart;

      try {
        // --- Draw selection highlight (one rect per visual line) ---
        if (hasSelection) {
          const startPos = textOffsetToDomPosition(selStart);
          const endPos = textOffsetToDomPosition(selEnd);
          const selRange = document.createRange();
          selRange.setStart(startPos.node, startPos.offset);
          selRange.setEnd(endPos.node, endPos.offset);
          // getClientRects() on a range spanning block-level .editor-line divs
          // returns BOTH the block line-box and the inline text-box for the same
          // span. Drawing both (each at opacity 0.25) stacks into a visibly doubled
          // highlight. Keep the tighter rects and drop any that substantially
          // overlap one already kept — a genuine multi-line selection has one
          // non-overlapping rect per line.
          const rawRects = Array.from(selRange.getClientRects())
            .filter((r) => r.width > 0 && r.height > 0)
            .sort((a, b) => a.width * a.height - b.width * b.height); // tighter first
          const keptRects = [];
          for (const rect of rawRects) {
            const overlapsKept = keptRects.some((k) => {
              const ix = Math.min(k.right, rect.right) - Math.max(k.left, rect.left);
              const iy = Math.min(k.bottom, rect.bottom) - Math.max(k.top, rect.top);
              if (ix <= 0 || iy <= 0) return false;
              const minArea = Math.min(k.width * k.height, rect.width * rect.height) || 1;
              return ix * iy > 0.5 * minArea;
            });
            if (overlapsKept) continue;
            keptRects.push(rect);
            // An empty line yields the full-width block box (no inline text box).
            // The source shows the native empty-line selection as a small sliver —
            // match it by clamping to a space width when the line has no content.
            let width = rect.width;
            const probe = document.elementFromPoint(rect.left + 2, (rect.top + rect.bottom) / 2);
            const probeLine = probe?.closest?.(".editor-line");
            if (probeLine && (probeLine.textContent ?? "").length === 0) {
              width = getEditorSpaceWidth();
            }
            const highlightEl = document.createElement("div");
            highlightEl.className = "remote-selection";
            highlightEl.style.top = `${rect.top - scrollRect.top + scrollEl.scrollTop}px`;
            highlightEl.style.left = `${rect.left - scrollRect.left + scrollEl.scrollLeft}px`;
            highlightEl.style.width = `${width}px`;
            highlightEl.style.height = `${rect.height}px`;
            highlightEl.style.background = color;
            container.appendChild(highlightEl);
          }
        }

        // --- Draw caret at the end (anchor) of the selection ---
        const caretOffset = selEnd;
        const pos = textOffsetToDomPosition(caretOffset);
        const anchorRange = document.createRange();
        anchorRange.setStart(pos.node, pos.offset);
        anchorRange.collapse(true);
        // A collapsed range's getBoundingClientRect() is EMPTY (all zeros) at a line
        // start / empty line in Chrome — which planted the caret off-screen at
        // negative coords, so no remote caret was ever visible. Prefer getClientRects
        // and fall back to the hosting line box.
        let rect = anchorRange.getClientRects()[0] || anchorRange.getBoundingClientRect();
        if (!rect || (!rect.height && !rect.width && !rect.top && !rect.left)) {
          const anchorEl = pos.node.nodeType === Node.ELEMENT_NODE ? pos.node : pos.node.parentElement;
          const lineEl = anchorEl?.closest?.(".editor-line");
          if (lineEl) rect = lineEl.getBoundingClientRect();
        }
        if (!rect) continue;

        const top = rect.top - scrollRect.top + scrollEl.scrollTop;
        const left = rect.left - scrollRect.left + scrollEl.scrollLeft;
        const height = rect.height || getEditorLineHeight();

        const cursorEl = document.createElement("div");
        cursorEl.className = "remote-cursor";
        cursorEl.style.top = `${top}px`;
        cursorEl.style.left = `${left}px`;
        cursorEl.style.height = `${height}px`;
        cursorEl.style.background = color;

        const label = document.createElement("div");
        label.className = "remote-cursor-label";
        label.style.background = color;
        label.textContent = cursor.displayName || cursor.clientId;
        cursorEl.appendChild(label);

        container.appendChild(cursorEl);
      } catch (err) {
        // Surface (throttled) instead of silently swallowing — this is how a
        // remote caret can vanish without a trace.
        logCursorDebug(`caret render error: ${err?.message || err}`);
      }
    }
  }


  // ---- Editor overview ruler ---------------------------------------------------
  // Markers down the right edge showing every point of interest in the document,
  // the way VS Code decorates its scrollbar: your own caret, line comments,
  // collaborators' carets and the ranges they have selected (in each peer's own
  // colour, matching their cursor), and current search hits. Clicking a marker
  // jumps there, so finding "where is my stuff" never means scrolling blindly.

  /** Which line a text offset falls on (0-based). */
  // Counting with indexOf rather than text[i]: indexing a CJK string allocates a
  // one-character string per position, tens of thousands per call, per marker.
  function lineIndexForOffset(text, offset) {
    const capped = Math.max(0, Math.min(Number(offset) || 0, text.length));
    let line = 0;
    for (let at = text.indexOf("\n"); at !== -1 && at < capped; at = text.indexOf("\n", at + 1)) line += 1;
    return line;
  }

  /** Vertical position of a line inside the scrollable content, in px. */
  function editorLineTop(lineIndex) {
    const lines = app.elements.editorContent.children; // not a fresh array per marker
    if (!lines.length) return 0;
    const el = lines[Math.max(0, Math.min(lineIndex, lines.length - 1))];
    return el ? el.offsetTop : 0;
  }

  let overviewRulerFrame = 0;
  function scheduleOverviewRuler() {
    if (overviewRulerFrame) return;
    overviewRulerFrame = requestAnimationFrame(() => {
      overviewRulerFrame = 0;
      renderOverviewRuler();
    });
  }

  function renderOverviewRuler() {
    const ruler = app.elements.editorOverviewRuler;
    const content = app.elements.editorContent;
    if (!ruler || !content) return;
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      ruler.replaceChildren();
      ruler.hidden = true;
      return;
    }
    ruler.hidden = false;

    const contentHeight = content.scrollHeight || 1;
    const rulerHeight = ruler.clientHeight || content.clientHeight || 1;
    const text = getEditorText();
    const ticks = [];

    const add = ({ line, endLine = null, color = null, className, title }) => {
      const top = (editorLineTop(line) / contentHeight) * rulerHeight;
      let height = 3;
      if (endLine != null && endLine > line) {
        const bottom = (editorLineTop(endLine) / contentHeight) * rulerHeight;
        height = Math.max(3, bottom - top);
      }
      ticks.push({ top, height, color, className, title, line });
    };

    // Collaborators' selections first, so their caret marks sit on top of them.
    const activePath = getPath(app.controller.getProject(), activeFile.id);
    for (const cursor of app.remoteCursorsByClient.values()) {
      if (cursor.fileId !== activePath) continue;
      const color = clientColor(cursor.clientId);
      const who = cursor.displayName || "A collaborator";
      const startLine = lineIndexForOffset(text, cursor.selStart);
      const endLine = lineIndexForOffset(text, cursor.selEnd);
      if (Number(cursor.selEnd) > Number(cursor.selStart)) {
        add({ line: startLine, endLine, color, className: "editor-overview-tick is-peer-selection",
              title: `${who} — selection` });
      }
      add({ line: startLine, color, className: "editor-overview-tick is-peer",
            title: `${who} — line ${startLine + 1}` });
    }

    // Search hits.
    if (app.searchState.open) {
      for (const match of app.searchState.matches) {
        add({ line: lineIndexForOffset(text, match.start), className: "editor-overview-tick is-search",
              title: "Search match" });
      }
    }

    // Line comments.
    for (const comment of app.commentsForActiveFile()) {
      add({ line: comment.line, className: "editor-overview-tick is-comment",
            title: `${comment.author ?? "Comment"}: ${comment.text}` });
    }

    // My own caret last so it is never hidden behind another marker.
    if (app.elements.editorContent === document.activeElement) {
      const { start } = getEditorSelection();
      add({ line: lineIndexForOffset(text, start), className: "editor-overview-tick is-caret",
            title: "Your cursor" });
    }

    ruler.replaceChildren(...ticks.map((tick) => {
      const el = document.createElement("div");
      el.className = tick.className;
      el.style.top = `${Math.max(0, tick.top)}px`;
      el.style.height = `${tick.height}px`;
      if (tick.color) el.style.background = tick.color;
      el.title = tick.title;
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        // Centre that line in the viewport.
        const target = editorLineTop(tick.line) - (content.clientHeight / 2);
        content.scrollTop = Math.max(0, target);
        syncEditorScroll();
        scheduleOverviewRuler();
      });
      return el;
    }));
  }

  // Throttled diagnostic (shows in the Log panel) so cursor delivery/rendering can
  // be confirmed without flooding.
  let _lastCursorLog = 0;
  function logCursorDebug(message) {
    const now = Date.now();
    if (now - _lastCursorLog < 1500) return;
    _lastCursorLog = now;
    app.logDebug("response", "Remote cursor", message);
  }

  function onRemoteCursor(event) {
    if (!event.clientId) return;
    app.remoteCursorsByClient.set(event.clientId, event);
    renderRemoteCursors(Array.from(app.remoteCursorsByClient.values()));
  }

  // Drop cached cursors for peers that are no longer present — otherwise a
  // disconnected peer's caret/selection lingers on screen (e.g. a stale red cursor
  // left over after that collaborator left). Reconciled against the presence list,
  // which the server updates on join/leave.
  function pruneRemoteCursors(presence) {
    const alive = new Set((presence ?? []).map((p) => p.clientId).filter(Boolean));
    let changed = false;
    for (const clientId of Array.from(app.remoteCursorsByClient.keys())) {
      if (!alive.has(clientId)) {
        app.remoteCursorsByClient.delete(clientId);
        changed = true;
      }
    }
    if (changed) renderRemoteCursors(Array.from(app.remoteCursorsByClient.values()));
  }

  // Remote carets/highlights are positioned from each peer's viewport rect against
  // the (overflow:hidden) editor frame, so when THIS user scrolls #editor-content
  // the overlay must be recomputed or it stays pinned to the old screen position.
  // rAF-coalesced so fast scrolling re-renders at most once per frame.
  let _remoteCursorRaf = 0;
  function scheduleRemoteCursorRender() {
    if (_remoteCursorRaf) return;
    _remoteCursorRaf = requestAnimationFrame(() => {
      _remoteCursorRaf = 0;
      if (app.remoteCursorsByClient.size) {
        renderRemoteCursors(Array.from(app.remoteCursorsByClient.values()));
      }
    });
  }

  // Broadcast local selection to peers on selectionchange (debounced).
  // Note: this listener is registered after `collaboration` is created (see below).
  let _selectionChangeListenerAttached = false;
  function attachSelectionChangeListener() {
    if (_selectionChangeListenerAttached) return;
    _selectionChangeListenerAttached = true;
    // On touch devices, tapping another control can clear the DOM selection before
    // its click handler switches files. Save it at pointer-down, while the editor
    // still owns the range. The selectionchange event may arrive too late (or not
    // at all when the browser puts the tab to sleep).
    document.addEventListener("pointerdown", (event) => {
      if (!app.elements.editorContent.contains(event.target)) app.rememberEditorSelection();
    }, true);
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === app.elements.editorContent && !app._editorUpdating && !app.editorIsComposing) app.rememberEditorSelection();
      if (!app.collaboration.isConnected()) return;
      const activeFile = app.controller.getActiveFile();
      if (!activeFile) return;
      const sel = getEditorSelection();
      // Suppress cursor broadcast while a text patch is pending for this file —
      // peers would see a stale position (before the text arrives).  The cursor
      // is sent automatically once the patch is confirmed by the server.
      const path = getPath(app.controller.getProject(), activeFile.id);
      if (app.collaboration.hasPendingPatch(path)) return;
      // Broadcast the PATH as the file identifier so peers (who may hold a different
      // node id for the same file) can match it — see renderRemoteCursors.
      app.collaboration.scheduleAwareness(path, sel.start, sel.end);
    });
  }

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
    const { start, end } = getEditorSelection();
    const text = getEditorText();
    const selected = text.slice(start, end) || placeholder;
    const inserted = `${before}${selected}${after}`;
    const innerStart = start + before.length;
    replaceEditorRange(start, end, inserted, innerStart, innerStart + selected.length);
  }

  /** Prefix every line touched by the selection (line-oriented markdown like
   *  headings, lists, quotes). `numbered` increments the prefix per line. */
  function prefixEditorLines(prefix, numbered = false) {
    const { start, end } = getEditorSelection();
    const text = getEditorText();
    const blockStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let blockEnd = text.indexOf("\n", end);
    if (blockEnd === -1) blockEnd = text.length;
    const lines = text.slice(blockStart, blockEnd).split("\n");
    const newBlock = lines
      .map((line, index) => `${numbered ? `${index + 1}. ` : prefix}${line}`)
      .join("\n");
    replaceEditorRange(blockStart, blockEnd, newBlock, blockStart, blockStart + newBlock.length);
  }

  /** Insert a multi-line block snippet on its own line(s). `caretOffset` (if set)
   *  places the caret at that offset within the inserted snippet. */
  function insertEditorBlock(snippet, caretOffset = null) {
    const { start, end } = getEditorSelection();
    const text = getEditorText();
    const atLineStart = start === 0 || text[start - 1] === "\n";
    const lead = atLineStart ? "" : "\n";
    const inserted = `${lead}${snippet}`;
    const caret = caretOffset === null
      ? start + inserted.length
      : start + lead.length + caretOffset;
    replaceEditorRange(start, end, inserted, caret, caret);
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
    const { start } = getEditorSelection();
    const value = getEditorText();
    const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    let lineEnd = value.indexOf("\n", start);
    if (lineEnd === -1) lineEnd = value.length;
    const currentLine = value.slice(lineStart, lineEnd);
    const childIndent = "\t".repeat(getMtreeIndentLevel(currentLine) + 1);
    const inserted = `\n${childIndent}${text}`;
    const caret = lineEnd + inserted.length;
    replaceEditorRange(lineEnd, lineEnd, inserted, caret, caret);
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


  function getEditorLineHeight() {
    const lineHeight = Number.parseFloat(globalThis.getComputedStyle(app.elements.editorContent).lineHeight);
    return Number.isFinite(lineHeight) ? lineHeight : 20.8;
  }

  // Width of a single space in the editor font — used to render a remote selection
  // on an EMPTY line as a small sliver (matching the browser's native empty-line
  // selection on the source), instead of the full-width block box getClientRects
  // hands back for a contentless line. Cached per font string.
  let _editorSpaceWidthCache = null;
  function getEditorSpaceWidth() {
    const cs = globalThis.getComputedStyle(app.elements.editorContent);
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (_editorSpaceWidthCache && _editorSpaceWidthCache.font === font) return _editorSpaceWidthCache.width;
    const canvas = _editorSpaceWidthCache?.canvas || document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    const width = ctx.measureText(" ").width || Number.parseFloat(cs.fontSize) * 0.3 || 4;
    _editorSpaceWidthCache = { font, width, canvas };
    return width;
  }

  function getLeadingIndentColumns(line) {
    let columns = 0;
    for (const character of line) {
      if (character === "\t") {
        columns += getIndentColumnWidth();
        continue;
      }
      if (character === " ") {
        columns += 1;
        continue;
      }
      break;
    }
    return columns;
  }

  function getOffsetWithinTextRoot(root, container, offset) {
    if (!root) {
      return 0;
    }

    if (container.nodeType === Node.TEXT_NODE) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let total = 0;
      while (walker.nextNode()) {
        const current = walker.currentNode;
        if (current === container) {
          return total + Math.min(offset, current.textContent?.length ?? 0);
        }
        total += current.textContent?.length ?? 0;
      }
      return total;
    }

    const childNodes = Array.from(container.childNodes).slice(0, offset);
    return childNodes.reduce((total, child) => total + (child.textContent?.length ?? 0), 0);
  }

  function getEditorTextOffsetFromPoint(clientX, clientY) {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      return getEditorSelection().start;
    }
    const caretRange = document.caretRangeFromPoint?.(clientX, clientY);
    const caretPosition = document.caretPositionFromPoint?.(clientX, clientY);
    const container = caretRange?.startContainer ?? caretPosition?.offsetNode;
    const posOffset = caretRange?.startOffset ?? caretPosition?.offset;
    if (!container) {
      return getEditorSelection().start;
    }
    return domPositionToTextOffset(container, posOffset ?? 0);
  }

  function clearEditorDropCaret() {
    app.editorDragState.dropOffset = null;
    app.elements.editorDropCaret.hidden = true;
  }

  function showEditorDropCaret(clientX, clientY) {
    const offset = getEditorTextOffsetFromPoint(clientX, clientY);
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
    const height = rect.height || getEditorLineHeight();
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

  // Fold the per-line wrap indent and agent decoration into the line's own HTML,
  // so a line's HTML is a pure function of its content and can be compared.
  function decorateEditorLineHtml(html, rawLine, decorated) {
    const indentCols = getLeadingIndentColumns(rawLine ?? "");
    if (!indentCols && !decorated) return html;
    const classes = `editor-line${indentCols > 0 ? " has-wrapped-indent" : ""}${decorated ? " is-agent-pending" : ""}`;
    const style = indentCols > 0 ? ` style="--wrapped-indent-columns:${indentCols}"` : "";
    return html.replace('<div class="editor-line"', `<div class="${classes}"${style}`);
  }

  // Empty lines need a <br> to render at full height and accept a caret.
  function normalizeEditorLineElement(line) {
    if (line.childNodes.length === 0 ||
        (line.childNodes.length === 1 &&
         line.firstChild?.nodeName !== "BR" &&
         line.firstChild?.textContent === "")) {
      line.innerHTML = "<br>";
    }
  }

  function parseEditorLines(htmlList) {
    const tpl = document.createElement("template");
    tpl.innerHTML = htmlList.join("");
    const els = Array.from(tpl.content.children);
    els.forEach(normalizeEditorLineElement);
    return { fragment: tpl.content, els };
  }

  // Replace DOM lines [from, to) with freshly rendered lines for new indices
  // [from, from + count) and splice the cache to match. Returns the new elements.
  function spliceEditorLines(from, to, htmlSlice, textSlice) {
    const container = app.elements.editorContent;
    const before = container.children[to] ?? null;
    for (let i = to - 1; i >= from; i -= 1) container.children[i]?.remove();
    const { fragment, els } = parseEditorLines(htmlSlice);
    container.insertBefore(fragment, before);
    const cache = app.editorRenderCache;
    const removed = to - from;
    cache.els.splice(from, removed, ...els);
    // The DOM's own text for each new line (normally identical to the source).
    cache.texts.splice(from, removed, ...els.map((el, i) => {
      const actual = el.textContent;
      if (actual !== textSlice[i]) cache.textExact = false;
      return actual;
    }));
    cache.html.splice(from, removed, ...htmlSlice);
    cache.heights.splice(from, removed, ...els.map(() => null)); // measured below
    return els;
  }

  function renderEditorContent(text, { full = false } = {}) {
    refreshFormatToolbar();
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const activeFile = app.controller.getActiveFile();
    const kind = app.editorHighlightKind(activeFile?.name);

    const activeFilePath = activeFile ? getPath(app.controller.getProject(), activeFile.id) : null;
    const activeDecoration = activeFilePath ? app.agentPendingDecorations.get(activeFilePath) : null;
    const isDecorated = (index) => Boolean(activeDecoration)
      && index >= activeDecoration.lineStart && index <= activeDecoration.lineEnd;
    const lineHtml = app.highlightEditorLinesMemo(kind, lines).map((hit, index) => {
      if (isDecorated(index)) return decorateEditorLineHtml(hit.html, lines[index], true);
      if (hit.plain === null) hit.plain = decorateEditorLineHtml(hit.html, lines[index], false);
      return hit.plain;
    });

    const container = app.elements.editorContent;
    const cache = app.editorRenderCache;
    const tracker = trackEditorDom();
    const incremental = !full
      && cache.fileId === (activeFile?.id ?? null)
      && cache.kind === kind
      && cache.els.length > 0
      // Stray text nodes directly under the editor (some mobile edits) aren't
      // lines we can diff against; rebuild.
      && container.childNodes.length === container.children.length;

    if (incremental) {
      const dom = container.children;
      const domLen = dom.length;
      const cacheLen = cache.els.length;
      const newLen = lineHtml.length;
      // Unchanged leading lines: same element, untouched, same HTML.
      let prefix = 0;
      const maxPrefix = Math.min(domLen, cacheLen, newLen);
      while (prefix < maxPrefix
        && dom[prefix] === cache.els[prefix]
        && cache.html[prefix] === lineHtml[prefix]
        && !tracker.dirty.has(dom[prefix])) {
        prefix += 1;
      }
      // Unchanged trailing lines, matched from each end independently: a native
      // Enter can add an element the cache has never seen.
      let suffix = 0;
      const maxSuffix = Math.min(domLen, cacheLen, newLen) - prefix;
      while (suffix < maxSuffix) {
        const d = domLen - 1 - suffix;
        const c = cacheLen - 1 - suffix;
        const n = newLen - 1 - suffix;
        if (dom[d] === cache.els[c] && cache.html[c] === lineHtml[n] && !tracker.dirty.has(dom[d])) {
          suffix += 1;
        } else {
          break;
        }
      }
      // The cache must describe the same leading elements as the DOM for the
      // splice indices to line up; drop cache entries for DOM-only elements.
      const domEnd = domLen - suffix;
      const cacheEnd = cacheLen - suffix;
      if (domEnd - prefix !== cacheEnd - prefix) {
        // Native edits added/removed elements in the middle. Re-sync the cache's
        // middle section to the DOM's actual elements before splicing.
        const middle = Array.from(dom).slice(prefix, domEnd);
        cache.els.splice(prefix, cacheEnd - prefix, ...middle);
        cache.texts.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
        cache.html.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
        cache.heights.splice(prefix, cacheEnd - prefix, ...middle.map(() => null));
      }
      spliceEditorLines(prefix, domEnd, lineHtml.slice(prefix, newLen - suffix), lines.slice(prefix, newLen - suffix));
      // Safety net: if the DOM and the text disagree on the line count, the diff
      // assumptions failed somewhere — rebuild rather than show wrong text.
      if (container.children.length !== newLen) {
        return renderEditorContent(text, { full: true });
      }
    } else {
      container.innerHTML = lineHtml.join("");
      const els = Array.from(container.children);
      els.forEach(normalizeEditorLineElement);
      cache.fileId = activeFile?.id ?? null;
      cache.kind = kind;
      cache.els = els;
      cache.texts = els.map((el) => el.textContent);
      cache.textExact = cache.texts.length === lines.length && cache.texts.every((t, i) => t === lines[i]);
      cache.html = lineHtml.slice(0, els.length);
      cache.heights = els.map(() => null);
      cache.gutter = [];
      cache.metricsKey = "";
    }

    // Gutter heights. Reading geometry forces layout, but after an incremental
    // splice only the replaced lines are dirty, so it is cheap; and only lines
    // without a cached height are measured. A width change invalidates them all.
    const metrics = globalThis.getComputedStyle(container);
    const parsedLineHeight = Number.parseFloat(metrics.lineHeight);
    const minimumLineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 20.8;
    const metricsKey = `${container.clientWidth}|${metrics.lineHeight}|${metrics.fontSize}|${metrics.fontFamily}|${app.elements.app.dataset.wordWrap ?? ""}`;
    if (metricsKey !== cache.metricsKey) {
      cache.heights = cache.els.map(() => null);
      cache.metricsKey = metricsKey;
    }
    const heights = cache.heights;
    const remeasured = [];
    for (let i = 0; i < cache.els.length; i += 1) {
      if (heights[i] == null) {
        heights[i] = Math.max(minimumLineHeight, cache.els[i].getBoundingClientRect().height);
        remeasured.push(i);
      }
    }

    // Gutter rows, diffed the same way. The gutter is entirely ours (no native
    // edits), so plain index comparison is enough. A line-count change shifts the
    // numbers of every following row, which then re-render — rare (Enter/paste).
    const comments = app.commentsForActiveFile();
    const commentByLine = new Map(comments.map((comment) => [comment.line, comment]));
    // Row strings depend on the row index, its height, comments and the agent
    // range. A changed line count renumbers every following row, so rebuild all;
    // otherwise only rows that were just (re)measured can differ.
    const gutterEpoch = `${cache.els.length}|${activeDecoration ? `${activeDecoration.lineStart}-${activeDecoration.lineEnd}` : ""}|${comments.map((c) => `${c.line}:${c.author ?? ""}:${c.text}`).join("\u0001")}`;
    const gutterRow = (index) => {
      const decorated = isDecorated(index);
      const marker = decorated ? `<span class="editor-gutter-agent-mark" aria-hidden="true">◦</span>` : "";
      const comment = commentByLine.get(index);
      const commentMark = comment
        ? `<span class="editor-gutter-comment-mark" title="${app.escapeHtmlAttribute(`${comment.author ?? ""}: ${comment.text}`.trim())}" aria-hidden="true">●</span>`
        : "";
      return `<div class="editor-gutter-line${decorated ? " is-agent-pending" : ""}${comment ? " has-comment" : ""}" data-line="${index}" style="height:${heights[index].toFixed(3)}px">${marker}${commentMark}${index + 1}</div>`;
    };
    let gutterHtml;
    if (gutterEpoch !== cache.gutterEpoch || cache.gutter.length !== cache.els.length) {
      gutterHtml = cache.els.map((_, index) => gutterRow(index));
    } else {
      gutterHtml = cache.gutter.slice();
      for (const index of remeasured) gutterHtml[index] = gutterRow(index);
    }
    cache.gutterEpoch = gutterEpoch;
    let gutterContent = app.elements.editorGutter.firstElementChild;
    if (!gutterContent || !gutterContent.classList.contains("editor-gutter-content")
        || gutterContent.children.length !== cache.gutter.length) {
      app.elements.editorGutter.innerHTML = `<div class="editor-gutter-content">${gutterHtml.join("")}</div>`;
    } else {
      const rows = gutterContent.children;
      const oldLen = cache.gutter.length;
      const newLen = gutterHtml.length;
      let gp = 0;
      while (gp < oldLen && gp < newLen && cache.gutter[gp] === gutterHtml[gp]) gp += 1;
      let gs = 0;
      while (gs < oldLen - gp && gs < newLen - gp && cache.gutter[oldLen - 1 - gs] === gutterHtml[newLen - 1 - gs]) gs += 1;
      const before = rows[oldLen - gs] ?? null;
      for (let i = oldLen - gs - 1; i >= gp; i -= 1) rows[i].remove();
      if (newLen - gs > gp) {
        const tpl = document.createElement("template");
        tpl.innerHTML = gutterHtml.slice(gp, newLen - gs).join("");
        gutterContent.insertBefore(tpl.content, before);
      }
    }
    cache.gutter = gutterHtml;
    scheduleOverviewRuler(); // line geometry just changed

    // Sync gutter scroll position.
    syncEditorScroll();

    // Keep placeholder visible when content is empty.
    container.dataset.empty = normalized.length === 0 ? "true" : "false";

    // The DOM now matches the cache; reads can use it until the next mutation.
    markEditorDomSynced(cache.textExact ? normalized : null);

    // Update the floating in-editor agent action bar.
    app.updateEditorAgentBar();
  }

  function syncEditorScroll() {
    const scrollTop = app.elements.editorContent.scrollTop;
    const gutterContent = app.elements.editorGutter.firstElementChild;
    if (gutterContent) {
      gutterContent.style.transform = `translateY(${-scrollTop}px)`;
    }
  }

  // Keep the caret visible while typing. The per-keystroke innerHTML rebuild +
  // focus({preventScroll:true}) suppresses the browser's native "scroll caret into
  // view", so after Enter/typing the caret can sit below the fold. This re-adds it
  // but as a NO-OP whenever the caret is already visible, so it never fights
  // mouse-driven scrolling. The real scroller is #editor-content (not #editor-scroll,
  // which is overflow:hidden).
  function caretIntoView(margin = getEditorLineHeight()) {
    if (document.activeElement !== app.elements.editorContent) return;
    const sel = globalThis.getSelection?.();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0).cloneRange();
    if (!app.elements.editorContent.contains(range.startContainer)) return;
    range.collapse(false); // track the focus/end offset — where the caret lands after the edit
    let caretRect = range.getClientRects()[0];
    if (!caretRect) {
      const b = range.getBoundingClientRect();
      if (b && (b.height || b.top)) caretRect = b;
    }
    if (!caretRect) {
      // Empty line: fall back to the line box (same pattern as the autocomplete positioner).
      const anchor = sel.focusNode;
      const el = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
      const lineEl = el?.closest?.(".editor-line");
      if (lineEl) caretRect = lineEl.getBoundingClientRect();
    }
    if (!caretRect) return;
    const view = app.elements.editorContent.getBoundingClientRect();
    const topLimit = view.top + margin;
    const bottomLimit = view.bottom - margin;
    let delta = 0;
    if (caretRect.bottom > bottomLimit) delta = caretRect.bottom - bottomLimit; // below → scroll down
    else if (caretRect.top < topLimit) delta = caretRect.top - topLimit;        // above → scroll up
    if (delta === 0) return; // already visible → leave the user's scroll position alone
    app.elements.editorContent.scrollTop += delta;
    syncEditorScroll();
  }

  function forwardEditorWheel(event) {
    const hasVertical = event.deltaY !== 0;
    const hasHorizontal = event.deltaX !== 0;
    if (!hasVertical && !hasHorizontal) {
      return;
    }
    app.elements.editorContent.scrollTop += event.deltaY;
    app.elements.editorContent.scrollLeft += event.deltaX;
    syncEditorScroll();
    event.preventDefault();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

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
    const value = getEditorText();
    const { start: selectionStart, end: selectionEnd } = getEditorSelection();
    const indentText = getIndentText();
    const { lineStart, lineEnd } = getLineSelectionRange(value, selectionStart, selectionEnd);
    const selectedText = value.slice(lineStart, lineEnd);
    const lines = selectedText.split("\n");

    if (direction > 0) {
      const nextLines = lines.map((line) => `${indentText}${line}`);
      const nextText = nextLines.join("\n");
      const nextSelectionStart = selectionStart + indentText.length;
      const nextSelectionEnd = selectionEnd + (indentText.length * lines.length);
      replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
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
    replaceEditorRange(lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
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
      replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
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
    replaceTextareaRange(textarea, lineStart, lineEnd, nextText, nextSelectionStart, nextSelectionEnd);
  }

  /** Insert an indent at the caret in the main contenteditable editor. */
  function insertIndentAtCursor() {
    const indentText = getIndentText();
    const { start, end } = getEditorSelection();
    app.traceEditorEvent("Tab indent before", { indent: app.formatEditorDebugValue(indentText) });
    replaceEditorRange(start, end, indentText, start + indentText.length, start + indentText.length);
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
    dispatchTextareaInput(textarea, selectionStart === selectionEnd ? "insertText" : "insertReplacementText");
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
      const { start, end } = getEditorSelection();
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
    // Find / Replace (Ctrl/Cmd+F, Ctrl/Cmd+H).
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "f") {
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
      editorUndo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === "y" || (event.shiftKey && event.key.toLowerCase() === "z"))) {
      event.preventDefault();
      editorRedo();
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
        applyToolbarAction({ kind: "wrap", before: "**", after: "**", placeholder: "bold text" });
        return;
      }
      if (key === "i" && isMarkdown) {
        event.preventDefault();
        applyToolbarAction({ kind: "wrap", before: "*", after: "*", placeholder: "italic text" });
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

  return {
    applyEditorEdit, applyEditorRender, attachSelectionChangeListener, caretIntoView, clamp,
    clampEditorSelection, clearEditorDropCaret, clientColor, consumeExternalEditorSelection,
    forwardEditorWheel, getEditorLineHeight, getEditorSelection, getEditorText,
    getEditorTextOffsetFromPoint, handleEditorKeydown, handleIndentKeydown, loadEditorContent,
    notifyEditorChanged, onRemoteCursor, pruneRemoteCursors, pushEditorHistoryState,
    queueExternalEditorSelection, refreshFormatToolbar, renderEditorContent, renderRemoteCursors,
    replaceEditorRange, resetEditorHistory, scheduleOverviewRuler, scheduleRemoteCursorRender,
    setEditorSelection, showEditorDropCaret, syncEditorScroll, textOffsetToDomPosition,
    transformEditorSelection
  };
}
