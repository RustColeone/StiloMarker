// Workspace History: whole-workspace backups of a cloud workspace — list them,
// compare one with the workspace as it is now, restore one file or everything.
// Loaded the first time the dialog opens; the app passes in what it needs.

import { createWorkspaceBackup, getWorkspaceBackupContent, listWorkspaceBackupFiles, listWorkspaceBackups } from "../modules/history/index.js";
import { query } from "../ui/dom.js";

export function createWorkspaceHistory(deps) {
  const {
    controller, cloudWorkspaceTarget, showToast, notify, confirmAction, formatSnapshotTime, formatBytes,
    projectPaths, writeAtPathOperations, applyHistoryOperations
  } = deps;
  const el = {
    dialog: query("#workspace-history-dialog"),
    list: query("#workspace-history-list"),
    empty: query("#workspace-history-empty"),
    status: query("#workspace-history-status"),
    backupNow: query("#workspace-history-backup-now"),
    filesWrap: query("#workspace-history-files-wrap"),
    files: query("#workspace-history-files"),
    filesCaption: query("#workspace-history-files-caption"),
    selection: query("#workspace-history-selection"),
    restoreFile: query("#workspace-history-restore-file"),
    restoreAll: query("#workspace-history-restore-all")
  };

  // ---- Workspace History (whole-workspace backups) ---------------------------
  // The server keeps one backup for each day a workspace changed, plus a copy
  // taken just before anything destructive. This dialog lists them, compares a
  // backup with the workspace as it is now, and restores one file — including one
  // deleted since — or everything. Restores go through the normal operations,
  // each confirmed by the server before this browser's tree changes, chained on
  // the confirmed revision so a concurrent edit stops the restore instead of
  // being overwritten.
  const historyState = { backups: [], selectedId: null, files: [], folders: [], created: [], status: new Map(), selectedFile: null, busy: false };

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function describeBackup(backup) {
    if (backup.kind === "daily") return `Daily · ${backup.day}`;
    return backup.label || (backup.kind === "manual" ? "Manual backup" : "Safety copy");
  }

  async function openWorkspaceHistory() {
    if (!cloudWorkspaceTarget()) {
      showToast("Workspace History is for cloud workspaces — open one from the server first");
      return;
    }
    historyState.selectedId = null;
    historyState.selectedFile = null;
    await refreshWorkspaceHistory();
    if (!el.dialog.open) el.dialog.showModal();
  }

  async function refreshWorkspaceHistory() {
    const target = cloudWorkspaceTarget();
    if (!target) return;
    try {
      historyState.backups = (await listWorkspaceBackups(target.serverUrl, target.token, target.team, target.path)).backups ?? [];
    } catch (error) {
      historyState.backups = [];
      showToast(error.message);
    }
    if (!historyState.backups.some((b) => b.id === historyState.selectedId)) {
      historyState.selectedId = null;
      historyState.files = [];
      historyState.selectedFile = null;
    }
    renderWorkspaceHistory();
    if (historyState.selectedId) await loadBackupFiles(historyState.selectedId);
  }

  function renderWorkspaceHistory() {
    const list = el.list;
    if (!list) return;
    list.replaceChildren();
    el.empty.hidden = historyState.backups.length > 0;
    el.status.textContent = historyState.backups.length
      ? `${historyState.backups.length} backup${historyState.backups.length === 1 ? "" : "s"}` : "";
    for (const backup of historyState.backups) {
      const item = document.createElement("li");
      const selected = backup.id === historyState.selectedId;
      item.className = `snapshot-item${selected ? " is-selected" : ""}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(selected));
      const meta = document.createElement("div");
      meta.className = "snapshot-meta";
      const time = document.createElement("span");
      time.className = "snapshot-time";
      time.textContent = formatSnapshotTime(backup.createdAt);
      const info = document.createElement("span");
      info.className = "snapshot-count subtle-label";
      info.textContent = `${describeBackup(backup)} · ${backup.fileCount} file${backup.fileCount === 1 ? "" : "s"} · ${formatBytes(backup.size)}`;
      meta.append(time, info);
      item.append(meta);
      item.addEventListener("click", () => void selectBackup(backup.id));
      list.append(item);
    }
    renderWorkspaceHistoryFiles();
  }

  async function selectBackup(backupId) {
    historyState.selectedId = historyState.selectedId === backupId ? null : backupId;
    historyState.selectedFile = null;
    historyState.files = [];
    renderWorkspaceHistory();
    if (historyState.selectedId) await loadBackupFiles(historyState.selectedId);
  }

  // Compare a backup with the workspace as it is now, file by file. Text is
  // compared by SHA-256 (the server stores blobs by the same hash); images are
  // kept on disk server-side, so for them only existence is known here.
  async function loadBackupFiles(backupId) {
    const target = cloudWorkspaceTarget();
    if (!target) return;
    let listing;
    try {
      listing = await listWorkspaceBackupFiles(target.serverUrl, target.token, target.team, target.path, backupId);
    } catch (error) {
      showToast(error.message);
      return;
    }
    if (historyState.selectedId !== backupId) return; // selection moved on meanwhile
    const current = projectPaths(controller.getProject());
    const status = new Map();
    for (const file of listing.files) {
      const node = current.files.get(file.path);
      if (!node) status.set(file.path, "deleted");
      else if (file.image) status.set(file.path, "image");
      else status.set(file.path, (await sha256Hex(String(node.content ?? ""))) === file.blob ? "same" : "changed");
    }
    const backed = new Set(listing.files.map((f) => f.path));
    historyState.created = [...current.files.keys()].filter((path) => !backed.has(path));
    historyState.files = listing.files;
    historyState.folders = listing.folders ?? [];
    historyState.status = status;
    renderWorkspaceHistoryFiles();
  }

  const HISTORY_STATUS_LABEL = { deleted: "deleted since", changed: "changed since", same: "unchanged", image: "image" };

  function renderWorkspaceHistoryFiles() {
    const wrap = el.filesWrap;
    const list = el.files;
    if (!wrap || !list) return;
    const backup = historyState.backups.find((b) => b.id === historyState.selectedId);
    wrap.hidden = !backup || !historyState.files.length;
    list.replaceChildren();
    if (backup && historyState.files.length) {
      const count = (kind) => historyState.files.filter((f) => historyState.status.get(f.path) === kind).length;
      const created = historyState.created?.length ?? 0;
      const parts = [`${historyState.files.length} files`];
      if (count("deleted")) parts.push(`${count("deleted")} deleted since`);
      if (count("changed")) parts.push(`${count("changed")} changed since`);
      if (created) parts.push(`${created} created since`);
      el.filesCaption.textContent = parts.join(" · ");
      // Most interesting first: what you would get back by restoring.
      const order = { deleted: 0, changed: 1, image: 2, same: 3 };
      const files = [...historyState.files].sort((a, b) =>
        (order[historyState.status.get(a.path)] - order[historyState.status.get(b.path)]) || a.path.localeCompare(b.path));
      for (const file of files) {
        const state = historyState.status.get(file.path);
        const item = document.createElement("li");
        const selected = file.path === historyState.selectedFile;
        item.className = `snapshot-item workspace-history-file is-${state}${selected ? " is-selected" : ""}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(selected));
        const meta = document.createElement("div");
        meta.className = "snapshot-meta";
        const name = document.createElement("span");
        name.className = "snapshot-time";
        name.textContent = file.path;
        const info = document.createElement("span");
        info.className = "snapshot-count subtle-label";
        info.textContent = `${HISTORY_STATUS_LABEL[state]} · ${formatBytes(file.size)}`;
        meta.append(name, info);
        item.append(meta);
        item.addEventListener("click", () => {
          historyState.selectedFile = historyState.selectedFile === file.path ? null : file.path;
          renderWorkspaceHistoryFiles();
        });
        list.append(item);
      }
    }
    const fileState = historyState.selectedFile ? historyState.status.get(historyState.selectedFile) : null;
    el.restoreFile.disabled = historyState.busy || !fileState || fileState === "same";
    el.restoreAll.disabled = historyState.busy || !backup;
    el.selection.textContent = backup
      ? (historyState.selectedFile ? historyState.selectedFile : `${describeBackup(backup)} · ${formatSnapshotTime(backup.createdAt)}`)
      : "";
  }

  async function fetchBackupContent(backupId, path) {
    const target = cloudWorkspaceTarget();
    return (await getWorkspaceBackupContent(target.serverUrl, target.token, target.team, target.path, backupId, path)).content;
  }

  async function restoreHistoryFile() {
    const backup = historyState.backups.find((b) => b.id === historyState.selectedId);
    const path = historyState.selectedFile;
    if (!backup || !path || historyState.busy) return;
    const state = historyState.status.get(path);
    const ok = await confirmAction(state === "deleted"
      ? `Bring back "${path}" from ${formatSnapshotTime(backup.createdAt)}?`
      : `Replace "${path}" with its version from ${formatSnapshotTime(backup.createdAt)}? Take a snapshot first if you want to keep the current text.`);
    if (!ok) return;
    historyState.busy = true;
    renderWorkspaceHistoryFiles();
    try {
      const content = await fetchBackupContent(backup.id, path);
      const current = projectPaths(controller.getProject());
      const ops = current.files.has(path)
        ? [{ type: "update-file", path, content }]
        : writeAtPathOperations(path, content, current.folders);
      await applyHistoryOperations(ops);
      showToast(`Restored ${path.split("/").pop()}`);
    } catch (error) {
      notify(`Restore stopped: ${error.message}`);
    } finally {
      historyState.busy = false;
      await loadBackupFiles(backup.id);
    }
  }

  // Make the workspace match a backup: remove what was created since, bring back
  // what was deleted, and put back what changed. A backup of the current state is
  // taken first, so the restore itself can be undone from this same list.
  async function restoreWholeBackup() {
    const target = cloudWorkspaceTarget();
    const backup = historyState.backups.find((b) => b.id === historyState.selectedId);
    if (!target || !backup || historyState.busy) return;
    const changed = historyState.files.filter((f) => ["deleted", "changed"].includes(historyState.status.get(f.path)));
    const removed = historyState.created ?? [];
    const ok = await confirmAction(`Restore the whole workspace to ${formatSnapshotTime(backup.createdAt)}? `
      + `${changed.length} file(s) are brought back or replaced and ${removed.length} file(s) created since are removed. `
      + "The current state is backed up first, so you can undo this from Workspace History.");
    if (!ok) return;
    historyState.busy = true;
    renderWorkspaceHistoryFiles();
    try {
      await createWorkspaceBackup(target.serverUrl, target.token, target.team, target.path,
        `Before restoring ${formatSnapshotTime(backup.createdAt)}`);
      const current = projectPaths(controller.getProject());
      const keepFolders = new Set(historyState.folders);
      const keepFiles = new Set(historyState.files.map((f) => f.path));
      const parentOf = (path) => path.split("/").slice(0, -1).join("/");
      const ops = [];
      // 1. Remove what the backup doesn't have — only the topmost such item;
      //    deleting a folder takes everything beneath it.
      const extraneous = [...[...current.folders].filter((p) => !keepFolders.has(p)),
                          ...[...current.files.keys()].filter((p) => !keepFiles.has(p))];
      for (const path of extraneous.sort((a, b) => a.split("/").length - b.split("/").length)) {
        const parent = parentOf(path);
        if (parent && !keepFolders.has(parent)) continue; // goes with its folder
        ops.push({ type: "delete-node", path });
      }
      const folders = new Set([...current.folders].filter((p) => keepFolders.has(p)));
      // 2. Folders the backup has, shallow first (empty ones included).
      for (const path of [...keepFolders].sort((a, b) => a.split("/").length - b.split("/").length)) {
        if (folders.has(path)) continue;
        ops.push({ type: "create-folder", parentPath: parentOf(path), name: path.split("/").pop() });
        folders.add(path);
      }
      // 3. Files: bring back deleted ones, put back changed ones.
      for (const file of changed) {
        const content = await fetchBackupContent(backup.id, file.path);
        ops.push(historyState.status.get(file.path) === "deleted"
          ? { type: "create-file", parentPath: parentOf(file.path), name: file.path.split("/").pop(), content }
          : { type: "update-file", path: file.path, content });
      }
      await applyHistoryOperations(ops);
      showToast(`Workspace restored to ${formatSnapshotTime(backup.createdAt)}`);
    } catch (error) {
      notify(`Restore stopped part-way: ${error.message}. The state from before the restore is in Workspace History.`);
    } finally {
      historyState.busy = false;
      await refreshWorkspaceHistory();
    }
  }

  async function backUpWorkspaceNow() {
    const target = cloudWorkspaceTarget();
    if (!target) return;
    try {
      const result = await createWorkspaceBackup(target.serverUrl, target.token, target.team, target.path, "Manual backup");
      showToast(result.created ? "Backup created" : "Nothing changed since the last backup");
    } catch (error) {
      showToast(error.message);
    }
    await refreshWorkspaceHistory();
  }

  el.backupNow.addEventListener("click", () => void backUpWorkspaceNow());
  el.restoreFile.addEventListener("click", () => void restoreHistoryFile());
  el.restoreAll.addEventListener("click", () => void restoreWholeBackup());

  return { open: openWorkspaceHistory };
}
