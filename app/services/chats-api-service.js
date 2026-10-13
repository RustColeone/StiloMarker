// Chats in a cloud workspace: the server keeps the conversations (one SQLite
// database per project) and pushes new messages to members over the
// workspace's event stream. This is the browser side of /api/chats.
//
// The local store (local-chats-service.js) has the same methods, so the Chats
// view works the same in a browser-only workspace (characters only).

import { normalizeServerUrl } from "./sync-service.js";

export function createCloudChats(getTarget) {
  async function call(method, action, params = {}) {
    const target = getTarget();
    if (!target) {
      throw Object.assign(new Error("Open a cloud workspace and sign in to chat with people."), { status: 0 });
    }
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
    const url = `${normalizeServerUrl(target.serverUrl)}/api/chats${action ? `/${action}` : ""}?${query}`;
    const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(data.message || `Chats request failed (${response.status}).`), { status: response.status });
    }
    return data;
  }

  return {
    kind: "cloud",
    overview: () => call("GET", ""),
    messages: (id, { before, after } = {}) => call("GET", "messages", { id, before, after }),
    search: (id, q) => call("GET", "search", { id, q }),
    start: (members) => call("POST", "start", { members }),
    send: (id, content, contextPaths = [], options = {}) => call("POST", "send", { id, content, contextPaths, ...options }),
    invite: (id, members) => call("POST", "invite", { id, members }),
    leave: (id) => call("POST", "leave", { id }),
    rename: (id, title) => call("POST", "rename", { id, title }),
    read: (id, messageId) => call("POST", "read", { id, messageId }),
    note: (contact, alias, note) => call("POST", "note", { contact, alias, note }),
    stop: (id) => call("POST", "stop", { id }),
    importGroup: (title, characters, messages) => call("POST", "import", { title, characters, messages }),
    // Replies written by this browser (its own key or a local model):
    prompt: (id, character, trigger) => call("POST", "prompt", { id, character, trigger }),
    typing: (id, character, trigger, text, state) => call("POST", "typing", { id, character, trigger, text, state }),
    reply: (id, character, trigger, content, state) => call("POST", "reply", { id, character, trigger, content, state })
  };
}
