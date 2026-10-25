// The editor's trace in the log panel (Shell's): what each input event did to
// the text, the caret and the line under it, for finding editing bugs. Built
// only while the log panel is open (it reads the whole document).
// Part of the Editor: `app` is its shared context (surface.js).
export function createDebugTrace(app, shell) {
  const formatEditorDebugValue = (value) => String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\t", "\\t");

  // The line (an editor-line element) a text offset falls on.
  function lineIndexAtOffset(offset) {
    const lines = Array.from(app.elements.editorContent.children);
    let remaining = Math.max(0, offset);
    for (let index = 0; index < lines.length; index += 1) {
      const length = lines[index].textContent.length;
      if (remaining <= length) return index;
      remaining -= length + 1;
    }
    return Math.max(0, lines.length - 1);
  }

  function detail(extra) {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const { start, end } = app.getEditorSelection();
    const lines = Array.from(app.elements.editorContent.children);
    const index = lineIndexAtOffset(start);
    const line = lines[index] ?? null;
    const container = range?.startContainer ?? null;
    const text = container?.nodeType === Node.TEXT_NODE;
    return Object.entries({
      file: app.controller.getActiveFile()?.name ?? "",
      editor: app.view.get().hosts.source, // which group's (the active one)
      active: document.activeElement === app.elements.editorContent ? "editor" : document.activeElement?.nodeName?.toLowerCase() ?? "null",
      sel: `${start}-${end}`,
      dom: `${text ? "#text" : container?.nodeName?.toLowerCase() ?? "null"}@${range?.startOffset ?? 0}`,
      domText: formatEditorDebugValue(text ? container.textContent ?? "" : ""),
      line: index,
      lineText: formatEditorDebugValue(line?.textContent ?? ""),
      lineHtml: formatEditorDebugValue(line?.innerHTML ?? ""),
      nextLineText: formatEditorDebugValue(lines[index + 1]?.textContent ?? ""),
      autocomplete: app.elements.editorAutocomplete.hidden ? "hidden" : "visible",
      history: `${app.editorHistory.index}/${app.editorHistory.stack.length}`,
      ...extra
    }).map(([key, value]) => `${key}=${value}`).join(" ; ");
  }

  // Called for every space and Enter, twice: only built when someone can see it.
  function traceEditorEvent(message, extra = {}) {
    if (!shell.frame.shown("bottom")) return;
    shell.log("editor", message, detail(extra));
  }

  return { traceEditorEvent, formatEditorDebugValue };
}
