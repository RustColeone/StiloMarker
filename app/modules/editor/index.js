// Editor (browser): the source editor (the contenteditable, its incremental
// rendering, caret and selection, undo, other people's cursors, the
// formatting toolbar, keys), highlighting, find and replace, autocomplete,
// links between notes, the tab strips and panes, and the preview pane with
// its extension point for other kinds of file (adapters/preview.js), and the
// Markdown renderer.
//
// API: attach(port) -> parts: creates the source editor, find, autocomplete,
// links, the tab strips and the preview, given what main.js still provides
// (adapters/surface.js lists it: PORT); parts() -> the same functions.
// previews, highlighters, toolbars and marks (extension points; marks are
// what other modules put on files' lines, service/marks.js) and view: what the
// editor shows, read with view.get() and changed only through its actions
// (service/view.js): reset(project), pick(nodeId, partId?), select(nodeId),
// openTab/closeTab(pane, fileId), moveTab(pane, id, targetId, after?),
// showPreview(fileId, partId?), showDiff(id), clearParts(), dragTab(state),
// keepTabs(project, { diffTabId, diffActive }).
//
// Static, for code from before the restructure: renderMarkdown,
// extractMarkdownLinks, collectMarkdownReferences, parseMarkdownInlineElements,
// buildTableSnippet, getEditorToolbarFormat, TOOLBAR_SPECS, escapeHtmlAttribute,
// the project path helpers, forgetViewStates (the saved resume positions) and
// DIFF_TAB_ID (the preview's diff tab).
import { defineModule } from "../../kernel/index.js";
import { DIFF_TAB_ID, EMPTY_VIEW, createView } from "./service/view.js";
import { EMPTY_MARKS, createMarks } from "./service/marks.js";
import { createSurface } from "./adapters/surface.js";

export { TOOLBAR_SPECS, buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./adapters/format-toolbar.js";
export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown } from "./model/markdown.js";
export { escapeHtmlAttribute } from "./model/html.js";
export { getRelativePath, getRelativeProjectPath, normalizePath } from "./model/paths.js";
export { forgetViewStates } from "./adapters/resume.js";
export { DIFF_TAB_ID };

export default defineModule({
  name: "editor",
  level: 3,
  uses: ["shell", "file-types", "workspace"],
  owns: { elements: ["the source editor", "the formatting toolbar", "the find bar", "the tab strips", "the preview pane"],
    state: ["the open tabs", "what each pane shows", "the explorer selection"],
    registries: ["previews", "highlighters", "toolbars", "marks"], rules: ["Markdown rendering"] },
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
    // Marks on files' lines, tabs and explorer rows, put by other modules (the agent's applied edits).
    const marks = createMarks(ctx.state(EMPTY_MARKS));
    // The source editor, find, autocomplete, links, the tab strips and the preview:
    // created once main.js attaches what no module owns yet (surface.js, PORT).
    let parts = null;
    function attach(port) {
      if (parts) throw new Error("editor: already attached");
      parts = createSurface({ port, view, marks, previews: open(previews), highlighters: open(highlighters), toolbars: open(toolbars),
        workspace: ctx.use("workspace"), shell: ctx.use("shell") });
      return parts;
    }
    return { previews: open(previews), highlighters: open(highlighters), toolbars: open(toolbars), marks, view, attach, parts: () => parts };
  }
});
