// Legacy (before the module restructure; moves into the Assistant module):
// what undoes one of the agent's structural changes. Text edits are undone
// through the Workspace write path instead. Pure, so it is tested alone.
//
// `checkpoint` is the project as it was before the agent's batch: undoing a
// delete brings back what was there.
import { getNodeIdByPath, getPath } from "../domain/project-model.js";

const join = (...parts) => parts.filter(Boolean).join("/");
const parentOf = (path) => path.split("/").slice(0, -1).join("/");
const baseName = (path) => path.split("/").pop();

export function undoSteps(op, checkpoint) {
  switch (op.type) {
    case "create-file":
    case "create-folder":
      return [{ type: "delete-node", path: join(op.parentPath, op.name) }];
    case "rename-node":
      return [{ type: "rename-node", path: join(parentOf(op.path), op.name), name: baseName(op.path) }];
    case "move-node":
      return [{ type: "move-node", path: join(op.parentPath, baseName(op.path)), parentPath: parentOf(op.path) }];
    case "delete-node":
      return recreate(op.path, checkpoint);
    default:
      return [];
  }
}

function recreate(path, project) {
  const id = project ? getNodeIdByPath(project, path) : null;
  const node = id ? project.nodes[id] : null;
  if (!node) throw new Error(`Nothing to bring back at ${path}`);
  if (node.kind === "file") return [{ type: "create-file", parentPath: parentOf(path), name: node.name, content: node.content ?? "" }];
  return [{ type: "create-folder", parentPath: parentOf(path), name: node.name },
    ...(node.children ?? []).flatMap((child) => recreate(getPath(project, child), project))];
}
