// Workspace's items in the status bar: where the open project lives (a folder
// on disk, a workspace on this device, or this browser), and, only when it
// can't, that this browser can't edit a folder on disk in place (that it can
// is no news). draw(project) after each change.
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

  function draw(project) {
    const live = project.sourceMode === "filesystem";
    source.set({ text: live ? "Live directory" : project.sourceMode === "opfs" ? "Local workspace" : "In-browser workspace",
      tone: live ? "success" : "warning" });
    const supported = supportsDirectoryAccess();
    browser.set({ hidden: supported, text: supported ? "Folder access available" : "No folder access (import/export instead)", tone: supported ? "success" : "warning" });
  }
  return draw;
}
