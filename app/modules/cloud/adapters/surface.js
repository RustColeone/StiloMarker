// The Cloud module's parts, created and wired here (main.js used to create
// them with a long list of its values): signing in and hosting, the file
// browser and its two places (the server and this device), managing entries,
// project access, opening a cloud workspace, and the dialogs' controls. They
// share one context, `app`: the browser's own state, every part's functions,
// what the modules below offer, and its elements on the page (elements.js).
import { createAccess } from "./access.js";
import { createAccounts } from "./accounts.js";
import { createBrowser } from "./browser.js";
import { installCloudEvents } from "./events.js";
import { createManage } from "./manage.js";
import { createOpening } from "./opening.js";
import { createResume } from "./resume.js";
import { addProjectCommands } from "./projects.js";
import { saveUserState } from "./api.js";
import { createProviders } from "./providers.js";
import { findElements } from "./elements.js";

// The editor's functions the cloud parts call (editor.parts()).
const EDITOR = ["showResumedFile", "cachedWorkspaceView", "resumeView"];

export function createSurface({ shell, workspace, identity, sync, editor, history, comments, explorer, models }) {
  const editorParts = editor.parts();

  const app = {
    view: editor.view, identity, history, mode: sync.mode, settings: shell.settings, syncState: sync.status,
    switchWorkspaceMode: (next) => sync.switchMode(next),
    logDebug: (...args) => shell.log(...args), // the log panel (Shell's)
    openSettingsDialog: (page) => shell.settingsDialog.open(page),
    // A status panel's border flashes (Settings → Collaboration's server line, by default).
    flashStatusPanel: (type, panel = document.getElementById("server-status-text")?.closest(".settings-status-panel")) => shell.flash(panel, type),
    setMobileExplorerOpen: (open) => shell.frame.setExplorerOpen(open), // the phone's explorer drawer (Shell's frame)
    loadLineComments: (options) => comments.load(options), // the open workspace's comments (Comments')
    // Snapshots are History's.
    ensureSnapshotsMigrated: (...args) => history.parts().ensureSnapshotsMigrated(...args),
    refreshSnapshotBaselines: (...args) => history.parts().refreshSnapshotBaselines(...args),
    snapshotDirtyFiles: (...args) => history.parts().snapshotDirtyFiles(...args),
    notify: (message) => shell.notify(message),
    showToast: (message, options) => shell.toast(message, options),
    showConfirmDialog: (options) => shell.confirm(options),
    promptForName: (message, value = "", options = {}) => shell.input({ title: message, message, value, submitLabel: "Save", ...options }),
    render: (project) => shell.render(project),
    // The agent's status, asked again (Models'; signing in or out changes it).
    refreshChatStatus: (options = {}) => models.agent.refresh({ signedIn: Boolean(identity.account()), ...options })
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "collaboration", { get: () => sync.session(), enumerable: true });
  app.elements = findElements();
  for (const name of EDITOR) app[name] = editorParts[name];

  const add = (part) => {
    for (const [name, fn] of Object.entries(part)) {
      if (name in app) throw new Error(`cloud: "${name}" is defined twice`);
      app[name] = fn;
    }
  };
  add(createAccounts(app));
  add(createBrowser(app));
  add(createManage(app));
  add(createAccess(app));
  add(createOpening(app));
  add(createResume(app, { sync }));
  const { serverProvider, opfsProvider } = createProviders(app);
  app.serverProvider = serverProvider;
  app.opfsProvider = opfsProvider;
  // The file browser's view: `provider` is one of the two above, `path` that
  // provider's opaque location, `selection` the highlighted entry (or null).
  app.browserState = { provider: opfsProvider, intent: "open", mode: "open", multiSelect: false, checked: new Set(), pendingTransfer: null, path: "", entries: [], atRoot: true, selection: null };
  installCloudEvents(app);
  addProjectCommands(app, { shell, editor, sync });
  // What Sync and the Editor need from the server's accounts and workspaces:
  // signing in again when the account's token died (a server restart; only
  // with a sign-in proven before, and null to let Sync stop retrying), and the
  // open tabs kept for this workspace.
  sync.configure({
    async reauthenticate() {
      if (!identity.canRestore()) return null;
      const token = sync.session().getConnectionInfo()?.token;
      try {
        await app.performLogin(app.settings.accountUsername, app.settings.accountPassword, {
          silent: true, isCurrent: () => Boolean(token) && sync.session().getConnectionInfo()?.token === token
        });
        app.logDebug("action", "Re-authenticated after token expiry", app.settings.accountUsername);
        return identity.token();
      } catch (error) {
        app.logDebug("response", "Re-authentication failed", error.message);
        if (![401, 403].includes(error.status)) throw error;
        return null;
      }
    }
  });
  // "Manage Preview" on the project's root (the Explorer's menu): who may open the
  // open cloud workspace's preview, while signed in and connected to it.
  const canManagePreview = () => Boolean(identity.account()) && sync.mode.get().workspaceMode === "synced"
    && Boolean(sync.session()?.isConnected()) && Boolean(app.settings.lastWorkspace?.team);
  explorer.rootMenus.add({
    id: "cloud.manage-preview",
    entries: () => (canManagePreview() ? [["Manage Preview", "manage-preview"]] : []),
    async run() {
      const ws = app.settings.lastWorkspace;
      if (ws?.team && ws?.path != null) await app.openAccessEditor(ws.team, ws.path, app.controller.getProject().name);
      else app.notify("Open a server workspace to manage its preview access.");
    }
  });
  editor.openTabs.configure((ws, openFiles, activeFile, groups) => saveUserState(app.settings.serverUrl, identity.token(), ws.team, ws.path, openFiles, activeFile, groups));
  // The welcome page (no file open): Resume the last cloud workspace, and open
  // one from the server when signed in.
  const welcomeResume = document.getElementById("welcome-resume");
  const welcomeOpenServer = document.getElementById("welcome-open-server");
  welcomeOpenServer?.addEventListener("click", () => app.openFileBrowser({ side: "server", intent: "open" }));
  editor.welcome.add({ id: "cloud", draw() {
    const resume = app.resumeTarget(); // unless that workspace is open or opening
    if (welcomeResume) {
      welcomeResume.hidden = !resume;
      if (resume) welcomeResume.textContent = `Resume ${resume}`;
    }
    if (welcomeOpenServer) welcomeOpenServer.hidden = !identity.account();
  } });

  return Object.freeze(Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
    .filter(([name, d]) => typeof d.value === "function" && !EDITOR.includes(name)
      && !["notify", "showToast", "showConfirmDialog", "promptForName", "render"].includes(name))
    .map(([name, d]) => [name, d.value])));
}
