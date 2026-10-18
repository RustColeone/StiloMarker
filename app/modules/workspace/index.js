// Workspace: owns the project (its tree of folders and files, the operations
// that change it) and how files change (the one write path). Saving the
// project and syncing it are other modules' jobs (docs/ARCHITECTURE.md).
//
// API:
//   write(path, text, { base?, source? }) -> Promise<{ changed, text }>
//       Text files change by patches that merge with other people's edits;
//       images are replaced whole. With `base`, the change from base to text
//       is placed into the file as it is now. Throws StaleWriteError when it
//       no longer fits (nothing changes).
//   fits(path, text, base) -> boolean
//   patchOperation(path, text, baseRevision) -> a patch-file operation from the
//       file as it is now to `text`, or null when nothing changes (for writers
//       that chain operations on the server's confirmation, like a restore)
//   asPatch(operation, baseRevision) -> the operation as it should travel: a
//       text file's whole-file update becomes a patch (null if nothing changes)
//   isStale(error) -> boolean
//   events.on("written", ({ path, source }) => …)
//   openProject(project) -> the project store (once): getProject(), subscribe(),
//                   getActiveFile(), and the changes (updateContent, applySyncOperation…)
//   project()       -> that store
//   attach(ports)   for code from before the restructure, which still edits and
//                   syncs: { commit(path, previous, next, source), replace(operation, source) }
//   parts.add(provider) -> remove()    an extension point: a kind of file that
//       holds named parts, each listed under the file, opened, renamed, moved
//       and copied on its own. `id` is the file type's id; the rest work on
//       the file's text and return new text (they throw to refuse):
//         list(text) -> [{ id, name, title?, image? }]   (image: a link for hover previews)
//         body(text, id) -> what the source editor shows for one part
//         withBody(text, id, body)   rename(text, id, name)   remove(text, id)
//         take(text, id) -> the part as plain data, with its `name` (to copy or move)
//         insert(text, part, index | null)   (refuses a name the file has)
//         linkText?(part) -> what a part dropped into Markdown becomes
//         add?: { label, run(file) -> Promise<part | null> }   (a menu item that asks for a new part)
//   parts.of(name) -> the provider for a file name, or null
//   saving: schedule(project) after a change (this browser's copy, a local
//       project's folder, auto-save), saveActiveFile() (Save), runAutoSave(why),
//       scheduleAutoSave(), flush() (the browser copy, now), and
//       attach({ busy, scope, shared, confirmed }) from the app above, which
//       starts the page listeners and the periodic save (adapters/saving.js)
// Static: the project's storage (loadProject, saveProject; folders on disk:
// importDirectory, saveProjectToHandles...; on-device folders: openProjectOpfs,
// listOpfsDir...; snapshotProject, savedFileIds), a file's content as bytes and back (bytesToDataUrl, dataUrlToBlob,
// decodeTextBytes, getExportBytes, getMimeTypeForFileName,
// readFileAsProjectContent) and ZIP archives (createZip, downloadBlob,
// extractZipEntries). Static, for code from before the restructure: the pure project model
// (applySyncOperation, getPath, isImageFileName…), seedDefaultProject, and
// the text-patch rules.
import { defineModule } from "../../kernel/index.js";
import { createWriter, StaleWriteError } from "./service/writer.js";
import { createProjectController } from "./service/project-store.js";
import { getNodeByPath } from "./model/project.js";

const PART_FUNCTIONS = ["list", "body", "withBody", "rename", "remove", "take", "insert"];
function checkParts(provider) {
  for (const name of PART_FUNCTIONS) {
    if (typeof provider[name] !== "function") throw new Error(`file parts for ${provider.id} need ${name}()`);
  }
  if (provider.add && (typeof provider.add.label !== "string" || typeof provider.add.run !== "function")) {
    throw new Error(`file parts for ${provider.id}: add needs a label and run()`);
  }
}

export * from "./model/project.js";
export { seedDefaultProject } from "./service/project-store.js";
export { buildTextPatch, isTextPatch } from "./model/text-patch.js";
export { bytesToDataUrl, dataUrlToBlob, dataUrlToBytes, decodeTextBytes, getExportBytes, getMimeTypeForFileName, readFileAsProjectContent } from "./adapters/file-content.js";
export { createZip, downloadBlob, extractZipEntries } from "./adapters/zip.js";
export { loadProject, saveProject } from "./adapters/browser-copy.js";
export { buildProjectFromDirectoryHandle, buildSourceIndex, importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess } from "./adapters/disk-folders.js";
export { createProjectOpfs, deleteOpfsEntry, exportProjectModelOpfs, getOpfsDirectoryHandle, importOsFolderIntoOpfs, importProjectModelOpfs, listOpfsDir, mkdirOpfs, openProjectOpfs, saveProjectOpfs, supportsOpfs } from "./adapters/device-folders.js";
export { createProjectSaveQueue, savedFileIds, snapshotProject } from "./adapters/save-queue.js";
import { createSaving } from "./adapters/saving.js";
import { addStatusItems } from "./adapters/status-items.js";

export default defineModule({
  name: "workspace",
  level: 2,
  uses: ["shell", "file-types"],
  owns: { events: ["written"], registries: ["file parts"], storage: ["this browser's copy of the project", "a project's folder"], names: ["operation update-file", "operation patch-file", "operation replace-project"] },
  start(ctx) {
    const events = ctx.emitter();
    let store = null;
    const read = (path) => {
      const node = store ? getNodeByPath(store.getProject(), path) : null;
      return node?.kind === "file" ? { content: node.content ?? "" } : null;
    };
    const types = ctx.use("file-types");
    const writer = createWriter({ types, emit: events.emit, read });
    const parts = ctx.registry({ validate: checkParts });
    // Saving: this browser's copy, a local project's folder, auto-save, Save.
    const saving = createSaving({ store: () => store, settings: ctx.use("shell").settings, log: (...parts) => ctx.log(...parts) });
    // Auto-save is a setting in Settings → Appearance; turned on, it saves what is waiting.
    const shell = ctx.use("shell");
    shell.settingsDialog.fields.add({ page: "appearance", id: "auto-save-input", order: 100, key: "autoSave", control: "checkbox",
      label: "Auto-save (cloud, local workspace & browser cache; real folders still use Ctrl+S)", read: (s) => s.autoSave !== false });
    shell.settings.on((view, changed) => { if (changed.includes("autoSave") && view.autoSave && store) saving.scheduleAutoSave(); });
    // Where the project lives, in the status bar: drawn as the project changes.
    const drawStatus = addStatusItems({ shell, log: (message) => ctx.log(message) });
    function openProject(project) {
      if (store) throw new Error("The workspace already has a project open; use project().replaceProject()");
      store = createProjectController(project);
      store.subscribe(drawStatus);
      drawStatus(store.getProject());
      return store;
    }
    return {
      openProject,
      project: () => store,
      write: writer.write,
      patchOperation: writer.patchOperation,
      asPatch: writer.asPatch,
      fits: writer.fits,
      attach: writer.attach,
      isStale: (error) => error instanceof StaleWriteError,
      events: { on: events.on },
      parts: { add: parts.add, of: (name) => parts.get(types.typeOf(name)?.id ?? "") ?? null },
      saving
    };
  }
});
