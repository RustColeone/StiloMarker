// Managing what the file browser lists: deleting (to the team's Trash),
// moving or copying between places, and publishing the open project.
// Part of the Cloud module: `app` is its shared context (surface.js).
import { seedDefaultProject } from "../../workspace/index.js";
import { createProjectServer } from "./api.js";

export function createManage(app) {
  // Lightweight reset when the open project vanishes: leave any live session and
  // drop back to a fresh default workspace (no reload, no extra confirmation).
  function fallbackToDefaultAfterDelete() {
    app.sessionRestorer?.cancel();
    if (app.collaboration.isConnected() && app.mode.get().workspaceMode === "synced") {
      app.collaboration.disconnect("The open workspace was deleted.");
    }
    app.mode.leave(); // the kept project is not brought back: another one opens
    app.settings.change({ lastLocalProject: null, lastWorkspace: null, wasConnected: false });
    const project = seedDefaultProject();
    app.controller.replaceProject(project);
    app.view.reset(project);
    app.render(project);
  }

  async function handleDeleteSelected() {
    const provider = app.browserState.provider;
    if (!provider?.delete) return;
    const targets = app.browserState.entries.filter((entry) => app.browserState.checked.has(entry.path));
    if (targets.length === 0) return;
    const label = targets.length === 1 ? `"${targets[0].name}"` : `${targets.length} items`;
    const it = targets.length === 1 ? "it" : "them";
    const confirmed = await app.showConfirmDialog({ acceptLabel: "Delete", danger: true, message: provider.id === "server"
      ? `Delete ${label}? The team's Trash keeps ${it} for 30 days, where the owner can restore ${it}.`
      : `Delete ${label}? This permanently removes ${it} and cannot be undone.` });
    if (!confirmed) return;
    let openWasDeleted = false;
    const failures = [];
    for (const entry of targets) {
      try {
        const wasOpen = app.isOpenEntry(provider, entry);
        await provider.delete(entry);
        if (wasOpen) openWasDeleted = true;
        app.logDebug("action", "Deleted entry", `${provider.id}:${entry.path}`);
      } catch (error) {
        failures.push(`${entry.name}: ${error.message || "failed"}`);
      }
    }
    app.browserState.checked.clear();
    if (openWasDeleted) fallbackToDefaultAfterDelete();
    await app.browseTo(app.browserState.path);
    if (failures.length) app.setBrowserStatus(`Could not delete — ${failures.join("; ")}`);
  }

  // The team's trash (History): deleted projects, restorable for a while.
  const trashTeam = () => (app.browserState.provider?.id === "server" ? app.browserState.path.split("/")[0] : "");
  const handleOpenTrash = () => trashTeam() && app.history.trash.open(trashTeam(), { onChange: () => void app.browseTo(app.browserState.path) });

  // Restore the File Manager title/subtitle after a destination-pick detour.
  function setManageChrome() {
    if (app.elements.browserTitle) app.elements.browserTitle.textContent = "File Manager";
    if (app.elements.browserSubtitle) {
      app.elements.browserSubtitle.textContent = "Browse, organize, and delete your projects across this device and team folders.";
    }
  }

  // Capture the checked items and flip the browser into destination-pick mode:
  // the user navigates to a folder and presses "Select this folder" to drop them.
  function beginTransfer(op) {
    if (app.browserState.mode !== "manage") return;
    const entries = app.browserState.entries.filter((entry) => app.browserState.checked.has(entry.path));
    if (entries.length === 0) return;
    app.browserState.pendingTransfer = { op, sourceProvider: app.browserState.provider, sourcePath: app.browserState.path, entries };
    app.browserState.mode = "pick";
    app.browserState.multiSelect = false;
    app.browserState.checked.clear();
    app.browserState.selection = null;
    const verb = op === "move" ? "Move" : "Copy";
    if (app.elements.browserTitle) app.elements.browserTitle.textContent = `${verb} ${entries.length} item${entries.length === 1 ? "" : "s"}…`;
    if (app.elements.browserSubtitle) app.elements.browserSubtitle.textContent = "Switch device or team if you like, open a folder, then press Select this folder.";
    void app.browseTo(app.browserState.path);
  }

  // Abandon a pending Move/Copy and return to the source folder in manage mode.
  function cancelPick() {
    const pending = app.browserState.pendingTransfer;
    app.browserState.pendingTransfer = null;
    app.browserState.mode = "manage";
    app.browserState.multiSelect = false;
    app.browserState.checked.clear();
    app.browserState.selection = null;
    setManageChrome();
    if (pending?.sourceProvider) app.browserState.provider = pending.sourceProvider;
    void app.browseTo(pending?.sourcePath ?? app.browserState.path);
  }

  // Drop the pending items into the currently browsed folder. Each project is read
  // into a portable model from the source and written as a fresh project at the
  // destination; a Move deletes the source afterwards. Copy/Move use one uniform
  // path so it also works across providers once that is enabled.
  async function handleSelectDestination() {
    const pending = app.browserState.pendingTransfer;
    if (!pending) return;
    const destProvider = app.browserState.provider;
    const destPath = app.browserState.path;
    if (!destProvider?.canCreateAt?.(destPath) || !destProvider.importModel) return;
    const { op, sourceProvider, entries } = pending;
    app.setBrowserStatus(`${op === "move" ? "Moving" : "Copying"} ${entries.length} item${entries.length === 1 ? "" : "s"}…`);
    const failures = [];
    let openWasMoved = false;
    for (const entry of entries) {
      try {
        const pkg = await sourceProvider.exportModel(entry);
        await destProvider.importModel(destPath, pkg.name ?? entry.name, pkg.project);
        if (op === "move") {
          const wasOpen = app.isOpenEntry(sourceProvider, entry);
          await sourceProvider.delete(entry);
          if (wasOpen) openWasMoved = true;
        }
        app.logDebug("action", `${op} entry`, `${sourceProvider.id}:${entry.path} -> ${destProvider.id}:${destPath}`);
      } catch (error) {
        failures.push(`${entry.name}: ${error.message || "failed"}`);
      }
    }
    app.browserState.pendingTransfer = null;
    app.browserState.mode = "manage";
    app.browserState.multiSelect = false;
    app.browserState.checked.clear();
    app.browserState.selection = null;
    setManageChrome();
    if (openWasMoved) fallbackToDefaultAfterDelete();
    await app.browseTo(destPath);
    if (failures.length) app.setBrowserStatus(`Could not ${op} — ${failures.join("; ")}`);
  }

  // Publish the current local project as a new cloud project at the browsed path,
  // then open it — the same flow as Collaboration → Share to team, unified here.
  async function handlePublishHere() {
    const { team, rel } = app.splitServerPath(app.browserState.path);
    if (!app.identity.account() || !team) return;
    const name = await app.promptForName("Publish current workspace as", "");
    if (!name) return;
    const path = rel;
    try {
      const localProject = app.controller.getProject();
      const created = await createProjectServer(app.settings.serverUrl, app.identity.token(), team, path, name);
      app.mode.share(localProject);
      await app.collaboration.openWorkspace(app.settings.serverUrl, app.identity.token(), team, created.path, { reason: "create-project" });
      app.controller.replaceProject(localProject);
      await app.collaboration.publishSnapshot(localProject);
      app.settings.change({ wasConnected: false, lastWorkspace: { team, path: created.path } });
      app.logDebug("action", "Published local project to cloud", created.id);
      if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
      app.render(app.controller.getProject());
    } catch (error) {
      const kept = app.mode.leave();
      if (kept) app.controller.replaceProject(kept);
      app.notify(error.message || "Could not publish workspace.");
      app.logDebug("response", "Publish failed", error.message);
      app.render(app.controller.getProject());
    }
  }

  return { fallbackToDefaultAfterDelete, handleDeleteSelected, setManageChrome, beginTransfer, cancelPick, handleSelectDestination, handlePublishHere, trashTeam, handleOpenTrash };
}
