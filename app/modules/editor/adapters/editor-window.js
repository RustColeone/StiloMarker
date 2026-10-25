// Lazy rendering: of a long file only the lines in view, and a margin around
// them, are in the page, so a 450 KB file costs what a chapter does. The rest
// is kept as text and HTML in the render cache (editor-render.js), and empty
// space above and below the rendered lines (the padding the spacer variables
// set) stands for their height: measured for lines that have been in view,
// estimated for the others. A file of up to LAZY_FROM lines is rendered whole,
// as before. Installed on the editor object `ed` (see editor-core.js).
//
// The rendered lines are one run, [ws, we): `cache.ws` and `cache.els`. A
// selection is kept in that run while it fits; a longer one (Select All, a
// shift-click far away), or a caret scrolled far out of view, is held as text
// offsets (`held`) while the page shows the part of it in view. Copying,
// cutting, typing over it and pasting use the held offsets; any key brings a
// held caret back into view first.
const LAZY_FROM = 2000; // lines: up to this, the whole file is in the page
const MARGIN = 60;      // lines rendered beyond the view, each side
const EDGE = 15;        // the view this close to the run's edge: the run moves
const SPAN_MAX = 1500;  // a selection longer than this (in lines) is held, not rendered whole
const PAD = 16;         // #editor-content's own padding (styles.css)

export function installWindow(ed, app) {
  const cache = () => app.editorRenderCache;
  const content = () => app.elements.editorContent;
  let held = null;      // { anchor, focus }: text offsets, when the page can't show the selection whole
  let heldClip = null;  // the DOM selection set for it: { anchorNode, anchorOffset, focusNode, focusOffset }

  // ── Heights ────────────────────────────────────────────────────────────────
  // Measured once, and again when something forgot the measurements (the
  // width, the font or word wrap changed: cache.metricsKey cleared). Reading
  // the editor's style on every render forced the browser to work it out.
  let charWidthCache = null;
  let metricsCache = null;
  function windowMetrics() {
    if (metricsCache && cache().metricsKey && metricsCache.key === cache().metricsKey) return metricsCache;
    const el = content();
    const style = globalThis.getComputedStyle(el);
    const parsed = Number.parseFloat(style.lineHeight);
    const lineHeight = Number.isFinite(parsed) ? parsed : 20.8;
    const wrap = app.elements.app?.dataset.wordWrap === "on";
    const width = Math.max(40, el.clientWidth - 2 * PAD);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    if (charWidthCache?.font !== font) {
      const ctx = (charWidthCache?.canvas ?? document.createElement("canvas")).getContext("2d");
      ctx.font = font;
      const sample = "the quick brown fox jumps over the lazy dog 0123456789 = 1.25e-3;";
      charWidthCache = { font, canvas: ctx.canvas, width: ctx.measureText(sample).width / sample.length || lineHeight * 0.5 };
    }
    const key = `${el.clientWidth}|${style.lineHeight}|${style.fontSize}|${style.fontFamily}|${app.elements.app?.dataset.wordWrap ?? ""}`;
    metricsCache = { key, lineHeight, wrap, width, charWidth: charWidthCache.width };
    return metricsCache;
  }

  // A line never measured: one row, or as many as its text would wrap to.
  function estimateHeight(text, m) {
    if (!m.wrap || !text) return m.lineHeight;
    return m.lineHeight * Math.max(1, Math.ceil((text.length * m.charWidth) / m.width));
  }

  function heightAt(i, m) {
    const c = cache();
    return c.heights[i] ?? estimateHeight(c.texts[i], m);
  }

  function sumHeights(from, to, m) {
    let total = 0;
    for (let i = from; i < to; i += 1) total += heightAt(i, m);
    return total;
  }

  // The spacers stand for the lines above and below the rendered run.
  function applySpacers(m = windowMetrics()) {
    const c = cache();
    const above = c.ws > 0 ? sumHeights(0, c.ws, m) : 0;
    const below = sumHeights(c.ws + c.els.length, c.texts.length, m);
    content().style.setProperty("--lazy-above", `${above.toFixed(2)}px`);
    content().style.setProperty("--lazy-below", `${below.toFixed(2)}px`);
    c.above = above;
    return above;
  }

  // Where line i starts, in the content's own coordinates (as offsetTop).
  function lineTop(i) {
    const c = cache();
    const k = i - c.ws;
    if (k >= 0 && k < c.els.length && c.els[k]?.isConnected) return c.els[k].offsetTop;
    return PAD + sumHeights(0, Math.max(0, Math.min(i, c.texts.length)), windowMetrics());
  }

  // The lines in view: [first, last], from the measured and estimated heights.
  function viewLines(n, heights, texts, m) {
    const el = content();
    const top = Math.max(0, el.scrollTop - PAD);
    const bottom = top + el.clientHeight;
    const h = (i) => heights[i] ?? estimateHeight(texts[i], m);
    let y = 0;
    let first = 0;
    while (first < n - 1 && y + h(first) <= top) { y += h(first); first += 1; }
    let last = first;
    y += h(first);
    while (last < n - 1 && y < bottom) { last += 1; y += h(last); }
    return [first, last];
  }

  // The run to render for n lines: the view and its margin, and `keep` (a
  // selection's lines [a, b]) when that is close enough to render with it.
  function windowFor(n, heights, texts, keep, m) {
    if (n <= LAZY_FROM) return [0, n];
    const [first, last] = viewLines(n, heights, texts, m);
    let ws = Math.max(0, first - MARGIN);
    let we = Math.min(n, last + 1 + MARGIN);
    if (keep) {
      const a = Math.max(0, Math.min(keep[0], n - 1));
      const b = Math.max(0, Math.min(keep[1], n - 1));
      if (Math.max(we, b + 1) - Math.min(ws, a) <= SPAN_MAX + 2 * MARGIN) {
        ws = Math.min(ws, a);
        we = Math.max(we, b + 1);
      }
    }
    return [ws, we];
  }

  const isLazy = () => cache().texts.length > LAZY_FROM;

  // ── Offsets and the rendered run ───────────────────────────────────────────
  // Lines are fixed outside the run between renders (native edits happen in
  // view), so the text before it starts at cache.winStart.
  function lineOfOffset(offset) {
    const texts = cache().texts;
    let at = 0;
    for (let i = 0; i < texts.length; i += 1) {
      const end = at + texts[i].length;
      if (offset <= end) return i;
      at = end + 1;
    }
    return Math.max(0, texts.length - 1);
  }

  function windowTextLength() {
    const c = cache();
    const tracker = ed.trackEditorDom();
    const kids = content().children;
    let total = 0;
    if (!tracker.structural && tracker.dirty.size === 0 && kids.length === c.els.length) {
      for (let k = 0; k < c.els.length; k += 1) total += c.texts[c.ws + k].length + 1;
    } else {
      for (const kid of kids) total += kid.textContent.length + 1;
    }
    return Math.max(0, total - 1);
  }

  // The text in the page: [start, end] offsets.
  function renderedRange() {
    const c = cache();
    return { start: c.winStart ?? 0, end: (c.winStart ?? 0) + windowTextLength() };
  }

  function isOffsetRendered(offset) {
    const { start, end } = renderedRange();
    return offset >= start && offset <= end;
  }

  // Line indices of [start, end] in the text as last rendered (or now, when clean).
  const linesOf = (start, end) => [lineOfOffset(Math.min(start, end)), lineOfOffset(Math.max(start, end))];

  // ── Moving the run ─────────────────────────────────────────────────────────
  // The view moved (or the run must include `keep`): render another run when
  // the view nears the edge of this one. True when the run changed. What was
  // typed and not yet drawn is drawn first, as the run's lines are replaced.
  function updateWindow({ keep = null, force = false } = {}) {
    const c = cache();
    const n = c.texts.length;
    if (!c.els.length || (n <= LAZY_FROM && c.ws === 0 && c.els.length === n)) return false;
    const m = windowMetrics();
    const [first, last] = viewLines(n, c.heights, c.texts, m);
    const ws = c.ws;
    const we = c.ws + c.els.length;
    const keepIn = !keep || (keep[0] >= ws && keep[1] < we);
    const covered = (first >= ws + EDGE || ws === 0) && (last < we - EDGE || we === n);
    const tooBig = we - ws > (last - first + 1) + 4 * MARGIN + (keep ? keep[1] - keep[0] : 0) + SPAN_MAX;
    if (!force && covered && keepIn && !tooBig) return false;
    // The selection: kept in the run when it fits, else held.
    const selection = ed.getEditorSelectionEnds();
    const focused = document.activeElement === content();
    let selLines = keep;
    if (!selLines && focused && !held) {
      const lines = linesOf(selection.start, selection.end);
      const reach = Math.max(last, lines[1]) - Math.min(first, lines[0]);
      if (reach <= SPAN_MAX + 2 * MARGIN) selLines = lines;
      else holdSelection(selection.anchor ?? selection.start, selection.focus ?? selection.end, { apply: false });
    }
    // Keep the first line in view where it is on the screen.
    const anchorLine = first;
    const anchorDelta = lineTop(anchorLine) - content().scrollTop;
    const text = ed.getEditorText();
    ed.renderEditorContent(text, { keep: selLines });
    content().scrollTop = Math.max(0, lineTop(anchorLine) - anchorDelta);
    ed.syncEditorScroll();
    // (Only while this editor has the focus: the page's one selection may be the other editor's.)
    if (held && focused) applyHeldClip();
    else if (focused) ed.setEditorSelection(selection.start, selection.end, { anchor: selection.anchor, focus: selection.focus });
    return true;
  }

  // Lines [a, b] in the page: rendered with the view when close enough to it
  // (the view stays where it is); else, when `reveal`, the view moves to them
  // (line a a third of the way down). False when they are too far apart to
  // render together, or far from the view and not to be revealed.
  function ensureLinesRendered(a, b, { reveal = false } = {}) {
    const c = cache();
    const inRun = () => a >= cache().ws && b < cache().ws + cache().els.length;
    if (inRun()) return true;
    if (b - a > SPAN_MAX) return false;
    const el = content();
    const anchorLine = viewLines(c.texts.length, c.heights, c.texts, windowMetrics())[0];
    const anchorDelta = lineTop(anchorLine) - el.scrollTop;
    ed.renderEditorContent(ed.getEditorText(), { keep: [a, b] });
    el.scrollTop = Math.max(0, lineTop(anchorLine) - anchorDelta);
    if (!inRun() && reveal) {
      el.scrollTop = Math.max(0, lineTop(a) - el.clientHeight / 3);
      ed.renderEditorContent(ed.getEditorText(), { keep: [a, b] });
      el.scrollTop = Math.max(0, lineTop(a) - el.clientHeight / 3);
    }
    ed.syncEditorScroll();
    return inRun();
  }

  // ── Held selections ───────────────────────────────────────────────────────
  function holdSelection(anchor, focus, { apply = true } = {}) {
    held = { anchor, focus };
    if (apply) applyHeldClip();
  }

  function dropHeld() {
    held = null;
    heldClip = null;
  }

  // The part of a held selection in the page, as the page's selection. When
  // none of it is in the page, the page's caret waits at the edge of the
  // rendered lines nearest to it, which is out of view (the rendered lines
  // reach MARGIN past the view, and the file's own ends): with no selection
  // the browser would put one at the start itself as a key arrives, which
  // would read as a click there.
  function applyHeldClip() {
    if (!held) return;
    const sel = globalThis.getSelection?.();
    if (!sel) return;
    const c = cache();
    const winEnd = c.winStart + windowTextLength();
    const lo = Math.min(held.anchor, held.focus);
    const hi = Math.max(held.anchor, held.focus);
    let from = Math.max(lo, c.winStart);
    let to = Math.min(hi, winEnd);
    if (from > to) from = to = hi < c.winStart ? c.winStart : winEnd;
    const forward = held.anchor <= held.focus;
    const a = ed.textOffsetToDomPosition(forward ? from : to);
    const f = ed.textOffsetToDomPosition(forward ? to : from);
    try {
      sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset);
      heldClip = { anchorNode: sel.anchorNode, anchorOffset: sel.anchorOffset, focusNode: sel.focusNode, focusOffset: sel.focusOffset };
    } catch {
      sel.removeAllRanges();
      heldClip = null;
    }
  }

  // The selection when one is held: its offsets while the page's selection is
  // the one set for it; with its anchor kept, the focus where the page's is now
  // (Shift with an arrow or a click extends it); else the page's own, and the
  // hold ends.
  function heldSelection() {
    if (!held) return null;
    const sel = globalThis.getSelection?.();
    const inEditor = sel && sel.rangeCount > 0 && content().contains(sel.anchorNode);
    const ordered = () => ({ start: Math.min(held.anchor, held.focus), end: Math.max(held.anchor, held.focus), anchor: held.anchor, focus: held.focus });
    if (!inEditor) return heldClip === null ? ordered() : (dropHeld(), null);
    if (!heldClip) { dropHeld(); return null; }
    if (sel.anchorNode !== heldClip.anchorNode || sel.anchorOffset !== heldClip.anchorOffset) { dropHeld(); return null; }
    if (sel.focusNode !== heldClip.focusNode || sel.focusOffset !== heldClip.focusOffset) {
      held = { anchor: held.anchor, focus: ed.domPositionToTextOffset(sel.focusNode, sel.focusOffset) };
      heldClip = { anchorNode: sel.anchorNode, anchorOffset: sel.anchorOffset, focusNode: sel.focusNode, focusOffset: sel.focusOffset };
    }
    return ordered();
  }

  // A held caret (or selection) brought into view: the run moved to it, the
  // page's selection set, the view scrolled to it.
  function revealHeld({ to = null } = {}) {
    if (!held) return;
    const target = to ?? held.focus;
    const keepAnchor = to === null && Math.abs(lineOfOffset(held.anchor) - lineOfOffset(held.focus)) <= SPAN_MAX;
    const anchor = keepAnchor ? held.anchor : target;
    dropHeld();
    ensureLinesRendered(...linesOf(anchor, target), { reveal: true });
    ed.setEditorSelection(Math.min(anchor, target), Math.max(anchor, target), { anchor, focus: target });
    ed.caretIntoView(ed.getEditorLineHeight() * 3);
  }

  // Keys over a held selection: a caret comes back into view before the key
  // acts; arrows collapse a held selection to its end; editing keys go through
  // beforeinput (which reads the held offsets); an IME composition replaces it.
  const NAVIGATION = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
  content()?.addEventListener("keydown", (event) => {
    // Select All in a long file: held, not rendered whole.
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a" && isLazy()) {
      event.preventDefault();
      selectAll();
      return;
    }
    if (!held || ["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(event.key)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && ["c", "x", "v", "a", "z", "y"].includes(event.key.toLowerCase())) return; // copy, cut, paste, select all, undo: theirs
    const { start, end } = heldSelection() ?? {};
    if (start === undefined) return;
    if (start === end) { revealHeld(); return; }
    if (event.key === "Process" || event.isComposing) {
      dropHeld();
      ed.replaceEditorRange(start, end, "");
      return;
    }
    if (NAVIGATION.has(event.key) && !event.shiftKey) {
      event.preventDefault();
      revealHeld({ to: ["ArrowLeft", "ArrowUp", "Home", "PageUp"].includes(event.key) ? start : end });
      return;
    }
    if (NAVIGATION.has(event.key)) revealHeld();
  }, true);

  // Select All in a long file: held, not rendered whole.
  function selectAll() {
    holdSelection(0, ed.getEditorText().length);
  }

  // Line i in the middle of the view (an overview ruler's tick, a marked line).
  function revealLine(i) {
    const el = content();
    el.scrollTop = Math.max(0, lineTop(i) - el.clientHeight / 2);
    updateWindow();
    el.scrollTop = Math.max(0, lineTop(i) - el.clientHeight / 2);
    ed.syncEditorScroll();
  }

  // Copying or cutting a held selection: from the text, not the page.
  for (const kind of ["copy", "cut"]) {
    content()?.addEventListener(kind, (event) => {
      const selection = heldSelection();
      if (!selection || selection.start === selection.end) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", ed.getEditorText().slice(selection.start, selection.end));
      if (kind === "cut") {
        dropHeld();
        ed.replaceEditorRange(selection.start, selection.end, "");
      }
    });
  }

  Object.assign(ed, { LAZY_FROM, renderedRange, windowMetrics, estimateHeight, applySpacers, lineTop, windowFor, isLazy, isOffsetRendered,
    lineOfOffset, updateWindow, ensureLinesRendered, holdSelection, dropHeld, applyHeldClip, heldSelection, selectAll, revealHeld,
    hasHeldSelection: () => Boolean(held),
    // The names the rest of the editor uses (editor-core.js).
    updateEditorWindow: () => updateWindow(), editorLineTop: lineTop, revealEditorLine: revealLine, selectAllInEditor: selectAll });
}
