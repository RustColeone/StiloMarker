import { dataUrlToBytes } from "./file-content-service.js";

function normalizeServerUrl(serverUrl) {
  const value = (serverUrl ?? "").trim();
  // Empty string means "same origin + current app base path" so the app
  // works when mounted under a subpath (for example "/stilomarker/")
  // behind a reverse proxy without manual URL configuration.
  if (!value) {
    if (typeof window === "undefined") {
      return "";
    }
    const pathname = window.location.pathname || "/";
    const basePath = pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname.replace(/\/[^/]*$/, "");
    return `${window.location.origin}${basePath}`;
  }
  return value.replace(/\/+$/, "");
}

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

async function pingServer(serverUrl) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/ping`, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain;q=0.9"
    }
  });

  if (!response.ok) {
    await throwForResponse("Ping failed.", response);
  }

  return parseResponse(response);
}

async function connectToServer(serverUrl, pin, displayName = "") {
  const baseUrl = normalizeServerUrl(serverUrl);
  const trimmedPin = pin.trim();
  if (!trimmedPin) {
    throw new Error("PIN is required.");
  }

  const response = await fetch(`${baseUrl}/api/session/connect`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain;q=0.9"
    },
    body: JSON.stringify({ pin: trimmedPin, displayName: displayName.trim() })
  });

  if (!response.ok) {
    await throwForResponse("Connect failed.", response);
  }

  return parseResponse(response);
}

async function loginToServer(serverUrl, username, password) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const trimmedName = String(username ?? "").trim();
  if (!trimmedName) {
    throw new Error("Username is required.");
  }
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain;q=0.9"
    },
    body: JSON.stringify({ username: trimmedName, password: String(password ?? "") })
  });

  if (!response.ok) {
    await throwForResponse("Login failed.", response);
  }

  return parseResponse(response);
}

async function listWorkspaces(serverUrl, accountToken) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces?token=${encodeURIComponent(accountToken)}`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    await throwForResponse("Could not list workspaces.", response);
  }
  const data = await parseResponse(response);
  return data.workspaces ?? [];
}

async function createWorkspace(serverUrl, accountToken, team, name, shareTeam = false) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, name, shareTeam: Boolean(shareTeam) })
  });
  if (!response.ok) {
    await throwForResponse("Could not create workspace.", response);
  }
  return parseResponse(response);
}

async function uploadAsset(serverUrl, token, path, dataUrl) {
  const { bytes } = dataUrlToBytes(dataUrl);
  const baseUrl = normalizeServerUrl(serverUrl);
  // Small sequential chunks keep every request well under a 1 MB proxy body
  // limit, so large images upload without a 413 and without base64 in the ops.
  const CHUNK = 256 * 1024;
  let offset = 0;
  do {
    const chunk = bytes.subarray(offset, offset + CHUNK);
    const response = await fetch(
      `${baseUrl}/api/workspaces/asset?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}&offset=${offset}`,
      { method: "POST", headers: { "content-type": "application/octet-stream" }, body: chunk }
    );
    if (!response.ok) {
      await throwForResponse("Image upload failed.", response);
    }
    offset += CHUNK;
  } while (offset < bytes.length);
}

async function hostSession(serverUrl, displayName) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/session/host`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ displayName: String(displayName ?? "").trim() })
  });
  if (!response.ok) {
    await throwForResponse("Could not start hosting.", response);
  }
  return parseResponse(response);
}

async function openWorkspaceSession(serverUrl, accountToken, team, name) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/open?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, name })
  });
  if (!response.ok) {
    await throwForResponse("Could not open workspace.", response);
  }
  return parseResponse(response);
}

function sanitizeProjectForSync(project) {
  const syncProject = structuredClone(project);
  delete syncProject.handles;
  delete syncProject.sourceIndex;
  if (syncProject.sourceMode === "filesystem") {
    syncProject.sourceMode = "memory";
  }
  return syncProject;
}

async function fetchSessionState(serverUrl, token) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/session/state?token=${encodeURIComponent(token)}`, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    await throwForResponse("State fetch failed.", response);
  }

  return parseResponse(response);
}

async function pushSessionState(serverUrl, token, project) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/session/state?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ project: sanitizeProjectForSync(project) })
  });

  if (!response.ok) {
    await throwForResponse("State push failed.", response);
  }

  return parseResponse(response);
}

async function pushOperation(serverUrl, token, operation) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/operations?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ operation })
  });

  if (!response.ok) {
    await throwForResponse("Operation push failed.", response);
  }

  return parseResponse(response);
}

function openEventStream(serverUrl, token, onEvent, onError) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const eventSource = new EventSource(`${baseUrl}/api/events/stream?token=${encodeURIComponent(token)}`);

  eventSource.onmessage = (event) => {
    try {
      onEvent(JSON.parse(event.data));
    } catch (error) {
      onError?.(error);
    }
  };

  eventSource.onerror = (event) => {
    onError?.(event);
  };

  return eventSource;
}

export {
  connectToServer,
  createWorkspace,
  fetchSessionState,
  hostSession,
  listWorkspaces,
  loginToServer,
  normalizeServerUrl,
  openEventStream,
  openWorkspaceSession,
  pingServer,
  pushOperation,
  pushSessionState,
  sanitizeProjectForSync,
  uploadAsset
};