// The table editor: a .csv or .tsv as a grid of cells, in the preview pane.
// Only the rows and columns in view are drawn, so 20,000 rows scroll like
// twenty. A cell is edited in place (typed over, or Enter / F2 / a double
// click to change it); Tab and Enter move on; rows and columns are added and
// removed from the bar or a right click; a block copies and pastes as
// spreadsheets do (tab-separated); the numbers in the selection (one cell: in
// its column) are summed up below. Every edit is a new text written with the
// text it started from (`write`), so it merges with other people's typing;
// Ctrl+Z undoes the grid's own edits.
//
// A hidden textarea at the active cell holds the keyboard, so an input
// method's composition starts the cell's edit where it is typed.
import { NUMBER, blockText, cell, columnName, delimiterFor, deleteColumns, deleteRows, insertColumns, insertRows,
  looksLikeHeader, parseBlock, parseTable, setCells, statsOf } from "../model/table.js";

const ROW_H = 24;             // px, every row
const MIN_W = 56;
const MAX_W = 360;
const SAMPLE = 200;           // rows measured for a column's first width
const OVERSCAN = 6;           // rows drawn past the edges
const UNDO_BYTES = 32 << 20;  // the grid's undo keeps whole texts, up to this much per file

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const shown = (value) => value.replace(/\r?\n/g, " ↵ ");
export function formatNumber(n) {
  if (n === null) return "–";
  const size = Math.abs(n);
  return size !== 0 && (size >= 1e15 || size < 1e-4) ? n.toPrecision(6) : String(Number(n.toPrecision(12)));
}

// write(id, next, base) -> Promise<text after | null> (null: not written, and said)
// read(id) -> the file's text now (or null)
export function createGrid({ doc = globalThis.document, write, read, menu }) {
  const root = doc.createElement("div");
  root.className = "datatable";
  root.innerHTML = `
    <div class="datatable-bar">
      <button type="button" class="find-btn" data-act="add-row" title="Add a row at the end">Add Row</button>
      <button type="button" class="find-btn" data-act="add-column" title="Add a column at the end">Add Column</button>
      <label class="datatable-header-label" title="The first row names the columns: kept in view, in bold"><input type="checkbox" class="datatable-header-toggle"> Header row</label>
      <span class="datatable-size subtle-label"></span>
    </div>
    <div class="datatable-view">
      <div class="datatable-corner"></div>
      <div class="datatable-cols"><div class="datatable-cols-inner"></div></div>
      <div class="datatable-rows"><div class="datatable-rows-inner"></div></div>
      <div class="datatable-scroll" role="grid">
        <div class="datatable-sizer">
          <div class="datatable-cells"></div>
          <textarea class="datatable-input" rows="1" autocomplete="off" spellcheck="false" aria-label="Cell"></textarea>
        </div>
      </div>
    </div>
    <div class="datatable-stats subtle-label" aria-live="polite"></div>`;
  const $ = (selector) => root.querySelector(selector);
  const scroller = $(".datatable-scroll");
  const sizer = $(".datatable-sizer");
  const cells = $(".datatable-cells");
  const colsInner = $(".datatable-cols-inner");
  const rowsInner = $(".datatable-rows-inner");
  const input = $(".datatable-input");
  const headerToggle = $(".datatable-header-toggle");
  const statsLine = $(".datatable-stats");

  const memory = new Map(); // file id -> { top, left, sel, header, widths, undo, redo }
  let file = null;          // { id, name }
  let state = null;
  let text = null;          // the text the grid shows
  let table = parseTable("", ",");
  let rows = 1, cols = 1;
  let colX = [0, MIN_W];
  let editing = null;       // { row, col, typed: begun by typing (arrows then move on), base, table: what it began on }
  let statsTimer = null;

  // ---- what is shown ---------------------------------------------------------

  function show(next, nextText) {
    if (file?.id !== next.id) {
      if (editing) commit();
      remember();
      file = { ...next };
      state = memory.get(next.id) ?? { top: 0, left: 0, sel: { row: 0, col: 0, r0: 0, c0: 0, r1: 0, c1: 0 }, header: null, widths: [], undo: [], redo: [] };
      memory.set(next.id, state);
      text = null;
    }
    file.name = next.name;
    load(nextText);
    scroller.scrollTop = state.top;
    scroller.scrollLeft = state.left;
    draw();
  }

  function remember() {
    if (!state) return;
    state.top = scroller.scrollTop;
    state.left = scroller.scrollLeft;
  }

  function load(nextText) {
    if (nextText === text) return;
    text = nextText ?? "";
    table = parseTable(text, delimiterFor(file.name, text));
    if (state.header === null) state.header = looksLikeHeader(table);
    headerToggle.checked = state.header;
    layout();
    draw();
    stats();
  }

  // Someone else's edit, the source editor's, or one of ours merged: shown as the file is now.
  function sync() {
    if (!file) return;
    const now = read(file.id);
    if (now === null || now === text) return;
    load(now);
  }

  function measure(column) {
    const style = getComputedStyle(cells);
    const context = (measure.canvas ??= doc.createElement("canvas").getContext("2d"));
    if (!context) return 120;
    context.font = `${style.fontSize} ${style.fontFamily}`;
    let width = context.measureText(columnName(column)).width;
    for (let row = 0; row < Math.min(table.records.length, SAMPLE); row += 1) {
      const value = cell(table, row, column);
      if (value) width = Math.max(width, context.measureText(shown(value)).width);
    }
    return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(width) + 18));
  }

  function layout() {
    rows = table.records.length + 1;  // a blank row and column at the end: typed into, they are added
    cols = table.columns + 1;
    colX = [0];
    for (let column = 0; column < cols; column += 1) {
      if (state.widths[column] === undefined) state.widths[column] = column < table.columns ? measure(column) : MIN_W * 2;
      colX.push(colX[column] + state.widths[column]);
    }
    root.style.setProperty("--datatable-rowhead", `${Math.max(44, String(rows).length * 8 + 20)}px`);
    sizer.style.width = `${colX[cols]}px`;
    sizer.style.height = `${rows * ROW_H}px`;
    $(".datatable-size").textContent = `${table.records.length.toLocaleString("en-US")} row${table.records.length === 1 ? "" : "s"} × ${table.columns} column${table.columns === 1 ? "" : "s"}`;
    clampSelection();
  }

  const colAt = (x) => {
    let low = 0, high = cols - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (colX[mid] <= x) low = mid; else high = mid - 1;
    }
    return low;
  };
  const pinned = () => state.header && table.records.length > 0;
  const range = () => {
    const { r0, r1, c0, c1 } = state.sel;
    return { top: Math.min(r0, r1), bottom: Math.max(r0, r1), left: Math.min(c0, c1), right: Math.max(c0, c1) };
  };
  const inRange = (row, col, area = range()) => row >= area.top && row <= area.bottom && col >= area.left && col <= area.right;

  function cellHtml(row, col, top, extra = "") {
    const value = cell(table, row, col);
    const area = range();
    let names = "datatable-cell";
    if (inRange(row, col, area) && (area.top !== area.bottom || area.left !== area.right)) names += " is-sel";
    if (row === state.sel.row && col === state.sel.col) names += " is-active";
    if (value && NUMBER.test(value.trim())) names += " is-num";
    if (row >= table.records.length || col >= table.columns) names += " is-extra";
    return `<div class="${names}${extra}" style="top:${top}px;left:${colX[col]}px;width:${state.widths[col]}px">${escape(shown(value))}</div>`;
  }

  function draw() {
    if (!file) return;
    const top = scroller.scrollTop, left = scroller.scrollLeft;
    const height = scroller.clientHeight || 600, width = scroller.clientWidth || 800;
    const r0 = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const r1 = Math.min(rows - 1, Math.ceil((top + height) / ROW_H) + OVERSCAN);
    const c0 = Math.max(0, colAt(left) - 1);
    const c1 = Math.min(cols - 1, colAt(left + width) + 1);
    const area = range();
    const out = [];
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) out.push(cellHtml(row, col, row * ROW_H, pinned() && row === 0 ? " is-head" : ""));
    }
    // The header row, kept at the top while scrolled past.
    if (pinned() && top > 0) for (let col = c0; col <= c1; col += 1) out.push(cellHtml(0, col, top, " is-head is-pinned"));
    cells.innerHTML = out.join("");
    const heads = [];
    for (let col = c0; col <= c1; col += 1) {
      heads.push(`<div class="datatable-col${col >= area.left && col <= area.right ? " is-sel" : ""}" data-col="${col}" style="left:${colX[col]}px;width:${state.widths[col]}px">${columnName(col)}<span class="datatable-resize" data-resize="${col}"></span></div>`);
    }
    colsInner.innerHTML = heads.join("");
    colsInner.style.transform = `translateX(${-left}px)`;
    const numbers = [];
    for (let row = r0; row <= r1; row += 1) {
      numbers.push(`<div class="datatable-rownum${row >= area.top && row <= area.bottom ? " is-sel" : ""}" data-row="${row}" style="top:${row * ROW_H}px">${row + 1}</div>`);
    }
    if (pinned() && top > 0) numbers.push(`<div class="datatable-rownum is-pinned${area.top === 0 ? " is-sel" : ""}" data-row="0" style="top:${top}px">1</div>`);
    rowsInner.innerHTML = numbers.join("");
    rowsInner.style.transform = `translateY(${-top}px)`;
    placeInput();
  }

  // The textarea sits on the active cell: invisible until an edit begins.
  function placeInput() {
    const { row, col } = editing ?? state.sel;
    const top = pinned() && row === 0 ? scroller.scrollTop : row * ROW_H;
    input.style.top = `${top}px`;
    input.style.left = `${colX[col]}px`;
    input.style.width = `${Math.max(state.widths[col], editing ? 160 : 0)}px`;
    input.setAttribute("aria-label", `Cell ${columnName(col)}${row + 1}`);
  }

  // ---- selection -------------------------------------------------------------

  function clampSelection() {
    const sel = state.sel;
    for (const key of ["row", "r0", "r1"]) sel[key] = Math.max(0, Math.min(sel[key], rows - 1));
    for (const key of ["col", "c0", "c1"]) sel[key] = Math.max(0, Math.min(sel[key], cols - 1));
  }

  function select(row, col, { extend = false, keep = false } = {}) {
    const sel = state.sel;
    row = Math.max(0, Math.min(row, rows - 1));
    col = Math.max(0, Math.min(col, cols - 1));
    if (extend) { sel.r1 = row; sel.c1 = col; }
    else { sel.row = sel.r0 = sel.r1 = row; sel.col = sel.c0 = sel.c1 = col; }
    if (!keep) reveal(extend ? sel.r1 : row, extend ? sel.c1 : col);
    draw();
    stats();
  }

  function selectBlock(r0, c0, r1, c1) {
    Object.assign(state.sel, { row: Math.min(r0, r1), col: Math.min(c0, c1), r0, c0, r1, c1 });
    clampSelection();
    draw();
    stats();
  }

  // The cell scrolled into view (below the header row when that is kept in view).
  function reveal(row, col) {
    const head = pinned() && row > 0 ? ROW_H : 0;
    const top = row * ROW_H;
    if (top - head < scroller.scrollTop) scroller.scrollTop = top - head;
    else if (top + ROW_H > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + ROW_H - scroller.clientHeight;
    if (colX[col] < scroller.scrollLeft) scroller.scrollLeft = colX[col];
    else if (colX[col + 1] > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = colX[col + 1] - scroller.clientWidth;
  }

  function stats() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(() => {
      const area = range();
      const one = area.top === area.bottom && area.left === area.right;
      // One cell: its column (below the header row); more: the block.
      const block = one ? { top: pinned() ? 1 : 0, bottom: table.records.length - 1, left: area.left, right: area.left } : area;
      const where = one ? `Column ${columnName(area.left)}${pinned() && cell(table, 0, area.left) ? ` (${cell(table, 0, area.left)})` : ""}`
        : `${columnName(area.left)}${area.top + 1}:${columnName(area.right)}${area.bottom + 1}`;
      const found = statsOf(table, block);
      statsLine.textContent = found.count
        ? `${where} · Sum ${formatNumber(found.sum)} · Mean ${formatNumber(found.mean)} · Min ${formatNumber(found.min)} · Max ${formatNumber(found.max)} · ${found.count.toLocaleString("en-US")} number${found.count === 1 ? "" : "s"}`
        : `${where} · ${found.cells.toLocaleString("en-US")} filled cell${found.cells === 1 ? "" : "s"}, no numbers`;
    }, 60);
  }

  // ---- editing ---------------------------------------------------------------

  function focusInput() {
    input.focus({ preventScroll: true });
  }

  function begin({ typed = false, value = null } = {}) {
    const { row, col } = state.sel;
    editing = { row, col, typed, base: text, table };
    input.value = value ?? (typed ? input.value : cell(table, row, col));
    input.classList.add("is-editing");
    placeInput();
    grow();
    focusInput();
    if (!typed) input.setSelectionRange(input.value.length, input.value.length);
  }

  function grow() {
    input.style.height = "";
    if (editing) input.style.height = `${Math.max(ROW_H, input.scrollHeight)}px`;
  }

  function end() {
    editing = null;
    input.value = "";
    input.classList.remove("is-editing");
    input.style.height = "";
    placeInput();
  }

  // The cell's edit, made on the text it began on: written with that text as
  // its base, it lands on the same row even if rows came or went meanwhile.
  function commit() {
    if (!editing) return;
    const { row, col, base, table: began } = editing;
    const value = input.value;
    end();
    if (value !== cell(began, row, col)) apply(setCells(base, began, row, col, [[value]]), base);
  }

  // A new text: shown at once (when made on what is shown), then written with
  // the text it came from.
  function apply(next, base = text) {
    if (next === base || !file) return;
    const { id } = file;
    const kept = state;
    if (base === text) load(next);
    void write(id, next, base).then((after) => {
      if (after !== null) keepStep(kept, base, after);
      if (file?.id === id) load(read(id) ?? after ?? base);
    });
  }

  function keepStep(kept, before, after) {
    kept.undo.push({ before, after });
    kept.redo = [];
    let bytes = kept.undo.reduce((sum, step) => sum + step.before.length + step.after.length, 0);
    while (bytes > UNDO_BYTES && kept.undo.length > 1) {
      const dropped = kept.undo.shift();
      bytes -= dropped.before.length + dropped.after.length;
    }
  }

  // Undo puts back what a step changed (in the file as it is now); redo does it again.
  function step(from, to, swap) {
    const entry = state[from].pop();
    if (!entry || !file) return;
    const { id } = file;
    const kept = state;
    const [base, next] = swap ? [entry.after, entry.before] : [entry.before, entry.after];
    if (text === base) load(next);
    void write(id, next, base).then((after) => {
      if (after !== null) kept[to].push(entry);
      if (file?.id === id) load(read(id) ?? text);
    });
  }

  const clear = () => {
    const area = range();
    const block = Array.from({ length: Math.min(area.bottom, table.records.length - 1) - area.top + 1 },
      () => Array.from({ length: Math.min(area.right, table.columns - 1) - area.left + 1 }, () => ""));
    if (block.length && block[0].length) apply(setCells(text, table, area.top, area.left, block));
  };

  function paste(clip) {
    const block = parseBlock(clip);
    if (!block.length) return;
    const area = range();
    // One value into a block of cells fills it, as spreadsheets do.
    if (block.length === 1 && block[0].length === 1 && (area.top !== area.bottom || area.left !== area.right)) {
      const value = block[0][0];
      const bottom = Math.min(area.bottom, Math.max(table.records.length - 1, area.top));
      apply(setCells(text, table, area.top, area.left, Array.from({ length: bottom - area.top + 1 }, () => Array.from({ length: area.right - area.left + 1 }, () => value))));
      return;
    }
    apply(setCells(text, table, area.top, area.left, block));
    selectBlock(area.top, area.left, area.top + block.length - 1, area.left + Math.max(...block.map((values) => values.length)) - 1);
  }

  const copyText = () => blockText(table, range());

  // Rows and columns (the selection's, or where it is).
  const rowsOfSelection = () => ({ from: range().top, count: range().bottom - range().top + 1 });
  const colsOfSelection = () => ({ from: range().left, count: range().right - range().left + 1 });
  const actions = {
    "add-row": () => { apply(insertRows(text, table, table.records.length)); select(table.records.length - 1, state.sel.col); },
    "add-column": () => { apply(insertColumns(text, table, table.columns)); select(state.sel.row, table.columns - 1); },
    "row-above": () => apply(insertRows(text, table, rowsOfSelection().from, rowsOfSelection().count)),
    "row-below": () => apply(insertRows(text, table, rowsOfSelection().from + rowsOfSelection().count, rowsOfSelection().count)),
    "delete-rows": () => { apply(deleteRows(text, table, rowsOfSelection().from, rowsOfSelection().count)); select(rowsOfSelection().from, state.sel.col); },
    "col-left": () => apply(insertColumns(text, table, colsOfSelection().from, colsOfSelection().count)),
    "col-right": () => apply(insertColumns(text, table, colsOfSelection().from + colsOfSelection().count, colsOfSelection().count)),
    "delete-cols": () => {
      const { from, count } = colsOfSelection();
      state.widths.splice(from, count);
      apply(deleteColumns(text, table, from, count));
      select(state.sel.row, from);
    },
    copy: () => void navigator.clipboard?.writeText(copyText()),
    clear
  };
  const run = (name) => { if (editing) commit(); actions[name]?.(); focusInput(); };

  function openMenu(event) {
    const { count: r } = rowsOfSelection();
    const { count: c } = colsOfSelection();
    const plural = (n, word) => (n === 1 ? word : `${n} ${word}s`);
    menu(event, [
      ["Insert Row Above", "row-above"], ["Insert Row Below", "row-below"], [`Delete ${plural(r, "Row")}`, "delete-rows"], null,
      ["Insert Column Left", "col-left"], ["Insert Column Right", "col-right"], [`Delete ${plural(c, "Column")}`, "delete-cols"], null,
      ["Copy", "copy"], ["Clear", "clear"]
    ], run);
  }

  // ---- input -----------------------------------------------------------------

  function cellAt(event) {
    const box = scroller.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    if (x >= scroller.clientWidth || y >= scroller.clientHeight) return null; // a scrollbar
    const row = pinned() && y < ROW_H && scroller.scrollTop > 0 ? 0 : Math.floor((y + scroller.scrollTop) / ROW_H);
    return { row: Math.min(row, rows - 1), col: colAt(x + scroller.scrollLeft) };
  }

  function dragFrom(onMove) {
    const move = (event) => onMove(event);
    const up = () => { doc.removeEventListener("mousemove", move); doc.removeEventListener("mouseup", up); };
    doc.addEventListener("mousemove", move);
    doc.addEventListener("mouseup", up);
  }

  scroller.addEventListener("mousedown", (event) => {
    if (event.target === input && editing) return;
    const hit = cellAt(event);
    if (!hit) return;
    event.preventDefault();
    if (editing) commit();
    focusInput();
    if (event.button === 2) {
      if (!inRange(hit.row, hit.col)) select(hit.row, hit.col, { keep: true });
      return;
    }
    if (event.button !== 0) return;
    select(hit.row, hit.col, { extend: event.shiftKey, keep: true });
    dragFrom((move) => {
      const over = cellAt(move);
      if (over && (over.row !== state.sel.r1 || over.col !== state.sel.c1)) select(over.row, over.col, { extend: true, keep: true });
    });
  });
  scroller.addEventListener("dblclick", (event) => {
    const hit = cellAt(event);
    if (hit && !editing) { select(hit.row, hit.col, { keep: true }); begin(); }
  });
  scroller.addEventListener("scroll", () => { remember(); draw(); });
  root.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".datatable-scroll, .datatable-cols, .datatable-rows")) return;
    event.preventDefault();
    openMenu(event);
  });

  // The column letters: a click selects the column (Shift: up to it); an edge drags its width.
  $(".datatable-cols").addEventListener("mousedown", (event) => {
    const resize = event.target.closest("[data-resize]");
    const head = event.target.closest("[data-col]");
    if (!head) return;
    event.preventDefault();
    if (editing) commit();
    focusInput();
    if (resize) {
      const col = Number(resize.dataset.resize), startX = event.clientX, startW = state.widths[col];
      dragFrom((move) => {
        state.widths[col] = Math.max(32, startW + move.clientX - startX);
        layout();
        draw();
      });
      return;
    }
    const col = Number(head.dataset.col);
    if (event.button === 2 && col >= range().left && col <= range().right && range().top === 0 && range().bottom >= rows - 2) return;
    const from = event.shiftKey ? state.sel.c0 : col;
    selectBlock(0, from, Math.max(0, rows - 2), col);
    state.sel.col = Math.min(from, col);
  });
  $(".datatable-rows").addEventListener("mousedown", (event) => {
    const head = event.target.closest("[data-row]");
    if (!head) return;
    event.preventDefault();
    if (editing) commit();
    focusInput();
    const row = Number(head.dataset.row);
    if (event.button === 2 && row >= range().top && row <= range().bottom && range().left === 0) return;
    const from = event.shiftKey ? state.sel.r0 : row;
    selectBlock(from, 0, row, Math.max(0, cols - 2));
    state.sel.row = Math.min(from, row);
  });

  const MOVES = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const sel = state.sel;
    if (editing) {
      const moveBy = (dr, dc) => { event.preventDefault(); const { row, col } = editing; commit(); select(row + dr, col + dc); };
      if (key === "Enter" && (event.altKey || mod)) { event.preventDefault(); input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end"); grow(); }
      else if (key === "Enter") moveBy(event.shiftKey ? -1 : 1, 0);
      else if (key === "Tab") moveBy(0, event.shiftKey ? -1 : 1);
      else if (key === "Escape") { event.preventDefault(); end(); }
      else if (editing.typed && (key === "ArrowUp" || key === "ArrowDown")) moveBy(MOVES[key][0], 0);
      return;
    }
    const page = Math.max(1, Math.floor(scroller.clientHeight / ROW_H) - 1);
    if (MOVES[key]) {
      event.preventDefault();
      const [dr, dc] = MOVES[key];
      const from = event.shiftKey ? { row: sel.r1, col: sel.c1 } : sel;
      const last = { row: Math.max(0, table.records.length - 1), col: Math.max(0, table.columns - 1) };
      const row = mod ? (dr < 0 ? 0 : dr > 0 ? last.row : from.row) : from.row + dr;
      const col = mod ? (dc < 0 ? 0 : dc > 0 ? last.col : from.col) : from.col + dc;
      select(row, col, { extend: event.shiftKey });
    } else if (key === "Tab") { event.preventDefault(); select(sel.row, sel.col + (event.shiftKey ? -1 : 1)); }
    else if (key === "Enter" || key === "F2") { event.preventDefault(); begin(); }
    else if (key === "PageDown" || key === "PageUp") { event.preventDefault(); select(sel.row + (key === "PageDown" ? page : -page), sel.col, { extend: event.shiftKey }); }
    else if (key === "Home") { event.preventDefault(); select(mod ? 0 : sel.row, 0, { extend: event.shiftKey }); }
    else if (key === "End") { event.preventDefault(); select(mod ? Math.max(0, table.records.length - 1) : sel.row, Math.max(0, table.columns - 1), { extend: event.shiftKey }); }
    else if (key === "Delete" || key === "Backspace") { event.preventDefault(); clear(); }
    else if (key === "Escape") select(sel.row, sel.col);
    else if (mod && key.toLowerCase() === "a") { event.preventDefault(); selectBlock(0, 0, Math.max(0, rows - 2), Math.max(0, cols - 2)); }
    else if (mod && key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? step("redo", "undo", false) : step("undo", "redo", true); }
    else if (mod && key.toLowerCase() === "y") { event.preventDefault(); step("redo", "undo", false); }
    else if (mod && (key.toLowerCase() === "c" || key.toLowerCase() === "x")) {
      // The block as the textarea's selected text: the browser's own copy takes it.
      input.value = copyText();
      input.select();
    }
  });
  // Typing (or an input method's composition) on a cell begins its edit. The
  // textarea is already empty: setting its value now would end the composition.
  input.addEventListener("compositionstart", () => { if (!editing) begin({ typed: true }); });
  input.addEventListener("input", () => {
    if (!editing) begin({ typed: true });
    grow();
  });
  input.addEventListener("copy", (event) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", copyText());
    setTimeout(() => { if (!editing) input.value = ""; });
  });
  input.addEventListener("cut", (event) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", copyText());
    input.value = "";
    clear();
  });
  input.addEventListener("paste", (event) => {
    if (editing) return;
    event.preventDefault();
    paste(event.clipboardData?.getData("text/plain") ?? "");
  });
  input.addEventListener("keyup", () => { if (!editing && input.value) input.value = ""; }); // a copy's text, once copied
  input.addEventListener("blur", () => commit());

  root.querySelector(".datatable-bar").addEventListener("click", (event) => {
    const button = event.target.closest("[data-act]");
    if (button) run(button.dataset.act);
  });
  headerToggle.addEventListener("change", () => {
    state.header = headerToggle.checked;
    draw();
    stats();
  });

  return {
    root, show, sync, draw,
    focus: focusInput,
    // For tests and the extension: what is shown.
    selection: () => ({ ...state.sel, editing: Boolean(editing) }),
    shownText: () => text
  };
}
