// A request to the server's agent (POST /api/chat): its answer arrives as a
// stream of progress events (newline-delimited JSON), ending in the result.
// Moved from the legacy chat API service; the agent's connection is Models'.
import { normalizeServerUrl, parseResponse, throwForResponse } from "../../shell/index.js";

// `signal` lets the caller interrupt a turn: aborting rejects the fetch and the
// stream reader, so a long generation can be stopped instead of run to completion.
export async function sendChatRequest(serverUrl, payload, onProgress, signal) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson, application/json" },
    body: JSON.stringify(payload),
    signal
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
