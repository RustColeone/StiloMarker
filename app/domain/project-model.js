const ROOT_ID = "root";
const TEXT_FILE_EXTENSIONS = [".md", ".mtree", ".urldb", ".bmap"];
const IMAGE_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
const ALLOWED_FILE_EXTENSIONS = [...TEXT_FILE_EXTENSIONS, ...IMAGE_FILE_EXTENSIONS];

function createId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`;
}

function getExtension(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function isAllowedFileName(name) {
  return ALLOWED_FILE_EXTENSIONS.includes(getExtension(name));
}

function isTextFileName(name) {
  return TEXT_FILE_EXTENSIONS.includes(getExtension(name));
}

function isBmapFileName(name) {
  return getExtension(name) === ".bmap";
}

function isUrlDbFileName(name) {
  return getExtension(name) === ".urldb";
}

function isImageFileName(name) {
  return IMAGE_FILE_EXTENSIONS.includes(getExtension(name));
}

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
    throw new Error("Only .md, .mtree, .urldb, and supported image files are allowed.");
  }

  return {
    id: createId("file"),
    kind: "file",
    name,
    parentId,
    content,
    expanded: false,
    dirty: false,
    sourceVersion: 0
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

function applyTextPatch(content, operation, { skipConflictCheck = false } = {}) {
  const start = Number(operation.start);
  const end = Number(operation.end);
  const insertText = String(operation.text ?? "");
  const removedText = String(operation.removedText ?? "");

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > content.length) {
    throw new Error("Invalid text patch range.");
  }

  if (!skipConflictCheck) {
    const currentSlice = content.slice(start, end);
    if (currentSlice !== removedText) {
      throw new Error("Text patch conflict detected.");
    }
  }

  return `${content.slice(0, start)}${insertText}${content.slice(end)}`;
}

function cloneProject(project) {
  return structuredClone(project);
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

function markFileSaved(project, fileId) {
  const next = cloneProject(project);
  const file = getNode(next, fileId);
  if (file.kind !== "file") {
    throw new Error("Only files can be saved.");
  }

  file.dirty = false;
  file.sourceVersion += 1;
  return next;
}

function renameNode(project, nodeId, name) {
  const next = cloneProject(project);
  const node = getNode(next, nodeId);
  if (node.kind === "file" && !isAllowedFileName(name)) {
    throw new Error("Only .md, .mtree, .urldb, and supported image files are allowed.");
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
  sourceParent.children = sourceParent.children.filter((childId) => childId !== nodeId);

  const insertionParent = getNode(next, targetParentId);
  const clampedIndex = targetIndex === null
    ? insertionParent.children.length
    : Math.max(0, Math.min(targetIndex, insertionParent.children.length));
  const normalizedIndex = sourceParent.id === insertionParent.id && sourceIndex >= 0 && sourceIndex < clampedIndex
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

  if (node.kind === "file" && isUrlDbFileName(node.name)) {
    node.expanded = !node.expanded;
    return next;
  }

  throw new Error("Only folders and .urldb files can be expanded.");
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
    return markFileSaved(next, nodeId);
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
    return markFileSaved(next, nodeId);
  }

  throw new Error(`Unsupported sync operation: ${operation.type}`);
}

export {
  ALLOWED_FILE_EXTENSIONS,
  IMAGE_FILE_EXTENSIONS,
  ROOT_ID,
  TEXT_FILE_EXTENSIONS,
  applyTextPatch,
  applySyncOperation,
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
  isBmapFileName,
  isTextFileName,
  isUrlDbFileName,
  listVisibleNodes,
  markFileSaved,
  moveNode,
  removeNodeRecursive,
  renameNode,
  serializeProject,
  setActiveFile,
  toggleFolder,
  updateFileContent
};