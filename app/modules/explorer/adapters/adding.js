// Adding files: the Add File dialog (a local file, a URL, a drop or a paste),
// files and text dropped into the source editor, replacing an image, and
// adding a part to a file that holds parts.
// Part of the Explorer module: `app` is its shared context (surface.js).
import { describeFileTypes, findChildByName, getPath, isAllowedFileName, isImageFileName, isMarkdownFileName, isTextFileName, readFileAsProjectContent } from "../../workspace/index.js";
import { ignore } from "../../../kernel/index.js";

export function createAdding(app) {
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
    setAddFileStatus(`Supported: ${describeFileTypes()}.`);
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
      throw new Error(`Only these kinds of file can be added: ${describeFileTypes()}.`);
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
        throw new Error("Remote image download was blocked by the source host or browser policy.");
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

    const dropOffset = app.editorDropOffset() ?? app.getEditorSelection().start;
    app.focusEditor();
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
    const insertOffset = app.editorDropOffset() ?? app.getEditorTextOffsetFromPoint(event.clientX, event.clientY);
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
        moveOrInsertDraggedSelection(JSON.parse(draggedSelection), app.editorDropOffset() ?? app.getEditorTextOffsetFromPoint(event.clientX, event.clientY));
      } catch (error) { ignore(error, "dropping dragged editor text failed"); }
      return;
    }

    const partPayload = event.dataTransfer?.getData("text/stilo-file-part");
    if (partPayload && isMarkdownFileName(activeFile.name)) {
      try {
        const parsed = JSON.parse(partPayload);
        const found = app.partsFile(app.controller.getProject(), parsed.fileId);
        const part = found?.parts.take(found.file.content, parsed.partId);
        const text = part ? found.parts.linkText?.(part) : null;
        if (text) {
          insertEditorTextAtDrop(text, event);
          app.logDebug("action", "Part inserted", `${part.name} :: ${text}`);
        }
      } catch (error) { ignore(error, "dropping a dragged part failed"); }
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

  // The image a "Replace File" action is choosing a new file for.
  let replaceFileTargetId = null;
  function chooseReplacementFor(nodeId) {
    replaceFileTargetId = nodeId;
    app.elements.replaceFileInput.click();
  }
  async function replaceWithChosenFile(event) {
    const [file, target] = [event.target.files?.[0], replaceFileTargetId];
    replaceFileTargetId = null;
    event.target.value = ""; // the same file can be chosen again next time
    if (!file || !target) return;
    await replaceImageFile(target, file).catch((error) => app.notify(error.message));
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
    await app.workspace.write(getPath(project, targetFile.id), content, { source: "replace file" });
    app.logDebug("action", "Image file replaced", getPath(project, targetFile.id));
  }

  function openAddFileDialog(nodeId = app.view.get().selectionNodeId) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
    const parent = node.kind === "folder" ? node : project.nodes[node.parentId];

    app.addFileState.parentId = parent.id;
    resetAddFileState();
    const targetPath = parent.id === project.rootId ? project.name : getPath(project, parent.id);
    app.elements.addFileTargetText.textContent = `Add a file (${describeFileTypes()}) into ${targetPath}.`;
    app.elements.addFileDialog.showModal();
  }

  // A new part, from the provider's own `add` (it asks for one).
  async function addPart(fileId) {
    const project = app.controller.getProject();
    const found = app.partsFile(project, fileId);
    if (!found?.parts.add) {
      return;
    }
    const { file, parts } = found;
    const part = await parts.add.run(file);
    if (!part) {
      return;
    }
    try {
      const current = app.controller.getProject().nodes[file.id];
      const nextContent = parts.insert(current.content, part, null);
      void app.workspace.write(getPath(project, file.id), nextContent, { source: "file part" }).catch((error) => app.notify(error.message));
      app.showMovedPart(file.id, parts, nextContent, part.name, false);
      app.openPreviewTab(file.id);
      app.view.showPreview(file.id);
      app.logDebug("action", "Part added", `${getPath(project, file.id)} :: ${part.name}`);
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
        throw new Error(`Only these kinds of file can be added: ${describeFileTypes()}.`);
      }
      if (typeof app.addFileState.content === "string" && app.addFileState.content.startsWith("data:image/") && !isImageFileName(fileName)) {
        throw new Error("Image assets must keep an image file extension.");
      }
      if (typeof app.addFileState.content === "string" && !app.addFileState.content.startsWith("data:image/") && isImageFileName(fileName)) {
        throw new Error("Image file extensions can only be used with image content.");
      }

      const project = app.controller.getProject();
      const parent = project.nodes[app.addFileState.parentId] ?? app.getSelectedParent(project);
      const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);
      app.controller.createFile(parent.id, fileName, app.addFileState.content);
      app.publishOperation({ type: "create-file", parentPath, name: fileName, content: app.addFileState.content });
      app.logDebug("action", "File added", `${parentPath}/${fileName}`.replace(/^\//, ""));

      const nextProject = app.controller.getProject();
      const createdFile = findChildByName(nextProject, parent.id, fileName);
      if (createdFile?.kind === "file") {
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

  return { setAddFileStatus, resetAddFileState, stageAddFileContent, stageAddFileFromLocalFile, stageAddFileFromUrl, handleAddFileTransfer, addDroppedImageAndInsert, moveOrInsertDraggedSelection, insertEditorTextAtDrop, handleEditorDrop, chooseReplacementFor, replaceWithChosenFile, replaceImageFile, openAddFileDialog, addPart, submitAddFile };
}
