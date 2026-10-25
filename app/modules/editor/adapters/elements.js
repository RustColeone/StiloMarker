// The Editor's elements on the page (find and replace, autocomplete, the tab
// strips and the preview pane), looked up once when it starts, and each source
// editor's own (editorElements: found in its body; the left one's carry the
// ids, a second editor is a copy without them: editors.js). A missing one
// stops the start: the page and the code disagree.
function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing DOM node: ${selector}`);
  return node;
}

export function findElements() {
  return {
    app: query("#app"),
    editorAutocomplete: query("#editor-autocomplete"),
    editorAutocompleteLabel: query("#editor-autocomplete-label"),
    editorAutocompleteList: query("#editor-autocomplete-list"),
    editorFindBar: query("#editor-find-bar"),
    findClose: query("#find-close"),
    findCount: query("#find-count"),
    findInput: query("#find-input"),
    findNext: query("#find-next"),
    findPrev: query("#find-prev"),
    findReplaceRow: query("#find-replace-row"),
    findToggleCase: query("#find-toggle-case"),
    findToggleRegex: query("#find-toggle-regex"),
    findToggleReplace: query("#find-toggle-replace"),
    findToggleWord: query("#find-toggle-word"),
    preview: query("#preview-output"),
    previewBody: query("#preview-body"),
    previewPane: query("#preview-pane"),
    previewTabOverflow: query("#preview-tab-overflow"),
    previewTabStrip: query("#preview-tab-strip"),
    replaceAll: query("#replace-all"),
    replaceInput: query("#replace-input"),
    replaceOne: query("#replace-one"),
    sourcePane: query("#source-pane"),
    sourceTabOverflow: query("#source-tab-overflow"),
    sourceTabStrip: query("#source-tab-strip"),
    tabOverflowMenu: query("#tab-overflow-menu"),
    tabContextMenu: query("#tab-context-menu")
  };
}

// A source editor's own elements, by class, in its body (a .source-body).
const EDITOR_PARTS = {
  editorContent: ".editor-content",
  editorCursors: ".editor-cursors",
  editorDropCaret: ".editor-drop-caret",
  editorEmptyState: ".editor-empty-state",
  editorFormatToolbar: ".editor-format-toolbar",
  editorGutter: ".editor-gutter",
  editorMarkBar: ".editor-mark-bar",
  editorOverviewRuler: ".editor-overview-ruler",
  editorScroll: ".editor-scroll",
  editorSearchHighlights: ".editor-search-highlights",
  editorSurface: ".editor-surface"
};

export function editorElements(body) {
  const found = { sourceBody: body };
  for (const [name, selector] of Object.entries(EDITOR_PARTS)) {
    const node = body.querySelector(selector);
    if (!node) throw new Error(`Missing DOM node in a source editor: ${selector}`);
    found[name] = node;
  }
  return found;
}
