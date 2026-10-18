// What a request to a model carries from the project (for the agent and for
// a character's reply alike): the project's tree and text, images emptied
// (data URLs are large and a model can't edit them), and the attached files.
import { getNodeIdByPath, isImageFileName } from "../../workspace/index.js";

export function projectSnapshot(project) {
  const nodes = {};
  for (const [id, node] of Object.entries(project.nodes ?? {})) {
    nodes[id] = node.kind === "file" && isImageFileName(node.name) ? { ...node, content: "" } : { ...node };
  }
  return { rootId: project.rootId, nodes };
}

// The attached files ({ contextPaths }) that still exist, as { path, kind, content }.
export function contextFiles(project, { contextPaths = [] } = {}) {
  return contextPaths.map((path) => {
    const nodeId = getNodeIdByPath(project, path);
    const node = nodeId ? project.nodes[nodeId] : null;
    if (!node || node.kind !== "file") return null;
    if (isImageFileName(node.name)) return { path, kind: "image", content: "" };
    return { path, kind: "text", content: typeof node.content === "string" ? node.content : "" };
  }).filter(Boolean);
}
