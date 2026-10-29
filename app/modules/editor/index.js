// Editor (browser): the source editors, one in each group (the
// contenteditable, its incremental rendering, caret and selection, undo,
// other people's cursors, the formatting toolbar, keys; the one last worked in
// is the active one: adapters/editors.js), highlighting, find and replace, autocomplete,
// links between notes, the tab strips and panes, and the preview pane with
// its extension point for other kinds of file (adapters/preview.js), and the
// Markdown renderer.
//
// API: parts() -> the active source editor's, find's, autocomplete's, links', the tab
// strips' and the preview's functions (adapters/surface.js), created when the
// Editor starts in a page.
// previews, codeBlocks (code blocks of a language drawn in a Markdown
// preview: Mermaid's diagrams), highlighters, toolbars, completions (autocomplete for a format),
// lineNotes (notes on lines in the gutter: comments), welcome (parts of the
// page shown when no file is open),
// paneViews (tabs in the preview pane that
// are not files, such as History's diff) and marks (extension points; marks are
// what other modules put on files' lines, service/marks.js) and view: what the
// editor shows, read with view.get() and changed only through its actions
// (service/view.js): reset(project), restore(kept), pick(nodeId, partId?),
// select(nodeId), openTab/closeTab(view, fileId, group?), showSource(fileId),
// activate(group, tab), switchView(group, tab, view), moveTab(group, dragged,
// target, after?), moveToGroup(from, to, tab, options?), closeGroup(group),
// showPreview(fileId, partId?), showView(id), clearParts(), dragTab(state),
// keepTabs(project, { views, open }). drops.configure(handle(event)): who
// handles what is dropped into the source editor (the Explorer).
//
// Static, for code with no module context (other modules' views, extensions): renderMarkdown,
// extractMarkdownLinks, collectMarkdownReferences, parseMarkdownInlineElements,
// buildTableSnippet, getEditorToolbarFormat, TOOLBAR_SPECS, escapeHtmlAttribute,
// the project path helpers, forgetViewStates (the saved resume positions).
import { defineModule } from "../../kernel/index.js";
import { EMPTY_VIEW, createView } from "./service/view.js";
import { EMPTY_MARKS, createMarks } from "./service/marks.js";
import { createSurface } from "./adapters/surface.js";
import { forgetViewStates } from "./adapters/resume.js";
import { addEditorSettings, applyEditorFont } from "./adapters/settings-fields.js";

export { TOOLBAR_SPECS, buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar } from "./adapters/format-toolbar.js";
export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown } from "./model/markdown.js";
export { escapeHtmlAttribute } from "./model/html.js";
export { getRelativePath, getRelativeProjectPath, normalizePath } from "../workspace/index.js";
export { forgetViewStates } from "./adapters/resume.js";
export { clampSourceFontSize, cssFontFamily } from "./model/font.js";

const FONT_KEYS = ["sourceFontSize", "sourceFontFamily"];

export default defineModule({
  name: "editor",
  level: 3,
  uses: ["shell", "file-types", "workspace", "identity"],
  owns: { elements: ["the source editors", "the formatting toolbar", "the find bar", "the tab strips", "the preview pane"],
    state: ["the open tabs", "what each pane shows", "the explorer selection"],
    registries: ["previews", "code blocks", "highlighters", "toolbars", "completions", "line notes", "marks", "pane views", "the welcome page"], rules: ["Markdown rendering"] },
  start(ctx) {
    // Previews of other kinds of file: { id, matches(file), render(target, project, file, tools), cacheable?, printHtml? }
    const previews = ctx.registry();
    // Code blocks of a language drawn in a Markdown preview, after it renders:
    // { id, languages: ["mermaid"], render(block, code, tools) } (block: the .md-code-block; may be async).
    const codeBlocks = ctx.registry({ validate: (entry) => {
      if (!Array.isArray(entry.languages) || typeof entry.render !== "function") throw new Error(`code blocks ${entry.id} need languages and render()`);
    } });
    // Highlighting for a format that is not built in: { id: format, line(rawLine, { escape, blank }) -> html }
    const highlighters = ctx.registry({ validate: (entry) => { if (typeof entry.line !== "function") throw new Error(`highlighter ${entry.id} needs line()`); } });
    // Formatting-toolbar buttons for such a format: { id: format, groups: [[{ id, html, title, action }]] }
    const toolbars = ctx.registry({ validate: (entry) => { if (!Array.isArray(entry.groups)) throw new Error(`toolbar ${entry.id} needs groups`); } });
    // Autocomplete for a format that is not built in: { id: format, find({ text, cursor, force }) -> { kind, token,
    // start, end } | null, items(context, { project, file, projectFiles(kind) }) -> [{ label, detail, insertText }],
    // label(context) -> the list's title } (a diagram's blocks and properties).
    const completions = ctx.registry({ validate: (entry) => { for (const key of ["find", "items", "label"]) if (typeof entry[key] !== "function") throw new Error(`completions ${entry.id} need ${key}()`); } });
    // Notes on a file's lines, shown in the gutter and on the overview ruler: { id, kind,
    // notes(file) -> [{ line, title }], click?(line) } (Comments; a line number's click goes to it).
    const lineNotes = ctx.registry({ validate: (entry) => { if (typeof entry.notes !== "function" || !entry.kind) throw new Error(`line notes ${entry.id} need kind and notes()`); } });
    // The welcome page (no file open): { id, draw() } for whoever keeps one of its parts current (Cloud's Resume).
    const welcome = ctx.registry({ validate: (entry) => { if (typeof entry.draw !== "function") throw new Error(`welcome ${entry.id} needs draw()`); } });
    // Tabs in the preview pane that are not files: { id, element, tab() -> { label, title, iconText, iconClass } | null
    // (null while closed), show({ fresh }), close() } (History's diff).
    const paneViews = ctx.registry({ validate: (entry) => { for (const key of ["tab", "show", "close"]) if (typeof entry[key] !== "function") throw new Error(`pane view ${entry.id} needs ${key}()`); } });
    const open = (registry) => ({ add: registry.add, get: registry.get, all: registry.all });
    // What the editor shows (tabs, the preview's file and part, the selection): read view.get(), change it through its actions.
    const view = createView(ctx.state(EMPTY_VIEW));
    // Marks on files' lines, tabs and explorer rows, put by other modules (the agent's applied edits).
    const marks = createMarks(ctx.state(EMPTY_MARKS));
    // Its settings in Settings → Appearance; the font follows them from the start.
    const shell = ctx.use("shell");
    // Clear All Cache (Shell) also drops the saved resume positions.
    shell.events.on("clearing-caches", () => forgetViewStates());
    addEditorSettings({ dialog: shell.settingsDialog, settings: shell.settings });
    applyEditorFont(shell.settings);
    shell.settings.on((view, changed) => { if (changed.some((key) => FONT_KEYS.includes(key))) applyEditorFont(view); });
    let parts = null;
    // Keeping the open tabs on the server for a cloud workspace: Cloud says how (configure).
    let saveOpenTabs = async () => {};
    const openTabsStore = { save: (...args) => saveOpenTabs(...args), configure(save) { saveOpenTabs = save; } };
    // What is dropped into the source editor is handled by whoever configures it (the Explorer adds files).
    let handleDrop = async () => {};
    const drops = { handle: (event) => handleDrop(event), configure(handle) { handleDrop = handle; } };
    // The source editor, find, autocomplete, links, the tab strips and the preview (in a page).
    if (globalThis.document) {
      parts = createSurface({ view, marks, identity: ctx.use("identity"), openTabsStore, drops, paneViews: open(paneViews), completions: open(completions), lineNotes: open(lineNotes), welcome: open(welcome), previews: open(previews), codeBlocks: open(codeBlocks), highlighters: open(highlighters), toolbars: open(toolbars),
        workspace: ctx.use("workspace"), shell: ctx.use("shell") });
      // The browser's own workspace, opened again, comes back with the tabs it
      // had (a cloud workspace's come back as it opens: tabs.js).
      const opened = ctx.use("workspace").restoredProject()?.id ?? null;
      ctx.whenStarted(() => { parts.restoreOwnView(opened); });
    }
    return { previews: open(previews), codeBlocks: open(codeBlocks), highlighters: open(highlighters), toolbars: open(toolbars), paneViews: open(paneViews), completions: open(completions), lineNotes: open(lineNotes), welcome: open(welcome), marks,
      openTabs: { configure: openTabsStore.configure }, drops: { configure: drops.configure }, view, parts: () => parts };
  }
});
