// Rendering the editor: the highlighted line HTML, incremental updates that
// touch only the lines that changed, scroll and caret visibility, and the
// measurements other parts need (line height, space width, indent columns).
// Installed on the editor object `ed` that the other parts share (see
// editor-core.js); calls into another part go through `ed`.
import { getPath } from "../../workspace/index.js";

export function installRender(ed, app) {

  /** Re-render the syntax-highlighted DOM from plain text, then restore the
   *  given selection.  All programmatic edits go through this. */
  // ed.rendering is true while applyEditorRender runs, so the synchronous
  // updateStatus callback triggered by notifyEditorChanged does not mistake a
  // transient focus state during innerHTML replacement for "editor lost focus".
  function applyEditorRender(text, selStart, selEnd) {
    ed.rendering = true;
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
      ed.setEditorSelection(selStart, selEnd);
      app.rememberEditorSelection();
      // Diagnostic: verify the caret actually landed where we asked. When it
      // doesn't (the "jump to line 1 / offset 0" bug), capture WHY — the resolved
      // DOM position, the DOM text length vs the model, and the line count — so we
      // can tell a textOffsetToDomPosition miscalc from a model/DOM drift.
      const _after = ed.getEditorSelection();
      if (_after.start !== selStart || _after.end !== selEnd) {
        const _pos = ed.textOffsetToDomPosition(selStart);
        const _domLen = ed.getEditorText().length;
        app.logDebug("response", "caret",
          `IMMEDIATE miss: wanted ${selStart}-${selEnd} landed ${_after.start}-${_after.end}; `
          + `modelLen=${text.length} domLen=${_domLen} lines=${ed.editorLineEls().length} `
          + `resolved=${_pos.node?.nodeName || "?"}@${_pos.offset} active=${document.activeElement?.id || document.activeElement?.tagName}`);
      } else if (selStart > 0) {
        // Placement was correct — watch briefly for an ASYNC reset to 0 (e.g. a
        // sync-confirmation render landing a beat later).
        setTimeout(() => {
          if (document.activeElement !== app.elements.editorContent) return;
          const now = ed.getEditorSelection();
          if (now.start === 0 && now.end === 0) {
            app.logDebug("response", "caret", `ASYNC reset: caret was ${selStart}, now 0 (~60ms after edit); domLen=${ed.getEditorText().length} lines=${ed.editorLineEls().length}`);
          }
        }, 60);
      }
      app.elements.editorContent.scrollTop = savedScroll;
      syncEditorScroll();
      caretIntoView();
    } finally {
      ed.rendering = false;
    }
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
        columns += ed.getIndentColumnWidth();
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
    ed.refreshFormatToolbar();
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
    const tracker = ed.trackEditorDom();
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
    ed.scheduleOverviewRuler(); // line geometry just changed

    // Sync gutter scroll position.
    syncEditorScroll();

    // Keep placeholder visible when content is empty.
    container.dataset.empty = normalized.length === 0 ? "true" : "false";

    // The DOM now matches the cache; reads can use it until the next mutation.
    ed.markEditorDomSynced(cache.textExact ? normalized : null);

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

  Object.assign(ed, { applyEditorRender, getEditorLineHeight, getEditorSpaceWidth, getLeadingIndentColumns, decorateEditorLineHtml, normalizeEditorLineElement, parseEditorLines, spliceEditorLines, renderEditorContent, syncEditorScroll, caretIntoView, forwardEditorWheel, clamp });
}
