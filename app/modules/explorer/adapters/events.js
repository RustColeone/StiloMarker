// The explorer's events and commands: dropping onto the tree (moving files,
// folders and parts), the add and filter buttons, the Add File dialog (a
// picked, dropped or pasted file), the New File dialog, choosing an image to
// replace another, and the Edit and Create menu items. Moved from main.js;
// `app` is the Explorer's shared context (surface.js).
import { builtinTypes } from "../../file-types/index.js";
import { getPath } from "../../workspace/index.js";

export function installExplorerEvents(app) {
  function bindExplorerDropTarget() {
    app.elements.explorerTree.addEventListener("dragover", (event) => {
      const payloadKind = app.getExplorerDropPayloadKind(event.dataTransfer?.types ?? []);
      if (!payloadKind) {
        app.clearExplorerDropState();
        return;
      }

      const row = event.target.closest(".tree-row");
      if (!row) {
        if (payloadKind === "file" || payloadKind === "node") {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
          app.setExplorerDropState(null, "into");
          return;
        }
        app.clearExplorerDropState();
        return;
      }

      const project = app.controller.getProject();
      const node = project.nodes[row.dataset.nodeId];
      if (!node) {
        app.clearExplorerDropState();
        return;
      }

      const placement = app.getExplorerDropPlacement(row, node, row.dataset.partId || null, payloadKind, event);
      if (!placement) {
        app.clearExplorerDropState();
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      app.setExplorerDropState(row, placement);
    });

    app.elements.explorerTree.addEventListener("dragleave", (event) => {
      if (event.currentTarget?.contains(event.relatedTarget)) {
        return;
      }
      app.clearExplorerDropState();
    });

    app.elements.explorerTree.addEventListener("drop", (event) => {
      app.clearExplorerDropState();
      const nodeId = event.dataTransfer?.getData("text/mdnotes-node-id");
      const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
      const partPayload = event.dataTransfer?.getData("text/stilo-file-part");
      if (!nodeId && !partPayload) {
        return;
      }

      const row = event.target.closest(".tree-row");
      const project = app.controller.getProject();
      const targetNodeId = row?.dataset.nodeId ?? null;
      const targetPartId = row?.dataset.partId ?? null;
      const targetNode = targetNodeId ? project.nodes[targetNodeId] : null;
      const placement = row && targetNode
        ? app.getExplorerDropPlacement(row, targetNode, targetPartId, partPayload ? "part" : "node", event)
        : (nodeId ? "into" : null);

      if (!placement) {
        return;
      }

      event.preventDefault();
      try {
        if (nodeId) {
          app.moveExplorerNode(nodeId, targetNodeId, placement);
          return;
        }

        const parsed = JSON.parse(partPayload);
        app.moveExplorerPart(parsed.fileId, parsed.partId, targetNodeId, targetPartId, placement);
      } catch (error) {
        app.notify(error.message);
      }
    });
  }

  app.elements.explorerAddButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const project = app.controller.getProject();
    const parent = app.getSelectedParent(project);
    app.view.select(parent.id);
    const opened = app.tree.toggleQuickAddMenu(app.elements.explorerAddButton, parent.id);
    app.logDebug("action", opened ? "Explorer add menu opened" : "Explorer add menu closed", getPath(project, parent.id) || project.name);
  });

  app.elements.explorerFilterButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const project = app.controller.getProject();
    const parent = app.getSelectedParent(project);
    app.view.select(parent.id);
    const opened = app.tree.toggleFilterMenu(app.elements.explorerFilterButton, parent.id);
    app.logDebug("action", opened ? "Explorer filter menu opened" : "Explorer filter menu closed", app.settings.explorerFilter);
  });

  app.elements.addFilePickerButton.addEventListener("click", () => app.elements.addFilePickerInput.click());
  app.elements.addFilePickerInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      await app.stageAddFileFromLocalFile(file);
    } catch (error) {
      app.notify(error.message);
      app.setAddFileStatus(error.message);
    } finally {
      event.target.value = "";
    }
  });
  app.elements.addFileNameInput.addEventListener("input", (event) => {
    app.addFileState.fileName = event.target.value.trim();
  });
  app.elements.addFileSubmitButton.addEventListener("click", () => {
    void app.submitAddFile();
  });
  app.elements.addFileDropzone.addEventListener("dragenter", (event) => {
    event.preventDefault();
    app.elements.addFileDropzone.classList.add("is-active");
  });
  app.elements.addFileDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    app.elements.addFileDropzone.classList.add("is-active");
  });
  app.elements.addFileDropzone.addEventListener("dragleave", (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    app.elements.addFileDropzone.classList.remove("is-active");
  });
  app.elements.addFileDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    app.elements.addFileDropzone.classList.remove("is-active");
    void app.handleAddFileTransfer(event.dataTransfer).catch((error) => {
      app.notify(error.message);
      app.setAddFileStatus(error.message);
    });
  });
  app.elements.addFileDropzone.addEventListener("paste", (event) => {
    void app.handleAddFileTransfer(event.clipboardData).catch((error) => {
      app.notify(error.message);
      app.setAddFileStatus(error.message);
    });
  });
  app.elements.addFileDialog.addEventListener("close", () => {
    app.elements.addFileDropzone.classList.remove("is-active");
    app.resetAddFileState();
  });

  app.elements.newFileDialog?.querySelector("form")?.addEventListener("submit", app.handleNewFileSubmit);
  app.elements.newFileCancelButton?.addEventListener("click", () => app.elements.newFileDialog.close("cancel"));

  app.elements.replaceFileInput.addEventListener("change", (event) => app.replaceWithChosenFile(event));

  app.shell.commands.add({ id: "workspace.rename-selected", title: "Rename Selected", menu: { id: "edit", group: 0, order: 4 }, run: () => {
    void app.renameSelected();
  } });
  app.shell.commands.add({ id: "workspace.delete-selected", title: "Delete Selected", menu: { id: "edit", group: 0, order: 5 }, run: () => {
    void app.deleteSelected();
  } });
  for (const type of builtinTypes.creatable()) { // New Markdown, New Diagram…: every type that says how to create one
    app.shell.commands.add({ id: `file-types.new-${type.id}`, title: type.create.label, menu: { id: "create", group: 0, order: type.create.order }, run: () => app.createItem(type.id) });
  }

  bindExplorerDropTarget();
}
