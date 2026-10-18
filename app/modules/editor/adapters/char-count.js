// The character count in the status bar: the shown file's source length, or
// "selected / total" while text is selected in the source editor. It counts
// source characters (what the editor holds), so selecting rendered text in the
// preview doesn't apply. The total is told when a file is shown, so a
// drag-select only works out the cheap selection part.
export function createCharCount(app, statusBar) {
  const item = statusBar.add({ id: "charcount", order: 60, className: "status-item-charcount", hidden: true });
  let total = null;

  function renderCharCount() {
    if (total == null) { item.set({ hidden: true }); return; }
    const { start, end } = app.getEditorSelection(); // {0,0} unless the editor holds the selection
    const selected = Math.max(0, end - start);
    const all = total.toLocaleString();
    item.set({
      text: selected > 0 ? `${selected.toLocaleString()} / ${all} chars` : `${all} chars`,
      title: selected > 0 ? `${selected.toLocaleString()} characters selected of ${all}` : `${all} characters in this file`,
      hidden: false
    });
  }

  // The shown text's length, or null when no text is shown (the count hides).
  function showCharCount(length) {
    total = length;
    renderCharCount();
  }

  // selectionchange fires continuously while dragging: one update per frame.
  let frame = 0;
  document.addEventListener("selectionchange", () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderCharCount();
      app.scheduleOverviewRuler(); // the caret marker follows the selection
    });
  });

  return { showCharCount, renderCharCount };
}
