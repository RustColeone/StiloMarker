// Tabs and panes: the source and preview tab strips (overflow menu, reorder,
// drag files in), which file each pane shows, resuming the last view, and
// the preview itself (Markdown, images, URL albums, diagrams, PDF printing).
// main.js creates this on first use and passes its shared values in `app`.
import { getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isMarkdownFileName, isMtreeFileName, isPersonaFileName, isUrlDbFileName } from "../domain/project-model.js";
import { renderMarkdown } from "../modules/editor/index.js";
import { authorNotesHtml, parsePersona, personaAvatarHtml } from "../modules/characters/index.js";
import { normalizeServerUrl, saveUserState } from "../services/sync-service.js";

export function createPanes(app) {
  function hasMathMarkup(value) {
    return /\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|\$(?!\s)[^$\n]+\$/.test(value);
  }

  function ensureMathJax() {
    if (globalThis.MathJax?.typesetPromise) {
      return Promise.resolve(globalThis.MathJax);
    }

    if (app.mathJaxLoadPromise) {
      return app.mathJaxLoadPromise;
    }

    globalThis.MathJax = globalThis.MathJax ?? {
      tex: {
        inlineMath: [["$", "$"], ["\\(", "\\)"]],
        displayMath: [["$$", "$$"], ["\\[", "\\]"]]
      },
      svg: { fontCache: "global" },
      startup: { typeset: false }
    };

    app.mathJaxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js";
      script.async = true;
      script.onload = () => resolve(globalThis.MathJax);
      script.onerror = () => reject(new Error("MathJax failed to load."));
      document.head.append(script);
    });

    return app.mathJaxLoadPromise;
  }

  async function typesetPreview(content, target = app.elements.preview) {
    if (!hasMathMarkup(content)) {
      return;
    }

    try {
      const mathJax = await ensureMathJax();
      if (mathJax?.typesetClear) {
        mathJax.typesetClear([target]);
      }
      if (mathJax?.typesetPromise) {
        await mathJax.typesetPromise([target]);
      }
    } catch {
      // Preview still works without MathJax when offline or blocked.
    }
  }

  function ensureOpenTabs(project) {
    app.sourceOpenTabIds = app.sourceOpenTabIds.filter((fileId) => {
      const node = project.nodes[fileId];
      return node?.kind === "file";
    });

    app.previewOpenTabIds = app.previewOpenTabIds.filter((fileId) => {
      const node = project.nodes[fileId];
      return node?.kind === "file";
    });

    if (project.activeFileId && !app.sourceOpenTabIds.includes(project.activeFileId)) {
      app.sourceOpenTabIds.push(project.activeFileId);
    }

    if (!project.activeFileId && app.sourceOpenTabIds.length > 0) {
      app.sourceOpenTabIds = [];
    }

    // The diff tab is a valid preview target but not a project file — leave it be.
    if (app.previewFileId === app.DIFF_TAB_ID) {
      if (!app.diffState.active) {
        app.previewFileId = app.previewOpenTabIds[app.previewOpenTabIds.length - 1] ?? null;
      }
    } else if (app.previewFileId) {
      const previewNode = project.nodes[app.previewFileId];
      if (previewNode?.kind !== "file") {
        app.previewFileId = null;
      }
    }

    if (app.previewFileId && app.previewFileId !== app.DIFF_TAB_ID && !app.previewOpenTabIds.includes(app.previewFileId)) {
      app.previewOpenTabIds.push(app.previewFileId);
    }

    if (!app.previewFileId && app.previewOpenTabIds.length > 0) {
      app.previewFileId = app.previewOpenTabIds[app.previewOpenTabIds.length - 1] ?? null;
    }
  }

  function openSourceTab(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }

    if (!app.sourceOpenTabIds.includes(fileId)) {
      app.sourceOpenTabIds.push(fileId);
    }
  }

  function openPreviewTab(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }

    if (!app.previewOpenTabIds.includes(fileId)) {
      app.previewOpenTabIds.push(fileId);
    }
  }

  function setActiveSourceFile(fileId) {
    app.captureViewState(); // resume-position: snapshot the outgoing document first
    app.selectionNodeId = fileId;
    app.sourceUrlDbEntry = null;
    openSourceTab(fileId);
    app.controller.setActiveFile(fileId);
    scheduleSaveUserState();
  }

  // ---- Per-user resume: persist which files are open in a cloud workspace so
  // they can be restored on the next open/reconnect. Server-side, per account.
  function currentWorkspaceView() {
    const project = app.controller.getProject();
    const pathFor = id => project.nodes[id]?.kind === "file" ? getPath(project, id) : null;
    return { openFiles: app.sourceOpenTabIds.map(pathFor).filter(Boolean), activeFile: pathFor(project.activeFileId) };
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
      const openFiles = app.sourceOpenTabIds
        .map((id) => (project.nodes[id]?.kind === "file" ? getPath(project, id) : null))
        .filter(Boolean);
      const activeId = project.activeFileId;
      const activeFile = activeId && project.nodes[activeId]?.kind === "file"
        ? getPath(project, activeId)
        : null;
      saveUserState(app.settings.serverUrl, app.identity.token(), ws.team, ws.path, openFiles, activeFile)
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

  function setActiveSourceUrlDbEntry(fileId, entryId) {
    app.selectionNodeId = fileId;
    app.sourceUrlDbEntry = { fileId, entryId };
    openSourceTab(fileId);
    app.controller.setActiveFile(fileId);
  }

  function setPreviewFile(fileId) {
    const project = app.controller.getProject();
    if (fileId === app.DIFF_TAB_ID) {
      if (!app.diffState.active) return;
      app.captureViewState();
      app.previewFileId = app.DIFF_TAB_ID;
      app.updateStatus(project);
      return;
    }
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }
    app.captureViewState(); // resume-position: snapshot the outgoing preview first
    openPreviewTab(fileId);
    app.previewFileId = fileId;
    app.previewUrlDbEntry = null;
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
    } else if (app.previewFileId === null && app.isPreviewableFileName(node.name)) {
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

  function openUrlDbEntryInPane(fileId, entryId, pane) {
    const project = app.controller.getProject();
    const file = project.nodes[fileId];
    if (!file || file.kind !== "file" || !isUrlDbFileName(file.name)) {
      return;
    }

    if (pane === "preview") {
      openPreviewTab(fileId);
      app.previewFileId = fileId;
      app.previewUrlDbEntry = entryId;
      app.updateStatus(project);
      return;
    }

    setActiveSourceUrlDbEntry(fileId, entryId);
    app.logDebug("action", "Bookmark entry dropped into source pane", `${getPath(project, fileId)} :: ${entryId}`);
  }

  function bindPaneDropTarget(target, pane) {
    // dragover: getData() is blocked by spec during dragover for security — use types instead.
    target.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types ?? [];
      const hasFile = types.includes("text/mdnotes-file-id");
      const hasEntry = types.includes("text/mdnotes-urldb-entry");
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
      const urlDbPayload = event.dataTransfer?.getData("text/mdnotes-urldb-entry");
      app.logDebug("action", `Drop on ${pane} pane`, fileId ? `file=${fileId}` : `entry=${urlDbPayload}`);
      if ((!fileId || !canOpenFileInPane(fileId, pane)) && !urlDbPayload) {
        app.logDebug("response", `Drop on ${pane} pane rejected`, fileId ? `canOpen=${canOpenFileInPane(fileId, pane)}` : "no payload");
        return;
      }
      event.preventDefault();
      if (fileId && canOpenFileInPane(fileId, pane)) {
        openDroppedFileInPane(fileId, pane);
        return;
      }

      try {
        const parsed = JSON.parse(urlDbPayload);
        openUrlDbEntryInPane(parsed.fileId, parsed.entryId, pane);
      } catch {
        app.logDebug("response", `Drop on ${pane} pane: malformed urldb payload`);
      }
    });
  }

  function closeSourceTab(fileId) {
    const project = app.controller.getProject();
    const wasActive = project.activeFileId === fileId;
    app.sourceOpenTabIds = app.sourceOpenTabIds.filter((tabId) => tabId !== fileId);
    scheduleSaveUserState();

    if (!wasActive) {
      app.updateStatus(project);
      return;
    }

    const fallbackId = app.sourceOpenTabIds[app.sourceOpenTabIds.length - 1] ?? null;
    if (fallbackId) {
      app.selectionNodeId = fallbackId;
      app.controller.setActiveFile(fallbackId);
      return;
    }

    const nextProject = structuredClone(project);
    nextProject.activeFileId = null;
    app.controller.replaceProject(nextProject);
  }

  function closePreviewTab(fileId) {
    app.previewOpenTabIds = app.previewOpenTabIds.filter((tabId) => tabId !== fileId);
    if (app.previewFileId === fileId) {
      app.previewFileId = app.previewOpenTabIds[app.previewOpenTabIds.length - 1] ?? null;
    }
    app.updateStatus(app.controller.getProject());
  }

  function moveTabWithinList(tabIds, draggedFileId, targetFileId, placeAfter = false) {
    const next = tabIds.filter((tabId) => tabId !== draggedFileId);
    const targetIndex = next.indexOf(targetFileId);
    if (targetIndex < 0) {
      next.push(draggedFileId);
      return next;
    }

    next.splice(targetIndex + (placeAfter ? 1 : 0), 0, draggedFileId);
    return next;
  }

  function reorderPaneTabs(pane, draggedFileId, targetFileId, placeAfter = false) {
    if (pane === "source") {
      app.sourceOpenTabIds = moveTabWithinList(app.sourceOpenTabIds, draggedFileId, targetFileId, placeAfter);
    } else {
      app.previewOpenTabIds = moveTabWithinList(app.previewOpenTabIds, draggedFileId, targetFileId, placeAfter);
    }

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
      if (app.agentPendingDecorations.has(filePath)) {
        const badge = document.createElement("span");
        badge.className = "tab-agent-badge";
        badge.title = "Pending agent edit — review in chat";
        tab.append(icon, title, badge, dirty, close);
      } else {
        tab.append(icon, title, dirty, close);
      }
      tab.addEventListener("click", () => onActivate(fileId));
      if (allowReorder) {
        tab.addEventListener("dragstart", (event) => {
          app.draggingTabState = { pane, fileId };
          event.dataTransfer?.setData("text/mdnotes-tab", JSON.stringify(app.draggingTabState));
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
        });
        tab.addEventListener("dragend", () => {
          app.draggingTabState = null;
        });
        tab.addEventListener("dragover", (event) => {
          if (app.draggingTabState?.pane !== pane || app.draggingTabState.fileId === fileId) {
            return;
          }
          event.preventDefault();
        });
        tab.addEventListener("drop", (event) => {
          if (app.draggingTabState?.pane !== pane || app.draggingTabState.fileId === fileId) {
            return;
          }
          event.preventDefault();
          const rect = tab.getBoundingClientRect();
          const placeAfter = event.clientX > rect.left + (rect.width / 2);
          reorderPaneTabs(pane, app.draggingTabState.fileId, fileId, placeAfter);
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
      tabIds: app.sourceOpenTabIds,
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
      tabIds: app.previewOpenTabIds,
      activeFileId: app.previewFileId,
      emptyText: "No preview file selected",
      onActivate: setPreviewFile,
      onClose: closePreviewTab,
      allowReorder: true,
      extraTabs: previewExtraTabs
    });
  }

  function bindTabStripReorderTarget(strip, pane) {
    strip.addEventListener("dragover", (event) => {
      if (app.draggingTabState?.pane !== pane) {
        return;
      }
      event.preventDefault();
    });

    strip.addEventListener("drop", (event) => {
      if (app.draggingTabState?.pane !== pane) {
        return;
      }
      const targetTab = event.target.closest(".editor-tab[data-file-id]");
      if (targetTab) {
        return;
      }

      event.preventDefault();
      const targetList = pane === "source" ? app.sourceOpenTabIds : app.previewOpenTabIds;
      const draggedId = app.draggingTabState.fileId;
      const next = targetList.filter((tabId) => tabId !== draggedId);
      next.push(draggedId);
      if (pane === "source") {
        app.sourceOpenTabIds = next;
      } else {
        app.previewOpenTabIds = next;
      }
      renderTabs(app.controller.getProject());
    });
  }

  function renderUrlDbTable(target, file) {
    const entries = app.getUrlDbEntries(file.content);
    const frame = document.createElement("div");
    frame.className = "urldb-preview";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-readonly-note";
      empty.textContent = "No valid bookmark entries yet. Add sections like [Name] and url = https://...";
      frame.append(empty);
      target.append(frame);
      return { shouldTypeset: false, content: "" };
    }

    const table = document.createElement("table");
    table.className = "urldb-table";
    table.innerHTML = "<thead><tr><th>Preview</th><th>Name</th><th>URL</th><th>Description</th></tr></thead>";
    const body = document.createElement("tbody");

    entries.forEach((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td><img src="${app.escapeHtmlAttribute(entry.url)}" alt="${app.escapeHtmlAttribute(entry.name)}"></td><td>${app.escapeEditorHtml(entry.name)}</td><td><a href="${app.escapeHtmlAttribute(entry.url)}" target="_blank" rel="noreferrer">${app.escapeEditorHtml(entry.url)}</a></td><td>${app.escapeEditorHtml(entry.description || "")}</td>`;
      body.append(row);
    });

    table.append(body);
    frame.append(table);
    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  function renderUrlDbEntryPreview(target, file, entryId) {
    const entry = app.getUrlDbEntryById(file.content, entryId);
    if (!entry) {
      app.previewUrlDbEntry = null;
      return renderUrlDbTable(target, file);
    }

    const frame = document.createElement("div");
    frame.className = "asset-preview remote-asset-preview";

    const image = document.createElement("img");
    image.src = entry.url;
    image.alt = entry.name;
    frame.append(image);

    const meta = document.createElement("div");
    meta.className = "remote-asset-meta";
    meta.innerHTML = `<strong>${app.escapeEditorHtml(entry.name)}</strong><span>${app.escapeEditorHtml(entry.description || entry.url)}</span>`;
    frame.append(meta);

    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  // Inputs of the last markdown/mtree preview render. Those previews are pure
  // functions of the file's text, the project's paths (link resolution) and the
  // connection (asset URLs) — so when none of that changed, the DOM already shows
  // the right thing. Every app render used to rebuild it regardless: a 90k-char
  // chapter is ~11k nodes, rebuilt and re-laid-out for a presence ping, a
  // collaborator's keystroke, or typing in a DIFFERENT file than the one previewed.
  // Any other kind of preview clears the key, so returning to a file re-renders.
  let previewRenderKey = null;

  function previewRenderKeyFor(project, file) {
    const structure = Object.values(project.nodes)
      .map((node) => `${node.id}/${node.parentId ?? ""}/${node.name}`)
      .join("|");
    const token = app.workspaceMode === "synced" ? (app.collaboration.getConnectionInfo?.()?.token ?? "") : "";
    return `${file.id}\u0000${file.name}\u0000${app.workspaceMode}\u0000${token}\u0000${structure}\u0000${file.content}`;
  }

  function renderPreviewContent(target, project, file) {
    const pureTextPreview = file && !isImageFileName(file.name) && !isUrlDbFileName(file.name)
      && !isBmapFileName(file.name);
    const key = pureTextPreview ? previewRenderKeyFor(project, file) : null;
    if (key !== null && key === previewRenderKey && target.childNodes.length > 0) {
      return { shouldTypeset: false, content: "" };
    }
    previewRenderKey = key;
    target.replaceChildren();

    if (!file) {
      return { shouldTypeset: false, content: "" };
    }

    if (isImageFileName(file.name)) {
      const frame = document.createElement("div");
      frame.className = "asset-preview";
      const image = document.createElement("img");
      image.src = app.imageSrcFor(project, file);
      image.alt = file.name;
      frame.append(image);
      target.append(frame);
      return { shouldTypeset: false, content: "" };
    }

    if (isUrlDbFileName(file.name)) {
      if (app.previewUrlDbEntry && app.previewFileId === file.id) {
        return renderUrlDbEntryPreview(target, file, app.previewUrlDbEntry);
      }
      return renderUrlDbTable(target, file);
    }

    if (isMtreeFileName(file.name)) {
      target.innerHTML = `<pre><code>${app.escapeEditorHtml(file.content)}</code></pre>`;
      return { shouldTypeset: false, content: "" };
    }

    if (isBmapFileName(file.name)) {
      if (!app.bmapViewModule) {
        target.innerHTML = `<div class="preview-loading">Loading diagram…</div>`;
        app.loadBmapView().then(() => {
          if (app.previewFileId === file.id) app.render(app.controller.getProject());
        }).catch((error) => {
          if (app.previewFileId !== file.id) return;
          target.innerHTML = `<div class="preview-loading">The diagram editor could not load. Check your connection, then reopen the file.</div>`;
          app.logDebug("error", "Diagram editor failed to load", error.message);
        });
        return { shouldTypeset: false, content: "" };
      }
      if (!app.previewBmapView) {
        app.previewBmapView = app.bmapViewModule.createBmapView({ container: target });
      }
      const basePath = getPath(project, file.id);
      app.previewBmapView.render({
        documentKey: file.id,
        source: file.content,
        initialView: app.getViewState(file.id)?.bmap ?? null,
        onOpenLinkedFile(filePath) {
          const baseSegments = basePath.split("/").filter(Boolean);
          baseSegments.pop();
          const resolvedPath = app.normalizePath([...baseSegments, filePath].join("/"));
          const nodeId = getNodeIdByPath(project, resolvedPath);
          if (nodeId) {
            openFileFromExplorer(nodeId);
          }
        },
        resolveFileContent(filePath) {
          const baseSegments = basePath.split("/").filter(Boolean);
          baseSegments.pop();
          const resolvedPath = app.normalizePath([...baseSegments, filePath].join("/"));
          const nodeId = getNodeIdByPath(project, resolvedPath);
          if (!nodeId) {
            return null;
          }
          const node = project.nodes[nodeId];
          return node?.kind === "file" ? (node.content ?? null) : null;
        },
        listProjectFiles() {
          return Object.values(project.nodes)
            .filter((node) => node?.kind === "file" && node.id !== file.id)
            .map((node) => {
              const path = getPath(project, node.id);
              return {
                fileId: node.id,
                kind: isImageFileName(node.name) ? "image" : "file",
                label: path,
                path: app.getRelativeProjectPath(basePath, path)
              };
            })
            .sort((left, right) => left.label.localeCompare(right.label));
        },
        resolveRelativeFilePath(targetFileId) {
          const targetNode = project.nodes[targetFileId];
          if (!targetNode || targetNode.kind !== "file" || targetNode.id === file.id) {
            return null;
          }
          return app.getRelativeProjectPath(basePath, getPath(project, targetNode.id));
        },
        onCommit(nextSource, detail) {
          app.updateFileContentFromPreview(file.id, nextSource, detail?.reason ?? "bmap preview edit");
        },
        generateScope: app.settings.bmapGenerateScope,
        autoPan: app.settings.bmapAutoPan,
        onQuickGenerate(request) {
          return app.quickGenerateBmapFile(file.id, request);
        },
        logDebug: app.logDebug,
      });
      return { shouldTypeset: false, content: "" };
    }

    // A character sheet previews as a card (avatar, name, @handle) over its body,
    // instead of showing the raw header lines as text.
    const persona = isPersonaFileName(file.name) ? parsePersona(file.content, getPath(project, file.id)) : null;
    const personaCard = persona
      ? `<div class="persona-card" style="--persona-color:${app.escapeHtmlAttribute(persona.color)}">
          ${personaAvatarHtml(persona, app.personaAvatarSrc(project, file.id, persona.avatar), "persona-avatar persona-card-avatar")}
          <div class="persona-card-text"><div class="persona-card-name">${app.escapeHtmlAttribute(persona.name)}</div>
            <div class="persona-card-meta">@${app.escapeHtmlAttribute(persona.handle)} · Character for Chats</div></div>
        </div>`
      : "";
    target.innerHTML = personaCard + authorNotesHtml(persona) + renderMarkdown(persona ? persona.sheet : file.content, {
      resolveUrl(url) {
        return app.resolveProjectAssetUrl(project, file.id, url);
      },
      resolveLink(token) {
        const url = token.href;
        if (token.type === "image") {
          return app.resolveProjectAssetUrl(project, file.id, url);
        }
        if (/^(https?:\/\/|mailto:|data:|blob:)/i.test(url)) {
          return { href: url, external: true };
        }
        if (url.startsWith("#")) {
          return { href: url, external: false };
        }
        const basePath = getPath(project, file.id);
        const baseSegments = basePath.split("/").filter(Boolean);
        baseSegments.pop();
        const resolvedPath = app.normalizePath([...baseSegments, url].join("/"));
        const nodeId = getNodeIdByPath(project, resolvedPath);
        if (nodeId) {
          return { href: "#", external: false, attributes: { "data-open-file-id": nodeId } };
        }
        return { href: "#", external: false, attributes: { "data-unresolved-link": url } };
      }
    });

    return { shouldTypeset: true, content: file.content };
  }

  function printPreviewAsPdf() {
    const project = app.controller.getProject();
    const previewFile = app.previewFileId ? project.nodes[app.previewFileId] : null;
    if (!previewFile) {
      app.notify("Open a markdown or image file before exporting PDF.");
      return;
    }

    const printFrame = document.createElement("iframe");
    printFrame.setAttribute("aria-hidden", "true");
    printFrame.style.position = "fixed";
    printFrame.style.right = "0";
    printFrame.style.bottom = "0";
    printFrame.style.width = "0";
    printFrame.style.height = "0";
    printFrame.style.border = "0";
    printFrame.style.opacity = "0";
    printFrame.style.pointerEvents = "none";
    document.body.append(printFrame);

    const printWindow = printFrame.contentWindow;
    if (!printWindow) {
      printFrame.remove();
      app.notify("Unable to prepare PDF export in this browser.");
      return;
    }

    const previewHtml = isImageFileName(previewFile.name)
      ? `<div class="asset-preview"><img src="${app.escapeHtmlAttribute(previewFile.content)}" alt="${app.escapeHtmlAttribute(previewFile.name)}"></div>`
      : isUrlDbFileName(previewFile.name)
        ? app.elements.preview.innerHTML
      : isMtreeFileName(previewFile.name)
        ? `<pre><code>${app.escapeEditorHtml(previewFile.content)}</code></pre>`
      : renderMarkdown(previewFile.content, {
        resolveUrl(url) {
          return app.resolveProjectAssetUrl(project, previewFile.id, url);
        }
      });
    const title = previewFile.name.replace(/\.md$/i, "") || "MDNotes";
    const includeMath = isMarkdownFileName(previewFile.name) && hasMathMarkup(previewFile.content);

    const cleanupPrintFrame = () => {
      globalThis.setTimeout(() => {
        printFrame.remove();
      }, 250);
    };

    printWindow.document.write(`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <title>${title}</title>
      <style>
        body { font-family: "Segoe UI", sans-serif; margin: 32px; color: #1f1f1f; line-height: 1.6; }
        pre, code { font-family: "Cascadia Code", Consolas, monospace; }
        pre { padding: 12px; background: #f5f5f5; border: 1px solid #ddd; overflow: auto; }
        code { background: #f5f5f5; padding: 1px 4px; }
        blockquote { margin: 0; padding-left: 12px; border-left: 3px solid #0e639c; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 6px 8px; border: 1px solid #ddd; }
        img { display: block; max-width: 100%; height: auto; }
        mjx-container { break-inside: avoid; page-break-inside: avoid; }
        mjx-container[jax="SVG"] { overflow: visible; }
        mjx-container[jax="SVG"] > svg { max-width: 100%; }
        @page { size: A4; margin: 14mm; }
      </style>
      ${includeMath ? '<script>window.MathJax={tex:{inlineMath:[["$","$"],["\\(","\\)"]],displayMath:[["$$","$$"],["\\[","\\]"]]},svg:{fontCache:"global"},startup:{typeset:false}};<\/script><script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"><\/script>' : ""}
    </head>
    <body>
      <main id="print-root">${previewHtml}</main>
    </body>
  </html>`);
    printWindow.document.close();

    const finalizePrint = () => {
      printWindow.addEventListener("afterprint", cleanupPrintFrame, { once: true });
      printWindow.focus();
      printWindow.print();
      globalThis.setTimeout(cleanupPrintFrame, 1500);
    };

    if (includeMath) {
      const waitForMath = () => {
        if (printWindow.MathJax?.typesetPromise) {
          printWindow.MathJax.typesetPromise([printWindow.document.getElementById("print-root")]).finally(finalizePrint);
          return;
        }
        printWindow.setTimeout(waitForMath, 120);
      };
      printWindow.setTimeout(waitForMath, 120);
      return;
    }

    printWindow.setTimeout(finalizePrint, 80);
  }

  return {
    bindPaneDropTarget, bindTabStripReorderTarget, cacheWorkspaceView, cachedWorkspaceView,
    clearPaneDropState, closeTabOverflowMenu, currentWorkspaceView, ensureOpenTabs,
    openDroppedFileInPane, openFileFromExplorer, openPreviewTab, openSourceTab,
    openTabOverflowMenu, printPreviewAsPdf, renderPreviewContent, renderTabs, restoreResumeState,
    setActiveSourceFile, setActiveSourceUrlDbEntry, setPreviewFile, showResumedFile,
    tabOverflowButton, typesetPreview
  };
}
