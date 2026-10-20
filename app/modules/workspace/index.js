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
//                   getActiveFile(), and the changes (updateContent, applySyncOperation…).
//                   In a page Workspace opens it itself at the start: the project
//                   this browser kept, else a seed project, and on a first visit
//                   the welcome template when it arrives (events "started-over" { project })
//   project()       -> that store
//   restoredProject() -> the project this browser kept, as the page started with it (or null)
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
//   location: where the open project lives (Sync configures it): key(project),
//     assetSrc(project, node) (an image's address), resolveAsset(project, fromNodeId, url)
//   events "saved": the user saved (Save, Ctrl+S); History takes a snapshot
//   What the Editor and Sync share (adapters/shared.js): typed(path, previous, next),
//     applyRemote(clientId, op), replace(project, { keepView }), editing.configure({ shows, apply }),
//     presence (carets); events "text-changed", "remote-change", "remote-applied",
//     "replacing", "replaced", "file-replaced", "own-caret", "other-caret", "carets-kept".
//     handover.offer(name, value) / receive(name, receiver): what one module hands
//     another on its level (the Assistant's old Roleplay threads to Chats); "handed-over".
//     holdSaving(busyNow): saving waits while busy (the Editor's IME composition)
//   saving: schedule(project) after a change (this browser's copy, a local
//       project's folder, auto-save), saveActiveFile() (Save), runAutoSave(why),
//       scheduleAutoSave(), flush() (the browser copy, now), keepAll() (Reload
//       Window's step: all of it, now; says what it could not keep), and
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
import { createProjectController, seedDefaultProject } from "./service/project-store.js";
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
export { getRelativePath, getRelativeProjectPath, normalizePath } from "./model/paths.js";
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
import { createLocation } from "./adapters/location.js";
import { createShared } from "./adapters/shared.js";
import { addWorkspaceCommands, reattachDeviceFolder, watchPage } from "./adapters/page-life.js";
import { loadProject } from "./adapters/browser-copy.js";
import { loadTemplateProject } from "./adapters/template.js";

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
    const location = createLocation();
    // What the Editor and Sync (same level) share through here (adapters/shared.js).
    const shared = createShared({ store: () => store, events });
    writer.attach(shared.ports);
    const savingHolds = new Set();
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
    // This browser's copy when the page hides, and a warning before leaving unsaved changes.
    watchPage({ store: () => store, log: (...parts) => ctx.log(parts.join(" ")), reloading: () => shell.reloading() });
    // Reload Window (Shell) writes everything first, after Sync's typing is confirmed.
    shell.beforeReload.add({ id: "workspace.files", label: "Your files", order: 20, keep: () => (store ? saving.keepAll() : "") });
    addWorkspaceCommands({ shell, log: (...parts) => ctx.log(parts.join(" ")) });
    // Save (Ctrl+S): auto-save keeps the work, so Save also marks a point to
    // compare against later; it says "saved" and History takes a snapshot.
    shell.commands.add({ id: "workspace.save", title: "Save", menu: { id: "file", group: 2, order: 1 }, keys: ["Mod+S"], async run() {
      try {
        ctx.log("Workspace save requested");
        await saving.saveActiveFile();
      } catch (error) {
        shell.notify(error.message);
      }
      events.emit("saved", {});
    } });
    function openProject(project) {
      if (store) throw new Error("The workspace already has a project open; use project().replaceProject()");
      store = createProjectController(project);
      store.subscribe(drawStatus);
      // Each change is saved (this browser's copy, a local project's folder,
      // auto-save) and the app asked to draw it (Shell holds that while typing).
      store.subscribe((next) => {
        saving.schedule(next);
        shell.render(next);
      });
      drawStatus(store.getProject());
      // Saving's questions (in a page): busy while the Editor holds it (an IME
      // composition), the workspace a save belongs to, shared or not, and which
      // files the server has confirmed (Sync tells the location).
      if (globalThis.window) {
        saving.attach({ busy: () => [...savingHolds].some((busy) => busy()), scope: () => location.key(store.getProject()),
          shared: () => location.shared(), confirmed: (project, ids) => location.confirmed(project, ids) });
      }
      // A project opened from a folder on this device keeps saving to it after a reload.
      void reattachDeviceFolder({ store, settings: shell.settings, log: (...parts) => ctx.log(parts.join(" ")) });
      return store;
    }
    // A first visit (nothing kept in this browser) gets the welcome template,
    // unless something took over while it loaded. It is only a placeholder,
    // fetched file by file: installed inside a cloud workspace restoring itself
    // on a fresh device, the next reconnect would upload it there (seen on a
    // slow connection). Installed, it is a fresh start ("started-over").
    function installTemplate() {
      const placeholder = store.getProject();
      void loadTemplateProject().then((project) => {
        const current = store.getProject();
        const edited = Object.values(current.nodes ?? {}).some((node) => node?.dirty);
        if (location.shared() || current.id !== placeholder.id || edited) {
          ctx.log("Default template not installed: a workspace or edits arrived first");
          return;
        }
        store.replaceProject(project);
        events.emit("started-over", { project });
        ctx.log(`Default template loaded: ${project.name}`);
      }).catch((error) => ctx.log(`Default template load failed: ${error.message}`));
    }
    // In a page, the project opens at once: the one this browser kept, else a
    // seed project until the template arrives. Its name shows in the title bar.
    let restored = null;
    if (globalThis.window) {
      restored = loadProject();
      openProject(restored ?? seedDefaultProject());
      if (!restored) ctx.whenStarted(installTemplate);
      shell.events.on("render", ({ project }) => {
        const label = globalThis.document?.getElementById("project-name-label");
        if (project && label) label.textContent = project.name;
      });
    }
    return {
      openProject,
      project: () => store,
      restoredProject: () => restored,
      write: writer.write,
      patchOperation: writer.patchOperation,
      asPatch: writer.asPatch,
      fits: writer.fits,
      typed: shared.typed,
      applyRemote: shared.applyRemote,
      replace: shared.replace,
      editing: shared.editing,
      presence: shared.presence,
      handover: shared.handover,
      holdSaving(busyNow) { savingHolds.add(busyNow); return () => savingHolds.delete(busyNow); },
      isStale: (error) => error instanceof StaleWriteError,
      events: { on: events.on },
      parts: { add: parts.add, of: (name) => parts.get(types.typeOf(name)?.id ?? "") ?? null },
      saving,
      location
    };
  }
});
