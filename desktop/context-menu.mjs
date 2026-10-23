// The right-click menu, which Electron leaves to the app (it shows none of
// its own; a browser shows its own): a misspelled word's suggestions and Add
// to Dictionary, then Cut, Copy, Paste and Select All as the place allows.
// Pure: Electron's context-menu details in, a menu template out (app.mjs
// shows it). Nowhere to type and nothing selected: no menu. Select All is the
// page's own Ctrl+A (selectAll()), not the browser's: a long file shows only
// the lines in view, and the editor selects all of its text itself.
const SUGGESTIONS = 5;

export function contextMenuTemplate(params, { replace, learn, selectAll }) {
  const editable = Boolean(params.isEditable);
  const flags = params.editFlags ?? {};
  if (!editable && !params.selectionText) return [];
  const items = [];
  if (editable && params.misspelledWord) {
    const suggestions = (params.dictionarySuggestions ?? []).slice(0, SUGGESTIONS);
    for (const word of suggestions) items.push({ label: word, click: () => replace(word) });
    if (!suggestions.length) items.push({ label: "No Suggestions", enabled: false });
    items.push({ label: "Add to Dictionary", click: () => learn(params.misspelledWord) }, { type: "separator" });
  }
  if (editable) items.push({ label: "Cut", role: "cut", enabled: Boolean(flags.canCut) });
  items.push({ label: "Copy", role: "copy", enabled: Boolean(flags.canCopy) });
  if (editable) items.push({ label: "Paste", role: "paste", enabled: Boolean(flags.canPaste) }, { type: "separator" },
    { label: "Select All", click: () => selectAll(), enabled: flags.canSelectAll !== false });
  return items;
}
