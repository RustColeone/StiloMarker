// Chats in a cloud workspace: Chats' messages to the server
// (protocol/chats.contract.json). The server keeps the conversations and
// pushes new messages to members over Sync's stream. The browser-only store
// (service/local-chats.js) has the same methods, so the view works the same.
import { normalizeServerUrl } from "../../shell/index.js";

// getTarget() -> { serverUrl, token, team, path } of the open cloud workspace, or null.
export function createCloudChats(getTarget) {
  async function call(method, path, params = {}) {
    const target = getTarget();
    if (!target) throw Object.assign(new Error("Open a cloud workspace and sign in to chat with people."), { status: 0 });
    const query = new URLSearchParams({ token: target.token });
    let body;
    if (method === "GET") {
      query.set("team", target.team);
      query.set("path", target.path);
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
      }
    } else {
      body = JSON.stringify({ team: target.team, path: target.path, ...params });
    }
    const response = await fetch(`${normalizeServerUrl(target.serverUrl)}${path}?${query}`,
      { method, headers: body ? { "content-type": "application/json" } : {}, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || `Chats request failed (${response.status}).`), { status: response.status });
    return data;
  }

  return {
    kind: "cloud",
    overview: () => call("GET", "/api/chats"),
    messages: (id, { before, after } = {}) => call("GET", "/api/chats/messages", { id, before, after }),
    search: (id, q) => call("GET", "/api/chats/search", { id, q }),
    noteFor: (contact) => call("GET", "/api/chats/note", { contact }),
    start: (members) => call("POST", "/api/chats/start", { members }),
    send: (id, content, contextPaths = [], options = {}) => call("POST", "/api/chats/send", { id, content, contextPaths, ...options }),
    invite: (id, members) => call("POST", "/api/chats/invite", { id, members }),
    leave: (id) => call("POST", "/api/chats/leave", { id }),
    rename: (id, title) => call("POST", "/api/chats/rename", { id, title }),
    read: (id, messageId) => call("POST", "/api/chats/read", { id, messageId }),
    note: (contact, alias, note) => call("POST", "/api/chats/note", { contact, alias, note }),
    stop: (id) => call("POST", "/api/chats/stop", { id }),
    importGroup: (title, characters, messages) => call("POST", "/api/chats/import", { title, characters, messages }),
    // Replies written by this browser (its own key or a local model):
    prompt: (id, character, trigger) => call("POST", "/api/chats/prompt", { id, character, trigger }),
    typing: (id, character, trigger, text, state) => call("POST", "/api/chats/typing", { id, character, trigger, text, state }),
    reply: (id, character, trigger, content, state) => call("POST", "/api/chats/reply", { id, character, trigger, content, state })
  };
}
