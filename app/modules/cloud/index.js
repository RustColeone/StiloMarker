// Cloud (browser): working with the server's projects and this device's.
// Signing in and out, the file browser (teams, folders and projects on the
// server; projects on this device), creating, deleting (to the team's Trash),
// moving and copying them, who may open a project, hosting this project for
// guests or publishing it to a team, and opening a cloud workspace.
//
// API: parts() -> its functions (handleOpenWorkspace(team, path, options),
// openFileBrowser({ side }), performLogin, openAccessEditor...), created when
// it starts in a page (adapters/surface.js). Once the whole app has started
// it asks for the agent's status and resumes the last session.
// Static, for code from before the restructure: saveUserState,
// pingServer (the server's routes, adapters/api.js).
import { addDesktopServer } from "./adapters/desktop-server.js";
import { defineModule } from "../../kernel/index.js";
import { createSurface } from "./adapters/surface.js";
import { addCollaborationSettings } from "./adapters/settings-section.js";
import { addServerItem } from "./adapters/server-item.js";

export { pingServer, saveUserState } from "./adapters/api.js";

export default defineModule({
  name: "cloud",
  level: 5,
  uses: ["shell", "workspace", "identity", "models", "sync", "editor", "history", "comments", "explorer"],
  owns: {
    elements: ["the file browser", "the account controls", "the access dialog", "hosting", "Settings → Collaboration", "the server in the status bar"],
    state: ["the file browser's place and selection"]
  },
  start(ctx) {
    const shell = ctx.use("shell");
    addCollaborationSettings({ dialog: shell.settingsDialog, settings: shell.settings, desktop: shell.desktop });
    // The desktop app: the server it connects to, or runs (Settings → Server).
    if (shell.desktop) addDesktopServer({ dialog: shell.settingsDialog, settings: shell.settings, sync: ctx.use("sync"), shell, identity: ctx.use("identity"),
      ping: () => parts?.pingCurrentServer(), log: (message, detail) => shell.log("response", message, detail ?? "") });
    let parts = null;
    addServerItem({ shell, sync: ctx.use("sync"), identity: ctx.use("identity"), ping: () => parts?.pingCurrentServer() });
    if (globalThis.document) {
      parts = createSurface({ shell: ctx.use("shell"), workspace: ctx.use("workspace"), identity: ctx.use("identity"),
        sync: ctx.use("sync"), editor: ctx.use("editor"), history: ctx.use("history"), comments: ctx.use("comments"),
        explorer: ctx.use("explorer"), models: ctx.use("models") });
      parts.renderHostTargets();
      // Once the whole app is there: the agent's status asked, and the last
      // session resumed, so a reload is not a fresh start.
      ctx.whenStarted(() => {
        void parts.refreshChatStatus({ silent: true });
        void parts.resumeSession();
      });
    }
    return { parts: () => parts };
  }
});
