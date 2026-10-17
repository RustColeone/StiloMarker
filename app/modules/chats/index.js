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
import { defineModule } from "../../kernel/index.js";
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
  uses: ["shell", "workspace", "characters"],
  owns: { events: ["chat-message", "chat-typing", "chat-update"], data: ["the browser's chat store"], elements: ["the Chats tab"] },
  start() {
    return {};
  }
});
