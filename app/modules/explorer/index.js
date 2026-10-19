// Explorer (browser): the project's tree and what is done to files from it:
// selecting, moving and copying files, folders and a file's parts, adding
// files (the Add File dialog, files and text dropped into the editor,
// replacing an image), creating, renaming, deleting, exporting, the context
// menu, and the Edit / Create menu items for them. It works on the project
// through Workspace, on the editor through the Editor's functions, on the
// live session through Sync, and asks through Shell's dialogs.
//
// API: attach(port) -> parts: creates the explorer, given what main.js still
// provides (adapters/surface.js lists it: PORT); parts() -> the same
// functions (renderTree(project), getSelectedParent(project),
// createFileInFolder(kind, parentId, name), handleExplorerAction...).
// fileMenus.add({ id: type, entries, run(action, nodeId) }): a file type's own
// context-menu entries; rootMenus.add({ id, entries() -> [[label, action]],
// run(action) }): entries on the project root's menu (Cloud's Manage Preview);
// newFiles.add({ id: type, content(name) }): a new file's first content
// (extension points). Events: "path-changed" { from, to } (a file or folder
// renamed or moved). Static: suggestUniqueFileName.
import { defineModule } from "../../kernel/index.js";
import { createSurface } from "./adapters/surface.js";

export { suggestUniqueFileName } from "./model/names.js";

export default defineModule({
  name: "explorer",
  level: 4,
  uses: ["shell", "file-types", "workspace", "editor", "sync"],
  owns: {
    elements: ["the explorer tree", "the Add File dialog", "the New File dialog"],
    state: ["the explorer clipboard", "a file being added"],
    registries: ["file menus", "root menus", "new file content"],
    events: ["path-changed"]
  },
  start(ctx) {
    // A file type's own context-menu entries: { id: type id, entries: [[label, action] | [label, null, [[label, action]]]],
    // run(action, nodeId) }; and a new file's first content: { id: type id, content(name) -> text }.
    const fileMenus = ctx.registry(), newFiles = ctx.registry();
    // Entries on the project root's menu: { id, entries() -> [[label, action]] (none when they don't apply), run(action) }.
    const rootMenus = ctx.registry({ validate: (entry) => { for (const key of ["entries", "run"]) if (typeof entry[key] !== "function") throw new Error(`root menu ${entry.id} needs ${key}()`); } });
    const events = ctx.emitter();
    let parts = null;
    function attach(port) {
      if (parts) throw new Error("explorer: already attached");
      parts = createSurface({ port, workspace: ctx.use("workspace"), editor: ctx.use("editor"), shell: ctx.use("shell"), sync: ctx.use("sync"),
        types: ctx.use("file-types"), fileMenus, rootMenus, newFiles, events });
      return parts;
    }
    return { attach, parts: () => parts, fileMenus: { add: fileMenus.add }, rootMenus: { add: rootMenus.add }, newFiles: { add: newFiles.add },
      events: { on: events.on } };
  }
});
