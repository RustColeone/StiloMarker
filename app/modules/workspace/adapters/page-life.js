// What Workspace does as the page comes and goes: reattach the on-device
// folder the project was opened from (a reload keeps saving to it without
// asking again), keep this browser's copy when the page hides, and warn before
// leaving with a file that has unsaved changes.
import { getOpfsDirectoryHandle, supportsOpfs } from "./device-folders.js";
import { saveProject } from "./browser-copy.js";
import { ROOT_ID } from "../model/project.js";

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
