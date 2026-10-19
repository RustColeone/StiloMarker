// The app: start the modules (docs/ARCHITECTURE.md). Each one finds its own
// elements on the page and does its own part of the start; what has to wait
// for the whole app (resuming the last session) waits with ctx.whenStarted.
import { startModules } from "./kernel/index.js";
import shellModule from "./modules/shell/index.js";
import fileTypesModule from "./modules/file-types/index.js";
import workspaceModule from "./modules/workspace/index.js";
import identityModule from "./modules/identity/index.js";
import modelsModule from "./modules/models/index.js";
import editorModule from "./modules/editor/index.js";
import syncModule from "./modules/sync/index.js";
import charactersModule from "./modules/characters/index.js";
import historyModule from "./modules/history/index.js";
import explorerModule from "./modules/explorer/index.js";
import commentsModule from "./modules/comments/index.js";
import cloudModule from "./modules/cloud/index.js";
import chatsModule from "./modules/chats/index.js";
import assistantModule from "./modules/assistant/index.js";
import extensionModules from "./extensions.js";

// Modules' log lines go to the log panel (Shell's); those from before Shell started wait.
const earlyLog = [];
let modules = null;
modules = await startModules([shellModule, fileTypesModule, workspaceModule, identityModule, modelsModule, editorModule, syncModule,
  charactersModule, historyModule, explorerModule, commentsModule, cloudModule, chatsModule, assistantModule, ...extensionModules], {
  log: (owner, ...args) => (modules?.shell ? modules.shell.log("action", `${owner}: ${args.join(" ")}`) : earlyLog.push(`${owner}: ${args.join(" ")}`))
});
for (const line of earlyLog.splice(0)) modules.shell.log("action", line);
