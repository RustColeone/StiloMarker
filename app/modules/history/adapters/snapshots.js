// Per-file snapshots (local or on the server), the S.E.N version label, the
// restore helpers shared with Workspace History, and the preview's diff tab
// comparing the open file with a snapshot.
// Part of History: created when History is attached, given its context in `app` (surface.js).
import { getPath, isTextFileName } from "../../workspace/index.js";
import { createServerSnapshot, deleteServerSnapshot, getServerSnapshotContent, listServerSnapshotPaths, listServerSnapshotVersions } from "./api.js";
import { createFileSnapshot, deleteVersion, getVersionContent, listFileVersions, listSnapshotPaths } from "./local-store.js";
import { diffLines } from "../model/diff.js";
import { ignore } from "../../../kernel/index.js";

export function createSnapshots(app) {
  // Newest snapshot per file path: { count, editSessions, sessionEdits }. The
  // baseline the S.E.N version label counts from. Refreshed on workspace open and
  // whenever snapshots change — never per keystroke.
  let snapshotBaselines = new Map();
  let snapshotBaselinesInFlight = null;

  // ---- Version label (S.E.N) --------------------------------------------------
  // S — snapshots you have deliberately cut of this file
  // E — writing sittings since that snapshot
  // N — edits in the current sitting
  //
  // None of these is the `revision`. Revision is a Lamport clock: one integer per
  // workspace, monotonic forever, compared in ~170 places to order writes and
  // refuse stale ones. It must never reset, and it is plumbing — users should not
  // be reading a five-digit counter they cannot influence. These three they can:
  // snapshotting bumps S, walking away bumps E. Nothing compares them, which is
  // exactly why they are free to reset.

  function setSnapshotBaselines(baselines) {
    snapshotBaselines = new Map(Object.entries(baselines ?? {}));
    scheduleVersionLabel();
  }

  function refreshSnapshotBaselines() {
    if (snapshotBaselinesInFlight) return snapshotBaselinesInFlight;
    snapshotBaselinesInFlight = (async () => {
      try {
        const listing = await snapshotStore().paths();
        setSnapshotBaselines(listing?.baselines);
      } catch (error) {
        ignore(error, "snapshot counts are unavailable; the label says no snapshots");
      } finally {
        snapshotBaselinesInFlight = null;
      }
    })();
    return snapshotBaselinesInFlight;
  }

  // Snapshots taken before this feature carry no baseline, so E/N count from 0
  // and read high once. That self-heals the next time the file is snapshotted.
  function fileVersionLabel(file, path) {
    if (!file || file.kind !== "file") return null;
    const base = (path && snapshotBaselines.get(path)) || null;
    const sessions = Number(file.editSessions) || 0;
    const edits = Number(file.sessionEdits) || 0;
    const s = base ? Number(base.count) || 0 : 0;
    // clamp: a workspace restored from a backup can sit behind its own snapshots.
    const e = Math.max(0, sessions - (base ? Number(base.editSessions) || 0 : 0));
    // Within the sitting the snapshot was taken in, subtract so a fresh snapshot
    // reads x.0.0; once a new sitting starts, N is simply that sitting's count.
    const n = e > 0 ? edits : Math.max(0, edits - (base ? Number(base.sessionEdits) || 0 : 0));
    return `${s}.${e}.${n}`;
  }

  let versionLabelHandle = null;
  function scheduleVersionLabel() {
    if (versionLabelHandle) return;
    versionLabelHandle = requestAnimationFrame(() => {
      versionLabelHandle = null;
      renderVersionLabel();
    });
  }

  function renderVersionLabel() {
    const item = app.versionItem; // the status bar's version item
    const project = app.controller.getProject();
    const file = app.controller.getActiveFile();
    if (!file || file.kind !== "file" || !isTextFileName(file.name)) {
      item.set({ hidden: true });
      return;
    }
    const path = getPath(project, file.id);
    const text = fileVersionLabel(file, path);
    if (!text) {
      item.set({ hidden: true });
      return;
    }
    const [s, e, n] = text.split(".");
    const total = Number(file.sourceVersion) || 0;
    item.set({ hidden: false, text: `v${text}`, title: `${file.name}\n`
      + `${s} snapshot${s === "1" ? "" : "s"} · ${e} sitting${e === "1" ? "" : "s"} since the last one · ${n} edit${n === "1" ? "" : "s"} this sitting\n`
      + `${total} edit${total === 1 ? "" : "s"} in total` });
  }

  function snapshotStore() {
    const target = app.cloudWorkspaceTarget();
    if (!target) {
      const key = app.snapshotProjectKey();
      return {
        remote: false,
        // No server here, so this browser is the host: it owns the counters and
        // stamps them onto the snapshot itself.
        create: (file, content, label, counters) => createFileSnapshot(key, file, content, label, counters),
        paths: () => listSnapshotPaths(key),
        versions: (file) => listFileVersions(key, file),
        content: (id) => getVersionContent(id),
        remove: (id) => deleteVersion(id)
      };
    }
    const { serverUrl, token, team, path } = target;
    return {
      remote: true,
      // The server reads the file's counters itself — it is the host, so its
      // numbers are the ones every peer must agree on.
      create: (file, content, label) => createServerSnapshot(serverUrl, token, team, path, file, content, label),
      paths: async () => {
        const result = await listServerSnapshotPaths(serverUrl, token, team, path);
        return { paths: result.paths ?? [], baselines: result.baselines ?? {} };
      },
      versions: async (file) => (await listServerSnapshotVersions(serverUrl, token, team, path, file)).versions ?? [],
      content: async (id) => {
        try {
          return (await getServerSnapshotContent(serverUrl, token, team, path, id)).content;
        } catch {
          return null; // gone or unreadable — callers already handle null
        }
      },
      remove: (id) => deleteServerSnapshot(serverUrl, token, team, path, id)
    };
  }

  // Snapshots made before they moved to the server still sit in this browser's
  // IndexedDB — under this workspace's id, or under "server-project", the project
  // id most server workspaces share (which is why they seemed to vanish). Upload
  // them once so no history is lost. From that shared key only files that exist in
  // THIS workspace are taken, so another workspace's history can't leak in. Safe
  // to repeat: the server skips anything already recorded (same time + content).
  let snapshotMigrationPromise = null;

  function ensureSnapshotsMigrated() {
    const target = app.cloudWorkspaceTarget();
    if (!target) return Promise.resolve(0);
    if (!snapshotMigrationPromise) {
      snapshotMigrationPromise = migrateLocalSnapshotsToServer(target)
        .catch((error) => {
          app.logDebug("response", "Snapshot migration failed", error?.message ?? String(error));
          return 0;
        })
        .finally(() => { snapshotMigrationPromise = null; });
    }
    return snapshotMigrationPromise;
  }

  async function migrateLocalSnapshotsToServer(target) {
    const workspaceId = `${target.team}/${target.path}`;
    const flag = `mdnotes.snapshots.migrated.${workspaceId}`;
    try {
      if (localStorage.getItem(flag)) return 0;
    } catch (error) { ignore(error, "local storage is blocked; migrating snapshots anyway"); }

    const project = app.controller.getProject();
    const workspaceFiles = new Set(Object.values(project?.nodes ?? {})
      .filter((node) => node?.kind === "file")
      .map((node) => getPath(project, node.id)));
    let uploaded = 0;
    for (const key of new Set([workspaceId, project?.id].filter(Boolean))) {
      let files = [];
      try { files = await listSnapshotPaths(key); } catch { continue; }
      for (const file of files) {
        if (key !== workspaceId && !workspaceFiles.has(file)) continue; // shared key: this workspace's files only
        let versions = [];
        try { versions = await listFileVersions(key, file); } catch (error) { ignore(error, "an old local snapshot list is unreadable; skipped"); continue; }
        for (const version of [...versions].reverse()) { // oldest first
          const content = await getVersionContent(version.id).catch((error) => { ignore(error, "an old local snapshot is unreadable; skipped"); return null; });
          if (content == null) continue;
          // A network failure throws out of here: the flag stays unset, so the next
          // open retries and the server de-duplicates whatever already arrived.
          const result = await createServerSnapshot(
            target.serverUrl, target.token, target.team, target.path,
            file, content, version.label || "", version.createdAt
          );
          if (result?.created) uploaded += 1;
        }
      }
    }
    try { localStorage.setItem(flag, String(Date.now())); } catch (error) { ignore(error, "remembering that snapshots were migrated failed"); }
    if (uploaded) app.logDebug("action", "Migrated local snapshots to server", `${uploaded} version(s) -> ${workspaceId}`);
    return uploaded;
  }


  // A snapshot is always of the CURRENT file only — the intuitive "save this file's
  // version" action. (The project-wide createFileSnapshots stays in the service for
  // possible future use.)
  async function createSnapshotNow(label = "") {
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    if (!activeFile || !isTextFileName(activeFile.name)) {
      app.showToast("Open a text file to snapshot it");
      return;
    }
    const path = getPath(project, activeFile.id);
    try {
      const result = await snapshotStore().create(path, activeFile.content, label, activeFile);
      void refreshSnapshotBaselines();
      app.showToast(result.created ? `Snapshot saved: ${path.split("/").pop()}` : "Snapshot — no changes since the last one");
      app.logDebug("action", "Snapshot created", `${path} ${result.created ? "saved" : "unchanged"}`);
    } catch (error) {
      app.logDebug("response", "Snapshot failed", error.message);
      app.showToast("Couldn't save snapshot (storage unavailable)");
    }
  }

  // Snapshot every file with unsaved local changes, so a pull that adopts newer
  // server content can never make those edits unrecoverable. Best-effort: snapshot
  // storage problems must not block opening a workspace.
  async function snapshotDirtyFiles(label) {
    const project = app.controller.getProject();
    const store = snapshotStore();
    let saved = 0;
    for (const node of Object.values(project?.nodes ?? {})) {
      if (node?.kind !== "file" || !node.dirty || !isTextFileName(node.name)) continue;
      try {
        const result = await store.create(getPath(project, node.id), node.content ?? "", label);
        if (result?.created) saved += 1;
      } catch (error) { ignore(error, "saving a snapshot before opening failed; opening anyway"); }
    }
    if (saved) app.logDebug("action", "Snapshotted unsaved files", `${saved} file(s) — ${label}`);
    return saved;
  }

  function formatSnapshotTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime())
      ? ""
      : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  // ---- Workspace History (whole-workspace backups) ---------------------------
  // The dialog lives in app/features/workspace-history.js and loads on first use.
  // These restore helpers stay here: per-file Snapshots restores use them too.
  function projectPaths(project) {
    const folders = new Set();
    const files = new Map();
    for (const node of Object.values(project.nodes ?? {})) {
      if (!node || node.id === project.rootId) continue;
      const path = getPath(project, node.id);
      if (node.kind === "folder") folders.add(path);
      else files.set(path, node);
    }
    return { folders, files };
  }

  // Apply restore operations through the server, one at a time, each based on
  // the revision the previous one produced. Images upload their bytes first, the
  // same way a normal image write does in a directory-backed workspace.
  async function applyHistoryOperations(ops) {
    let revision = app.collaboration.getRevision?.() ?? 0;
    for (const op of ops) {
      // A text file's restore travels as a patch against the file as it is now.
      let operation = app.workspace.asPatch(op, revision);
      if (!operation) continue; // already matches
      if (typeof operation.content === "string" && operation.content.startsWith("data:")
          && app.collaboration.isDirectoryBacked?.()) {
        const path = operation.type === "create-file"
          ? [operation.parentPath, operation.name].filter(Boolean).join("/") : operation.path;
        await app.collaboration.uploadAsset(path, operation.content);
        operation = { ...operation, content: "" };
      }
      const result = await app.collaboration.publishOperation(
        { ...operation, baseRevision: revision, expectedRevision: revision }, { optimistic: false });
      if (!result) throw new Error("The workspace connection changed");
      revision = result.revision;
    }
  }

  // Operations that write `content` at `path`, creating missing folders first.
  function writeAtPathOperations(path, content, existingFolders) {
    const segments = path.split("/");
    const name = segments.pop();
    const ops = [];
    for (let i = 1; i <= segments.length; i += 1) {
      const folder = segments.slice(0, i).join("/");
      if (!existingFolders.has(folder)) {
        ops.push({ type: "create-folder", parentPath: segments.slice(0, i - 1).join("/"), name: segments[i - 1] });
        existingFolders.add(folder);
      }
    }
    ops.push({ type: "create-file", parentPath: segments.join("/"), name, content });
    return ops;
  }

  // Compare the ACTIVE file's current content with one of its stored versions,
  // rendering the diff in the preview pane.
  async function showFileDiff(path, versionId, createdAt) {
    const project = app.controller.getProject();
    const activeFile = app.controller.getActiveFile();
    const activePath = activeFile ? getPath(project, activeFile.id) : null;
    if (activePath !== path) { app.showToast("Open that file to compare it"); return; }
    const oldText = await snapshotStore().content(versionId);
    if (oldText == null) { app.showToast("That version is no longer available"); return; }
    app.diffState.active = true;
    app.diffState.fileId = activeFile.id; // diff tracks the file by id (survives the editor switching files)
    app.diffState.path = path;
    app.diffState.versionId = versionId;
    app.diffState.oldText = oldText;
    app.diffState.createdAt = createdAt;
    app.diffState.currentChange = -1;
    if (app.settings.preview === "hidden") app.togglePreview();
    app.view.showView(app.DIFF_TAB_ID); // make the diff the active preview tab
    app.updateStatus(project); // renders the tab strip + shows the diff pane
    renderDiff(); // immediate full render so blocks are fresh (updateStatus may have debounced)
    if (app.diffState.blocks.length) gotoChange(1); // jump to the first change
  }

  // Tear down the diff tab's state + hide the overlay WITHOUT re-rendering (safe to
  // call from inside updateStatus, e.g. when the diffed file is gone).
  function resetDiffState() {
    app.diffState.active = false;
    app.diffState.fileId = null;
    app.diffState.path = null;
    app.diffState.versionId = null;
    app.diffState.oldText = "";
    app.diffState.blocks = [];
    app.diffState.currentChange = -1;
    if (app.elements.previewDiffView) app.elements.previewDiffView.hidden = true;
    if (app.elements.preview) app.elements.preview.hidden = false;
  }

  // Close the diff tab (its × button, or when its file disappears). Falls the
  // preview back to whatever file tab was last open.
  function closeDiff() {
    resetDiffState();
    app.view.closeTab("preview", app.DIFF_TAB_ID); // the preview falls back to the last file tab
    app.render(app.controller.getProject());
  }

  // Rebuild the diff into #diff-body, group changes into blocks, and draw the
  // overview ruler. `preserveScroll` keeps the reader's place on a live re-render
  // (e.g. while they edit the file with the diff open).
  function renderDiff({ preserveScroll = false } = {}) {
    if (!app.diffState.active || !app.elements.diffBody) return;
    const project = app.controller.getProject();
    const node = project.nodes[app.diffState.fileId];
    // The diffed file was deleted → close the diff tab.
    if (!node || node.kind !== "file") {
      closeDiff();
      return;
    }
    const savedScroll = preserveScroll ? app.elements.diffBody.scrollTop : 0;
    const ops = diffLines(app.diffState.oldText, String(node.content ?? ""));

    // Group consecutive changed lines into blocks (for navigation + the ruler).
    const blocks = [];
    let cur = null;
    ops.forEach((op, i) => {
      if (op.type === "same") { cur = null; return; }
      if (!cur) { cur = { start: i, end: i, hasAdd: false, hasDel: false }; blocks.push(cur); }
      cur.end = i;
      if (op.type === "add") cur.hasAdd = true;
      if (op.type === "del") cur.hasDel = true;
    });
    app.diffState.blocks = blocks;

    let added = 0;
    let removed = 0;
    const rowsHtml = ops.map((op) => {
      if (op.type === "add") added += 1;
      if (op.type === "del") removed += 1;
      const marker = op.type === "add" ? "+" : op.type === "del" ? "−" : " ";
      // One line-number column: the current-file line for kept/added rows, the old
      // line for deleted rows (which have no current-file position).
      const lineNo = op.newLine != null ? String(op.newLine) : (op.oldLine != null ? String(op.oldLine) : "");
      return `<div class="diff-line diff-${op.type}"><span class="diff-gutter">${lineNo}</span><span class="diff-mark">${marker}</span><span class="diff-text">${app.escapeHtmlAttribute(op.text)}</span></div>`;
    }).join("");
    app.elements.diffBody.innerHTML = rowsHtml || '<div class="diff-line diff-same"><span class="diff-text">(identical to the current file)</span></div>';

    if (app.elements.previewDiffLabel) app.elements.previewDiffLabel.textContent = `Current vs snapshot · ${formatSnapshotTime(app.diffState.createdAt)}`;
    if (app.elements.previewDiffStats) app.elements.previewDiffStats.textContent = `+${added} −${removed} · ${blocks.length} change${blocks.length === 1 ? "" : "s"}`;

    renderDiffRuler();
    if (preserveScroll) app.elements.diffBody.scrollTop = savedScroll;
    // Re-apply the current-change highlight after the rebuild.
    if (app.diffState.currentChange >= 0 && app.diffState.currentChange < blocks.length) {
      highlightChange(app.diffState.currentChange, { scroll: false });
    }
  }

  function renderDiffRuler() {
    const ruler = app.elements.diffRuler;
    const body = app.elements.diffBody;
    if (!ruler || !body) return;
    ruler.replaceChildren();
    const scrollHeight = body.scrollHeight || 1;
    const rulerHeight = body.clientHeight || 1;
    const rows = body.children;
    app.diffState.blocks.forEach((block, index) => {
      const firstRow = rows[block.start];
      if (!firstRow) return;
      const lastRow = rows[block.end] ?? firstRow;
      const topPx = (firstRow.offsetTop / scrollHeight) * rulerHeight;
      const heightPx = Math.max(3, ((lastRow.offsetTop + lastRow.offsetHeight - firstRow.offsetTop) / scrollHeight) * rulerHeight);
      const tick = document.createElement("div");
      tick.className = `diff-ruler-tick ${block.hasAdd && block.hasDel ? "tick-mix" : block.hasAdd ? "tick-add" : "tick-del"}`;
      tick.style.top = `${topPx}px`;
      tick.style.height = `${heightPx}px`;
      tick.title = `Change ${index + 1} of ${app.diffState.blocks.length}`;
      tick.addEventListener("click", () => { app.diffState.currentChange = index; highlightChange(index, { scroll: true }); });
      ruler.append(tick);
    });
  }

  function highlightChange(index, { scroll = true } = {}) {
    const body = app.elements.diffBody;
    if (!body) return;
    body.querySelectorAll(".is-current-change").forEach((el) => el.classList.remove("is-current-change"));
    const block = app.diffState.blocks[index];
    if (!block) return;
    const rows = body.children;
    for (let i = block.start; i <= block.end; i += 1) rows[i]?.classList.add("is-current-change");
    if (scroll) rows[block.start]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function gotoChange(delta) {
    const total = app.diffState.blocks.length;
    if (!total) { app.showToast("No changes"); return; }
    const next = app.diffState.currentChange < 0
      ? (delta > 0 ? 0 : total - 1)
      : (((app.diffState.currentChange + delta) % total) + total) % total;
    app.diffState.currentChange = next;
    highlightChange(next, { scroll: true });
  }

  // Debounced live refresh so editing the file with the diff open stays smooth and
  // keeps the reader's scroll position.
  let diffRefreshTimer = null;
  function scheduleDiffRefresh() {
    if (diffRefreshTimer) return;
    diffRefreshTimer = setTimeout(() => {
      diffRefreshTimer = null;
      if (app.diffState.active) renderDiff({ preserveScroll: true });
    }, 180);
  }

  return {
    applyHistoryOperations, closeDiff, createSnapshotNow, ensureSnapshotsMigrated, formatBytes,
    formatSnapshotTime, gotoChange, projectPaths, refreshSnapshotBaselines, renderDiff,
    renderVersionLabel, scheduleDiffRefresh, scheduleVersionLabel, setSnapshotBaselines,
    showFileDiff, snapshotDirtyFiles, snapshotStore, writeAtPathOperations
  };
}
