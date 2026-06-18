// Self-contained floating grid-picker for inserting a table. The user drags
// across a grid to choose dimensions, toggles Markdown vs HTML output, then
// commits — the chosen size and kind are reported via onPick. No project or
// editor dependencies: the caller decides what to do with { rows, cols, kind }.

/**
 * @param {object} options
 * @param {number} [options.maxRows]
 * @param {number} [options.maxCols]
 * @param {(selection: { rows: number, cols: number, kind: "markdown" | "html" }) => void} options.onPick
 */
function createTableGridPicker({ maxRows = 8, maxCols = 10, onPick } = {}) {
  let hoverRows = 1;
  let hoverCols = 1;
  let kind = "markdown";

  const root = document.createElement("div");
  root.className = "table-grid-picker";
  root.hidden = true;

  const grid = document.createElement("div");
  grid.className = "table-grid";
  grid.style.setProperty("--grid-cols", String(maxCols));

  /** cells[r][c] — row-major for highlight updates. */
  const cells = [];
  for (let r = 0; r < maxRows; r += 1) {
    const rowCells = [];
    for (let c = 0; c < maxCols; c += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "table-grid-cell";
      cell.dataset.row = String(r + 1);
      cell.dataset.col = String(c + 1);
      grid.append(cell);
      rowCells.push(cell);
    }
    cells.push(rowCells);
  }

  const footer = document.createElement("div");
  footer.className = "table-grid-footer";

  const sizeLabel = document.createElement("span");
  sizeLabel.className = "table-grid-size";

  const toggle = document.createElement("div");
  toggle.className = "table-grid-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Table format");

  const kindButtons = ["markdown", "html"].map((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-grid-toggle-btn";
    button.dataset.kind = value;
    button.textContent = value === "markdown" ? "Markdown" : "HTML";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      kind = value;
      updateToggle();
    });
    toggle.append(button);
    return button;
  });

  footer.append(sizeLabel, toggle);
  root.append(grid, footer);

  function updateToggle() {
    kindButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.kind === kind);
    });
  }

  function updateHighlight(rows, cols) {
    hoverRows = rows;
    hoverCols = cols;
    for (let r = 0; r < maxRows; r += 1) {
      for (let c = 0; c < maxCols; c += 1) {
        cells[r][c].classList.toggle("is-active", r < rows && c < cols);
      }
    }
    sizeLabel.textContent = `${cols} × ${rows}`;
  }

  grid.addEventListener("mousemove", (event) => {
    const cell = event.target.closest(".table-grid-cell");
    if (!cell) return;
    updateHighlight(Number(cell.dataset.row), Number(cell.dataset.col));
  });

  grid.addEventListener("mousedown", (event) => {
    const cell = event.target.closest(".table-grid-cell");
    if (!cell) return;
    event.preventDefault();
    const rows = Number(cell.dataset.row);
    const cols = Number(cell.dataset.col);
    close();
    onPick?.({ rows, cols, kind });
  });

  function handleOutsidePointer(event) {
    if (!root.contains(event.target)) close();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  function open(anchorEl) {
    updateHighlight(1, 1);
    updateToggle();
    root.hidden = false;

    // Anchor under the trigger button, keeping the picker within the viewport.
    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      root.style.left = `${Math.round(rect.left)}px`;
      root.style.top = `${Math.round(rect.bottom + 4)}px`;
    }

    // Defer listener registration so the opening click does not close it.
    setTimeout(() => {
      document.addEventListener("mousedown", handleOutsidePointer, true);
      document.addEventListener("keydown", handleKeydown, true);
    }, 0);
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    document.removeEventListener("mousedown", handleOutsidePointer, true);
    document.removeEventListener("keydown", handleKeydown, true);
  }

  return { element: root, open, close };
}

export { createTableGridPicker };
