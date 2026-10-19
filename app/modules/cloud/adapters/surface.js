// The Cloud module's parts, created and wired here (main.js used to create
// them with a long list of its values): signing in and hosting, the file
// browser and its two places (the server and this device), managing entries,
// project access, opening a cloud workspace, and the dialogs' controls. They
// share one context, `app`: the browser's own state, every part's functions,
// what the modules below offer, and PORT, what main.js still provides.
import { createAccess } from "./access.js";
import { createAccounts } from "./accounts.js";
import { createBrowser } from "./browser.js";
import { installCloudEvents } from "./events.js";
import { createManage } from "./manage.js";
import { createOpening } from "./opening.js";
import { createResume } from "./resume.js";
import { createProviders } from "./providers.js";

// What main.js attaches (cloud.attach(port)); each entry should move to an
// owner, or become an extension point, and leave this list.
export const PORT = [
  "elements", "logDebug", "flashStatusPanel", "openSettingsDialog", "refreshChatStatus",
  "setMobileExplorerOpen"
];

// The editor's functions the cloud parts call (editor.parts()).
const EDITOR = ["showResumedFile", "currentWorkspaceView", "cachedWorkspaceView"];

export function createSurface({ port, shell, workspace, identity, sync, editor, history, comments }) {
  const missing = PORT.filter((name) => !(name in port));
  if (missing.length) throw new Error(`cloud.attach: the port lacks ${missing.join(", ")}`);
  const editorParts = editor.parts();
  if (!editorParts) throw new Error("cloud.attach: attach the editor first");

  const app = {
    view: editor.view, identity, history, mode: sync.mode, settings: shell.settings, syncState: sync.status,
    switchWorkspaceMode: (next) => sync.switchMode(next),
    loadLineComments: (options) => comments.load(options), // the open workspace's comments (Comments')
    // Snapshots are History's.
    ensureSnapshotsMigrated: (...args) => history.parts().ensureSnapshotsMigrated(...args),
    refreshSnapshotBaselines: (...args) => history.parts().refreshSnapshotBaselines(...args),
    snapshotDirtyFiles: (...args) => history.parts().snapshotDirtyFiles(...args),
    notify: (message) => shell.notify(message),
    showToast: (message, options) => shell.toast(message, options),
    showConfirmDialog: (options) => shell.confirm(options),
    promptForName: (message, value = "", options = {}) => shell.input({ title: message, message, value, submitLabel: "Save", ...options }),
    render: (project) => shell.render(project)
  };
  Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
  Object.defineProperty(app, "collaboration", { get: () => sync.session(), enumerable: true });
  for (const name of PORT) Object.defineProperty(app, name, { get: () => port[name], enumerable: true });
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

  return Object.freeze(Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(app))
    .filter(([name, d]) => typeof d.value === "function" && !EDITOR.includes(name)
      && !["notify", "showToast", "showConfirmDialog", "promptForName", "render"].includes(name))
    .map(([name, d]) => [name, d.value])));
}
