// A linked window's project as the window that keeps the workspace sent it,
// with what belongs to this window kept: where it saves (its source mode,
// its folder's handles and path, the index of a folder on disk), the file it
// shows and the folders it has open (by path: node ids differ between
// windows). Pure.
import { getNodeIdByPath, getPath } from "../../workspace/index.js";

export function withWindowView(current, next) {
  if (!current || !next || current.id !== next.id) return next;
  const open = new Map(Object.values(current.nodes)
    .filter((node) => node.kind === "folder")
    .map((node) => [getPath(current, node.id), Boolean(node.expanded)]));
  const nodes = {};
  for (const [id, node] of Object.entries(next.nodes)) {
    const expanded = node.kind === "folder" ? open.get(getPath(next, id)) : undefined;
    nodes[id] = expanded === undefined || expanded === Boolean(node.expanded) ? node : { ...node, expanded };
  }
  const kept = { sourceMode: current.sourceMode };
  for (const name of ["handles", "localPath", "sourceIndex"]) if (current[name] !== undefined) kept[name] = current[name];
  const result = { ...next, nodes, ...kept };
  const shown = current.activeFileId && current.nodes[current.activeFileId] ? getPath(current, current.activeFileId) : null;
  result.activeFileId = (shown && getNodeIdByPath(result, shown)) || (next.nodes[next.activeFileId] ? next.activeFileId : null);
  return result;
}
