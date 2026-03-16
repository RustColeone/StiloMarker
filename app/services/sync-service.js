function normalizeServerUrl(serverUrl) {
  const value = serverUrl.trim();
  if (!value) {
    throw new Error("Server URL is required.");
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
  fetchSessionState,
  normalizeServerUrl,
  openEventStream,
  pingServer,
  pushOperation,
  pushSessionState,
  sanitizeProjectForSync
};