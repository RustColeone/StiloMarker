// Editor (browser): the source editor (the contenteditable, its incremental
// rendering, caret and selection, undo, other people's cursors, the
// formatting toolbar, keys), highlighting, find and replace, autocomplete,
// links between notes, the tab strips and panes, and the preview pane with
// its extension point for other kinds of file (adapters/preview.js), and the
// Markdown renderer.
//
// API: previews, highlighters, toolbars (extension points) and view: what the
// editor shows, read with view.get() and changed only through its actions
// (service/view.js): reset(project), pick(nodeId, partId?), select(nodeId),
// openTab/closeTab(pane, fileId), moveTab(pane, id, targetId, after?),
// showPreview(fileId, partId?), showDiff(id), clearParts(), dragTab(state),
// keepTabs(project, { diffTabId, diffActive }).
//
// Static, for code from before the restructure (each takes the app's shared
// values, as before):
//   createEditorCore(app)   createHighlighter(app)   createFindReplace(app)
//     (app.toolbars and app.highlighters: this module's extension points)
//   createAutocomplete(app)   createLinks(app)
//   createPanes(app, previews)   the tab strips, panes and preview (previews: this module's extension point)
//   renderMarkdown, extractMarkdownLinks, collectMarkdownReferences, parseMarkdownInlineElements
//   buildTableSnippet, getEditorToolbarFormat, TOOLBAR_SPECS
import { defineModule } from "../../kernel/index.js";

export { createEditorCore } from "./adapters/editor-core.js";
export { createHighlighter } from "./adapters/highlight.js";
export { createFindReplace } from "./adapters/find-replace.js";
export { createAutocomplete } from "./adapters/autocomplete.js";
export { createLinks } from "./adapters/links.js";
import { createPreview } from "./adapters/preview.js";
import { createTabs } from "./adapters/tabs.js";
import { EMPTY_VIEW, createView } from "./service/view.js";

export function createPanes(app, previews) {
  return { ...createTabs(app), ...createPreview(app, previews) };
}
export { TOOLBAR_SPECS, buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./adapters/format-toolbar.js";
export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown } from "./model/markdown.js";

export default defineModule({
  name: "editor",
  level: 3,
  uses: ["shell", "file-types", "workspace"],
  owns: { elements: ["the source editor", "the formatting toolbar", "the find bar", "the tab strips", "the preview pane"],
    state: ["the open tabs", "what each pane shows", "the explorer selection"],
    registries: ["previews", "highlighters", "toolbars"], rules: ["Markdown rendering"] },
  start(ctx) {
    // Previews of other kinds of file: { id, matches(file), render(target, project, file, tools), cacheable?, printHtml? }
    const previews = ctx.registry();
    // Highlighting for a format that is not built in: { id: format, line(rawLine, { escape, blank }) -> html }
    const highlighters = ctx.registry({ validate: (entry) => { if (typeof entry.line !== "function") throw new Error(`highlighter ${entry.id} needs line()`); } });
    // Formatting-toolbar buttons for such a format: { id: format, groups: [[{ id, html, title, action }]] }
    const toolbars = ctx.registry({ validate: (entry) => { if (!Array.isArray(entry.groups)) throw new Error(`toolbar ${entry.id} needs groups`); } });
    const open = (registry) => ({ add: registry.add, get: registry.get, all: registry.all });
    // What the editor shows (tabs, the preview's file and part, the selection): read view.get(), change it through its actions.
    const view = createView(ctx.state(EMPTY_VIEW));
    return { previews: open(previews), highlighters: open(highlighters), toolbars: open(toolbars), view };
  }
});
