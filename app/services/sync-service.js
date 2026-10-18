import { dataUrlToBytes } from "../modules/workspace/index.js";

import { normalizeServerUrl, parseResponse, throwForResponse } from "../modules/shell/index.js";

async function pingServer(serverUrl) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/ping`, {
    signal: AbortSignal.timeout(15000),
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

// ---- File-browser navigation (nested folders + per-project access) -----------

async function browseServer(serverUrl, accountToken, team = "", path = "") {
  const baseUrl = normalizeServerUrl(serverUrl);
  const params = new URLSearchParams({ token: accountToken });
  if (team) params.set("team", team);
  if (path) params.set("path", path);
  const response = await fetch(`${baseUrl}/api/workspaces/browse?${params.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    await throwForResponse("Could not browse the server.", response);
  }
  return parseResponse(response);
}

async function mkdirServer(serverUrl, accountToken, team, path, name) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/mkdir?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path, name })
  });
  if (!response.ok) {
    await throwForResponse("Could not create folder.", response);
  }
  return parseResponse(response);
}

async function createProjectServer(serverUrl, accountToken, team, path, name) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/create?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path, name })
  });
  if (!response.ok) {
    await throwForResponse("Could not create project.", response);
  }
  return parseResponse(response);
}

// Persist which files the user has open in a cloud workspace, so they can be
// restored on the next open/reconnect (per-user, server-side resume state).
async function saveUserState(serverUrl, accountToken, team, path, openFiles, activeFile) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/user-state?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path, openFiles, activeFile })
  });
  if (!response.ok) {
    await throwForResponse("Could not save resume state.", response);
  }
  return parseResponse(response);
}

async function deleteServer(serverUrl, accountToken, team, path) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/delete?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path })
  });
  if (!response.ok) {
    await throwForResponse("Could not delete this item.", response);
  }
  return parseResponse(response);
}

async function exportProjectServer(serverUrl, accountToken, team, path) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const params = new URLSearchParams({ token: accountToken, team, path });
  const response = await fetch(`${baseUrl}/api/workspaces/export?${params.toString()}`, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    await throwForResponse("Could not read this project.", response);
  }
  return parseResponse(response);
}

async function importProjectServer(serverUrl, accountToken, team, path, name, project) {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await fetch(`${baseUrl}/api/workspaces/import?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path, name, project })
  });
  if (!response.ok) {
    await throwForResponse("Could not copy the project to the server.", response);
  }
  return parseResponse(response);
}

export {
  browseServer,
  createProjectServer,
  createWorkspace,
  deleteServer,
  exportProjectServer,
  importProjectServer,
  listWorkspaces,
  mkdirServer,
  normalizeServerUrl,
  pingServer,
  saveUserState,
  uploadAsset
};