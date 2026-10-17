// Comments' messages to the server (protocol/comments.contract.json). Each
// takes the server address and account token of the workspace it is about.
import { normalizeServerUrl, parseResponse, throwForResponse } from "../../shell/index.js";

async function call(serverUrl, path, { token, query, body, failure }) {
  const params = new URLSearchParams({ token, ...(query ?? {}) });
  const response = await fetch(`${normalizeServerUrl(serverUrl)}${path}?${params}`, body === undefined
    ? { method: "GET", headers: { accept: "application/json" } }
    : { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) await throwForResponse(failure, response);
  return parseResponse(response);
}

export const listComments = (serverUrl, token, team, path) =>
  call(serverUrl, "/api/comments", { token, query: { team, path }, failure: "Could not load comments." });
export const saveComment = (serverUrl, token, team, path, comment) =>
  call(serverUrl, "/api/comments", { token, body: { team, path, ...comment }, failure: "Could not save the comment." });
export const deleteComment = (serverUrl, token, team, path, id) =>
  call(serverUrl, "/api/comments/delete", { token, body: { team, path, id }, failure: "Could not delete the comment." });
// Where comments ended up after edits moved their lines.
export const reanchorComments = (serverUrl, token, team, path, file, moves) =>
  call(serverUrl, "/api/comments/reanchor", { token, body: { team, path, file, moves }, failure: "Could not update comment anchors." });
