// The server's routes for cloud workspaces: browsing, making a folder, the
// resume state and who may open a project are the server's Projects
// (protocol/projects.contract.json); create, delete, export and import are
// the server's Cloud (protocol/cloud.contract.json); ping is the server's own.
// (Images upload through Sync's routes.)
import { normalizeServerUrl, parseResponse, throwForResponse } from "../../shell/index.js";

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

// Who may open a project: its access list (Identity's rules, kept by Projects).
async function getAccessServer(serverUrl, accountToken, team, path) {
  const params = new URLSearchParams({ token: accountToken, team, path });
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/workspaces/access?${params.toString()}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    await throwForResponse("Could not read access list.", response);
  }
  return parseResponse(response);
}

async function setAccessServer(serverUrl, accountToken, team, path, whitelist, blacklist) {
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/workspaces/access?token=${encodeURIComponent(accountToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ team, path, whitelist, blacklist })
  });
  if (!response.ok) {
    await throwForResponse("Could not update access list.", response);
  }
  return parseResponse(response);
}

export {
  browseServer,
  getAccessServer,
  setAccessServer,
  createProjectServer,
  deleteServer,
  exportProjectServer,
  importProjectServer,
  mkdirServer,
  pingServer,
  saveUserState
};