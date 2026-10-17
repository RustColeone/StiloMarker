// The editor's text and the contenteditable DOM: one line element per line,
// which lines changed behind our back (native typing, IME, mobile keyboards),
// and converting between text offsets and DOM positions (caret, selection).
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { isTextFileName } from "../../workspace/index.js";

export function installDom(ed, app) {
  // What has changed in the editor DOM since the last render (see
  // trackEditorDom). Lets text/caret reads use the render cache instead of
  // re-reading every line's textContent — each read allocated a fresh string.
  const editorDomTracker = {
    observer: null,
    dirty: new Set(),   // top-level lines whose content changed since the last render
    structural: false,  // lines were added/removed directly under the editor
    text: null          // getEditorText() result, valid until the next mutation
  };


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

  Object.assign(ed, { editorLineEls, trackEditorDom, noteEditorMutations, markEditorDomSynced, cleanLineIndex, getEditorText, findTextNodeAt, textOffsetToDomPosition, domPositionToTextOffset, getEditorSelection, setEditorSelection, getOffsetWithinTextRoot, getEditorTextOffsetFromPoint });
}
