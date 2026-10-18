// Sync's messages to the server (protocol/sync.contract.json). Each takes the
// server address of the session it belongs to, which may differ from the
// settings while a session is open.
import { normalizeServerUrl, throwForResponse, parseResponse } from "../../shell/index.js";
import contract from "../model/contract.js";
import { ignored } from "../../../kernel/index.js";

// This page load, sent with every workspace open: many ids mean the page keeps
// reloading, one id opening again and again means one tab keeps reconnecting.
const PAGE_ID = `pg-${Math.random().toString(36).slice(2, 10)}`;
const PAGE_LOADED_AT = Date.now();

async function call(serverUrl, path, { method = "GET", token, body, failure, timeout = 15000 } = {}) {
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}${query}`, {
    method,
    ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
    headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) await throwForResponse(failure, response);
  return parseResponse(response);
}

export function connectToServer(serverUrl, pin, displayName = "") {
  const trimmedPin = String(pin ?? "").trim();
  if (!trimmedPin) return Promise.reject(new Error("PIN is required."));
  return call(serverUrl, "/api/session/connect", { method: "POST", timeout: 0, failure: "Connect failed.",
    body: { pin: trimmedPin, displayName: displayName.trim(), lease: true } });
}

export function hostSession(serverUrl, displayName) {
  return call(serverUrl, "/api/session/host", { method: "POST", timeout: 0, failure: "Could not start hosting.",
    body: { displayName: String(displayName ?? "").trim(), lease: true } });
}

export function openWorkspaceSession(serverUrl, accountToken, team, path, device, reason = "unspecified") {
  return call(serverUrl, "/api/workspaces/open", { method: "POST", token: accountToken, failure: "Could not open workspace.",
    body: { team, path, device, lease: true, version: contract.version, reason, pageId: PAGE_ID, uptimeMs: Date.now() - PAGE_LOADED_AT } });
}

export function fetchSessionState(serverUrl, token) {
  return call(serverUrl, "/api/session/state", { token, failure: "State fetch failed." });
}

export function pushSessionState(serverUrl, token, project, baseRevision) {
  return call(serverUrl, "/api/session/state", { method: "POST", token, failure: "State push failed.",
    body: { project, baseRevision, version: contract.version } });
}

export function pushOperation(serverUrl, token, operation) {
  return call(serverUrl, "/api/operations", { method: "POST", token, failure: "Operation push failed.",
    body: { operation, version: contract.version } });
}

// Best effort: a lost cursor update is replaced by the next one.
export async function pushCursor(serverUrl, token, { fileId, selStart, selEnd }) {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/session/presence?token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId, selStart, selEnd })
  });
  return response.ok;
}

export async function renewSessionLease(serverUrl, token) {
  await call(serverUrl, "/api/session/lease", { method: "POST", token, failure: "Connection check failed.", timeout: 10000 });
}

// pagehide is the last reliable moment on many phones. A beacon may still be
// dropped when the system kills the tab; the server's lease covers that.
export function leaveSession(serverUrl, token) {
  if (!token) return;
  const url = `${normalizeServerUrl(serverUrl)}/api/session/leave?token=${encodeURIComponent(token)}`;
  if (typeof navigator !== "undefined" && navigator.sendBeacon?.(url)) return;
  void fetch(url, { method: "POST", keepalive: true }).catch(ignored("telling the server this tab left failed; its session times out"));
}

export function openEventStream(serverUrl, token, onEvent, onError) {
  const eventSource = new EventSource(`${normalizeServerUrl(serverUrl)}/api/events/stream?token=${encodeURIComponent(token)}&lease=1`);
  eventSource.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch (error) {
      onError?.(error);
    }
  };
  eventSource.onerror = (event) => onError?.(event);
  return eventSource;
}
