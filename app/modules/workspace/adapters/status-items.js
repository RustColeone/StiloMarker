// Workspace's items in the status bar: where the open project lives (a folder
// on disk, a workspace on this device, or this browser), and, only when it
// can't, that this browser can't edit a folder on disk in place (that it can
// is no news); and, while this browser's copy can't be written, a red item
// (the first failure also says so in a notice). draw(project) after each
// change; reportCopy(error | null) after each write of the copy.
import { supportsDirectoryAccess } from "./disk-folders.js";

export function addStatusItems({ shell, log }) {
  const source = shell.statusBar.add({ id: "source", order: 10, dot: true, title: "Open a local directory", text: "In Browser",
    action() { log("Status bar: open directory"); void shell.run("cloud.import-folder"); } });
  const browser = shell.statusBar.add({ id: "browser", order: 20, dot: true, title: "Browser capability details", text: "Checking browser support",
    action() {
      shell.notice(supportsDirectoryAccess()
        ? "This browser supports the File System Access API, so you can open and edit a local directory directly."
        : "This browser falls back to import/export mode. Use a Chromium-based browser (Chrome, Edge) to edit a local directory in place.",
      "Browser Support");
    } });

  const copy = shell.statusBar.add({ id: "storage", order: 15, dot: true, hidden: true, text: "Not saved in this browser",
    action() { shell.notice(copyMessage, "Not saved in this browser"); } });
  let failing = false, copyMessage = "", persisted = false;
  function reportCopy(error) {
    if (!error) {
      if (failing) shell.toast("Saved in this browser again.");
      failing = false;
      copy.set({ hidden: true });
      // Once something is kept, ask the browser not to clear it under storage pressure.
      if (!persisted) {
        persisted = true;
        void globalThis.navigator?.storage?.persist?.().then((granted) => log(`Browser storage kept for good: ${granted}`))
          .catch((reason) => log(`Asking to keep browser storage failed: ${reason?.message ?? reason}`));
      }
      return;
    }
    copyMessage = `This workspace can't be saved in this browser (${error.message || error}). `
      + "Your work stays in this window while it is open. To keep it, export it (File → Export Project Zipped), "
      + "or free space in the browser and keep working: each change tries again.";
    copy.set({ hidden: false, tone: "danger", title: copyMessage });
    if (!failing) shell.notice(copyMessage, "Not saved in this browser");
    failing = true;
  }

  function draw(project) {
    const live = project.sourceMode === "filesystem";
    source.set({ text: live ? "Live directory" : project.sourceMode === "opfs" ? "Local workspace" : "In-browser workspace",
      tone: live ? "success" : "warning" });
    const supported = supportsDirectoryAccess();
    browser.set({ hidden: supported, text: supported ? "Folder access available" : "No folder access (import/export instead)", tone: supported ? "success" : "warning" });
  }
  return { draw, reportCopy };
}
