// Explorer and file actions: selection, copy / paste, drag-and-drop moves,
// the Add File dialog (and files dropped into the editor), create / rename /
// delete / export, and the explorer's context-menu actions.
// main.js creates this on first use and passes its shared values in `app`.
import { ROOT_ID, findChildByName, getPath, isAllowedFileName, isBmapFileName, isImageFileName, isMarkdownFileName, isTextFileName, isUrlDbFileName } from "../domain/project-model.js";
import { normalizeBmapAst, parseBmap } from "../services/bmap-service.js";
import { dataUrlToBlob, getExportBytes, getMimeTypeForFileName, readFileAsProjectContent } from "../services/file-content-service.js";
import { appendUrlDbEntry, moveUrlDbEntry, moveUrlDbEntryBetweenFiles, removeUrlDbEntry, serializeUrlDb, updateUrlDbEntry } from "../services/urldb-service.js";
import { createZip, downloadBlob } from "../services/zip-service.js";

export function createFileActions(app) {
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
    if (types.includes("text/mdnotes-urldb-entry")) {
      return "urldb-entry";
    }
    return null;
  }

  function getExplorerDropPlacement(row, node, entryId, payloadKind, event) {
    if (payloadKind === "urldb-entry") {
      if (entryId) {
        const rect = row.getBoundingClientRect();
        return event.clientY < rect.top + (rect.height / 2) ? "before" : "after";
      }
      return node.kind === "file" && isUrlDbFileName(node.name) ? "into" : null;
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
    app.selectionNodeId = nodeId;
    app.sourceUrlDbEntry = null;
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

  function moveExplorerUrlDbEntry(sourceFileId, sourceEntryId, targetNodeId, targetEntryId, placement) {
    const project = app.controller.getProject();
    const sourceFile = project.nodes[sourceFileId];
    const targetFile = targetNodeId ? project.nodes[targetNodeId] : null;
    if (!sourceFile || sourceFile.kind !== "file" || !isUrlDbFileName(sourceFile.name)) {
      return false;
    }
    if (!targetFile || targetFile.kind !== "file" || !isUrlDbFileName(targetFile.name)) {
      return false;
    }

    const sourceEntry = app.getUrlDbEntryById(sourceFile.content, sourceEntryId);
    if (!sourceEntry) {
      return false;
    }

    const targetEntries = app.getUrlDbEntries(targetFile.content);
    const targetIndex = targetEntryId
      ? (() => {
        const index = targetEntries.findIndex((entry) => entry.id === targetEntryId);
        if (index < 0) {
          return null;
        }
        return placement === "after" ? index + 1 : index;
      })()
      : targetEntries.length;

    if (targetIndex === null) {
      return false;
    }

    let nextTargetContent = targetFile.content;
    if (sourceFileId === targetNodeId) {
      const sourceEntries = app.getUrlDbEntries(sourceFile.content);
      const sourceIndex = sourceEntries.findIndex((entry) => entry.id === sourceEntryId);
      if (sourceIndex < 0) {
        return false;
      }
      const normalizedIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      if (sourceIndex === normalizedIndex) {
        return false;
      }
      nextTargetContent = moveUrlDbEntry(sourceFile.content, sourceEntryId, normalizedIndex);
      app.applyFileContentUpdates([{ fileId: sourceFileId, content: nextTargetContent }]);
    } else {
      const moved = moveUrlDbEntryBetweenFiles(sourceFile.content, sourceEntryId, targetFile.content, targetIndex);
      nextTargetContent = moved.targetContent;
      app.applyFileContentUpdates([
        { fileId: sourceFileId, content: moved.sourceContent },
        { fileId: targetNodeId, content: moved.targetContent }
      ]);
    }

    const nextTargetEntries = app.getUrlDbEntries(nextTargetContent);
    const movedEntry = nextTargetEntries.find((entry) => entry.name === sourceEntry.name);
    if (movedEntry) {
      app.setActiveSourceUrlDbEntry(targetNodeId, movedEntry.id);
    } else {
      app.selectionNodeId = targetNodeId;
      app.sourceUrlDbEntry = null;
      app.controller.setActiveFile(targetNodeId);
    }
    if (app.previewFileId === sourceFileId || app.previewFileId === targetNodeId) {
      app.previewFileId = targetNodeId;
      app.previewUrlDbEntry = movedEntry?.id ?? null;
    }
    app.logDebug("action", "Bookmark entry moved", `${getPath(app.controller.getProject(), targetNodeId)} :: ${sourceEntry.name}`);
    return true;
  }

  function getSelectedNode(project) {
    return project.nodes[app.selectionNodeId] ?? (project.activeFileId ? project.nodes[project.activeFileId] : project.nodes[project.rootId]);
  }

  function getSelectedUrlDbEntry(project) {
    if (!app.sourceUrlDbEntry) {
      return null;
    }

    const file = project.nodes[app.sourceUrlDbEntry.fileId];
    if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
      return null;
    }

    const entry = app.getUrlDbEntryById(file.content, app.sourceUrlDbEntry.entryId);
    if (!entry) {
      return null;
    }

    return { file, entry };
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
      return !target?.entryId && node.kind === "folder";
    }

    if (payload.kind === "urldb-entry") {
      return node.kind === "file" && isUrlDbFileName(node.name);
    }

    return false;
  }

  function copyExplorerTarget(target) {
    const project = app.controller.getProject();
    if (target.entryId) {
      const file = project.nodes[target.nodeId];
      const entry = file?.kind === "file" ? app.getUrlDbEntryById(file.content, target.entryId) : null;
      if (!entry) {
        return false;
      }
      app.explorerClipboard.payload = {
        kind: "urldb-entry",
        fileId: target.nodeId,
        entryId: target.entryId,
        entry: structuredClone(entry)
      };
      app.logDebug("action", "Explorer copied bookmark", `${getPath(project, target.nodeId)} :: ${entry.name}`);
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

    app.selectionNodeId = createdId;
    app.sourceUrlDbEntry = null;
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

  function pasteUrlDbEntryClipboard(target) {
    const payload = app.explorerClipboard.payload;
    if (!payload || payload.kind !== "urldb-entry") {
      return false;
    }

    const project = app.controller.getProject();
    const targetFile = project.nodes[target.nodeId];
    if (!targetFile || targetFile.kind !== "file" || !isUrlDbFileName(targetFile.name)) {
      return false;
    }

    const entries = app.getUrlDbEntries(targetFile.content);
    const insertionIndex = target.entryId
      ? (() => {
        const index = entries.findIndex((entry) => entry.id === target.entryId);
        return index < 0 ? entries.length : index + 1;
      })()
      : entries.length;
    const entryDraft = {
      ...payload.entry,
      name: app.suggestUniqueUrlDbEntryName(entries, payload.entry.name)
    };
    const nextEntries = [...entries];
    nextEntries.splice(insertionIndex, 0, entryDraft);
    const nextContent = serializeUrlDb(nextEntries);
    app.controller.updateContent(targetFile.id, nextContent);
    app.publishOperation({ type: "update-file", path: getPath(project, targetFile.id), content: nextContent });
    const pastedEntry = app.getUrlDbEntries(nextContent).find((entry) => entry.name === entryDraft.name);
    if (pastedEntry) {
      app.setActiveSourceUrlDbEntry(targetFile.id, pastedEntry.id);
      app.previewFileId = targetFile.id;
      app.previewUrlDbEntry = pastedEntry.id;
    }
    app.logDebug("action", "Explorer pasted bookmark", `${getPath(app.controller.getProject(), targetFile.id)} :: ${entryDraft.name}`);
    return true;
  }

  function pasteExplorerClipboard(target) {
    if (!canPasteIntoExplorerTarget(target)) {
      return false;
    }

    if (app.explorerClipboard.payload?.kind === "node") {
      return pasteNodeClipboard(target);
    }

    if (app.explorerClipboard.payload?.kind === "urldb-entry") {
      return pasteUrlDbEntryClipboard(target);
    }

    return false;
  }

  function setAddFileStatus(message) {
    app.elements.addFileStatusText.textContent = message;
  }

  function resetAddFileState() {
    app.addFileState.fileName = "";
    app.addFileState.content = null;
    app.addFileState.sourceLabel = "";
    app.elements.addFileUrlInput.value = "";
    app.elements.addFileNameInput.value = "";
    app.elements.addFileSourceText.textContent = "No staged file yet.";
    setAddFileStatus("Supported: .md, .mtree, .urldb, .png, .jpg, .jpeg, .gif, .svg, .webp, .bmp.");
  }

  function stageAddFileContent({ name, content, sourceLabel }) {
    app.addFileState.fileName = name;
    app.addFileState.content = content;
    app.addFileState.sourceLabel = sourceLabel;
    app.elements.addFileNameInput.value = name;
    app.elements.addFileSourceText.textContent = sourceLabel;
    setAddFileStatus(`Ready to add ${name}.`);
  }

  async function stageAddFileFromLocalFile(file) {
    if (!isAllowedFileName(file.name)) {
      throw new Error("Only markdown, mtree, urldb, and supported image files can be added.");
    }

    const content = await readFileAsProjectContent(file, file.name);
    stageAddFileContent({
      name: file.name,
      content,
      sourceLabel: `Staged from local file: ${file.name}`
    });
  }

  async function stageAddFileFromUrl() {
    const url = app.elements.addFileUrlInput.value.trim();
    if (!url) {
      throw new Error("Enter a file URL first.");
    }

    const suggestedName = app.elements.addFileNameInput.value.trim() || app.inferNameFromUrl(url);
    if (!isAllowedFileName(suggestedName)) {
      throw new Error("The fetched file name must end with a supported extension.");
    }

    let response;
    try {
      response = await fetch(url);
    } catch {
      if (isImageFileName(suggestedName)) {
        throw new Error("Remote image download was blocked by the source host or browser policy. Add that URL to a .urldb album instead.");
      }
      throw new Error("Unable to fetch file from URL.");
    }
    if (!response.ok) {
      throw new Error(`Unable to fetch file from URL (${response.status}).`);
    }

    const blob = await response.blob();
    const file = new File([blob], suggestedName, { type: blob.type });
    const content = await readFileAsProjectContent(file, suggestedName);
    stageAddFileContent({
      name: suggestedName,
      content,
      sourceLabel: `Fetched from ${url}`
    });
  }

  async function handleAddFileTransfer(transfer) {
    const directFile = transfer.files?.[0];
    if (directFile) {
      await stageAddFileFromLocalFile(directFile);
      return;
    }

    const itemFile = Array.from(transfer.items ?? [])
      .map((item) => item.kind === "file" ? item.getAsFile() : null)
      .find(Boolean);
    if (itemFile) {
      await stageAddFileFromLocalFile(itemFile);
      return;
    }

    const uri = transfer.getData("text/uri-list")?.trim();
    const text = transfer.getData("text/plain")?.trim();

    if (uri || app.looksLikeUrl(text || "")) {
      app.elements.addFileUrlInput.value = uri || text;
      setAddFileStatus("URL staged. Use Add File to fetch it.");
      return;
    }

    if (text) {
      const suggestedName = app.elements.addFileNameInput.value.trim() || "pasted-note.md";
      const finalName = /\.(md|mtree)$/i.test(suggestedName) ? suggestedName : `${suggestedName}.md`;
      stageAddFileContent({
        name: finalName,
        content: text,
        sourceLabel: "Staged from pasted text"
      });
    }
  }

  async function addDroppedImageAndInsert(file) {
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isMarkdownFileName(activeFile.name)) {
      return false;
    }

    if (!await app.confirmAction(`Add ${file.name} to the current folder and insert a markdown image reference?`)) {
      return false;
    }

    const project = app.controller.getProject();
    const parentId = project.nodes[activeFile.id].parentId;
    const parentPath = parentId === project.rootId ? "" : getPath(project, parentId);
    const content = await readFileAsProjectContent(file, file.name);
    const fileName = app.suggestUniqueFileName(project, parentId, file.name);
    app.controller.createFile(parentId, fileName, content);
    app.publishOperation({ type: "create-file", parentPath, name: fileName, content });

    const nextProject = app.controller.getProject();
    const createdFile = findChildByName(nextProject, parentId, fileName);
    if (!createdFile || createdFile.kind !== "file") {
      return false;
    }

    const dropOffset = app.editorDragState.dropOffset ?? app.getEditorSelection().start;
    app.elements.editorContent.focus();
    const ref = app.createMarkdownReference(activeFile, createdFile);
    app.replaceEditorRange(dropOffset, dropOffset, ref, dropOffset + ref.length, dropOffset + ref.length);
    app.logDebug("action", "Dropped image inserted", fileName);
    return true;
  }

  function moveOrInsertDraggedSelection(payload, insertOffset) {
    const value = app.getEditorText();
    const sourceStart = Number(payload.start);
    const sourceEnd = Number(payload.end);
    const text = String(payload.text ?? "");
    if (!Number.isInteger(sourceStart) || !Number.isInteger(sourceEnd) || sourceStart < 0 || sourceEnd < sourceStart) {
      return false;
    }
    if (value.slice(sourceStart, sourceEnd) !== text) {
      app.replaceEditorRange(insertOffset, insertOffset, text, insertOffset + text.length, insertOffset + text.length);
      return true;
    }
    if (insertOffset >= sourceStart && insertOffset <= sourceEnd) {
      app.setEditorSelection(sourceStart, sourceEnd);
      return false;
    }

    const withoutSelection = `${value.slice(0, sourceStart)}${value.slice(sourceEnd)}`;
    const adjustedOffset = insertOffset > sourceEnd ? insertOffset - (sourceEnd - sourceStart) : insertOffset;
    const nextValue = `${withoutSelection.slice(0, adjustedOffset)}${text}${withoutSelection.slice(adjustedOffset)}`;
    const nextCursor = adjustedOffset + text.length;
    app.applyEditorEdit(nextValue, nextCursor, nextCursor);
    return true;
  }

  function insertEditorTextAtDrop(text, event) {
    const insertOffset = app.editorDragState.dropOffset ?? app.getEditorTextOffsetFromPoint(event.clientX, event.clientY);
    app.replaceEditorRange(insertOffset, insertOffset, text, insertOffset + text.length, insertOffset + text.length);
  }

  async function handleEditorDrop(event) {
    app.clearEditorDropCaret();
    const internalFileId = event.dataTransfer?.getData("text/mdnotes-file-id");
    if (internalFileId) {
      app.openDroppedFileInPane(internalFileId, "source");
      return;
    }

    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      return;
    }

    const draggedSelection = event.dataTransfer?.getData("text/mdnotes-editor-selection");
    if (draggedSelection) {
      try {
        moveOrInsertDraggedSelection(JSON.parse(draggedSelection), app.editorDragState.dropOffset ?? app.getEditorTextOffsetFromPoint(event.clientX, event.clientY));
      } catch {
        // Ignore malformed editor drag payloads.
      }
      return;
    }

    const urlDbPayload = event.dataTransfer?.getData("text/mdnotes-urldb-entry");
    if (urlDbPayload && isMarkdownFileName(activeFile.name)) {
      try {
        const parsed = JSON.parse(urlDbPayload);
        const project = app.controller.getProject();
        const sourceFile = project.nodes[parsed.fileId];
        const entry = sourceFile?.kind === "file" ? app.getUrlDbEntryById(sourceFile.content, parsed.entryId) : null;
        if (entry) {
          insertEditorTextAtDrop(app.createMarkdownImageReference(entry.name, entry.url), event);
          app.logDebug("action", "Bookmark image inserted", `${entry.name} :: ${entry.url}`);
        }
      } catch {
        // Ignore malformed bookmark payloads.
      }
      return;
    }

    const droppedText = event.dataTransfer?.getData("text/plain");
    if (droppedText) {
      insertEditorTextAtDrop(droppedText, event);
      return;
    }

    const file = event.dataTransfer?.files?.[0];
    if (file && isImageFileName(file.name) && isMarkdownFileName(activeFile.name)) {
      await addDroppedImageAndInsert(file);
    }
  }

  async function replaceImageFile(targetFileId, file) {
    const project = app.controller.getProject();
    const targetFile = project.nodes[targetFileId];
    if (!targetFile || targetFile.kind !== "file" || !isImageFileName(targetFile.name)) {
      throw new Error("Replace File is only available for image assets.");
    }

    const targetExtension = targetFile.name.slice(targetFile.name.lastIndexOf(".")).toLowerCase();
    const sourceExtension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (targetExtension !== sourceExtension) {
      throw new Error(`Replacement file must also be ${targetExtension}.`);
    }

    const content = await readFileAsProjectContent(file, targetFile.name);
    app.controller.updateContent(targetFile.id, content);
    app.publishOperation({ type: "update-file", path: getPath(project, targetFile.id), content });
    app.logDebug("action", "Image file replaced", getPath(project, targetFile.id));
  }

  function openAddFileDialog(nodeId = app.selectionNodeId) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
    const parent = node.kind === "folder" ? node : project.nodes[node.parentId];

    app.addFileState.parentId = parent.id;
    resetAddFileState();
    const targetPath = parent.id === project.rootId ? project.name : getPath(project, parent.id);
    app.elements.addFileTargetText.textContent = `Add a markdown, mtree, urldb, or image file into ${targetPath}.`;
    app.elements.addFileDialog.showModal();
  }

  async function promptAndAddUrlDbEntry(fileId) {
    const project = app.controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
      app.notify("Bookmark entries can only be added to .urldb files.");
      return;
    }

    const entryDraft = await app.showBookmarkEntryDialog({
      name: app.getNextUrlDbEntryName(file.content),
      url: "https://example.com/image.jpg",
      description: ""
    });

    if (!entryDraft) {
      return;
    }

    if (!entryDraft.name) {
      app.notify("Bookmark entries require a name.");
      return;
    }

    if (!entryDraft.url || !app.looksLikeUrl(entryDraft.url)) {
      app.notify("Bookmark entries require a valid URL.");
      return;
    }

    try {
      const nextContent = appendUrlDbEntry(file.content, entryDraft);
      app.controller.updateContent(file.id, nextContent);
      app.publishOperation({ type: "update-file", path: getPath(project, file.id), content: nextContent });
      const nextEntry = app.getUrlDbEntries(nextContent).find((entry) => entry.name === entryDraft.name);
      if (nextEntry) {
        app.setActiveSourceUrlDbEntry(file.id, nextEntry.id);
      } else {
        app.setActiveSourceFile(file.id);
      }
      app.openPreviewTab(file.id);
      app.previewFileId = file.id;
      app.previewUrlDbEntry = null;
      app.logDebug("action", "Bookmark added", `${getPath(project, file.id)} :: ${entryDraft.name}`);
    } catch (error) {
      app.notify(error.message);
    }
  }

  async function submitAddFile() {
    try {
      if (!app.addFileState.content) {
        await stageAddFileFromUrl();
      }

      const fileName = (app.elements.addFileNameInput.value.trim() || app.addFileState.fileName).trim();
      if (!fileName) {
        throw new Error("Provide a file name before adding the file.");
      }
      if (!isAllowedFileName(fileName)) {
        throw new Error("Only markdown, mtree, urldb, and supported image files can be added.");
      }
      if (typeof app.addFileState.content === "string" && app.addFileState.content.startsWith("data:image/") && !isImageFileName(fileName)) {
        throw new Error("Image assets must keep an image file extension.");
      }
      if (typeof app.addFileState.content === "string" && !app.addFileState.content.startsWith("data:image/") && isImageFileName(fileName)) {
        throw new Error("Image file extensions can only be used with image content.");
      }

      const project = app.controller.getProject();
      const parent = project.nodes[app.addFileState.parentId] ?? getSelectedParent(project);
      const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);
      app.controller.createFile(parent.id, fileName, app.addFileState.content);
      app.publishOperation({ type: "create-file", parentPath, name: fileName, content: app.addFileState.content });
      app.logDebug("action", "File added", `${parentPath}/${fileName}`.replace(/^\//, ""));

      const nextProject = app.controller.getProject();
      const createdFile = findChildByName(nextProject, parent.id, fileName);
      if (createdFile?.kind === "file") {
        app.selectionNodeId = createdFile.id;
        app.setActiveSourceFile(createdFile.id);
        if (app.isPreviewableFileName(createdFile.name)) {
          app.setPreviewFile(createdFile.id);
        }
      }

      app.elements.addFileDialog.close();
      resetAddFileState();
    } catch (error) {
      app.notify(error.message);
      setAddFileStatus(error.message);
    }
  }

  function createItem(kind) {
    const project = app.controller.getProject();
    const parent = getSelectedParent(project);
    const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);

    try {
      if (kind === "folder") {
        const name = app.getNextDefaultFolderName(project, parent.id);
        app.controller.createFolder(parent.id, name);
        app.publishOperation({ type: "create-folder", parentPath, name });
        // Select the new folder so the next create/rename targets it; keep the
        // explorer open so the user can rename or add inside it right away.
        const created = findChildByName(app.controller.getProject(), parent.id, name);
        if (created) app.selectionNodeId = created.id;
        app.render(app.controller.getProject());
        app.showToast(`Created folder ${name}`);
        return;
      }

      const name = app.getNextDefaultFileName(project, parent.id, kind);
      const content = app.initialContentForKind(kind, name);
      app.controller.createFile(parent.id, name, content);
      app.publishOperation({ type: "create-file", parentPath, name, content });
      // Open the new file as the active document (so it's what you're editing) but
      // leave the explorer open so it can be renamed/managed without reopening it.
      const created = findChildByName(app.controller.getProject(), parent.id, name);
      if (created) {
        app.selectionNodeId = created.id;
        app.setActiveSourceFile(created.id);
      }
      app.showToast(`Created ${name}`);
    } catch (error) {
      app.notify(error.message);
    }
  }

  // Rename a specific file by id (used by the mobile pane's pen button so the user
  // can rename the doc they're viewing without opening the explorer).
  async function renameFileById(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.id === project.rootId || node.kind !== "file") {
      app.showToast("No file to rename");
      return;
    }
    const currentPath = getPath(project, node.id);
    const name = await app.promptForName("Rename file", node.name, { extension: app.fileExtensionOf(node.name) });
    if (!name || name === node.name) {
      return;
    }
    try {
      app.controller.rename(node.id, name);
      // Re-key any queued text patch from the old path to the new one BEFORE
      // publishing the rename, so a pending edit isn't sent against the old path
      // (which the server just renamed → 400 → disconnect / "server unreachable").
      app.collaboration.remapPatchPath(currentPath, getPath(app.controller.getProject(), node.id));
      app.remapPersonaPaths(currentPath, getPath(app.controller.getProject(), node.id));
      app.publishOperation({ type: "rename-node", path: currentPath, name });
      app.showToast(`Renamed to ${name}`);
    } catch (error) {
      app.notify(error.message);
    }
  }

  // Every folder in the project as {id, label} for the New File destination picker
  // (root first, then nested by path).
  function listProjectFolders(project) {
    const out = [{ id: project.rootId, label: project.name || "Workspace" }];
    const walk = (nodeId) => {
      const node = project.nodes[nodeId];
      for (const childId of node?.children ?? []) {
        const child = project.nodes[childId];
        if (child?.kind === "folder") {
          out.push({ id: child.id, label: getPath(project, child.id) });
          walk(child.id);
        }
      }
    };
    walk(project.rootId);
    return out;
  }

  // Create a file of `kind` in `parentId` with a chosen base name (extension is
  // appended by kind), then open it. Shared by the New File dialog.
  function createFileInFolder(kind, parentId, baseName) {
    const project = app.controller.getProject();
    const parent = project.nodes[parentId] ?? project.nodes[project.rootId];
    const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);
    const ext = app.fileExtensionForKind(kind);
    let name = String(baseName || "").trim();
    if (!name) name = app.getNextDefaultFileName(project, parent.id, kind);
    else if (!name.toLowerCase().endsWith(ext)) name = `${name}${ext}`;
    const content = app.initialContentForKind(kind, name);
    app.controller.createFile(parent.id, name, content);
    app.publishOperation({ type: "create-file", parentPath, name, content });
    const created = findChildByName(app.controller.getProject(), parent.id, name);
    if (created) {
      app.selectionNodeId = created.id;
      app.setActiveSourceFile(created.id);
    }
    app.showToast(`Created ${name}`);
    return created;
  }

  function openNewFileDialog() {
    if (!app.elements.newFileDialog) return;
    const project = app.controller.getProject();
    const folders = listProjectFolders(project);
    app.elements.newFileFolder.replaceChildren(...folders.map(({ id, label }) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = label;
      return option;
    }));
    // Default the destination to the currently selected folder (or its parent).
    app.elements.newFileFolder.value = getSelectedParent(project).id;
    app.elements.newFileName.value = "";
    if (app.elements.newFileStatus) app.elements.newFileStatus.hidden = true;
    app.elements.newFileDialog.showModal();
    app.elements.newFileName.focus();
  }

  function handleNewFileSubmit(event) {
    event.preventDefault();
    try {
      createFileInFolder(
        app.elements.newFileType.value,
        app.elements.newFileFolder.value,
        app.elements.newFileName.value.trim()
      );
      app.elements.newFileDialog.close();
    } catch (error) {
      if (app.elements.newFileStatus) {
        app.elements.newFileStatus.textContent = error.message || "Could not create the file.";
        app.elements.newFileStatus.hidden = false;
      }
    }
  }

  async function renameSelected() {
    const project = app.controller.getProject();
    const selectedEntry = getSelectedUrlDbEntry(project);
    if (selectedEntry) {
      const nextName = await app.promptForName("Rename bookmark", selectedEntry.entry.name);
      if (!nextName) {
        return;
      }

      try {
        const nextContent = updateUrlDbEntry(selectedEntry.file.content, selectedEntry.entry.id, { name: nextName });
        app.controller.updateContent(selectedEntry.file.id, nextContent);
        app.publishOperation({ type: "update-file", path: getPath(project, selectedEntry.file.id), content: nextContent });
        const nextEntry = app.getUrlDbEntries(nextContent).find((entry) => entry.name === nextName);
        if (nextEntry) {
          app.setActiveSourceUrlDbEntry(selectedEntry.file.id, nextEntry.id);
        }
      } catch (error) {
        app.notify(error.message);
      }
      return;
    }

    const node = getSelectedNode(project);
    if (!node || node.id === project.rootId) {
      return;
    }
    const currentPath = getPath(project, node.id);
    // Folders have no extension → the auto-extension toggle is hidden for them.
    const name = await app.promptForName("Rename item", node.name, {
      extension: node.kind === "file" ? app.fileExtensionOf(node.name) : ""
    });
    if (!name) {
      return;
    }

    try {
      app.controller.rename(node.id, name);
      // Re-key any queued text patch from the old path to the new one BEFORE
      // publishing the rename, so a pending edit isn't sent against the old path
      // (which the server just renamed → 400 → disconnect / "server unreachable").
      app.collaboration.remapPatchPath(currentPath, getPath(app.controller.getProject(), node.id));
      app.remapPersonaPaths(currentPath, getPath(app.controller.getProject(), node.id));
      app.publishOperation({ type: "rename-node", path: currentPath, name });
      app.showToast(`Renamed to ${name}`);
    } catch (error) {
      app.notify(error.message);
    }
  }

  async function deleteSelected() {
    const project = app.controller.getProject();
    const selectedEntry = getSelectedUrlDbEntry(project);
    if (selectedEntry) {
      if (!await app.confirmAction(`Delete ${selectedEntry.entry.name}?`)) {
        return;
      }

      try {
        const nextContent = removeUrlDbEntry(selectedEntry.file.content, selectedEntry.entry.id);
        app.controller.updateContent(selectedEntry.file.id, nextContent);
        app.publishOperation({ type: "update-file", path: getPath(project, selectedEntry.file.id), content: nextContent });
        app.sourceUrlDbEntry = null;
        app.previewUrlDbEntry = null;
        app.setActiveSourceFile(selectedEntry.file.id);
      } catch (error) {
        app.notify(error.message);
      }
      return;
    }

    const node = getSelectedNode(project);
    if (!node || node.id === project.rootId) {
      return;
    }
    const path = getPath(project, node.id);
    if (!await app.confirmAction(`Delete ${node.name}?`)) {
      return;
    }
    const removedName = node.name;
    app.controller.remove(node.id);
    // Drop any queued patch for the deleted file/folder so it isn't sent against a
    // path the server just removed (→ 400 → disconnect).
    app.collaboration.dropPatchPath(path);
    app.publishOperation({ type: "delete-node", path });
    app.showToast(`Deleted ${removedName}`);
  }

  function collectFileEntries(project, nodeId) {
    const node = project.nodes[nodeId];
    if (!node) {
      return [];
    }

    if (node.kind === "file") {
      return [{ path: node.name, bytes: getExportBytes(node.name, node.content) }];
    }

    const entries = [];
    function walk(currentId, prefix = "") {
      const current = project.nodes[currentId];
      if (current.kind === "file") {
        entries.push({ path: `${prefix}${current.name}`, bytes: getExportBytes(current.name, current.content) });
        return;
      }
      current.children.forEach((childId) => {
        const child = project.nodes[childId];
        const nextPrefix = child.kind === "folder" ? `${prefix}${child.name}/` : prefix;
        walk(childId, nextPrefix);
      });
    }
    walk(nodeId, nodeId === project.rootId ? "" : `${node.name}/`);
    return entries;
  }

  function exportNode(nodeId) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
    if (node.kind === "file") {
      const blob = isImageFileName(node.name)
        ? dataUrlToBlob(node.content)
        : new Blob([node.content], { type: getMimeTypeForFileName(node.name) });
      downloadBlob(blob, node.name);
      return;
    }
    downloadBlob(createZip(collectFileEntries(project, node.id)), `${node.name || project.name}.zip`);
  }

  /** Rasterize an SVG string to a PNG/JPG Blob. `background` (e.g. white) is
   *  painted first for opaque formats; omit it to keep PNG transparency. */
  function rasterizeSvgToBlob(svgString, { type, background = null, scale = 2 }) {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext("2d");
          if (background) {
            ctx.fillStyle = background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export produced no data."))),
            type,
            0.92
          );
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to render the diagram for export."));
      };
      image.src = url;
    });
  }

  /** Export a .bmap file as PNG (transparent), JPG (white background), or SVG. */
  async function exportBmapAs(nodeId, format) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId];
    if (!node || node.kind !== "file" || !isBmapFileName(node.name)) {
      app.notify("Export As is only available for .bmap diagrams.");
      return;
    }
    try {
      const ast = normalizeBmapAst(parseBmap(node.content ?? ""));
      if (!ast.nodes.length) {
        app.notify("This diagram has no nodes to export.");
        return;
      }
      const { renderBmapToSvg } = await app.loadBmapView();
      const svgString = renderBmapToSvg(ast);
      const baseName = node.name.replace(/\.bmap$/i, "");

      if (format === "svg") {
        downloadBlob(new Blob([svgString], { type: "image/svg+xml" }), `${baseName}.svg`);
      } else if (format === "png") {
        const blob = await rasterizeSvgToBlob(svgString, { type: "image/png" });
        downloadBlob(blob, `${baseName}.png`);
      } else if (format === "jpg") {
        const blob = await rasterizeSvgToBlob(svgString, { type: "image/jpeg", background: "#ffffff" });
        downloadBlob(blob, `${baseName}.jpg`);
      }
      app.logDebug("action", "Bmap exported", `${node.name} → ${format}`);
    } catch (error) {
      app.notify(error instanceof Error ? error.message : String(error));
      app.logDebug("error", "Bmap export failed", error instanceof Error ? error.message : String(error));
    }
  }

  async function handleExplorerAction(action, target, options = {}) {
    if (options.dryRun) {
      return false;
    }

    const nodeId = target.nodeId;
    app.selectionNodeId = nodeId;
    app.sourceUrlDbEntry = target.entryId ? { fileId: nodeId, entryId: target.entryId } : null;
    app.logDebug("action", "Explorer action", action);
    if (action === "open-source") {
      app.setActiveSourceFile(nodeId);
      app.showToast(`Opened ${app.controller.getProject().nodes[nodeId]?.name ?? "file"}`);
      return;
    }
    if (action === "open-preview") {
      app.setPreviewFile(nodeId);
      app.showToast(`Preview: ${app.controller.getProject().nodes[nodeId]?.name ?? "file"}`);
      return;
    }
    if (action.startsWith("filter-")) {
      app.settings.explorerFilter = action.replace("filter-", "");
      app.persistSettings();
      app.render(app.controller.getProject());
      return;
    }
    if (action === "copy") {
      copyExplorerTarget(target);
      app.showToast(`Copied ${app.controller.getProject().nodes[nodeId]?.name ?? "item"}`);
      return;
    }
    if (action === "paste") {
      if (!pasteExplorerClipboard(target)) {
        app.notify("Nothing valid to paste here.");
      }
      return;
    }
    if (action === "new-folder") {
      createItem("folder");
      return;
    }
    if (action === "new-md") {
      createItem("md");
      return;
    }
    if (action === "new-mtree") {
      createItem("mtree");
      return;
    }
    if (action === "new-urldb") {
      createItem("urldb");
      return;
    }
    if (action === "new-bmap") {
      createItem("bmap");
      return;
    }
    if (action === "new-persona") {
      createItem("persona");
      return;
    }
    if (action === "add-file") {
      openAddFileDialog(nodeId);
      return;
    }
    if (action === "add-bookmark-entry") {
      await promptAndAddUrlDbEntry(nodeId);
      return;
    }
    if (action === "rename-entry") {
      await renameSelected();
      return;
    }
    if (action === "delete-entry") {
      await deleteSelected();
      return;
    }
    if (action === "generate-module-map") {
      app.openMtreeToolsDialog(nodeId);
      return;
    }
    if (action === "replace-file") {
      app.replaceFileTargetId = nodeId;
      app.elements.replaceFileInput.click();
      return;
    }
    if (action === "rename") {
      await renameSelected();
      return;
    }
    if (action === "delete") {
      await deleteSelected();
      return;
    }
    if (action === "manage-preview") {
      const ws = app.settings.lastWorkspace;
      if (ws?.team && ws?.path != null) {
        await app.openAccessEditor(ws.team, ws.path, app.controller.getProject().name);
      } else {
        app.notify("Open a server workspace to manage its preview access.");
      }
      return;
    }
    if (action === "export") {
      exportNode(nodeId);
      return;
    }
    if (action === "export-bmap-png") {
      await exportBmapAs(nodeId, "png");
      return;
    }
    if (action === "export-bmap-jpg") {
      await exportBmapAs(nodeId, "jpg");
      return;
    }
    if (action === "export-bmap-svg") {
      await exportBmapAs(nodeId, "svg");
    }
  }

  return {
    canPasteIntoExplorerTarget, clearExplorerDropState, createFileInFolder, createItem,
    deleteSelected, exportNode, getExplorerDropPayloadKind, getExplorerDropPlacement,
    getSelectedNode, getSelectedParent, getSelectedUrlDbEntry, handleAddFileTransfer,
    handleEditorDrop, handleExplorerAction, handleNewFileSubmit, moveExplorerNode,
    moveExplorerUrlDbEntry, openNewFileDialog, renameFileById, renameSelected, replaceImageFile,
    resetAddFileState, setAddFileStatus, setExplorerDropState, stageAddFileFromLocalFile,
    submitAddFile
  };
}
