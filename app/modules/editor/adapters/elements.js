// The Editor's elements on the page (the source editor, find and replace, autocomplete, the formatting toolbar, the tab strips and the preview pane),
// looked up once when it starts. A missing one stops the start: the page and
// the code disagree.
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
    editorContent: query("#editor-content"),
    editorCursors: query("#editor-cursors"),
    editorDropCaret: query("#editor-drop-caret"),
    editorEmptyState: query("#editor-empty-state"),
    editorFindBar: query("#editor-find-bar"),
    editorFormatToolbar: query("#editor-format-toolbar"),
    editorGutter: query("#editor-gutter"),
    editorMarkBar: query("#editor-mark-bar"),
    editorOverviewRuler: query("#editor-overview-ruler"),
    editorScroll: query("#editor-scroll"),
    editorSearchHighlights: query("#editor-search-highlights"),
    findClose: query("#find-close"),
    findCount: query("#find-count"),
    findInput: query("#find-input"),
    searchActivityButton: query("#search-activity-button"),
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
    sourceBody: query("#source-body"),
    sourcePane: query("#source-pane"),
    sourceTabOverflow: query("#source-tab-overflow"),
    sourceTabStrip: query("#source-tab-strip"),
    tabOverflowMenu: query("#tab-overflow-menu"),
    tabContextMenu: query("#tab-context-menu")
  };
}
