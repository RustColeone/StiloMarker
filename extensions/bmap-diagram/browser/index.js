// Diagrams (.bmap), an extension. It uses only the core's public extension
// points:
//   Editor     a preview: the diagram editor (adapters/view.js, loaded the
//              first time a diagram is shown) and edits written back; in the
//              source editor, highlighting, toolbar buttons and autocomplete
//              (adapters/source.js)
//   Explorer   "Export As" (PNG, JPG, SVG) on a diagram, and a new diagram's
//              first content
//   Shell      its two settings (declared in ../extension.json: Shell knows
//              their defaults and shows their fields in Settings → Appearance)
//   Assistant  Quick Generate asks the server's agent for a note, the map's
//              overview as its named context
// Its file type is declared in ../extension.json too, and its styles are its
// own (bmap.css). Nothing in the core names it; remove this folder and the
// app runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { createDefaultBmap } from "./model/bmap.js";
import { createDiagramExport } from "./adapters/export.js";
import { createGenerate } from "./adapters/generate.js";
import { addDiagramPreview } from "./adapters/preview.js";
import { completions, highlighter, toolbarGroups } from "./adapters/source.js";

const TYPE = "bmap";

export default defineModule({
  name: "bmap-diagram",
  level: 6,
  uses: ["shell", "file-types", "workspace", "identity", "editor", "sync", "explorer", "assistant"],
  owns: { names: ["the diagram editor"], data: ["extensions/bmap-diagram/extension.json"] },
  start(ctx) {
    const shell = ctx.use("shell"), types = ctx.use("file-types"), workspace = ctx.use("workspace");
    const editor = ctx.use("editor"), explorer = ctx.use("explorer");
    const log = (kind, message, detail) => ctx.log(detail ? `${message}: ${detail}` : message);

    const generate = createGenerate({ shell, workspace, identity: ctx.use("identity"), sync: ctx.use("sync"), editor, log });
    const preview = addDiagramPreview({ editor, shell, workspace, isDiagram: (name) => types.is(name, TYPE), generate, log });

    const exportAs = createDiagramExport({ get controller() { return workspace.project(); }, loadBmapView: preview.load, isDiagram: (name) => types.is(name, TYPE),
      notify: (message) => shell.notify(message), logDebug: log });
    explorer.fileMenus.add({
      id: TYPE,
      entries: [["Export As", null, [["Image (PNG)", "export-bmap-png"], ["Image (JPG)", "export-bmap-jpg"], ["Vector (SVG)", "export-bmap-svg"]]]],
      async run(action, nodeId) {
        const format = { "export-bmap-png": "png", "export-bmap-jpg": "jpg", "export-bmap-svg": "svg" }[action];
        if (format) await exportAs(nodeId, format);
      }
    });
    explorer.newFiles.add({ id: TYPE, content: () => createDefaultBmap() });
    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./bmap.css", import.meta.url).href;
      document.head.append(style);
    }
    editor.highlighters.add({ id: TYPE, ...highlighter });
    editor.toolbars.add({ id: TYPE, groups: toolbarGroups });
    editor.completions.add({ id: TYPE, ...completions });

    return {};
  }
});
