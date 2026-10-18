// Diagrams (.bmap), an extension. It uses only the core's public extension
// points:
//   Editor     a preview: the diagram editor (adapters/view.js, loaded the
//              first time a diagram is shown) and edits written back
//   Explorer   "Export As" (PNG, JPG, SVG) on a diagram, and a new diagram's
//              first content
//   Shell      its two settings in Settings → Appearance
//   Assistant  Quick Generate asks the server's agent for a note
// The file type is still one of File types' built-in ones (see extension.json).
import { defineModule } from "../../../app/kernel/index.js";
import { createDefaultBmap } from "./model/bmap.js";
import { createDiagramExport } from "./adapters/export.js";
import { createGenerate } from "./adapters/generate.js";
import { addDiagramPreview } from "./adapters/preview.js";

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

    const exportAs = createDiagramExport({ get controller() { return workspace.project(); }, loadBmapView: preview.load,
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

    shell.settingsDialog.fields.add({ page: "appearance", id: "bmap-generate-scope-select", order: 110, label: "Bmap Generate Context",
      key: "bmapGenerateScope", control: "select", options: [["connected", "Connected nodes only"], ["all", "All linked files"]],
      read: (s) => (s.bmapGenerateScope === "all" ? "all" : "connected") });
    shell.settingsDialog.fields.add({ page: "appearance", id: "bmap-auto-pan-input", order: 120, label: "Auto-pan diagrams to content on open",
      key: "bmapAutoPan", control: "checkbox", read: (s) => s.bmapAutoPan !== false });
    return {};
  }
});
