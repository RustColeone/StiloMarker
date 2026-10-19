// History on the page, created when it starts in a page: snapshots of files
// (snapshots.js) and the version label in the status bar, the preview pane's
// diff tab (an Editor pane view), and the Snapshots and Workspace History
// dialogs, which load the first time they open.
import { escapeHtmlAttribute } from "../../editor/index.js";
import { applyHostCounters, getNodeIdByPath, getPath } from "../../workspace/index.js";
import { createSnapshots } from "./snapshots.js";

// The diff tab's id among the preview's tabs (not a project file).
export const DIFF_TAB_ID = "__diff__";

export function createSurface({ shell, workspace, editor, sync }) {
  const $ = (id) => document.getElementById(id);
  const settings = shell.settings;
  const controller = () => workspace.project();

  // The diff tab compares the current text of `fileId` with a stored version
  // (`oldText`, fetched once so drawing stays synchronous).
  const diffState = { active: false, fileId: null, path: null, versionId: null, oldText: "", createdAt: 0, blocks: [], currentChange: -1 };
  const app = {
    view: editor.view, workspace, settings, DIFF_TAB_ID, diffState, escapeHtmlAttribute,
    elements: { preview: $("preview-output"), previewDiffView: $("preview-diff-view"), diffBody: $("diff-body"), diffRuler: $("diff-ruler"),
      previewDiffLabel: $("preview-diff-label"), previewDiffStats: $("preview-diff-stats") },
    cloudWorkspaceTarget: () => sync.cloudWorkspace(),
    // Snapshots are grouped by project: the cloud workspace's id, else the local project's.
    snapshotProjectKey: () => settings.syncedProjectId || controller().getProject()?.id || "local",
    logDebug: (...args) => shell.log(...args),
    togglePreview: () => shell.frame.toggle("preview"),
    showToast: (message, options) => shell.toast(message, options),
    render: (project) => shell.render(project),
    updateStatus: (project) => shell.render(project, { only: "status" }),
    versionItem: shell.statusBar.add({ id: "version", order: 50, className: "status-item-version", hidden: true })
  };
  Object.defineProperty(app, "controller", { get: controller, enumerable: true });
  Object.defineProperty(app, "collaboration", { get: () => sync.session(), enumerable: true });
  const snapshots = createSnapshots(app);

  // The diff, as a tab in the preview pane.
  editor.paneViews.add({
    id: DIFF_TAB_ID,
    element: app.elements.previewDiffView,
    tab: () => (diffState.active ? {
      label: diffState.path.split("/").pop(),
      title: `Diff: ${diffState.path} — current vs ${snapshots.formatSnapshotTime(diffState.createdAt)}`,
      iconText: "±",
      iconClass: "tab-diff-icon",
      caption: `${diffState.path.split("/").pop()} (diff)` // the phone's pane caption
    } : null),
    // In full when the tab is (re)shown; while the file is edited underneath, a light refresh.
    show: ({ fresh }) => (fresh ? snapshots.renderDiff() : snapshots.scheduleDiffRefresh()),
    close: () => snapshots.closeDiff()
  });
  $("diff-next-change")?.addEventListener("click", () => snapshots.gotoChange(1));
  $("diff-prev-change")?.addEventListener("click", () => snapshots.gotoChange(-1));

  // The version label follows the project (its counters, the active file).
  controller().subscribe(() => snapshots.scheduleVersionLabel());
  snapshots.renderVersionLabel();
  // The host stamped a file's counters on an operation it accepted: adopt them
  // as they are (a synced tab never counts itself), so everyone shows the same sitting.
  sync.events.on("host-counters", ({ path, counters }) => {
    const project = controller().getProject();
    const nodeId = getNodeIdByPath(project, path);
    if (!nodeId) return;
    applyHostCounters(project, nodeId, counters);
    snapshots.scheduleVersionLabel();
  });

  // The dialogs, loaded the first time they open.
  const shared = () => ({
    controller: controller(), showToast: app.showToast, notify: (message) => shell.notify(message),
    confirmAction: (message) => shell.confirm(String(message)),
    formatSnapshotTime: snapshots.formatSnapshotTime, formatBytes: snapshots.formatBytes, projectPaths: snapshots.projectPaths,
    writeAtPathOperations: snapshots.writeAtPathOperations, applyHistoryOperations: snapshots.applyHistoryOperations
  });
  let snapshotsDialog = null;
  async function openSnapshotsDialog() {
    snapshotsDialog ??= import("./snapshots-dialog.js").then(({ createSnapshotsDialog }) => createSnapshotsDialog({
      ...shared(), collaboration: sync.session(), getPath, getWorkspaceMode: () => sync.mode.get().workspaceMode,
      snapshotStore: snapshots.snapshotStore, ensureSnapshotsMigrated: snapshots.ensureSnapshotsMigrated,
      setSnapshotBaselines: snapshots.setSnapshotBaselines, refreshSnapshotBaselines: snapshots.refreshSnapshotBaselines,
      createSnapshotNow: snapshots.createSnapshotNow, showFileDiff: snapshots.showFileDiff, workspace
    })).catch((error) => { snapshotsDialog = null; throw error; });
    try {
      await (await snapshotsDialog).open();
    } catch (error) {
      shell.notify(`Snapshots could not load: ${error.message}`);
    }
  }
  let workspaceHistory = null;
  async function openWorkspaceHistory() {
    if (!sync.cloudWorkspace()) {
      app.showToast("Workspace History is for cloud workspaces — open one from the server first");
      return;
    }
    workspaceHistory ??= import("./workspace-history.js").then(({ createWorkspaceHistory }) => createWorkspaceHistory({
      ...shared(), cloudWorkspaceTarget: () => sync.cloudWorkspace()
    })).catch((error) => { workspaceHistory = null; throw error; });
    try {
      await (await workspaceHistory).open();
    } catch (error) {
      shell.notify(`Workspace History could not load: ${error.message}`);
    }
  }

  shell.commands.add({ id: "history.create-snapshot", title: "Create Snapshot", menu: { id: "create", group: 1, order: 1 }, run: () => void snapshots.createSnapshotNow() });
  shell.commands.add({ id: "history.snapshots", title: "Snapshots…", menu: { id: "edit", group: 0, order: 2 }, run: () => void openSnapshotsDialog() });
  shell.commands.add({ id: "history.workspace-history", title: "Workspace History…", menu: { id: "edit", group: 0, order: 3 }, run: () => void openWorkspaceHistory() });
  // Before a reload replaces local edits with the cloud's copy (Sync's), they are kept as snapshots.
  sync.keepers.add(async (files) => {
    const store = snapshots.snapshotStore();
    for (const [path, content] of files) await store.create(path, content, "Recovery: local edits before cloud reload");
    shell.toast(`Local changes saved in Snapshots (${files.size} file(s)); loading the cloud version.`);
  });
  // Save (Workspace's) marks a point to compare against later: a snapshot.
  workspace.events.on("saved", () => void snapshots.createSnapshotNow());
  // A project without a server never opens a cloud workspace (which counts them),
  // so the version label's baselines are counted here too.
  void snapshots.refreshSnapshotBaselines();

  return Object.freeze({ ...snapshots, openSnapshotsDialog, openWorkspaceHistory });
}
