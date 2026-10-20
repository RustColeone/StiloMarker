// Mermaid, an extension: diagrams written as text. A .mmd (or .mermaid) file
// is edited as source and previewed as its diagram, and a ```mermaid block in
// a note is drawn in the note's preview. It uses only the core's public
// extension points:
//   File types   its type comes from ../extension.json (both ends read it)
//   Editor       a preview, codeBlocks (the blocks in Markdown), source
//                highlighting and the formatting toolbar's snippets
//   Explorer     a new diagram's first content
// The library (Mermaid 11, adapters/library.js) is imported from jsDelivr the
// first time a diagram shows. Nothing in the core names it; remove this folder
// and the app runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { SNIPPETS, STARTER, highlightMermaidLine } from "./model/mermaid.js";
import { createMermaid } from "./adapters/library.js";
import { drawCodeBlock, drawFilePreview } from "./adapters/draw.js";

const TYPE = "mermaid";

export default defineModule({
  name: "mermaid",
  level: 6,
  uses: ["file-types", "editor", "explorer"],
  owns: { names: ["file type .mmd"], data: ["extensions/mermaid/extension.json"] },
  start(ctx) {
    const types = ctx.use("file-types");
    const editor = ctx.use("editor");
    const mermaid = createMermaid();

    // Opening a diagram shows it in the preview too (its point), as a .bmap's editor does.
    editor.previews.add({
      id: TYPE, matches: (file) => types.is(file.name, TYPE), cacheable: true, showOnOpen: true,
      render(target, project, file) {
        drawFilePreview(target, file.content, mermaid);
        return { shouldTypeset: false, content: "" };
      }
    });
    editor.codeBlocks.add({ id: TYPE, languages: ["mermaid"], render: (block, code) => drawCodeBlock(block, code, mermaid) });
    editor.highlighters.add({ id: TYPE, line: highlightMermaidLine });
    editor.toolbars.add({ id: TYPE, groups: [SNIPPETS.map(({ snippet, ...button }) => ({ ...button, action: { kind: "block", snippet, caret: 1 } }))] });
    ctx.use("explorer").newFiles.add({ id: TYPE, content: () => STARTER });

    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./mermaid.css", import.meta.url).href;
      document.head.append(style);
    }
    return {};
  }
});
