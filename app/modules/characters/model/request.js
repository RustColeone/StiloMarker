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

// [{ path, kind }] for every node but the root, depth first: the tree a model
// is shown, and what list_files answers.
export function walkProjectTree(project) {
  const nodes = project?.nodes ?? {};
  const results = [];
  const walk = (id, prefix) => {
    const node = nodes[id];
    if (!node) return;
    const isRoot = node.parentId === null || node.parentId === undefined;
    const path = isRoot ? "" : (prefix ? `${prefix}/${node.name}` : node.name);
    if (!isRoot) results.push({ path, kind: node.kind ?? "file" });
    for (const child of node.children ?? []) walk(child, path);
  };
  walk(project?.rootId ?? "root", "");
  return results;
}

// The tree as the model is shown it: "folder: a" / "file: a/b.md", a line each.
export function projectTree(project) {
  return walkProjectTree(project).map(({ path, kind }) => (kind === "folder" ? `folder: ${path}` : `file: ${path}`)).join("\n");
}

// The attached files as the model reads them, within a budget of characters:
// { text, paths } (the paths it used).
export function serializeContext(contextFiles, budget) {
  const sections = [], paths = [];
  let remaining = budget;
  for (const entry of contextFiles ?? []) {
    if (remaining <= 0) break;
    if (!entry || typeof entry !== "object") continue;
    const path = String(entry.path ?? "").trim();
    if (!path) continue;
    const kind = String(entry.kind ?? "text").trim().toLowerCase() || "text";
    const body = kind === "image" ? "[Image file omitted from text context.]" : String(entry.content ?? "");
    let chunk = `File: ${path}\nKind: ${kind}\n\`\`\`\n${body}\n\`\`\`\n`;
    if (chunk.length > remaining) chunk = chunk.slice(0, remaining);
    sections.push(chunk);
    paths.push(path);
    remaining -= chunk.length;
  }
  return { text: sections.join("\n").trim(), paths };
}
