// Module maps, an extension. It uses only the core's public extension points:
//   Explorer   "Generate Module Map" on a .mtree file (a file menu)
//   Editor     the written file opened in the source editor and the preview,
//              and the dialog's Markdown highlighting, rendering and keys
//   Workspace  the map written into a Markdown file (or a new one, sent by Sync)
// The dialog (adapters/tools.js, its markup adapters/dialog.js) loads the
// first time it opens; its styles (module-map.css) load with the page. While it is
// open and focused, Ctrl+S writes the map instead of saving the file.
// Nothing in the core names it; remove this folder and the app runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { findChildByName, getNode, getPath } from "../../../app/modules/workspace/index.js";
import { renderMarkdown } from "../../../app/modules/editor/index.js";

const TYPE = "mtree";

export default defineModule({
  name: "module-map",
  level: 6,
  uses: ["shell", "file-types", "workspace", "editor", "sync", "explorer"],
  owns: { elements: ["the module map dialog"], data: ["extensions/module-map/extension.json"] },
  start(ctx) {
    const shell = ctx.use("shell"), workspace = ctx.use("workspace"), editor = ctx.use("editor"), sync = ctx.use("sync");
    let tools = null;
    let loading = null;
    function load() {
      loading ??= import("./adapters/tools.js").then(({ createModuleMapTools }) => {
        const parts = editor.parts();
        tools = createModuleMapTools({
          get controller() { return workspace.project(); }, getPath, getNode, findChildByName, renderMarkdown, workspace,
          notify: (message) => shell.notify(message),
          publishOperation: (operation) => sync.publish(operation),
          setActiveSourceFile: (id) => parts.setActiveSourceFile(id),
          setPreviewFile: (id) => parts.setPreviewFile(id),
          highlightMarkdownSource: (text) => parts.highlightMarkdownSource(text),
          typesetPreview: (...args) => parts.typesetPreview(...args),
          handleIndentKeydown: (event) => parts.handleIndentKeydown(event)
        });
        return tools;
      }).catch((error) => {
        loading = null;
        throw error;
      });
      return loading;
    }
    async function open(fileId) {
      try {
        (await load()).open(fileId);
      } catch (error) {
        shell.notify(`Module map tools could not load: ${error.message}`);
      }
    }

    ctx.use("explorer").fileMenus.add({
      id: TYPE,
      entries: [["Generate Module Map", "generate-module-map"]],
      async run(action, nodeId) {
        if (action === "generate-module-map") await open(nodeId);
      }
    });
    // While the dialog is open and focused, Ctrl+S writes the map (before Shell's shortcut saves the file).
    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      if (!tools?.isOpen() || !tools.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      ctx.log("Module map written to target");
      tools.write();
    }, true);
    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./module-map.css", import.meta.url).href;
      document.head.append(style);
    }
    return { open };
  }
});
