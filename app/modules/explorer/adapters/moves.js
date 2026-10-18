// Moving things around in the explorer: where a drag would drop (and its
// marker), moving files and folders, moving a file's parts within and between
// files, what is selected, and copy and paste of nodes and parts.
// Part of the Explorer module: `app` is its shared context (surface.js).
import { ROOT_ID, findChildByName, getPath } from "../../workspace/index.js";

export function createMoves(app) {
  function clearExplorerDropState() {
    app.elements.explorerTree.classList.remove("is-drop-into-root");
    app.elements.explorerTree.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach((row) => {
      row.classList.remove("is-drop-before", "is-drop-after", "is-drop-into");
    });
  }

  function setExplorerDropState(row, placement) {
    clearExplorerDropState();
    if (!placement) {
      return;
    }
    if (!row) {
      app.elements.explorerTree.classList.add("is-drop-into-root");
      return;
    }
    row.classList.add(`is-drop-${placement}`);
  }

  function getExplorerDropPayloadKind(types) {
    if (types.includes("text/mdnotes-node-id")) {
      return "node";
    }
    if (types.includes("text/mdnotes-file-id")) {
      return "file";
    }
    if (types.includes("text/stilo-file-part")) {
      return "part";
    }
    return null;
  }

  function getExplorerDropPlacement(row, node, partId, payloadKind, event) {
    if (payloadKind === "part") {
      if (partId) {
        const rect = row.getBoundingClientRect();
        return event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
      }
      return partsFile(app.controller.getProject(), node.id) ? "into" : null;
    }

    if (payloadKind !== "file" && payloadKind !== "node") {
      return null;
    }

    const rect = row.getBoundingClientRect();
    if (node.kind === "folder") {
      const topEdge = rect.top + (rect.height * 0.25);
      const bottomEdge = rect.bottom - (rect.height * 0.25);
      if (event.clientY < topEdge) {
        return "before";
      }
      if (event.clientY > bottomEdge) {
        return "after";
      }
      return "into";
    }

    return event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
  }

  function resolveNodeDropLocation(project, targetNodeId, placement) {
    if (!targetNodeId) {
      const root = project.nodes[ROOT_ID];
      return { parentId: ROOT_ID, index: root?.children.length ?? 0 };
    }

    const targetNode = project.nodes[targetNodeId];
    if (!targetNode) {
      return null;
    }

    if (placement === "into") {
      if (targetNode.kind !== "folder") {
        return null;
      }
      return { parentId: targetNode.id, index: targetNode.children.length };
    }

    const parent = project.nodes[targetNode.parentId];
    if (!parent || parent.kind !== "folder") {
      return null;
    }

    const targetIndex = parent.children.indexOf(targetNode.id);
    if (targetIndex < 0) {
      return null;
    }

    return {
      parentId: parent.id,
      index: placement === "after" ? targetIndex + 1 : targetIndex
    };
  }

  function moveExplorerNode(nodeId, targetNodeId, placement) {
    const project = app.controller.getProject();
    const draggedNode = project.nodes[nodeId];
    if (!draggedNode || (draggedNode.kind !== "file" && draggedNode.kind !== "folder")) {
      return false;
    }

    const destination = resolveNodeDropLocation(project, targetNodeId, placement);
    if (!destination) {
      return false;
    }

    const sourceParent = project.nodes[draggedNode.parentId];
    const sourceIndex = sourceParent?.children.indexOf(nodeId) ?? -1;
    if (sourceIndex < 0) {
      return false;
    }

    const normalizedIndex = sourceParent?.id === destination.parentId && sourceIndex < destination.index
      ? destination.index - 1
      : destination.index;
    if (draggedNode.parentId === destination.parentId && sourceIndex === normalizedIndex) {
      return false;
    }

    const oldPath = getPath(project, nodeId);
    const parentPath = destination.parentId === ROOT_ID ? "" : getPath(project, destination.parentId);
    app.controller.move(nodeId, destination.parentId, destination.index);
    app.view.pick(nodeId);
    // Tell the server. A move used to change only this browser's tree; the server
    // kept the old path, and the next reconnect's reconcile — which can only add
    // what the server lacks — uploaded the file again at its new path, leaving
    // both. As with rename, re-key any queued text patch to the new path first so
    // a pending edit lands on the moved file instead of the vanished old path.
    const newPath = getPath(app.controller.getProject(), nodeId);
    app.collaboration.remapPatchPath(oldPath, newPath);
    app.remapPersonaPaths(oldPath, newPath);
    app.publishOperation({ type: "move-node", path: oldPath, parentPath, index: destination.index });
    app.logDebug("action", "Explorer node moved", `${oldPath} -> ${newPath}`);
    return true;
  }

  // A file with parts (Workspace's `parts`) and its provider, or null.
  function partsFile(project, fileId) {
    const file = fileId ? project.nodes[fileId] : null;
    const parts = file?.kind === "file" ? app.parts.of(file.name) : null;
    return parts ? { file, parts } : null;
  }

  // Where `index` lands among the target's parts: next to `targetPartId`, or last.
  function partIndex(parts, text, targetPartId, placement) {
    const list = parts.list(text);
    if (!targetPartId) return list.length;
    const index = list.findIndex((part) => part.id === targetPartId);
    return index < 0 ? null : placement === "after" ? index + 1 : index;
  }

  function showMovedPart(fileId, parts, text, name, previewToo) {
    const part = parts.list(text).find((candidate) => candidate.name === name);
    if (part) {
      app.setActiveSourcePart(fileId, part.id);
    } else {
      app.view.pick(fileId);
      app.controller.setActiveFile(fileId);
    }
    if (previewToo) app.view.showPreview(fileId, part?.id ?? null);
  }

  function moveExplorerPart(sourceFileId, sourcePartId, targetNodeId, targetPartId, placement) {
    const project = app.controller.getProject();
    const source = partsFile(project, sourceFileId);
    const target = partsFile(project, targetNodeId);
    if (!source || !target || source.parts !== target.parts) {
      return false;
    }
    const { parts } = source;
    let moving;
    try {
      moving = parts.take(source.file.content, sourcePartId);
    } catch {
      return false;
    }
    const targetIndex = partIndex(parts, target.file.content, targetPartId, placement);
    if (targetIndex === null) {
      return false;
    }

    // Through the write path, the target first: a refused second write leaves the part in both files, not neither.
    const write = (file, text) => app.workspace.write(getPath(project, file.id), text, { source: "file part" });
    const report = (error) => app.notify(error.message);
    let nextTargetContent;
    try {
      if (sourceFileId === targetNodeId) {
        const sourceIndex = parts.list(source.file.content).findIndex((part) => part.id === sourcePartId);
        const normalizedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        if (sourceIndex === normalizedIndex) {
          return false;
        }
        nextTargetContent = parts.insert(parts.remove(source.file.content, sourcePartId), moving, normalizedIndex);
        void write(source.file, nextTargetContent).catch(report);
      } else {
        nextTargetContent = parts.insert(target.file.content, moving, targetIndex);
        const nextSourceContent = parts.remove(source.file.content, sourcePartId);
        void write(target.file, nextTargetContent).then(() => write(source.file, nextSourceContent)).catch(report);
      }
    } catch (error) {
      report(error);
      return false;
    }
    showMovedPart(targetNodeId, parts, nextTargetContent, moving.name, app.view.get().previewFileId === sourceFileId || app.view.get().previewFileId === targetNodeId);
    app.logDebug("action", "Part moved", `${getPath(app.controller.getProject(), targetNodeId)} :: ${moving.name}`);
    return true;
  }

  function getSelectedNode(project) {
    return project.nodes[app.view.get().selectionNodeId] ?? (project.activeFileId ? project.nodes[project.activeFileId] : project.nodes[project.rootId]);
  }

  // The part open in the source editor: { file, parts, part }, or null.
  function getSelectedPart(project) {
    const found = app.view.get().sourcePart ? partsFile(project, app.view.get().sourcePart.fileId) : null;
    const part = found?.parts.list(found.file.content).find((candidate) => candidate.id === app.view.get().sourcePart.partId);
    return part ? { ...found, part } : null;
  }

  function getSelectedParent(project) {
    const selectedNode = getSelectedNode(project);
    if (!selectedNode) {
      return project.nodes[project.rootId];
    }
    if (selectedNode.kind === "folder") {
      return selectedNode;
    }
    return project.nodes[selectedNode.parentId];
  }

  function getPasteTargetParent(project, targetNodeId) {
    const node = project.nodes[targetNodeId] ?? project.nodes[project.rootId];
    if (!node) {
      return null;
    }
    if (node.kind === "folder") {
      return node;
    }
    return project.nodes[node.parentId] ?? null;
  }

  function canPasteIntoExplorerTarget(target) {
    const payload = app.explorerClipboard.payload;
    if (!payload) {
      return false;
    }

    const project = app.controller.getProject();
    const node = project.nodes[target?.nodeId] ?? project.nodes[project.rootId];
    if (!node) {
      return false;
    }

    if (payload.kind === "node") {
      return !target?.partId && node.kind === "folder";
    }

    if (payload.kind === "part") {
      return partsFile(project, node.id)?.parts === payload.parts;
    }

    return false;
  }

  function copyExplorerTarget(target) {
    const project = app.controller.getProject();
    if (target.partId) {
      const found = partsFile(project, target.nodeId);
      let part;
      try {
        part = found?.parts.take(found.file.content, target.partId);
      } catch {
        return false;
      }
      if (!part) {
        return false;
      }
      app.explorerClipboard.payload = { kind: "part", parts: found.parts, part };
      app.logDebug("action", "Explorer copied part", `${getPath(project, target.nodeId)} :: ${part.name}`);
      return true;
    }

    const node = project.nodes[target.nodeId];
    if (!node || node.id === project.rootId) {
      return false;
    }
    app.explorerClipboard.payload = {
      kind: "node",
      nodeId: node.id
    };
    app.logDebug("action", "Explorer copied item", getPath(project, node.id));
    return true;
  }

  function duplicateNodeTree(sourceProject, sourceNodeId, targetParentId) {
    const sourceNode = sourceProject.nodes[sourceNodeId];
    if (!sourceNode) {
      throw new Error("Copied item no longer exists.");
    }

    if (sourceNode.kind === "file") {
      const before = app.controller.getProject();
      const fileName = app.suggestUniqueFileName(before, targetParentId, sourceNode.name);
      app.controller.createFile(targetParentId, fileName, sourceNode.content);
      return findChildByName(app.controller.getProject(), targetParentId, fileName)?.id ?? null;
    }

    const before = app.controller.getProject();
    const folderName = app.suggestUniqueFolderName(before, targetParentId, sourceNode.name);
    app.controller.createFolder(targetParentId, folderName);
    const createdFolder = findChildByName(app.controller.getProject(), targetParentId, folderName);
    if (!createdFolder || createdFolder.kind !== "folder") {
      return null;
    }

    sourceNode.children.forEach((childId) => {
      duplicateNodeTree(sourceProject, childId, createdFolder.id);
    });
    return createdFolder.id;
  }

  function pasteNodeClipboard(target) {
    const payload = app.explorerClipboard.payload;
    if (!payload || payload.kind !== "node") {
      return false;
    }

    const sourceProject = app.controller.getProject();
    const parent = getPasteTargetParent(sourceProject, target.nodeId);
    if (!parent) {
      return false;
    }

    const createdId = duplicateNodeTree(sourceProject, payload.nodeId, parent.id);
    if (!createdId) {
      return false;
    }

    app.view.pick(createdId);
    const createdNode = app.controller.getProject().nodes[createdId];
    if (createdNode?.kind === "file") {
      app.setActiveSourceFile(createdId);
      if (app.isPreviewableFileName(createdNode.name)) {
        app.setPreviewFile(createdId);
      }
    }
    app.publishSnapshot();
    app.logDebug("action", "Explorer pasted item", getPath(app.controller.getProject(), createdId));
    return true;
  }

  // A name like `name` that none of the file's parts has.
  function uniquePartName(parts, text, name) {
    const names = new Set(parts.list(text).map((part) => part.name.toLowerCase()));
    let candidate = name;
    for (let counter = 2; names.has(candidate.toLowerCase()); counter += 1) candidate = `${name}-${counter}`;
    return candidate;
  }

  function pastePartClipboard(target) {
    const payload = app.explorerClipboard.payload;
    const project = app.controller.getProject();
    const found = payload?.kind === "part" ? partsFile(project, target.nodeId) : null;
    if (!found || found.parts !== payload.parts) {
      return false;
    }
    const { file, parts } = found;
    const index = target.partId ? partIndex(parts, file.content, target.partId, "after") ?? null : null;
    const part = { ...payload.part, name: uniquePartName(parts, file.content, payload.part.name) };
    let nextContent;
    try {
      nextContent = parts.insert(file.content, part, index);
    } catch (error) {
      app.notify(error.message);
      return false;
    }
    void app.workspace.write(getPath(project, file.id), nextContent, { source: "file part" }).catch((error) => app.notify(error.message));
    showMovedPart(file.id, parts, nextContent, part.name, true);
    app.logDebug("action", "Explorer pasted part", `${getPath(app.controller.getProject(), file.id)} :: ${part.name}`);
    return true;
  }

  function pasteExplorerClipboard(target) {
    if (!canPasteIntoExplorerTarget(target)) {
      return false;
    }

    if (app.explorerClipboard.payload?.kind === "node") {
      return pasteNodeClipboard(target);
    }

    if (app.explorerClipboard.payload?.kind === "part") {
      return pastePartClipboard(target);
    }

    return false;
  }

  return { clearExplorerDropState, setExplorerDropState, getExplorerDropPayloadKind, getExplorerDropPlacement, resolveNodeDropLocation, moveExplorerNode, partsFile, partIndex, showMovedPart, moveExplorerPart, getSelectedNode, getSelectedPart, getSelectedParent, getPasteTargetParent, canPasteIntoExplorerTarget, copyExplorerTarget, duplicateNodeTree, pasteNodeClipboard, uniquePartName, pastePartClipboard, pasteExplorerClipboard };
}
