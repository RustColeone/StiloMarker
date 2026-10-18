// Tabs and panes: the source and preview tab strips (overflow menu, reorder,
// drag files in), which file each pane shows, and resuming the last view
// (the open tabs per workspace, kept on the server through app.saveUserState).
// main.js creates this through createPanes and passes its shared values in `app`;
// what the panes show is the Editor's view (app.view, service/view.js).
import { normalizeServerUrl } from "../../shell/index.js";
import { getPath, isBmapFileName } from "../../workspace/index.js";

export function createTabs(app) {

  function ensureOpenTabs(project) {
    app.view.keepTabs(project, { diffTabId: app.DIFF_TAB_ID, diffActive: Boolean(app.diffState.active) });
  }

  function openSourceTab(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }

    app.view.openTab("source", fileId);
  }

  function openPreviewTab(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }

    app.view.openTab("preview", fileId);
  }

  function setActiveSourceFile(fileId) {
    app.captureViewState(); // resume-position: snapshot the outgoing document first
    app.view.pick(fileId);
    openSourceTab(fileId);
    app.controller.setActiveFile(fileId);
    scheduleSaveUserState();
  }

  // ---- Per-user resume: persist which files are open in a cloud workspace so
  // they can be restored on the next open/reconnect. Server-side, per account.
  function currentWorkspaceView() {
    const project = app.controller.getProject();
    const pathFor = id => project.nodes[id]?.kind === "file" ? getPath(project, id) : null;
    return { openFiles: app.view.get().sourceOpenTabIds.map(pathFor).filter(Boolean), activeFile: pathFor(project.activeFileId) };
  }
  function cacheWorkspaceView() {
    if (app.workspaceMode !== "synced" || !app.settings.syncedProjectId) return;
    try {
      localStorage.setItem("mdnotes.workspaceView.v1", JSON.stringify({
        server: normalizeServerUrl(app.settings.serverUrl), workspace: app.settings.syncedProjectId,
        ...currentWorkspaceView()
      }));
    } catch (error) { app.logDebug("response", "Resume cache failed", error.message); }
  }
  function cachedWorkspaceView(workspace) {
    try {
      const saved = JSON.parse(localStorage.getItem("mdnotes.workspaceView.v1"));
      return saved?.server === normalizeServerUrl(app.settings.serverUrl) && saved.workspace === workspace ? saved : null;
    } catch { return null; }
  }
  function showResumedFile(resume) {
    restoreResumeState(resume);
    if (!app.controller.getActiveFile()) {
      const first = Object.values(app.controller.getProject().nodes).find(node => node.kind === "file");
      if (first) setActiveSourceFile(first.id);
    }
  }

  let saveUserStateTimer = null;
  function scheduleSaveUserState() {
    cacheWorkspaceView();
    if (app.workspaceMode !== "synced" || !app.identity.account()) return;
    const ws = app.settings.lastWorkspace;
    if (!ws?.team || ws.path == null) return;
    if (saveUserStateTimer) clearTimeout(saveUserStateTimer);
    saveUserStateTimer = setTimeout(() => {
      saveUserStateTimer = null;
      const project = app.controller.getProject();
      const openFiles = app.view.get().sourceOpenTabIds
        .map((id) => (project.nodes[id]?.kind === "file" ? getPath(project, id) : null))
        .filter(Boolean);
      const activeId = project.activeFileId;
      const activeFile = activeId && project.nodes[activeId]?.kind === "file"
        ? getPath(project, activeId)
        : null;
      app.saveUserState(ws, openFiles, activeFile)
        .catch((error) => app.logDebug("response", "Save resume state failed", error.message));
    }, 1200);
  }

  // Restore the tabs the user had open here last time (from the open response's
  // `resume`). Paths are resolved back to node ids in the freshly-pulled project.
  function restoreResumeState(resume) {
    if (!resume || (!resume.openFiles?.length && !resume.activeFile)) return;
    const project = app.controller.getProject();
    const pathToId = new Map();
    for (const node of Object.values(project.nodes)) {
      if (node.kind === "file") pathToId.set(getPath(project, node.id), node.id);
    }
    const openIds = (resume.openFiles ?? [])
      .map((path) => pathToId.get(path))
      .filter(Boolean);
    for (const id of openIds) openSourceTab(id);
    const activeId = resume.activeFile ? pathToId.get(resume.activeFile) : null;
    if (activeId) {
      setActiveSourceFile(activeId);
    } else if (openIds.length) {
      setActiveSourceFile(openIds[0]);
    }
    if (openIds.length) {
      app.render(app.controller.getProject());
      app.logDebug("action", "Restored resume state", `${openIds.length} file(s)`);
    }
  }

  function setActiveSourcePart(fileId, partId) {
    app.view.pick(fileId, partId);
    openSourceTab(fileId);
    app.controller.setActiveFile(fileId);
  }

  function setPreviewFile(fileId) {
    const project = app.controller.getProject();
    if (fileId === app.DIFF_TAB_ID) {
      if (!app.diffState.active) return;
      app.captureViewState();
      app.view.showDiff(app.DIFF_TAB_ID);
      app.updateStatus(project);
      return;
    }
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }
    app.captureViewState(); // resume-position: snapshot the outgoing preview first
    openPreviewTab(fileId);
    app.view.showPreview(fileId);
    app.updateStatus(project);
  }

  function openFileFromExplorer(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }
    app.logDebug("action", "File opened", getPath(project, fileId));
    setActiveSourceFile(fileId);
    app.showToast(`Opened ${node.name}`);
    // On mobile the explorer is a flyout overlay — close it so the opened file
    // is visible without an extra tap.
    app.setMobileExplorerOpen(false);
    if (isBmapFileName(node.name)) {
      setPreviewFile(fileId);
      if (app.settings.preview === "hidden") {
        app.togglePreview();
      }
    } else if (app.view.get().previewFileId === null && app.isPreviewableFileName(node.name)) {
      setPreviewFile(fileId);
    }
  }

  function canOpenFileInPane(fileId, pane) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return false;
    }

    if (pane === "preview") {
      return app.isPreviewableFileName(node.name);
    }

    return true;
  }

  function setPaneDropActive(pane, isActive) {
    const target = pane === "preview" ? app.elements.previewPane : app.elements.sourcePane;
    target.classList.toggle("is-drop-active", isActive);
  }

  function clearPaneDropState() {
    app.elements.sourcePane.classList.remove("is-drop-active");
    app.elements.previewPane.classList.remove("is-drop-active");
  }

  function openDroppedFileInPane(fileId, pane) {
    if (!canOpenFileInPane(fileId, pane)) {
      return;
    }
    if (pane === "preview") {
      setPreviewFile(fileId);
      app.logDebug("action", "File dropped into preview pane", getPath(app.controller.getProject(), fileId));
      return;
    }
    setActiveSourceFile(fileId);
    app.logDebug("action", "File dropped into source pane", getPath(app.controller.getProject(), fileId));
  }

  function openPartInPane(fileId, partId, pane) {
    const project = app.controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || !app.parts.of(file.name)) {
      return;
    }

    if (pane === "preview") {
      openPreviewTab(fileId);
      app.view.showPreview(fileId, partId);
      app.updateStatus(project);
      return;
    }

    setActiveSourcePart(fileId, partId);
    app.logDebug("action", "Part dropped into source pane", `${getPath(project, fileId)} :: ${partId}`);
  }

  function bindPaneDropTarget(target, pane) {
    // dragover: getData() is blocked by spec during dragover for security — use types instead.
    target.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types ?? [];
      const hasFile = types.includes("text/mdnotes-file-id");
      const hasEntry = types.includes("text/stilo-file-part");
      if (!hasFile && !hasEntry) {
        setPaneDropActive(pane, false);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setPaneDropActive(pane, true);
    });

    target.addEventListener("dragleave", (event) => {
      if (event.currentTarget?.contains(event.relatedTarget)) {
        return;
      }
      setPaneDropActive(pane, false);
    });

    target.addEventListener("drop", (event) => {
      setPaneDropActive(pane, false);
      const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
      const partPayload = event.dataTransfer?.getData("text/stilo-file-part");
      app.logDebug("action", `Drop on ${pane} pane`, fileId ? `file=${fileId}` : `part=${partPayload}`);
      if ((!fileId || !canOpenFileInPane(fileId, pane)) && !partPayload) {
        app.logDebug("response", `Drop on ${pane} pane rejected`, fileId ? `canOpen=${canOpenFileInPane(fileId, pane)}` : "no payload");
        return;
      }
      event.preventDefault();
      if (fileId && canOpenFileInPane(fileId, pane)) {
        openDroppedFileInPane(fileId, pane);
        return;
      }

      try {
        const parsed = JSON.parse(partPayload);
        openPartInPane(parsed.fileId, parsed.partId, pane);
      } catch {
        app.logDebug("response", `Drop on ${pane} pane: malformed part payload`);
      }
    });
  }

  function closeSourceTab(fileId) {
    const project = app.controller.getProject();
    const wasActive = project.activeFileId === fileId;
    app.view.closeTab("source", fileId);
    scheduleSaveUserState();

    if (!wasActive) {
      app.updateStatus(project);
      return;
    }

    const fallbackId = app.view.get().sourceOpenTabIds[app.view.get().sourceOpenTabIds.length - 1] ?? null;
    if (fallbackId) {
      app.view.select(fallbackId);
      app.controller.setActiveFile(fallbackId);
      return;
    }

    const nextProject = structuredClone(project);
    nextProject.activeFileId = null;
    app.controller.replaceProject(nextProject);
  }

  function closePreviewTab(fileId) {
    app.view.closeTab("preview", fileId);
    app.updateStatus(app.controller.getProject());
  }

  function reorderPaneTabs(pane, draggedFileId, targetFileId, placeAfter = false) {
    app.view.moveTab(pane, draggedFileId, targetFileId, placeAfter);

    renderTabs(app.controller.getProject());
  }

  // The tab strips scroll instead of squeezing tabs down to unreadable slivers, so
  // a "⋯" button at the end lists EVERY open tab (activate or close from there).
  // renderTabStrip records what it drew here so the menu can rebuild the same list.
  const tabStripState = { source: null, preview: null };

  function tabOverflowButton(pane) {
    return pane === "source" ? app.elements.sourceTabOverflow : app.elements.previewTabOverflow;
  }

  function closeTabOverflowMenu() {
    const menu = app.elements.tabOverflowMenu;
    if (menu) menu.hidden = true;
    for (const pane of ["source", "preview"]) {
      const btn = tabOverflowButton(pane);
      btn?.classList.remove("is-open");
      btn?.setAttribute("aria-expanded", "false");
    }
  }

  // Build the "all open tabs" list for one pane from the last render's descriptor.
  function openTabOverflowMenu(pane) {
    const menu = app.elements.tabOverflowMenu;
    const button = tabOverflowButton(pane);
    const state = tabStripState[pane];
    if (!menu || !button || !state) return;

    const rows = [];
    for (const fileId of state.tabIds) {
      const node = state.project?.nodes?.[fileId];
      if (!node || node.kind !== "file") continue;
      rows.push({
        label: node.name,
        title: getPath(state.project, fileId),
        active: state.activeFileId === fileId,
        activate: () => state.onActivate(fileId),
        close: () => state.onClose(fileId)
      });
    }
    for (const spec of state.extraTabs ?? []) {
      rows.push({
        label: spec.label,
        title: spec.title || spec.label,
        active: state.activeFileId === spec.id,
        activate: () => spec.onActivate(),
        close: () => spec.onClose()
      });
    }
    if (!rows.length) {
      closeTabOverflowMenu();
      return;
    }

    menu.replaceChildren(...rows.map((row) => {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.className = `tab-overflow-row${row.active ? " is-active" : ""}`;
      item.title = row.title;

      const name = document.createElement("span");
      name.className = "tab-overflow-name";
      name.textContent = row.label;

      const close = document.createElement("span");
      close.className = "tab-overflow-close";
      close.textContent = "\u00d7";
      close.setAttribute("aria-hidden", "true");

      item.append(name, close);
      item.addEventListener("click", (event) => {
        if (event.target === close) {
          event.stopPropagation();
          row.close();
          renderTabs(app.controller.getProject());
          openTabOverflowMenu(pane); // keep the list open so several can be closed
          return;
        }
        row.activate();
        closeTabOverflowMenu();
      });
      return item;
    }));

    // Anchor under the button, right-aligned, clamped to the viewport.
    menu.hidden = false;
    const rect = button.getBoundingClientRect();
    const width = menu.offsetWidth || 240;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
  }

  function renderTabStrip({ strip, pane, project, tabIds, activeFileId, emptyText, onActivate, onClose, allowReorder = false, extraTabs = [] }) {
    strip.replaceChildren();

    // Record what we're drawing so the "⋯" overflow menu can list the same tabs,
    // and show that button only when this pane actually has tabs.
    tabStripState[pane] = { project, tabIds, activeFileId, onActivate, onClose, extraTabs };
    const overflowBtn = tabOverflowButton(pane);
    if (overflowBtn) overflowBtn.hidden = (tabIds.length + extraTabs.length) === 0;

    if (tabIds.length === 0 && extraTabs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-tab is-empty";
      empty.textContent = emptyText;
      strip.append(empty);
      return;
    }

    tabIds.forEach((fileId) => {
      const file = project.nodes[fileId];
      if (!file || file.kind !== "file") {
        return;
      }

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `editor-tab${activeFileId === fileId ? " is-active" : ""}`;
      tab.dataset.fileId = fileId;
      tab.title = getPath(project, fileId);
      tab.draggable = allowReorder;

      const icon = document.createElement("span");
      icon.className = "tab-file-icon";
      icon.setAttribute("aria-hidden", "true");

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = file.name;

      const dirty = document.createElement("span");
      dirty.className = `tab-dirty${file.dirty ? " is-dirty" : ""}`;
      dirty.textContent = file.dirty ? "●" : "";

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");

      const filePath = getPath(project, fileId);
      const mark = app.marks.get(filePath);
      if (mark) {
        const badge = document.createElement("span");
        badge.className = `tab-mark-badge is-${mark.kind}`;
        badge.title = mark.title ?? "";
        tab.append(icon, title, badge, dirty, close);
      } else {
        tab.append(icon, title, dirty, close);
      }
      tab.addEventListener("click", () => onActivate(fileId));
      if (allowReorder) {
        tab.addEventListener("dragstart", (event) => {
          app.view.dragTab({ pane, fileId });
          event.dataTransfer?.setData("text/mdnotes-tab", JSON.stringify({ pane, fileId }));
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
        });
        tab.addEventListener("dragend", () => {
          app.view.dragTab(null);
        });
        tab.addEventListener("dragover", (event) => {
          if (app.view.get().draggingTabState?.pane !== pane || app.view.get().draggingTabState.fileId === fileId) {
            return;
          }
          event.preventDefault();
        });
        tab.addEventListener("drop", (event) => {
          if (app.view.get().draggingTabState?.pane !== pane || app.view.get().draggingTabState.fileId === fileId) {
            return;
          }
          event.preventDefault();
          const rect = tab.getBoundingClientRect();
          const placeAfter = event.clientX > rect.left + (rect.width / 2);
          reorderPaneTabs(pane, app.view.get().draggingTabState.fileId, fileId, placeAfter);
        });
      }
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        onClose(fileId);
      });
      strip.append(tab);
    });

    // Special (non-file) tabs — e.g. the preview diff view. Rendered after the file
    // tabs; not draggable/reorderable, but activate + close like any other tab.
    extraTabs.forEach((spec) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `editor-tab${activeFileId === spec.id ? " is-active" : ""}`;
      tab.dataset.tabId = spec.id;
      tab.title = spec.title || spec.label;

      const icon = document.createElement("span");
      icon.className = `tab-file-icon ${spec.iconClass || ""}`.trim();
      icon.setAttribute("aria-hidden", "true");
      if (spec.iconText) icon.textContent = spec.iconText;

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = spec.label;

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");

      tab.append(icon, title, close);
      tab.addEventListener("click", () => spec.onActivate());
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        spec.onClose();
      });
      strip.append(tab);
    });

    // The strip scrolls now, so the active tab can sit off-screen after a switch.
    // Nudge it into view without disturbing any other scroll container.
    const activeTab = strip.querySelector(".editor-tab.is-active");
    if (activeTab) {
      const left = activeTab.offsetLeft;
      const right = left + activeTab.offsetWidth;
      if (left < strip.scrollLeft) {
        strip.scrollLeft = left;
      } else if (right > strip.scrollLeft + strip.clientWidth) {
        strip.scrollLeft = right - strip.clientWidth;
      }
    }
  }

  function renderTabs(project) {
    renderTabStrip({
      strip: app.elements.sourceTabStrip,
      pane: "source",
      project,
      tabIds: app.view.get().sourceOpenTabIds,
      activeFileId: project.activeFileId,
      emptyText: "No source file selected",
      onActivate: setActiveSourceFile,
      onClose: closeSourceTab,
      allowReorder: true
    });

    const previewExtraTabs = app.diffState.active
      ? [{
          id: app.DIFF_TAB_ID,
          label: app.diffState.path.split("/").pop(),
          title: `Diff: ${app.diffState.path} — current vs ${app.formatSnapshotTime(app.diffState.createdAt)}`,
          iconText: "±",
          iconClass: "tab-diff-icon",
          onActivate: () => setPreviewFile(app.DIFF_TAB_ID),
          onClose: app.closeDiff
        }]
      : [];
    renderTabStrip({
      strip: app.elements.previewTabStrip,
      pane: "preview",
      project,
      tabIds: app.view.get().previewOpenTabIds,
      activeFileId: app.view.get().previewFileId,
      emptyText: "No preview file selected",
      onActivate: setPreviewFile,
      onClose: closePreviewTab,
      allowReorder: true,
      extraTabs: previewExtraTabs
    });
  }

  function bindTabStripReorderTarget(strip, pane) {
    strip.addEventListener("dragover", (event) => {
      if (app.view.get().draggingTabState?.pane !== pane) {
        return;
      }
      event.preventDefault();
    });

    strip.addEventListener("drop", (event) => {
      if (app.view.get().draggingTabState?.pane !== pane) {
        return;
      }
      const targetTab = event.target.closest(".editor-tab[data-file-id]");
      if (targetTab) {
        return;
      }

      event.preventDefault();
      app.view.moveTab(pane, app.view.get().draggingTabState.fileId, null);
      renderTabs(app.controller.getProject());
    });
  }

  return { ensureOpenTabs, openSourceTab, openPreviewTab, setActiveSourceFile, currentWorkspaceView, cacheWorkspaceView, cachedWorkspaceView, showResumedFile, scheduleSaveUserState, restoreResumeState, setActiveSourcePart, setPreviewFile, openFileFromExplorer, canOpenFileInPane, setPaneDropActive, clearPaneDropState, openDroppedFileInPane, openPartInPane, bindPaneDropTarget, closeSourceTab, closePreviewTab, reorderPaneTabs, tabOverflowButton, closeTabOverflowMenu, openTabOverflowMenu, renderTabStrip, renderTabs, bindTabStripReorderTarget };
}
