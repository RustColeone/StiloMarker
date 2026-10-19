// What Workspace does as the page comes and goes: reattach the on-device
// folder the project was opened from (a reload keeps saving to it without
// asking again), keep this browser's copy when the page hides, and warn before
// leaving with a file that has unsaved changes.
import { getOpfsDirectoryHandle, supportsOpfs } from "./device-folders.js";
import { saveProject } from "./browser-copy.js";
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

export function watchPage({ store, log, win = globalThis.window, doc = globalThis.document }) {
  const keepCopy = () => {
    try { saveProject(store().getProject()); } catch (error) { log("Browser recovery save failed", error.message); }
  };
  win?.addEventListener("pagehide", keepCopy);
  doc?.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") keepCopy(); });
  win?.addEventListener("beforeunload", (event) => {
    if (!store()?.getActiveFile()?.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

// Empty Everything (Settings menu): everything the app keeps in this browser
// cleared, and an empty project saved so the next start does not fall back to
// the welcome workspace. And the welcome page's "Open a local folder".
export function addWorkspaceCommands({ shell, log, doc = globalThis.document }) {
  shell.commands.add({ id: "workspace.empty-everything", title: "Empty Everything", menu: { id: "settings", group: 0, order: 4 }, danger: true, async run() {
    const confirmed = await shell.confirm({ title: "Empty Everything",
      message: "This deletes your workspace, chat history, and settings, then reloads into a completely empty workspace (no welcome files). This cannot be undone.",
      acceptLabel: "Empty Everything" });
    if (!confirmed) return;
    shell.closeMenus();
    shell.clearAppStorage();
    saveProject(createProject("Workspace"));
    log("Workspace emptied");
    globalThis.location.reload();
  } });
  doc?.getElementById("welcome-open-local")?.addEventListener("click", () => void shell.run("workspace.import-folder"));
}
