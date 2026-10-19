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
// API: page() -> the side panel's Chats page (adapters/page.js), created
// when it starts in a page: render(project), badge(), receive(event), remapPersonaPaths(old, new),
// giveAgentThreads({ oldGroupThreads(project), movedGroupThreads(threads) }), view().
// A character sheet's preview and a new sheet's template are its
// (adapters/sheet.js). It draws on each redraw (Shell's), follows renamed characters (the
// Explorer's "path-changed") and takes the Assistant's old Roleplay threads
// (Workspace's handover "agent-group-threads").
import { defineModule } from "../../kernel/index.js";
import { createChatsPage } from "./adapters/page.js";
import { addCharacterSheet } from "./adapters/sheet.js";
import { createIdbRecordStore } from "./adapters/local-records.js";
import { createLocalChats as createLocalStore } from "./service/local-chats.js";

export { createCloudChats } from "./adapters/api.js";
export { createIdbRecordStore } from "./adapters/local-records.js";

export function createLocalChats(options) {
  return createLocalStore({ ...options, records: options.records ?? createIdbRecordStore() });
}

export const loadChatsView = () => import("./adapters/view.js");

export default defineModule({
  name: "chats",
  level: 5,
  uses: ["shell", "workspace", "identity", "sync", "editor", "explorer", "characters", "models"],
  owns: { events: ["chat-message", "chat-typing", "chat-update"], data: ["the browser's chat store"], elements: ["the Chats page"] },
  start(ctx) {
    // Character sheets in the editor: their preview, and a new sheet's template.
    addCharacterSheet({ editor: ctx.use("editor"), explorer: ctx.use("explorer"), characters: ctx.use("characters") });
    let page = null;
    if (globalThis.document) {
      const shell = ctx.use("shell"), editor = ctx.use("editor"), sync = ctx.use("sync"), workspace = ctx.use("workspace");
      const app = {
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
      // Drawn on each redraw (Shell's): the unread count on its tab, and the page while it is open.
      shell.events.on("render", ({ project }) => {
        if (!project) return;
        page.badge();
        if (shell.pages.active("side") === "chats") page.render(project);
      });
      // Group chats name their characters by path: a renamed or moved character file (or folder) is followed.
      ctx.use("explorer").events.on("path-changed", ({ from, to }) => page.remapPersonaPaths(from, to));
      // The Agent page's old Roleplay threads, handed over through Workspace.
      workspace.handover.receive("agent-group-threads", (threads) => page.giveAgentThreads(threads));
    }
    return { page: () => page };
  }
});
