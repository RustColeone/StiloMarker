// The project: a tree of folders and files, and the operations that change
// it. Pure: projects in, new projects out. The server applies the same
// operations (spec/workspace/operations.cases.json keeps the two in step).
import { builtinTypes } from "../../file-types/index.js";
import { applyTextPatch } from "./text-patch.js";

const ROOT_ID = "root";

// File types belong to the File types module (protocol/file-types.json);
// these helpers only ask it.
const ALLOWED_MESSAGE = () => `Only ${builtinTypes.describe()} files are allowed.`;

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

const isAllowedFileName = (name) => builtinTypes.isKnown(name);
const isTextFileName = (name) => builtinTypes.isText(name);
const isBmapFileName = (name) => builtinTypes.is(name, "bmap");
const isMtreeFileName = (name) => builtinTypes.is(name, "mtree");
const isImageFileName = (name) => builtinTypes.isImage(name);
// Notes and character files edit and preview the same way.
const isMarkdownFileName = (name) => builtinTypes.formatOf(name) === "markdown";
const isPersonaFileName = (name) => builtinTypes.is(name, "persona");
// For messages and file names: a type's extension, the list of allowed
// extensions, and a name without its type's extension.
const fileTypeExtension = (id) => builtinTypes.extensionsOf(id)[0] ?? "";
const describeFileTypes = () => builtinTypes.describe();
const fileBaseName = (name) => builtinTypes.baseName(name);

function createFolder(name, parentId = ROOT_ID) {
  return {
    id: createId("folder"),
    kind: "folder",
    name,
    parentId,
    children: [],
    expanded: true
  };
}

function createFile(name, parentId = ROOT_ID, content = "") {
  if (!isAllowedFileName(name)) {
    throw new Error(ALLOWED_MESSAGE());
  }

  return {
    id: createId("file"),
    kind: "file",
    name,
    parentId,
    content,
    expanded: false,
    dirty: false,
    sourceVersion: 0,
    editSessions: 0,
    sessionEdits: 0,
    lastEditAt: 0
  };
}

function createProject(name = "Notes") {
  return {
    id: createId("project"),
    name,
    sourceMode: "memory",
    rootId: ROOT_ID,
    activeFileId: null,
    nodes: {
      [ROOT_ID]: {
        id: ROOT_ID,
        kind: "folder",
        name,
        parentId: null,
        children: [],
        expanded: true
      }
    }
  };
}


// A deep copy of the model's objects and arrays that SHARES its strings.
// structuredClone copies string data too, and every edit clones the project —
// so each keystroke used to duplicate every file's full text (~600KB for a
// novel-sized workspace) straight into long-lived memory, which is what kept
// triggering full garbage collections. Strings are immutable, so sharing them
// is safe; objects and arrays are still fresh, so mutating a node of the copy
// never touches the original — the same guarantee structuredClone gave.
// Anything that is not plain data (a Date, Map, buffer…) still goes through
// structuredClone, so no value changes meaning.
function cloneModelData(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneModelData);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return structuredClone(value);
  const copy = {};
  for (const key of Object.keys(value)) copy[key] = cloneModelData(value[key]);
  return copy;
}

function cloneProject(project) {
  // Handles are capabilities; preserve their identity across model edits so
  // writes for the same directory share one serialization queue.
  const { handles, ...model } = project;
  return { ...cloneModelData(model), ...(handles ? { handles: { ...handles } } : {}) };
}

function getNode(project, nodeId) {
  const node = project.nodes[nodeId];
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node;
}

function getPathSegments(project, nodeId) {
  const segments = [];
  let current = getNode(project, nodeId);

  while (current && current.parentId) {
    segments.unshift(current.name);
    current = getNode(project, current.parentId);
  }

  return segments;
}

function getPath(project, nodeId) {
  return getPathSegments(project, nodeId).join("/");
}

function findChildByName(project, parentId, name) {
  const parent = getNode(project, parentId);
  return parent.children
    .map((childId) => project.nodes[childId])
    .find((child) => child && child.name === name) ?? null;
}

function getNodeIdByPath(project, path) {
  const segments = path.split("/").filter(Boolean);
  let currentId = ROOT_ID;

  for (const segment of segments) {
    const child = findChildByName(project, currentId, segment);
    if (!child) {
      return null;
    }
    currentId = child.id;
  }

  return currentId;
}

function getNodeByPath(project, path) {
  const nodeId = getNodeIdByPath(project, path);
  return nodeId ? getNode(project, nodeId) : null;
}

function ensureUniqueName(project, parentId, name, excludeNodeId = null) {
  const parent = getNode(project, parentId);
  const duplicate = parent.children
    .map((childId) => project.nodes[childId])
    .find((child) => child && child.id !== excludeNodeId && child.name.toLowerCase() === name.toLowerCase());

  if (duplicate) {
    throw new Error(`A sibling item named \"${name}\" already exists.`);
  }
}

function appendNode(project, node) {
  const next = cloneProject(project);
  const parent = getNode(next, node.parentId);
  ensureUniqueName(next, node.parentId, node.name);
  next.nodes[node.id] = node;
  parent.children = [...parent.children, node.id];
  return next;
}

function addFolder(project, parentId, name) {
  return appendNode(project, createFolder(name, parentId));
}

function addFile(project, parentId, name, content = "") {
  return appendNode(project, createFile(name, parentId, content));
}

function updateFileContent(project, fileId, content) {
  const next = cloneProject(project);
  const file = getNode(next, fileId);
  if (file.kind !== "file") {
    throw new Error("Only files can be edited.");
  }

  file.content = content;
  file.dirty = true;
  return next;
}

// A writing "sitting": edits to one file less than this apart are the same
// session. It is the E of the S.E.N version label. Whoever hosts the document
// owns it — this runs only when there is no host but us (no-server mode); in a
// synced workspace the server counts, so everyone in the room shares one E.
const EDIT_SESSION_GAP_MS = 600 * 1000;

function bumpEditCounters(file, now = Date.now()) {
  if (now - (Number(file.lastEditAt) || 0) > EDIT_SESSION_GAP_MS) {
    file.editSessions = (Number(file.editSessions) || 0) + 1;
    file.sessionEdits = 0;
  }
  file.lastEditAt = now;
  file.sourceVersion = (Number(file.sourceVersion) || 0) + 1;
  file.sessionEdits = (Number(file.sessionEdits) || 0) + 1;
}

function applyHostCounters(project, fileId, counters) {
  const file = project.nodes[fileId];
  if (!file || file.kind !== "file" || !counters) return project;
  if (counters.editSessions !== undefined) file.editSessions = Number(counters.editSessions) || 0;
  if (counters.sessionEdits !== undefined) file.sessionEdits = Number(counters.sessionEdits) || 0;
  if (counters.sourceVersion !== undefined) file.sourceVersion = Number(counters.sourceVersion) || 0;
  return project;
}

function markFileSaved(project, fileId, countEdits = true) {
  const next = cloneProject(project);
  const file = getNode(next, fileId);
  if (file.kind !== "file") {
    throw new Error("Only files can be saved.");
  }

  file.dirty = false;
  if (countEdits) bumpEditCounters(file);
  return next;
}

// Clear the dirty flag on several files in one pass (auto-save). Unknown or
// non-file ids are skipped so a stale id can't throw mid-flush.
function markFilesSaved(project, fileIds, countEdits = true) {
  const next = cloneProject(project);
  const now = Date.now();  // one timestamp for the batch: it is a single flush
  for (const fileId of fileIds ?? []) {
    const file = next.nodes[fileId];
    if (file?.kind === "file" && file.dirty) {
      file.dirty = false;
      if (countEdits) bumpEditCounters(file, now);
    }
  }
  return next;
}

function renameNode(project, nodeId, name) {
  const next = cloneProject(project);
  const node = getNode(next, nodeId);
  if (node.kind === "file" && !isAllowedFileName(name)) {
    throw new Error(ALLOWED_MESSAGE());
  }

  ensureUniqueName(next, node.parentId, name, node.id);
  node.name = name;
  return next;
}

function removeNodeRecursive(project, nodeId) {
  const next = cloneProject(project);
  const node = getNode(next, nodeId);
  if (nodeId === ROOT_ID) {
    throw new Error("Cannot remove the root folder.");
  }

  const parent = getNode(next, node.parentId);
  parent.children = parent.children.filter((childId) => childId !== nodeId);

  const removeChild = (childNodeId) => {
    const child = next.nodes[childNodeId];
    if (!child) {
      return;
    }
    if (child.kind === "folder") {
      child.children.forEach(removeChild);
    }
    delete next.nodes[childNodeId];
  };

  removeChild(nodeId);

  if (next.activeFileId === nodeId) {
    next.activeFileId = null;
  }

  return next;
}

function moveNode(project, nodeId, targetParentId, targetIndex = null) {
  const next = cloneProject(project);
  const node = getNode(next, nodeId);
  if (nodeId === ROOT_ID) {
    throw new Error("Cannot move the root folder.");
  }

  const targetParent = getNode(next, targetParentId);
  if (targetParent.kind !== "folder") {
    throw new Error("Items can only be moved into folders.");
  }

  let ancestor = targetParent;
  while (ancestor.parentId) {
    if (ancestor.id === nodeId) {
      throw new Error("Cannot move an item into itself.");
    }
    ancestor = getNode(next, ancestor.parentId);
  }

  ensureUniqueName(next, targetParentId, node.name, node.id);

  const sourceParent = getNode(next, node.parentId);
  const sourceIndex = sourceParent.children.indexOf(nodeId);
  // targetIndex is a slot in the destination's list as it is BEFORE the move —
  // what the explorer computes from the drop position. Clamp against that
  // length, then account for the removal. Clamping against the shortened list
  // first meant a file dragged to the end of its own folder (index = length)
  // landed one above the bottom; no-index "append" had the same off-by-one.
  const sameParent = sourceParent.id === targetParentId;
  const slots = getNode(next, targetParentId).children.length; // still includes the node if sameParent
  sourceParent.children = sourceParent.children.filter((childId) => childId !== nodeId);

  const insertionParent = getNode(next, targetParentId);
  const clampedIndex = targetIndex === null
    ? slots
    : Math.max(0, Math.min(targetIndex, slots));
  const normalizedIndex = sameParent && sourceIndex >= 0 && sourceIndex < clampedIndex
    ? clampedIndex - 1
    : clampedIndex;

  insertionParent.children.splice(normalizedIndex, 0, nodeId);
  node.parentId = targetParentId;
  return next;
}

function toggleFolder(project, nodeId) {
  const next = cloneProject(project);
  const node = getNode(next, nodeId);
  if (node.kind === "folder") {
    node.expanded = !node.expanded;
    return next;
  }

  if (node.kind === "file" && builtinTypes.typeOf(node.name)?.expandable) {
    node.expanded = !node.expanded;
    return next;
  }

  throw new Error("Only folders and expandable files can be expanded.");
}

function setActiveFile(project, fileId) {
  const next = cloneProject(project);
  const file = getNode(next, fileId);
  if (file.kind !== "file") {
    throw new Error("Only files can be active.");
  }
  next.activeFileId = fileId;
  return next;
}

function listVisibleNodes(project, startId = ROOT_ID, depth = 0, rows = []) {
  const node = getNode(project, startId);
  if (startId !== ROOT_ID) {
    rows.push({ node, depth, path: getPath(project, node.id) });
  }

  if (node.kind === "folder" && node.expanded) {
    node.children
      .map((childId) => getNode(project, childId))
      .forEach((child) => listVisibleNodes(project, child.id, depth + (startId === ROOT_ID ? 0 : 1), rows));
  }

  return rows;
}

function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

function deserializeProject(json) {
  const project = JSON.parse(json);
  if (!project || !project.nodes || !project.rootId) {
    throw new Error("Invalid project data.");
  }
  return project;
}

function applySyncOperation(project, operation) {
  if (!operation || typeof operation !== "object") {
    throw new Error("Sync operation is required.");
  }

  if (operation.type === "replace-project") {
    if (!operation.project) {
      throw new Error("Replace-project operation requires project data.");
    }
    return operation.project;
  }

  if (operation.type === "create-folder") {
    const parentId = operation.parentPath ? getNodeIdByPath(project, operation.parentPath) : ROOT_ID;
    if (!parentId) {
      throw new Error(`Parent path not found: ${operation.parentPath}`);
    }
    return addFolder(project, parentId, operation.name);
  }

  if (operation.type === "create-file") {
    const parentId = operation.parentPath ? getNodeIdByPath(project, operation.parentPath) : ROOT_ID;
    if (!parentId) {
      throw new Error(`Parent path not found: ${operation.parentPath}`);
    }
    return addFile(project, parentId, operation.name, operation.content ?? "");
  }

  if (operation.type === "rename-node") {
    const nodeId = getNodeIdByPath(project, operation.path);
    if (!nodeId) {
      throw new Error(`Node path not found: ${operation.path}`);
    }
    return renameNode(project, nodeId, operation.name);
  }

  if (operation.type === "delete-node") {
    const nodeId = getNodeIdByPath(project, operation.path);
    if (!nodeId) {
      return project;
    }
    return removeNodeRecursive(project, nodeId);
  }

  if (operation.type === "move-node") {
    const nodeId = getNodeIdByPath(project, operation.path);
    if (!nodeId) {
      throw new Error(`Node path not found: ${operation.path}`);
    }
    const parentId = operation.parentPath ? getNodeIdByPath(project, operation.parentPath) : ROOT_ID;
    if (!parentId) {
      throw new Error(`Parent path not found: ${operation.parentPath}`);
    }
    return moveNode(project, nodeId, parentId, operation.index ?? null);
  }

  if (operation.type === "update-file") {
    const nodeId = getNodeIdByPath(project, operation.path);
    if (!nodeId) {
      throw new Error(`File path not found: ${operation.path}`);
    }
    const next = updateFileContent(project, nodeId, operation.content ?? "");
    return applyHostCounters(markFileSaved(next, nodeId, false), nodeId, operation.counters);
  }

  if (operation.type === "patch-file") {
    const nodeId = getNodeIdByPath(project, operation.path);
    if (!nodeId) {
      throw new Error(`File path not found: ${operation.path}`);
    }

    const file = getNode(project, nodeId);
    if (file.kind !== "file") {
      throw new Error("Only files can receive text patches.");
    }

    const patchedContent = applyTextPatch(file.content, operation, { skipConflictCheck: true });
    const next = updateFileContent(project, nodeId, patchedContent);
    return applyHostCounters(markFileSaved(next, nodeId, false), nodeId, operation.counters);
  }

  throw new Error(`Unsupported sync operation: ${operation.type}`);
}

export {
  cloneModelData,
  describeFileTypes,
  fileBaseName,
  fileTypeExtension,
  ROOT_ID,
  applyTextPatch,
  applySyncOperation,
  applyHostCounters,
  addFile,
  addFolder,
  createProject,
  deserializeProject,
  findChildByName,
  getNode,
  getNodeByPath,
  getNodeIdByPath,
  getPath,
  isImageFileName,
  isAllowedFileName,
  isMarkdownFileName,
  isMtreeFileName,
  isPersonaFileName,
  isBmapFileName,
  isTextFileName,
  listVisibleNodes,
  markFileSaved,
  markFilesSaved,
  moveNode,
  removeNodeRecursive,
  renameNode,
  serializeProject,
  setActiveFile,
  toggleFolder,
  updateFileContent
};