// What Workspace does as the page comes and goes: reattach the on-device
// folder the project was opened from (a reload keeps saving to it without
// asking again), keep this browser's copy when the page hides (not once the
// app's storage was cleared: Reset, Empty Everything), and warn before leaving
// with a file that has unsaved changes (not while Reload Window, which kept
// them, reloads).
import { getOpfsDirectoryHandle, supportsOpfs } from "./device-folders.js";
import { clearCopies, saveProject } from "./browser-copy.js";
import { ROOT_ID, createProject } from "../model/project.js";

export async function reattachDeviceFolder({ store, settings, log }) {
  const path = store.getProject()?.localPath ?? settings.lastLocalProject?.path;
  if (store.getProject()?.sourceMode !== "opfs" || !path || !supportsOpfs()) return;
  try {
    // The handle first; then it goes on the project as it is by then, so an
    // edit made meanwhile can't leave it on an old copy.
    const dir = await getOpfsDirectoryHandle(path);
    const project = store.getProject();
    project.sourceMode = "opfs";
    project.localPath = path;
    project.handles = { [ROOT_ID]: dir };
    log("Reattached local workspace", path);
  } catch (error) {
    // The folder is gone (or there is no device storage): keep the browser's copy.
    store.getProject().sourceMode = "memory";
    log("Local workspace reattach failed", error.message);
  }
}

// keep(): this browser's copy kept now (Workspace's saving); cleared(): the
// app's storage was cleared while this page was open; reloading(): Shell's
// Reload Window, which kept the work first, is reloading.
export function watchPage({ store, keep, cleared = () => false, reloading = () => false, win = globalThis.window, doc = globalThis.document }) {
  const keepCopy = () => { if (!cleared()) keep(); };
  win?.addEventListener("pagehide", keepCopy);
  doc?.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") keepCopy(); });
  win?.addEventListener("beforeunload", (event) => {
    if (reloading() || !store()?.getActiveFile()?.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

// Empty Everything (Settings menu): everything the app keeps in this browser
// cleared (every workspace's copy too), and an empty project saved so the
// next start does not fall back to the welcome workspace.
export function addWorkspaceCommands({ shell, log, doc = globalThis.document }) {
  shell.commands.add({ id: "workspace.empty-everything", title: "Empty Everything", menu: { id: "settings", group: 2, order: 2 }, danger: true, async run() {
    const confirmed = await shell.confirm({ title: "Empty Everything",
      message: "This deletes your workspace, chat history, and settings, then reloads into a completely empty workspace (no welcome files). This cannot be undone.",
      acceptLabel: "Empty Everything", danger: true });
    if (!confirmed) return;
    shell.closeMenus();
    shell.clearAppStorage();
    try {
      await clearCopies();
      await saveProject(createProject("Workspace"));
    } catch (error) {
      log(`Emptying could not write the empty workspace: ${error.message}`); // the next start finds none and opens the welcome
    }
    log("Workspace emptied");
    shell.announceCleared?.();
    globalThis.location.reload();
  } });
}
