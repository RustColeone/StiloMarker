import { normalizeServerUrl } from "./sync-service.js";

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

async function fetchChatStatus(serverUrl) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/chat/status`, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    await throwForResponse("Chat status failed.", response);
  }

  return parseResponse(response);
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
    body: JSON.stringify(workspace)
  });
  if (!response.ok) {
    await throwForResponse("Chat workspace push failed.", response);
  }
  return parseResponse(response);
}

async function sendChatRequest(serverUrl, payload, onProgress) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    await throwForResponse("Chat request failed.", response);
  }

  const contentType = response.headers.get("content-type") || "";
  // Non-streaming fallback (e.g. an old server or a proxy that buffered the body).
  if (!response.body || !contentType.includes("ndjson")) {
    return parseResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  const handleEvent = (event) => {
    if (!event || typeof event !== "object") {
      return;
    }
    if (event.type === "result") {
      result = event.response;
    } else if (event.type === "error") {
      const error = new Error(`Chat request failed. ${event.message || "Server error."}`);
      error.status = event.status;
      throw error;
    } else if (typeof onProgress === "function" && event.type !== "heartbeat") {
      onProgress(event);
    }
  };

  // Parse one NDJSON line. Tolerate the occasional unparseable line (e.g. a
  // proxy that injects framing) instead of discarding the whole stream — the
  // important payload is the single `result` line, which is valid JSON.
  const parseLine = (line) => {
    if (!line) {
      return;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    handleEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        parseLine(line);
      }
    }
    if (done) {
      break;
    }
  }
  parseLine(buffer.trim());

  if (!result) {
    throw new Error("Chat request failed. The server closed the connection before completing.");
  }
  return result;
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

export { fetchChatStatus, fetchServerChatWorkspace, pushServerChatWorkspace, sendChatRequest, sendGenerationRequest };