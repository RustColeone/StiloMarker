// Other people in the file: their cursors and selections drawn over the
// editor, the overview ruler beside it, and where this tab's own caret is.
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { getPath, isTextFileName } from "../../workspace/index.js";
import { participantColor } from "../../identity/index.js";

export function installCursors(ed, app) {

  // A person's cursor has their colour (Identity's, the same as their dot and chip).
  const clientColor = participantColor;

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

    // Of a long file only part is in the page (editor-window.js): what lies
    // outside it is out of view, and not drawn.
    const shownText = ed.renderedRange();
    for (const cursor of cursors) {
      if (cursor.fileId !== activePath) continue;
      const color = clientColor(cursor.clientId);
      const selStart = Math.max(Number(cursor.selStart), shownText.start);
      const selEnd = Math.min(Number(cursor.selEnd), shownText.end);
      if (Number(cursor.selEnd) < shownText.start || Number(cursor.selStart) > shownText.end) continue;
      const hasSelection = selEnd > selStart;

      try {
        // --- Draw selection highlight (one rect per visual line) ---
        if (hasSelection) {
          const startPos = ed.textOffsetToDomPosition(selStart);
          const endPos = ed.textOffsetToDomPosition(selEnd);
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
              width = ed.getEditorSpaceWidth();
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
        const pos = ed.textOffsetToDomPosition(caretOffset);
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
        const height = rect.height || ed.getEditorLineHeight();

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

  /** Vertical position of a line inside the scrollable content, in px (a line
   *  not in the page: from the measured and estimated heights above it). */
  const editorLineTop = (lineIndex) => ed.lineTop(lineIndex);

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
    const text = ed.getEditorText();
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

    // Other modules' notes on lines (editor.lineNotes: comments).
    for (const note of app.lineNotesOf(app.controller.getActiveFile())) {
      add({ line: note.line, className: `editor-overview-tick is-${note.kind}`, title: note.title });
    }

    // My own caret last so it is never hidden behind another marker.
    if (app.elements.editorContent === document.activeElement) {
      const { start } = ed.getEditorSelection();
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
        ed.syncEditorScroll();
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
      if (document.activeElement === app.elements.editorContent && !ed.rendering && !app.editorIsComposing) app.rememberEditorSelection();
      const activeFile = app.controller.getActiveFile();
      if (!activeFile) return;
      const sel = ed.getEditorSelection();
      // My caret (Workspace's presence; Sync shows it to the others). By PATH,
      // since others may hold another node id for the same file.
      app.workspace.presence.setOwn({ path: getPath(app.controller.getProject(), activeFile.id), start: sel.start, end: sel.end });
    });
  }

  Object.assign(ed, { clientColor, renderRemoteCursors, lineIndexForOffset, editorLineTop, scheduleOverviewRuler, renderOverviewRuler, logCursorDebug, onRemoteCursor, pruneRemoteCursors, scheduleRemoteCursorRender, attachSelectionChangeListener });
}
