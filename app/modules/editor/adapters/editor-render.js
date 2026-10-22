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
  // reveal: false keeps a selection out of view where it is (someone else's edit).
  function applyEditorRender(text, selStart, selEnd, { reveal = true } = {}) {
    ed.rendering = true;
    try {
      // renderEditorContent replaces innerHTML, which resets scrollTop to 0. Save
      // and restore it so an in-place edit (e.g. backspacing one char mid-document)
      // doesn't jump the view. caretIntoView() below then only nudges the scroll
      // when the edit actually pushed the caret out of the viewport.
      const savedScroll = app.elements.editorContent.scrollTop;
      // A write from elsewhere while something else has the keyboard (a
      // table's cell, the chat, a Replace button): drawn, and the keyboard stays
      // where it is (placing the caret here would take it).
      const active = document.activeElement;
      const elsewhere = Boolean(active) && active !== document.body && !app.elements.editorContent.contains(active);
      renderEditorContent(text, { keep: [lineAt(text, Math.min(selStart, selEnd)), lineAt(text, Math.max(selStart, selEnd))] });
      if (elsewhere) {
        ed.dropHeld?.();
        app.elements.editorContent.scrollTop = savedScroll;
        syncEditorScroll();
        return;
      }
      // Setting innerHTML can cause the contenteditable to lose focus in some
      // browsers.  Restore focus explicitly so that the subsequent
      // notifyEditorChanged → updateStatus call still sees the editor as the
      // active element and does not reset the cursor via loadEditorContent.
      if (document.activeElement !== app.elements.editorContent) {
        app.elements.editorContent.focus({ preventScroll: true });
      }
      ed.setEditorSelection(selStart, selEnd, { reveal });
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


  // The line an offset falls on in `text` (0-based).
  function lineAt(text, offset) {
    let line = 0;
    for (let at = text.indexOf("\n"); at !== -1 && at < offset; at = text.indexOf("\n", at + 1)) line += 1;
    return line;
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

  // Fold the per-line wrap indent and a mark (its kind) into the line's own HTML,
  // so a line's HTML is a pure function of its content and can be compared.
  function decorateEditorLineHtml(html, rawLine, markKind) {
    const indentCols = getLeadingIndentColumns(rawLine ?? "");
    if (!indentCols && !markKind) return html;
    const classes = `editor-line${indentCols > 0 ? " has-wrapped-indent" : ""}${markKind ? ` is-${markKind}` : ""}`;
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

  // Render the text: the whole file, or of a long one (editor-window.js) the
  // run of lines in view, [ws, we). Lines unchanged since the last render keep
  // their elements (and so the native caret and composition); the rest are
  // made from their HTML. `keep`: lines [a, b] to render with the view (the
  // selection's, when close enough).
  function renderEditorContent(text, { full = false, keep = null } = {}) {
    ed.refreshFormatToolbar();
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const activeFile = app.controller.getActiveFile();
    const kind = app.editorHighlightKind(activeFile?.name);

    const activeFilePath = activeFile ? getPath(app.controller.getProject(), activeFile.id) : null;
    // Another module's mark on this file (editor.marks): its lines are tinted.
    const activeDecoration = activeFilePath ? app.marks.get(activeFilePath) : null;
    const isDecorated = (index) => Boolean(activeDecoration)
      && index >= activeDecoration.lineStart && index <= activeDecoration.lineEnd;
    const container = app.elements.editorContent;
    const cache = app.editorRenderCache;
    const tracker = ed.trackEditorDom();
    const n = lines.length;
    const oldWs = cache.ws ?? 0;
    const oldEls = cache.els;
    // The page still holds exactly the elements last rendered (native edits
    // only changed text inside them): they can be kept.
    const incremental = !full
      && cache.fileId === (activeFile?.id ?? null)
      && cache.kind === kind
      && oldEls.length > 0
      && !tracker.structural
      && container.childNodes.length === oldEls.length
      && oldEls.every((el, k) => container.children[k] === el);

    // Lines unchanged at both ends (a line typed in and not yet drawn counts as changed).
    const oldN = cache.html.length;
    // (Collected once: usually none or one; asking for each line cost a long file ~15 ms a render.)
    const dirtyLines = new Set();
    for (const el of tracker.dirty) {
      const k = oldEls.indexOf(el);
      if (k >= 0) dirtyLines.add(oldWs + k);
    }
    const dirtyLine = dirtyLines.size ? (i) => dirtyLines.has(i) : () => false;
    let prefix = 0;
    let suffix = 0;
    let lineHtml;
    let fenceIn; // each line's starting state: inside a ``` fence (markdown) or not
    let fenceEnd = false;
    // Only some lines changed (and no mark tints this file's lines): the
    // others keep their HTML, and only the changed lines are highlighted, with
    // the lines after them until the fence state is again what it was. (Every
    // line went through the highlighter's memo on every render: ~30 ms a key
    // in a 450 KB file.)
    if (incremental && !activeDecoration && !cache.decorated && cache.textExact && cache.fenceIn?.length === oldN) {
      const most = Math.min(oldN, n);
      while (prefix < most && lines[prefix] === cache.texts[prefix] && !dirtyLine(prefix)) prefix += 1;
      while (suffix < most - prefix && lines[n - 1 - suffix] === cache.texts[oldN - 1 - suffix] && !dirtyLine(oldN - 1 - suffix)) suffix += 1;
      lineHtml = new Array(n);
      fenceIn = new Array(n);
      for (let i = 0; i < prefix; i += 1) { lineHtml[i] = cache.html[i]; fenceIn[i] = cache.fenceIn[i]; }
      let state = prefix < oldN ? cache.fenceIn[prefix] : cache.fenceEnd;
      let j = prefix;
      const unchangedFrom = n - suffix;
      while (j < n && !(j >= unchangedFrom && state === cache.fenceIn[j - n + oldN])) {
        const hit = app.highlightEditorLineMemo(kind, lines[j], state);
        if (hit.plain === null) hit.plain = decorateEditorLineHtml(hit.html, lines[j], null);
        lineHtml[j] = hit.plain;
        fenceIn[j] = state;
        state = hit.inFence;
        j += 1;
      }
      for (let i = j; i < n; i += 1) { lineHtml[i] = cache.html[i - n + oldN]; fenceIn[i] = cache.fenceIn[i - n + oldN]; }
      fenceEnd = j < n ? cache.fenceEnd : state;
      suffix = n - j; // lines highlighted again past the edit count as changed
    } else {
      const hits = app.highlightEditorLinesMemo(kind, lines);
      fenceIn = new Array(n);
      lineHtml = hits.map((hit, index) => {
        fenceIn[index] = index > 0 ? hits[index - 1].inFence : false;
        if (isDecorated(index)) return decorateEditorLineHtml(hit.html, lines[index], activeDecoration.kind);
        if (hit.plain === null) hit.plain = decorateEditorLineHtml(hit.html, lines[index], null);
        return hit.plain;
      });
      fenceEnd = hits.length ? hits[hits.length - 1].inFence : false;
      if (incremental) {
        const most = Math.min(oldN, n);
        while (prefix < most && cache.html[prefix] === lineHtml[prefix] && !dirtyLine(prefix)) prefix += 1;
        while (suffix < most - prefix && cache.html[oldN - 1 - suffix] === lineHtml[n - 1 - suffix] && !dirtyLine(oldN - 1 - suffix)) suffix += 1;
      }
    }
    // Where each new line was (-1: changed or new).
    const oldIndexOf = (j) => (j < prefix ? j : j >= n - suffix ? j - n + oldN : -1);

    // Measurements: kept through the diff; none when the geometry changed.
    const metrics = ed.windowMetrics();
    let heights;
    if (incremental && metrics.key === cache.metricsKey) {
      heights = new Array(n);
      for (let j = 0; j < n; j += 1) {
        const old = oldIndexOf(j);
        heights[j] = old >= 0 ? cache.heights[old] ?? null : null;
      }
    } else {
      heights = new Array(n).fill(null);
    }
    cache.metricsKey = metrics.key;

    // The run to render, then the page made to hold exactly it.
    const [ws, we] = ed.windowFor(n, heights, lines, keep, metrics);
    const wanted = new Array(we - ws).fill(null);
    if (incremental) {
      for (let j = ws; j < we; j += 1) {
        const k = oldIndexOf(j) - oldWs;
        if (oldIndexOf(j) >= 0 && k >= 0 && k < oldEls.length) wanted[j - ws] = oldEls[k];
      }
      const kept = new Set(wanted.filter(Boolean));
      for (const el of oldEls) if (!kept.has(el)) el.remove();
      for (let k = 0; k < wanted.length;) {
        if (wanted[k]) { k += 1; continue; }
        let e = k;
        while (e < wanted.length && !wanted[e]) e += 1;
        const { fragment, els } = parseEditorLines(lineHtml.slice(ws + k, ws + e));
        container.insertBefore(fragment, e < wanted.length ? wanted[e] : null);
        for (let t = k; t < e; t += 1) wanted[t] = els[t - k];
        k = e;
      }
    } else {
      container.innerHTML = lineHtml.slice(ws, we).join("");
      Array.from(container.children).forEach((el, k) => { normalizeEditorLineElement(el); wanted[k] = el; });
    }
    // Safety net: the page and the run disagree on the line count; rebuild.
    if (container.children.length !== we - ws) {
      cache.els = [];
      return renderEditorContent(text, { full: true, keep });
    }

    // The cache describes every line; the page, the run.
    cache.fileId = activeFile?.id ?? null;
    cache.kind = kind;
    cache.els = wanted;
    cache.ws = ws;
    cache.texts = lines;
    cache.html = lineHtml;
    cache.fenceIn = fenceIn;
    cache.fenceEnd = fenceEnd;
    cache.decorated = Boolean(activeDecoration);
    cache.textExact = true;
    for (let k = 0; k < wanted.length; k += 1) {
      const actual = wanted[k].textContent;
      if (actual !== lines[ws + k]) { lines[ws + k] = actual; cache.textExact = false; }
    }
    let winStart = 0;
    for (let i = 0; i < ws; i += 1) winStart += lines[i].length + 1;
    cache.winStart = winStart;
    cache.before = ws > 0 ? lines.slice(0, ws).join("\n") : "";
    cache.after = we < n ? lines.slice(we).join("\n") : "";

    // Gutter heights. Reading geometry forces layout, but only the run's
    // lines without a measurement are read (after a splice, just those).
    const minimumLineHeight = metrics.lineHeight;
    const remeasured = [];
    for (let k = 0; k < wanted.length; k += 1) {
      if (heights[ws + k] == null) {
        heights[ws + k] = Math.max(minimumLineHeight, wanted[k].getBoundingClientRect().height);
        remeasured.push(ws + k);
      }
    }
    cache.heights = heights;
    const above = ed.applySpacers(metrics);

    // Gutter rows, diffed the same way. The gutter is entirely ours (no native
    // edits), so plain index comparison is enough. A line-count change shifts the
    // numbers of every following row, which then re-render — rare (Enter/paste).
    // Other modules' notes on lines (editor.lineNotes: comments), one per line.
    const notes = app.lineNotesOf(activeFile);
    const noteByLine = new Map(notes.map((note) => [note.line, note]));
    // Row strings depend on the row index, its height, the notes and the
    // mark's range. A changed line count renumbers every following row, so
    // rebuild all; otherwise only rows that were just (re)measured can differ.
    const gutterEpoch = `${n}|${ws}|${we}|${activeDecoration ? `${activeDecoration.kind}:${activeDecoration.lineStart}-${activeDecoration.lineEnd}` : ""}|${notes.map((n) => `${n.kind}:${n.line}:${n.title}`).join("\u0001")}`;
    const gutterRow = (index) => {
      const decorated = isDecorated(index);
      const marker = decorated ? `<span class="editor-gutter-mark" aria-hidden="true">◦</span>` : "";
      const note = noteByLine.get(index);
      const noteMark = note
        ? `<span class="editor-gutter-${note.kind}-mark" title="${app.escapeHtmlAttribute(note.title)}" aria-hidden="true">●</span>`
        : "";
      return `<div class="editor-gutter-line${decorated ? ` is-${activeDecoration.kind}` : ""}${note ? ` has-${note.kind}` : ""}" data-line="${index}" style="height:${heights[index].toFixed(3)}px">${marker}${noteMark}${index + 1}</div>`;
    };
    let gutterHtml;
    if (gutterEpoch !== cache.gutterEpoch || cache.gutter.length !== wanted.length) {
      gutterHtml = wanted.map((_, k) => gutterRow(ws + k));
    } else {
      gutterHtml = cache.gutter.slice();
      for (const index of remeasured) gutterHtml[index - ws] = gutterRow(index);
    }
    cache.gutterEpoch = gutterEpoch;
    let gutterContent = app.elements.editorGutter.firstElementChild;
    if (!gutterContent || !gutterContent.classList.contains("editor-gutter-content")
        || gutterContent.children.length !== cache.gutter.length) {
      app.elements.editorGutter.innerHTML = `<div class="editor-gutter-content">${gutterHtml.join("")}</div>`;
      gutterContent = app.elements.editorGutter.firstElementChild;
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

    // The bar a mark on this file offers (the agent's Keep / Drop), or none.
    drawMarkBar(activeDecoration);
  }

  // The bar a mark on the shown file offers; drawn with the file, and again
  // when its owner's state changes (drawMarkBar()).
  function drawMarkBar(mark = shownMark()) {
    const bar = app.elements.editorMarkBar;
    if (!bar) return;
    const html = mark?.bar?.() ?? "";
    if (html) bar.innerHTML = html;
    bar.hidden = !html;
  }

  // The gutter follows the text: its rows (the rendered lines') sit where
  // those lines are, below the space the lines before them stand for. (Not
  // padding: the gutter is a layer of its own, and a long file's would be
  // hundreds of thousands of pixels tall.)
  function syncEditorScroll() {
    const scrollTop = app.elements.editorContent.scrollTop;
    const gutterContent = app.elements.editorGutter.firstElementChild;
    if (gutterContent) {
      gutterContent.style.transform = `translateY(${(app.editorRenderCache.above ?? 0) - scrollTop}px)`;
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
    // A held selection (editor-window.js): the page's caret is not the real one (a held
    // caret's waits out of view at the edge of the rendered lines); the view stays.
    if (ed.hasHeldSelection?.()) return;
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

  function shownMark() {
    const file = app.controller.getActiveFile();
    return file ? app.marks.get(getPath(app.controller.getProject(), file.id)) : null;
  }

  Object.assign(ed, { lineAt, drawMarkBar, applyEditorRender, getEditorLineHeight, getEditorSpaceWidth, getLeadingIndentColumns, decorateEditorLineHtml, normalizeEditorLineElement, parseEditorLines, renderEditorContent, syncEditorScroll, caretIntoView, forwardEditorWheel, clamp });
}
