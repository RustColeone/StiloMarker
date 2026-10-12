// Snapshots: the per-file version history dialog — list a file's snapshots,
// compare one with the open file (in the preview's diff tab), restore or delete
// it. Loaded the first time the dialog opens; the app passes in what it needs.

import { query } from "../ui/dom.js";

export function createSnapshotsDialog(deps) {
  const {
    controller, collaboration, getPath, getWorkspaceMode, snapshotStore, ensureSnapshotsMigrated,
    setSnapshotBaselines, refreshSnapshotBaselines, createSnapshotNow, showFileDiff, showToast, notify,
    confirmAction, formatSnapshotTime, formatBytes, projectPaths, writeAtPathOperations,
    applyHistoryOperations, isTextFileName, applyEditorEdit, publishOperation
  } = deps;
  const el = {
    dialog: query("#snapshots-dialog"),
    list: query("#snapshots-list"),
    empty: query("#snapshots-empty"),
    createButton: query("#snapshots-create-button"),
    fileSelect: query("#snapshots-file-select"),
    selectionLabel: query("#snapshots-selection-label"),
    compareBtn: query("#snapshots-compare-btn"),
    restoreBtn: query("#snapshots-restore-btn"),
    deleteBtn: query("#snapshots-delete-btn")
  };
  // The versions currently listed, which file they belong to, and which one
  // the user has highlighted.
  let snapshotsViewPath = null;
  let snapshotsVersions = [];
  let snapshotsSelectedId = null;

  async function openSnapshotsDialog() {
      const project = controller.getProject();
    const activeFile = controller.getActiveFile();
    const activePath = activeFile ? getPath(project, activeFile.id) : null;
    let paths = [];
    try {
      const migrated = await ensureSnapshotsMigrated();
      if (migrated) showToast(`Uploaded ${migrated} earlier snapshot${migrated === 1 ? "" : "s"} to the server`);
      const listing = await snapshotStore().paths();
      paths = listing.paths ?? [];
      setSnapshotBaselines(listing.baselines);
    } catch { paths = []; }
    // Show a set of files that have history, plus the active file even if it has none.
    const options = Array.from(new Set([...(activePath ? [activePath] : []), ...paths]));
    if (el.fileSelect) {
      el.fileSelect.replaceChildren(...options.map((p) => {
        const opt = document.createElement("option");
        opt.value = p;
        opt.textContent = p;
        return opt;
      }));
      snapshotsViewPath = options.includes(activePath) ? activePath : (options[0] ?? null);
      if (snapshotsViewPath) el.fileSelect.value = snapshotsViewPath;
      el.fileSelect.disabled = options.length === 0;
    }
    snapshotsSelectedId = null; // fresh selection each open
    await renderFileHistory();
    if (!el.dialog.open) el.dialog.showModal();
  }

  async function renderFileHistory() {
    const list = el.list;
    if (!list) return;
    const path = snapshotsViewPath;
    try {
      snapshotsVersions = path ? await snapshotStore().versions(path) : [];
    } catch { snapshotsVersions = []; }
    // Keep the highlight only if the selected version still exists.
    if (!snapshotsVersions.some((v) => v.id === snapshotsSelectedId)) snapshotsSelectedId = null;
    list.replaceChildren();
    if (el.empty) {
      el.empty.hidden = snapshotsVersions.length > 0;
      el.empty.textContent = path
        ? "No snapshots yet for this file. Press Ctrl+S (or Create Snapshot) to make one."
        : "No snapshots yet for this project.";
    }
    for (const v of snapshotsVersions) {
      const item = document.createElement("li");
      item.className = `snapshot-item${v.id === snapshotsSelectedId ? " is-selected" : ""}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(v.id === snapshotsSelectedId));
      item.tabIndex = -1;

      const meta = document.createElement("div");
      meta.className = "snapshot-meta";
      const time = document.createElement("span");
      time.className = "snapshot-time";
      time.textContent = formatSnapshotTime(v.createdAt);
      const info = document.createElement("span");
      info.className = "snapshot-count subtle-label";
      info.textContent = `${formatBytes(v.byteSize)}${v.label ? ` · ${v.label}` : ""}`;
      meta.append(time, info);

      item.append(meta);
      // Single-click toggles selection; double-click compares that version.
      item.addEventListener("click", () => selectSnapshot(v.id));
      item.addEventListener("dblclick", () => { compareSnapshotVersion(v.id); });
      list.append(item);
    }
    renderSnapshotsActionbar();
  }

  function selectSnapshot(versionId) {
    // Tapping the highlighted row again clears the selection.
    snapshotsSelectedId = snapshotsSelectedId === versionId ? null : versionId;
    // Repaint selection state in place (rows are in snapshotsVersions order).
    const rows = el.list?.children ?? [];
    snapshotsVersions.forEach((v, i) => {
      const li = rows[i];
      if (!li) return;
      const on = v.id === snapshotsSelectedId;
      li.classList.toggle("is-selected", on);
      li.setAttribute("aria-selected", String(on));
    });
    renderSnapshotsActionbar();
  }

  // Whether a diff can be shown for the viewed file: it must be the file that's
  // currently open in the editor (the diff compares against live content).
  function snapshotsCanCompare() {
    const project = controller.getProject();
    const activeFile = controller.getActiveFile();
    const activePath = activeFile ? getPath(project, activeFile.id) : null;
    return activePath != null && activePath === snapshotsViewPath;
  }

  function renderSnapshotsActionbar() {
    const selected = snapshotsVersions.find((v) => v.id === snapshotsSelectedId) || null;
    const canCompare = !!selected && snapshotsCanCompare();
    if (el.compareBtn) {
      el.compareBtn.disabled = !canCompare;
      el.compareBtn.title = selected && !canCompare
        ? "Open this file in the editor to compare it"
        : "Compare the current file with this version";
    }
    if (el.restoreBtn) el.restoreBtn.disabled = !selected;
    if (el.deleteBtn) el.deleteBtn.disabled = !selected;
    if (el.selectionLabel) {
      el.selectionLabel.textContent = selected
        ? `Selected: ${formatSnapshotTime(selected.createdAt)}`
        : snapshotsVersions.length
          ? "Select a version"
          : "";
    }
  }

  // Compare a specific version with the current file (used by double-click, which
  // must ignore the intervening select/deselect toggles). Returns true if it ran.
  function compareSnapshotVersion(versionId) {
    const v = snapshotsVersions.find((x) => x.id === versionId);
    if (!v || !snapshotsCanCompare()) return false;
    el.dialog?.close();
    void showFileDiff(snapshotsViewPath, v.id, v.createdAt);
    return true;
  }

  // Compare the highlighted snapshot with the current file (the Compare button).
  function compareSelectedSnapshot() {
    return compareSnapshotVersion(snapshotsSelectedId);
  }

  async function restoreVersion(path, versionId, createdAt) {
    const project = controller.getProject();
    const node = Object.values(project.nodes).find((n) => n.kind === "file" && getPath(project, n.id) === path);
    const content = await snapshotStore().content(versionId);
    if (content == null) { showToast("That version is no longer available"); return; }
    if (!node) {
      // The file was deleted since. Snapshots outlive their file, so recreate it
      // (and any missing folders) instead of refusing.
      const ok = await confirmAction(`"${path.split("/").pop()}" no longer exists. Bring it back from its ${formatSnapshotTime(createdAt)} snapshot?`);
      if (!ok) return;
      const ops = writeAtPathOperations(path, content, projectPaths(project).folders);
      try {
        if (collaboration.isConnected() && getWorkspaceMode() === "synced") await applyHistoryOperations(ops);
        else for (const op of ops) controller.applySyncOperation(op);
        showToast(`Restored ${path.split("/").pop()}`);
      } catch (error) {
        notify(`Could not restore: ${error.message}`);
      }
      return;
    }
    if (content === String(node.content ?? "")) { showToast("Already matches this version"); return; }
    const ok = await confirmAction(`Restore "${path.split("/").pop()}" to its ${formatSnapshotTime(createdAt)} snapshot? Current content is replaced (you can snapshot first to keep it).`);
    if (!ok) return;
    if (project.activeFileId === node.id && isTextFileName(node.name)) {
      // Active file: route through the editor so undo history + caret stay sane.
      applyEditorEdit(content, 0, 0);
    } else {
      controller.updateContent(node.id, content);
    }
    publishOperation({ type: "update-file", path, content });
    showToast(`Restored ${path.split("/").pop()}`);
  }

  el.createButton?.addEventListener("click", async () => {
    await createSnapshotNow();
    // Rebuild the dialog so a newly-tracked file appears and the active file (the
    // one we just snapshotted) is reselected in the dropdown.
    await openSnapshotsDialog();
  });
  el.fileSelect?.addEventListener("change", (event) => {
    snapshotsViewPath = event.target.value || null;
    snapshotsSelectedId = null; // switching files clears the highlight
    void renderFileHistory();
  });
  el.compareBtn?.addEventListener("click", () => { compareSelectedSnapshot(); });
  el.restoreBtn?.addEventListener("click", async () => {
    const selected = snapshotsVersions.find((v) => v.id === snapshotsSelectedId);
    if (!selected) return;
    await restoreVersion(snapshotsViewPath, selected.id, selected.createdAt);
  });
  el.deleteBtn?.addEventListener("click", async () => {
    const selected = snapshotsVersions.find((v) => v.id === snapshotsSelectedId);
    if (!selected) return;
    const ok = await confirmAction(`Delete the ${formatSnapshotTime(selected.createdAt)} snapshot of "${(snapshotsViewPath || "").split("/").pop()}"? This can't be undone.`);
    if (!ok) return;
    await snapshotStore().remove(selected.id);
    snapshotsSelectedId = null;
    void refreshSnapshotBaselines();  // S dropped by one
    await renderFileHistory();
  });

  return { open: openSnapshotsDialog };
}
