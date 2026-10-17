// History's messages to the server (protocol/history.contract.json). Each
// takes the server address and account token of the workspace it is about.
import { normalizeServerUrl, parseResponse, throwForResponse } from "../../shell/index.js";

async function call(serverUrl, path, { token, query = {}, body, failure }) {
  const params = new URLSearchParams({ token, ...(body === undefined ? Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) : {}) });
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}?${params}`, body === undefined
    ? { method: "GET", headers: { accept: "application/json" } }
    : { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) await throwForResponse(failure, response);
  return parseResponse(response);
}

export const listServerSnapshotPaths = (serverUrl, token, team, path) =>
  call(serverUrl, "/api/snapshots", { token, query: { team, path }, failure: "Could not list snapshots." });
export const listServerSnapshotVersions = (serverUrl, token, team, path, file) =>
  call(serverUrl, "/api/snapshots/versions", { token, query: { team, path, file }, failure: "Could not list snapshot versions." });
export const getServerSnapshotContent = (serverUrl, token, team, path, id) =>
  call(serverUrl, "/api/snapshots/content", { token, query: { team, path, id }, failure: "Could not read snapshot." });
// `createdAt` only when migrating a snapshot from this browser's own store: the
// server keeps its time and treats uploading it again as a no-op.
export const createServerSnapshot = (serverUrl, token, team, path, file, content, label = "", createdAt = undefined) =>
  call(serverUrl, "/api/snapshots", { token, body: { team, path, file, content, label, createdAt }, failure: "Could not save snapshot." });
export const deleteServerSnapshot = (serverUrl, token, team, path, id) =>
  call(serverUrl, "/api/snapshots/delete", { token, body: { team, path, id }, failure: "Could not delete snapshot." });

export const listWorkspaceBackups = (serverUrl, token, team, path) =>
  call(serverUrl, "/api/backups", { token, query: { team, path }, failure: "Could not list backups." });
export const listWorkspaceBackupFiles = (serverUrl, token, team, path, id) =>
  call(serverUrl, "/api/backups/files", { token, query: { team, path, id }, failure: "Could not read that backup." });
export const getWorkspaceBackupContent = (serverUrl, token, team, path, id, file) =>
  call(serverUrl, "/api/backups/content", { token, query: { team, path, id, file }, failure: "Could not read that file from the backup." });
export const createWorkspaceBackup = (serverUrl, token, team, path, label = "") =>
  call(serverUrl, "/api/backups", { token, body: { team, path, label }, failure: "Could not create a backup." });
