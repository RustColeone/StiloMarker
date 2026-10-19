// Cloud (browser): working with the server's projects and this device's.
// Signing in and out, the file browser (teams, folders and projects on the
// server; projects on this device), creating, deleting (to the team's Trash),
// moving and copying them, who may open a project, hosting this project for
// guests or publishing it to a team, and opening a cloud workspace.
//
// API: attach(port) -> parts: creates it, given what main.js still provides
// (adapters/surface.js lists it: PORT); parts() -> the same functions
// (handleOpenWorkspace(team, path, options), openFileBrowser({ side }),
// performLogin, openAccessEditor...).
// Static, for code from before the restructure: saveUserState, uploadAsset,
// pingServer (the server's routes, adapters/api.js).
import { defineModule } from "../../kernel/index.js";
import { createSurface } from "./adapters/surface.js";
import { addCollaborationSettings } from "./adapters/settings-section.js";
import { addServerItem } from "./adapters/server-item.js";

export { pingServer, saveUserState, uploadAsset } from "./adapters/api.js";

export default defineModule({
  name: "cloud",
  level: 5,
  uses: ["shell", "workspace", "identity", "sync", "editor", "history", "comments"],
  owns: {
    elements: ["the file browser", "the account controls", "the access dialog", "hosting", "Settings → Collaboration", "the server in the status bar"],
    state: ["the file browser's place and selection"]
  },
  start(ctx) {
    const shell = ctx.use("shell");
    addCollaborationSettings({ dialog: shell.settingsDialog, settings: shell.settings });
    let parts = null;
    addServerItem({ shell, sync: ctx.use("sync"), identity: ctx.use("identity"), ping: () => parts?.pingCurrentServer() });
    function attach(port) {
      if (parts) throw new Error("cloud: already attached");
      parts = createSurface({ port, shell: ctx.use("shell"), workspace: ctx.use("workspace"), identity: ctx.use("identity"),
        sync: ctx.use("sync"), editor: ctx.use("editor"), history: ctx.use("history"), comments: ctx.use("comments") });
      return parts;
    }
    return { attach, parts: () => parts };
  }
});
