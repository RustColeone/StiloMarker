// Starting, opening and importing a project (the File menu): a new project
// (where it lives is chosen in the file browser, or this browser when there is
// no device storage and no account), opening one, the file manager, and
// importing a folder, a file or a zip.
// Part of Cloud: `app` is its shared context (surface.js).
import { importDirectory, importOsFolderIntoOpfs, importSingleFile, importZipArchive, seedDefaultProject, supportsDirectoryAccess,
  supportsOpfs } from "../../workspace/index.js";

export function addProjectCommands(app, { shell, editor, sync }) {
  const { settings, identity } = app;
  // A project read in from elsewhere replaces the open one, shown afresh and shared if this tab is.
  function adopt(project) {
    app.controller.replaceProject(project);
    editor.view.reset(project);
    sync.publishSnapshot();
  }

  shell.commands.add({ id: "cloud.new-project", title: "New Project", menu: { id: "file", group: 0, order: 1 }, async run() {
    app.logDebug("action", "New project requested");
    shell.closeMenus();
    // No device storage and no account: the in-browser workspace.
    if (!supportsOpfs() && !identity.account()) {
      adopt(seedDefaultProject());
      app.logDebug("action", "New in-browser project created");
      return;
    }
    // Otherwise the file browser, to choose where it lives (this device or a team folder).
    app.openFileBrowser({ side: supportsOpfs() ? "local" : "server", intent: "create" });
  } });
  shell.commands.add({ id: "cloud.open-project", title: "Open Project…", menu: { id: "file", group: 0, order: 2 }, run() {
    shell.closeMenus();
    app.logDebug("action", "Open project browser");
    // The server's side when signed in, else this device's; the dialog switches sides.
    app.openFileBrowser({ side: identity.account() ? "server" : "local", intent: "open" });
  } });
  shell.commands.add({ id: "cloud.file-manager", title: "File Manager", menu: { id: "file", group: 0, order: 3 }, run() {
    shell.closeMenus();
    app.logDebug("action", "Open file manager");
    app.openFileBrowser({ side: identity.account() ? "server" : "local", mode: "manage" });
  } });
  shell.commands.add({ id: "cloud.import-folder", title: "Import Local Folder", menu: { id: "file", group: 1, order: 1 }, async run() {
    if (!supportsDirectoryAccess()) {
      shell.notify("Folder import is only available in Chromium-based browsers.");
      return;
    }
    try {
      app.logDebug("action", "Import folder requested");
      // A real folder is copied into this device's storage and opened from
      // there; without device storage, a live (session-only) link to the folder.
      const project = supportsOpfs() ? await importOsFolderIntoOpfs("") : await importDirectory();
      if (project.sourceMode === "opfs" && project.localPath) settings.change({ lastLocalProject: { path: project.localPath } }, "imported a folder");
      adopt(project);
      app.logDebug("action", "Imported folder", project.localPath ?? project.name);
    } catch (error) {
      if (error?.name === "AbortError") return; // the picker was dismissed
      shell.notify(error.message);
    }
  } });
  const fileInput = document.getElementById("import-file-input");
  shell.commands.add({ id: "cloud.import-file", title: "Import File or Zip", menu: { id: "file", group: 1, order: 2 }, run: () => fileInput?.click() });
  fileInput?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      app.logDebug("action", "Import requested", file.name);
      adopt(file.name.toLowerCase().endsWith(".zip") ? await importZipArchive(file) : await importSingleFile(file));
    } catch (error) {
      shell.notify(error.message);
    } finally {
      event.target.value = "";
    }
  });
  // The welcome page's "Open a local folder".
  document.getElementById("welcome-open-local")?.addEventListener("click", () => void shell.run("cloud.import-folder"));
}
