// The explorer's context-menu actions, each run against the target the menu
// was opened on.
// Part of the Explorer module: `app` is its shared context (surface.js).


export function createActions(app) {
  async function handleExplorerAction(action, target, options = {}) {
    if (options.dryRun) {
      return false;
    }

    const nodeId = target.nodeId;
    app.view.pick(nodeId, target.partId);
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
      app.settings.change({ explorerFilter: action.replace("filter-", "") });
      app.render(app.controller.getProject());
      return;
    }
    if (action === "copy") {
      app.copyExplorerTarget(target);
      app.showToast(`Copied ${app.controller.getProject().nodes[nodeId]?.name ?? "item"}`);
      return;
    }
    if (action === "paste") {
      if (!app.pasteExplorerClipboard(target)) {
        app.notify("Nothing valid to paste here.");
      }
      return;
    }
    if (action === "new-folder") {
      app.createItem("folder");
      return;
    }
    if (action.startsWith("new-")) {
      app.createItem(action.slice("new-".length));
      return;
    }
    if (action === "add-file") {
      app.openAddFileDialog(nodeId);
      return;
    }
    if (action === "add-part") {
      await app.addPart(nodeId);
      return;
    }
    if (action === "rename-part") {
      await app.renameSelected();
      return;
    }
    if (action === "delete-part") {
      await app.deleteSelected();
      return;
    }
    if (action === "replace-file") {
      app.chooseReplacementFor(nodeId);
      return;
    }
    if (action === "rename") {
      await app.renameSelected();
      return;
    }
    if (action === "delete") {
      await app.deleteSelected();
      return;
    }
    if (action === "export") {
      app.exportNode(nodeId);
      return;
    }
    // One of another module's entries on the project's root (explorer.rootMenus).
    const rootMenu = app.rootMenuOf(action);
    if (rootMenu) { await rootMenu.run(action); return; }
    // One of a file type's own entries (explorer.fileMenus).
    const node = app.controller.getProject().nodes[nodeId];
    const menu = node?.kind === "file" ? app.fileMenuOf(node.name) : null;
    if (menu) await menu.run(action, nodeId);
  }

  return { handleExplorerAction };
}
