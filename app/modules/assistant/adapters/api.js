// The server's routes for the agent's conversations (the chat workspace, read
// and pushed) and for generating a diagram's notes. Moved from the legacy chat
// API service.
import { syncVersion } from "../../sync/index.js";
import { normalizeServerUrl } from "../../shell/index.js";

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

async function throwForResponse(prefix, response) {
  const payload = await parseResponse(response);
  const message = typeof payload === "string" ? payload : payload?.message;
  const error = new Error(message ? `${prefix} ${message}` : `${prefix} Status ${response.status}.`);
  error.status = response.status;
  error.payload = payload;
  throw error;
}


async function fetchServerChatWorkspace(serverUrl, token) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/chat/workspace?token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    await throwForResponse("Chat workspace fetch failed.", response);
  }
  return parseResponse(response);
}

async function pushServerChatWorkspace(serverUrl, token, workspace) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const url = `${baseUrl}/api/chat/workspace?token=${encodeURIComponent(token)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...workspace, version: syncVersion })
  });
  if (!response.ok) {
    await throwForResponse("Chat workspace push failed.", response);
  }
  return parseResponse(response);
}


async function sendGenerationRequest(serverUrl, payload) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwForResponse("Generation request failed.", response);
  }
  return parseResponse(response);
}

export { fetchServerChatWorkspace, pushServerChatWorkspace, sendGenerationRequest };