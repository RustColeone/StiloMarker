// Editor (browser): the source editor (the contenteditable, its incremental
// rendering, caret and selection, undo, other people's cursors, the
// formatting toolbar, keys), highlighting, find and replace, autocomplete,
// links between notes, and the Markdown renderer the previews use. The panes
// and their previews are still app/features/panes.js (step 7g-2).
//
// Static, for code from before the restructure (each takes the app's shared
// values, as before):
//   createEditorCore(app)   createHighlighter(app)   createFindReplace(app)
//   createAutocomplete(app)   createLinks(app)
//   renderMarkdown, extractMarkdownLinks, collectMarkdownReferences, parseMarkdownInlineElements
//   buildTableSnippet, getEditorToolbarFormat, TOOLBAR_SPECS
import { defineModule } from "../../kernel/index.js";

export { createEditorCore } from "./adapters/editor-core.js";
export { createHighlighter } from "./adapters/highlight.js";
export { createFindReplace } from "./adapters/find-replace.js";
export { createAutocomplete } from "./adapters/autocomplete.js";
export { createLinks } from "./adapters/links.js";
export { TOOLBAR_SPECS, buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./adapters/format-toolbar.js";
export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown } from "./model/markdown.js";

export default defineModule({
  name: "editor",
  level: 3,
  uses: ["shell", "file-types", "workspace"],
  owns: { elements: ["the source editor", "the formatting toolbar", "the find bar"], rules: ["Markdown rendering"] },
  start() {
    return {};
  }
});
