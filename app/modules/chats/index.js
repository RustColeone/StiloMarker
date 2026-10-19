// Chats (browser): a small chat app for a project's people and its
// characters. The view (list, conversation, details, picker), the cloud store
// (the server keeps the conversations; new messages arrive on Sync's stream)
// and this browser's own store for a browser-only workspace (characters only).
// The server's half is server/stilo/modules/chats; their messages and events
// are protocol/chats.contract.json.
//
// Static, for code from before the restructure:
//   createCloudChats(getTarget) -> store       getTarget() -> { serverUrl, token, team, path } | null
//   createLocalChats({ workspaceKey, listCharacters, runReply, onEvent, records? }) -> store
//   loadChatsView() -> Promise<{ createChatsView(deps) }>   loaded when the Chats tab first opens
// API: attach(port) -> page: the side panel's Chats page (adapters/page.js),
// given what main.js still provides (PORT below); page() -> the same:
// render(project), badge(), receive(event), remapPersonaPaths(old, new),
// giveAgentThreads({ oldGroupThreads(), movedGroupThreads(threads) }), view().
import { defineModule } from "../../kernel/index.js";
import { createChatsPage } from "./adapters/page.js";
import { createIdbRecordStore } from "./adapters/local-records.js";
import { createLocalChats as createLocalStore } from "./service/local-chats.js";

export { createCloudChats } from "./adapters/api.js";
export { createIdbRecordStore } from "./adapters/local-records.js";

export function createLocalChats(options) {
  return createLocalStore({ ...options, records: options.records ?? createIdbRecordStore() });
}

export const loadChatsView = () => import("./adapters/view.js");

// What main.js attaches (chats.attach(port)); each entry should find an owner.
const PORT = [];

export default defineModule({
  name: "chats",
  level: 5,
  uses: ["shell", "workspace", "identity", "sync", "editor", "characters", "models"],
  owns: { events: ["chat-message", "chat-typing", "chat-update"], data: ["the browser's chat store"], elements: ["the Chats page"] },
  start(ctx) {
    let page = null;
    function attach(port) {
      if (page) throw new Error("chats: already attached");
      const missing = PORT.filter((name) => !(name in port));
      if (missing.length) throw new Error(`chats.attach: the port lacks ${missing.join(", ")}`);
      const shell = ctx.use("shell"), editor = ctx.use("editor"), sync = ctx.use("sync"), workspace = ctx.use("workspace");
      const app = {
        ...Object.fromEntries(PORT.map((name) => [name, port[name]])),
        models: ctx.use("models"), identity: ctx.use("identity"), settings: shell.settings, pages: shell.pages,
        notify: (message) => shell.notify(message),
        showToast: (message, options) => shell.toast(message, options),
        showConfirmDialog: (options) => shell.confirm(options),
        openFileFromExplorer: (nodeId) => editor.parts().openFileFromExplorer(nodeId),
        collaboration: () => sync.session(),
        cloudWorkspaceTarget: () => sync.cloudWorkspace(),
        isMobileLayout: () => shell.frame.isPhone(),
        logDebug: (...args) => shell.log(...args),
        // The key the open project's chats are kept under (Workspace's location, which Sync tells).
        chatWorkspaceKey: (project = workspace.project().getProject()) => workspace.location.key(project),
        personaAvatarSrc: (...args) => ctx.use("characters").avatarSrc(...args)
      };
      Object.defineProperty(app, "controller", { get: () => workspace.project(), enumerable: true });
      page = createChatsPage(app);
      // Chats' messages, typing and changes from others arrive on Sync's stream.
      sync.events.on("event", ({ event }) => {
        if (["chat-message", "chat-typing", "chat-update"].includes(event.type)) page.receive(event);
      });
      return page;
    }
    return { attach, page: () => page };
  }
});
