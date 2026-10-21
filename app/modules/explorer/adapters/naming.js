// Creating, renaming and deleting: new files and folders (and the New File
// dialog), renaming the selection or a file by id, and deleting the selection.
// Part of the Explorer module: `app` is its shared context (surface.js).
import { fileTypeExtension, findChildByName, getPath } from "../../workspace/index.js";

export function createNaming(app) {
  function createItem(kind) {
    const project = app.controller.getProject();
    const parent = app.getSelectedParent(project);
    const parentPath = parent.id === project.rootId ? "" : getPath(project, parent.id);

    try {
      if (kind === "folder") {
        const name = app.getNextDefaultFolderName(project, parent.id);
        app.controller.createFolder(parent.id, name);
        app.publishOperation({ type: "create-folder", parentPath, name });
        // Select the new folder so the next create/rename targets it; keep the
        // explorer open so the user can rename or add inside it right away.
        const created = findChildByName(app.controller.getProject(), parent.id, name);
        if (created) app.view.select(created.id);
        app.render(app.controller.getProject());
        app.showToast(`Created folder ${name}`);
        return;
      }

      const name = app.getNextDefaultFileName(project, parent.id, kind);
      const content = app.newFileContent(kind, name);
      app.controller.createFile(parent.id, name, content);
      app.publishOperation({ type: "create-file", parentPath, name, content });
      // Open the new file as the active document (so it's what you're editing) but
      // leave the explorer open so it can be renamed/managed without reopening it.
      const created = findChildByName(app.controller.getProject(), parent.id, name);
      if (created) app.setActiveSourceFile(created.id);
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
    const name = await app.promptForName(`Rename ${node.name}`, node.name, { suffix: app.fileExtensionOf(node.name), submitLabel: "Rename" });
    if (!name || name === node.name) {
      return;
    }
    try {
      app.controller.rename(node.id, name);
      // Re-key any queued text patch from the old path to the new one BEFORE
      // publishing the rename, so a pending edit isn't sent against the old path
      // (which the server just renamed → 400 → disconnect / "server unreachable").
      app.collaboration.remapPatchPath(currentPath, getPath(app.controller.getProject(), node.id));
      app.pathChanged(currentPath, getPath(app.controller.getProject(), node.id));
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
    const ext = fileTypeExtension(kind);
    let name = String(baseName || "").trim();
    if (!name) name = app.getNextDefaultFileName(project, parent.id, kind);
    else if (!name.toLowerCase().endsWith(ext)) name = `${name}${ext}`;
    const content = app.newFileContent(kind, name);
    app.controller.createFile(parent.id, name, content);
    app.publishOperation({ type: "create-file", parentPath, name, content });
    const created = findChildByName(app.controller.getProject(), parent.id, name);
    if (created) app.setActiveSourceFile(created.id);
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
    app.elements.newFileFolder.value = app.getSelectedParent(project).id;
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
    const selected = app.getSelectedPart(project);
    if (selected) {
      const { file, parts, part } = selected;
      const nextName = await app.promptForName(`Rename ${part.name}`, part.name, { submitLabel: "Rename" });
      if (!nextName) {
        return;
      }

      try {
        const nextContent = parts.rename(file.content, part.id, nextName);
        void app.workspace.write(getPath(project, file.id), nextContent, { source: "file part" }).catch((error) => app.notify(error.message));
        const renamed = parts.list(nextContent).find((candidate) => candidate.name === nextName.trim());
        if (renamed) {
          app.setActiveSourcePart(file.id, renamed.id);
        }
      } catch (error) {
        app.notify(error.message);
      }
      return;
    }

    const node = app.getSelectedNode(project);
    if (!node || node.id === project.rootId) {
      return;
    }
    const currentPath = getPath(project, node.id);
    // Folders have no extension → the auto-extension toggle is hidden for them.
    const name = await app.promptForName(`Rename ${node.name}`, node.name, {
      suffix: node.kind === "file" ? app.fileExtensionOf(node.name) : "", submitLabel: "Rename"
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
      app.pathChanged(currentPath, getPath(app.controller.getProject(), node.id));
      app.publishOperation({ type: "rename-node", path: currentPath, name });
      app.showToast(`Renamed to ${name}`);
    } catch (error) {
      app.notify(error.message);
    }
  }

  async function deleteSelected() {
    const project = app.controller.getProject();
    const selected = app.getSelectedPart(project);
    if (selected) {
      const { file, parts, part } = selected;
      if (!await app.confirmAction(`Delete ${part.name}?`, { acceptLabel: "Delete", danger: true })) {
        return;
      }

      try {
        const nextContent = parts.remove(file.content, part.id);
        void app.workspace.write(getPath(project, file.id), nextContent, { source: "file part" }).catch((error) => app.notify(error.message));
        app.view.clearParts();
        app.setActiveSourceFile(file.id);
      } catch (error) {
        app.notify(error.message);
      }
      return;
    }

    const node = app.getSelectedNode(project);
    if (!node || node.id === project.rootId) {
      return;
    }
    const path = getPath(project, node.id);
    if (!await app.confirmAction(`Delete ${node.name}?`, { acceptLabel: "Delete", danger: true })) {
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

  return { createItem, renameFileById, listProjectFolders, createFileInFolder, openNewFileDialog, handleNewFileSubmit, renameSelected, deleteSelected };
}
