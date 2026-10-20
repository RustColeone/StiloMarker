// HTML pages, an extension: a page as a file. A .html (or .htm) file is
// edited as source and previewed in a sandboxed frame, where its scripts run
// in an origin of their own (adapters/frame.js). It uses only the core's
// public extension points:
//   File types   its type comes from ../extension.json (both ends read it)
//   Workspace    a page's relative images, resolved to the workspace's files
//   Editor       a preview, source highlighting and the formatting toolbar's pieces
//   Explorer     a new page's first content
// Nothing in the core names it; remove this folder and the app runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { SNIPPETS, STARTER, highlightHtmlLine } from "./model/html.js";
import { drawPage } from "./adapters/frame.js";

const TYPE = "htmlpage"; // the file type (not "html": the core spells that word everywhere)
const FORMAT = "html";    // its format: the highlighter's and the toolbar's

export default defineModule({
  name: "html-page",
  level: 6,
  uses: ["file-types", "workspace", "editor", "explorer"],
  owns: { names: ["file type .html"], data: ["extensions/html-page/extension.json"] },
  start(ctx) {
    const types = ctx.use("file-types");
    const workspace = ctx.use("workspace");
    const editor = ctx.use("editor");

    // Opening a page shows it in the preview too (its point).
    editor.previews.add({
      id: TYPE, matches: (file) => types.is(file.name, TYPE), cacheable: true, showOnOpen: true,
      render(target, project, file) {
        drawPage(target, file.content, (url) => workspace.location.resolveAsset(project, file.id, url));
        return { shouldTypeset: false, content: "" };
      }
    });
    editor.highlighters.add({ id: FORMAT, line: highlightHtmlLine });
    editor.toolbars.add({ id: FORMAT, groups: [SNIPPETS.map(({ snippet, ...button }) => ({ ...button, action: { kind: "block", snippet, caret: 1 } }))] });
    ctx.use("explorer").newFiles.add({ id: TYPE, content: () => STARTER });

    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./html-page.css", import.meta.url).href;
      document.head.append(style);
    }
    return {};
  }
});
