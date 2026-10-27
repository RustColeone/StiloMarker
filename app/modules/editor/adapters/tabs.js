// Tabs and groups: each group's tab strip (a tab is a file in a view; overflow
// menu, reorder, drag files in, drag tabs to the other group), a tab coming on
// screen in its group (a source tab in that group's editor, a preview tab in
// the preview, which moves there: groups.js draws that),
// groups closing with their last tab, and resuming the last view
// (the open tabs per workspace, kept on the server through app.saveUserState).
// What the groups show is the Editor's view (app.view, service/view.js).
import { normalizeServerUrl } from "../../shell/index.js";
import { getPath } from "../../workspace/index.js";
import { builtinTypes } from "../../file-types/index.js";
import { filesIn, groupsFromSaved, sameTab, savedGroups } from "../service/view.js";

export function createTabs(app) {

  function ensureOpenTabs(project) {
    const views = app.paneViews.all();
    app.view.keepTabs(project, { views: views.map((view) => view.id), open: views.filter((view) => view.tab()).map((view) => view.id) });
    app.handOnWhenGone(project); // the active file gone: handed to the other editor (editors.js)
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

  // A tab in a group comes on screen (its click, Show here, Open as). A source
  // tab's group's editor becomes the active one, its file the project's active
  // file (the whole file: a part shown there before is left); a preview tab's
  // file is what the preview shows (its body moves to that group); a pane view
  // (History's diff) stays in the group holding the preview.
  function activateTab(group, tab) {
    const project = app.controller.getProject();
    const paneView = tab.view === "preview" ? app.paneViews.get(tab.fileId) : null;
    if (paneView) {
      if (!paneView.tab()) return;
      app.captureViewState();
      app.view.showView(tab.fileId);
      app.updateStatus(project);
      return;
    }
    if (project.nodes[tab.fileId]?.kind !== "file") return;
    tabsWorkedIn = true;
    app.captureViewState(); // resume-position: snapshot the outgoing document first
    app.view.activate(group, { fileId: tab.fileId, view: tab.view });
    if (tab.view === "source") app.view.pick(tab.fileId);
    // Drawn again: by the project changing, or here when only the view did.
    if (tab.view === "source" && project.activeFileId !== tab.fileId) app.controller.setActiveFile(tab.fileId);
    else app.updateStatus(project);
    scheduleSaveUserState();
  }

  // The pane label's Source / Preview: the group's tab changes its view where
  // it is (no second tab), then comes on screen as activateTab does.
  function switchTabView(group, tab, view) {
    const project = app.controller.getProject();
    if (project.nodes[tab.fileId]?.kind !== "file" || tab.view === view) return;
    tabsWorkedIn = true;
    app.captureViewState();
    // The active editor always shows the project's active file, with a source
    // tab for it in its group: its shown source tab turned Preview hands the
    // active file on, as closing that tab would (handOn, editors.js).
    const handsOn = view === "preview" && project.activeFileId === tab.fileId && app.view.get().hosts.source === group;
    app.view.switchView(group, { fileId: tab.fileId, view: tab.view }, view);
    if (view === "source") app.view.pick(tab.fileId);
    scheduleSaveUserState();
    if (view === "source" && project.activeFileId !== tab.fileId) {
      app.controller.setActiveFile(tab.fileId);
    } else if (handsOn) {
      app.handOn(group, project, { show: false }); // the tab stays on screen, as Preview
    } else {
      app.updateStatus(project);
    }
  }

  function setActiveSourceFile(fileId) {
    activateTab(app.view.get().hosts.source, { fileId, view: "source" });
  }

  // ---- Per-user resume: persist which files are open in a cloud workspace so
  // they can be restored on the next open/reconnect. Server-side, per account:
  // the source tabs and the active file (as before groups), and the groups.
  function currentWorkspaceView() {
    const project = app.controller.getProject();
    const pathFor = id => project.nodes[id]?.kind === "file" ? getPath(project, id) : null;
    return { openFiles: filesIn(app.view.get(), "source").map(pathFor).filter(Boolean), activeFile: pathFor(project.activeFileId),
      groups: savedGroups(app.view.get(), pathFor) };
  }
  function cacheWorkspaceView() {
    try {
      if (app.workspaceMode !== "synced") {
        const project = app.controller.getProject();
        if (project?.id) localStorage.setItem(OWN_VIEW, JSON.stringify({ project: project.id, ...currentWorkspaceView() }));
        return;
      }
      if (!app.settings.syncedProjectId) return;
      localStorage.setItem("mdnotes.workspaceView.v1", JSON.stringify({
        server: normalizeServerUrl(app.settings.serverUrl), workspace: app.settings.syncedProjectId,
        ...currentWorkspaceView()
      }));
    } catch (error) { app.logDebug("response", "Resume cache failed", error.message); }
  }
  // The browser's own workspace keeps its tabs in this browser too (O12): one
  // project's, the last worked in, by its id. Read as the page starts, before
  // its first tabs are kept over them; brought back once the app has started
  // (restoreOwnView, from the Editor's start) if the page opened that project.
  const OWN_VIEW = "mdnotes.ownView.v1";
  let ownViewAtStart = null;
  try { ownViewAtStart = JSON.parse(localStorage.getItem(OWN_VIEW)); } catch (error) { app.logDebug("response", "Kept tabs unreadable", error.message); }
  function restoreOwnView(projectId) {
    const saved = ownViewAtStart;
    ownViewAtStart = null;
    if (!saved || !projectId || saved.project !== projectId || app.workspaceMode === "synced") return false;
    if (app.controller.getProject()?.id !== projectId) return false;
    restoreResumeState(saved);
    return true;
  }
  function cachedWorkspaceView(workspace) {
    try {
      const saved = JSON.parse(localStorage.getItem("mdnotes.workspaceView.v1"));
      return saved?.server === normalizeServerUrl(app.settings.serverUrl) && saved.workspace === workspace ? saved : null;
    } catch { return null; }
  }
  // Whether this page's tabs are the user's (worked in, or restored), not
  // only the project's active file the page started with.
  let tabsWorkedIn = false;
  // The tabs to bring back when this workspace opens again: this page's once
  // worked in; else those this browser kept from its last visit; else this
  // page's (the Cloud asks, before the server's own resume).
  function resumeView(workspace) {
    const current = currentWorkspaceView();
    if (tabsWorkedIn && current.activeFile) return current;
    return cachedWorkspaceView(workspace) ?? (current.activeFile ? current : null);
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
      const { openFiles, activeFile, groups } = currentWorkspaceView();
      app.saveUserState(ws, openFiles, activeFile, groups)
        .catch((error) => app.logDebug("response", "Save resume state failed", error.message));
    }, 1200);
  }

  // Restore the tabs the user had open here last time (from the open response's
  // `resume`). Paths are resolved back to node ids in the freshly-pulled project.
  // Kept groups come back as they were; a resume from before groups opens its
  // files as source tabs.
  function restoreResumeState(resume) {
    if (!resume || (!resume.openFiles?.length && !resume.activeFile && !resume.groups?.length)) return;
    const project = app.controller.getProject();
    const pathToId = new Map();
    for (const node of Object.values(project.nodes)) {
      if (node.kind === "file") pathToId.set(getPath(project, node.id), node.id);
    }
    const restored = groupsFromSaved(resume.groups, (path) => pathToId.get(path) ?? null, resume.activeFile ? pathToId.get(resume.activeFile) ?? null : null);
    if (restored.groups.some((group) => group.tabs.length)) {
      tabsWorkedIn = true;
      app.view.restore(restored);
      // The active editor shows the active file (else the source tab its group shows, else the first).
      const shown = restored.groups.find((group) => group.id === restored.hosts.source)?.active;
      const activeId = (resume.activeFile ? pathToId.get(resume.activeFile) : null)
        ?? (shown?.view === "source" ? shown.fileId : null) ?? filesIn(app.view.get(), "source")[0] ?? null;
      if (activeId) {
        app.view.pick(activeId);
        app.controller.setActiveFile(activeId);
      }
      app.render(app.controller.getProject());
      app.logDebug("action", "Restored resume state", `${restored.groups.reduce((n, group) => n + group.tabs.length, 0)} tab(s) in groups`);
      return;
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

  // One part of a file in a group's editor (the active one's unless given),
  // which becomes the active one.
  function setActiveSourcePart(fileId, partId, group = app.view.get().hosts.source) {
    if (group !== app.view.get().hosts.source) app.view.activate(group, { fileId, view: "source" });
    app.view.pick(fileId, partId);
    openSourceTab(fileId);
    app.view.showSource(fileId);
    app.controller.setActiveFile(fileId);
  }

  function setPreviewFile(fileId) {
    activateTab(app.view.get().hosts.preview, { fileId, view: "preview" });
  }

  function openFileFromExplorer(fileId) {
    const project = app.controller.getProject();
    const node = project.nodes[fileId];
    if (!node || node.kind !== "file") {
      return;
    }
    app.logDebug("action", "File opened", getPath(project, fileId));
    // On the phone the file shows in the view on screen: in Preview its preview,
    // else Source (switched to first, so the file on screen does not follow over).
    const phonePane = app.phonePane();
    if (phonePane && phonePane !== "source" && !(phonePane === "preview" && app.isPreviewableFileName(node.name))) app.showPhonePane("source");
    setActiveSourceFile(fileId);
    // On mobile the explorer is a flyout overlay — close it so the opened file
    // is visible without an extra tap.
    app.setMobileExplorerOpen(false);
    // A file whose preview is how it is used (a diagram's editor) shows there too.
    if (app.previews.all().some((preview) => preview.showOnOpen && preview.matches(node))) {
      setPreviewFile(fileId);
      if (app.settings.preview === "hidden") {
        app.togglePreview();
      }
    } else if (app.view.get().previewFileId === null && app.isPreviewableFileName(node.name)) {
      setPreviewFile(fileId);
    }
    if (phonePane === "preview" && app.isPreviewableFileName(node.name)) setPreviewFile(fileId);
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

  // A group's element, and the view a file dropped on it opens in: the view
  // its active tab shows, else the body it holds, else its default.
  const groupElement = (group) => document.querySelector(`.editor-group[data-group="${group}"]`);
  function dropViewOf(group) {
    const state = app.view.get();
    const active = state.groups.find((g) => g.id === group)?.active;
    if (active) return active.view;
    if (state.hosts.source === group) return "source";
    if (state.hosts.preview === group) return "preview";
    return group === "left" ? "source" : "preview";
  }

  function setPaneDropActive(group, isActive) {
    groupElement(group)?.classList.toggle("is-drop-active", isActive);
  }

  function clearPaneDropState() {
    for (const element of document.querySelectorAll(".editor-group.is-drop-active")) element.classList.remove("is-drop-active");
  }

  // A file dropped (or dragged into the editor): shown in that view, in the
  // group given or the one holding that view's body.
  function openDroppedFileInPane(fileId, view, group = app.view.get().hosts[view]) {
    if (!canOpenFileInPane(fileId, view)) {
      return;
    }
    activateTab(group, { fileId, view });
    app.logDebug("action", `File dropped into ${view}`, getPath(app.controller.getProject(), fileId));
  }

  function openPartInPane(fileId, partId, pane, group = app.view.get().hosts[pane]) {
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

    setActiveSourcePart(fileId, partId, group);
    app.logDebug("action", "Part dropped into source pane", `${getPath(project, fileId)} :: ${partId}`);
  }

  function bindPaneDropTarget(target, group) {
    // dragover: getData() is blocked by spec during dragover for security — use types instead.
    target.addEventListener("dragover", (event) => {
      const types = event.dataTransfer?.types ?? [];
      const hasFile = types.includes("text/mdnotes-file-id");
      const hasEntry = types.includes("text/stilo-file-part");
      if (!hasFile && !hasEntry) {
        setPaneDropActive(group, false);
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      setPaneDropActive(group, true);
    });

    target.addEventListener("dragleave", (event) => {
      if (event.currentTarget?.contains(event.relatedTarget)) {
        return;
      }
      setPaneDropActive(group, false);
    });

    target.addEventListener("drop", (event) => {
      setPaneDropActive(group, false);
      const pane = dropViewOf(group);
      const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
      const partPayload = event.dataTransfer?.getData("text/stilo-file-part");
      app.logDebug("action", `Drop on the ${group} group (${pane})`, fileId ? `file=${fileId}` : `part=${partPayload}`);
      if ((!fileId || !canOpenFileInPane(fileId, pane)) && !partPayload) {
        app.logDebug("response", `Drop on the ${group} group rejected`, fileId ? `canOpen=${canOpenFileInPane(fileId, pane)}` : "no payload");
        return;
      }
      event.preventDefault();
      if (fileId && canOpenFileInPane(fileId, pane)) {
        openDroppedFileInPane(fileId, pane, group);
        return;
      }

      try {
        const parsed = JSON.parse(partPayload);
        openPartInPane(parsed.fileId, parsed.partId, pane, group);
      } catch {
        app.logDebug("response", `Drop on the ${group} group: malformed part payload`);
      }
    });
  }

  // Closing a tab, in its group. When it was the active editor's file, the
  // active file is handed on (handOn, editors.js).
  function closeTab(group, tab) {
    tabsWorkedIn = true;
    const project = app.controller.getProject();
    if (tab.view === "preview") {
      app.view.closeTab("preview", tab.fileId, group);
      app.updateStatus(project);
      closeGroupIfEmpty(group);
      scheduleSaveUserState();
      return;
    }
    const wasShown = project.activeFileId === tab.fileId && app.view.get().hosts.source === group;
    app.captureViewState(); // where it was left: the file's latest place (resume.js)
    app.view.closeTab("source", tab.fileId, group);
    app.forgetEditorPlace(tab.fileId, group);
    scheduleSaveUserState();

    if (!wasShown) {
      app.updateStatus(project);
      closeGroupIfEmpty(group);
      return;
    }

    app.handOn(group, project);
    closeGroupIfEmpty(group);
  }
  const closeSourceTab = (fileId) => closeTab(app.view.get().hosts.source, { fileId, view: "source" });
  const closePreviewTab = (fileId) => closeTab(app.view.get().hosts.preview, { fileId, view: "preview" });

  // ---- Groups come and go. The frame shows and hides them: the left is its
  // "source" area and the right its "preview" one (named for the default).
  const otherGroup = (group) => (group === "left" ? "right" : "left");
  const areaOf = (group) => (group === "left" ? "source" : "preview");

  // A tab moved (or, keep: opened too) to the other group, before or after a
  // tab there or at the end. It comes on screen there, the group shown; the
  // group it left closes if that was its last tab.
  function moveTabToGroup(from, tab, { keep = false, target = null, placeAfter = false } = {}) {
    const to = otherGroup(from);
    const project = app.controller.getProject();
    if (project.nodes[tab.fileId]?.kind !== "file") return;
    tabsWorkedIn = true;
    app.captureViewState();
    if (tab.view === "source") {
      // Its editor there starts where it was here (resume.js).
      app.carryEditorPlace(tab.fileId, from, to);
      if (!keep) app.forgetEditorPlace(tab.fileId, from);
    }
    app.setAreaShown(areaOf(to), true);
    app.view.moveToGroup(from, to, { fileId: tab.fileId, view: tab.view }, { keep, target, placeAfter });
    if (tab.view === "source") {
      app.view.pick(tab.fileId);
      if (project.activeFileId !== tab.fileId) app.controller.setActiveFile(tab.fileId);
      else app.updateStatus(project);
    } else {
      app.updateStatus(project);
    }
    if (!keep) closeGroupIfEmpty(from);
    scheduleSaveUserState();
  }

  // A group left with no tab closes, when the other one shows (on the
  // desktop): the bodies it held go there, so what opens next shows, and it
  // hides. Hiding a group with its × keeps its tabs (reading mode).
  function closeGroupIfEmpty(group) {
    const state = app.view.get();
    const empty = state.groups.find((g) => g.id === group)?.tabs.length === 0;
    const viewTabs = state.hosts.preview === group && app.paneViews.all().some((paneView) => paneView.tab());
    if (!empty || viewTabs || app.phonePane() || app.settings[areaOf(otherGroup(group))] === "hidden") return;
    app.view.closeGroup(group);
    // The active editor may be the other group's now: its file is the active
    // file (with none, the other group's source tabs would be dropped).
    const now = app.view.get();
    const shown = now.groups.find((g) => g.id === now.hosts.source)?.active;
    if (shown?.view === "source" && app.controller.getProject().activeFileId !== shown.fileId) {
      app.view.select(shown.fileId);
      app.controller.setActiveFile(shown.fileId);
    }
    app.setAreaShown(areaOf(group), false);
    app.updateStatus(app.controller.getProject());
  }

  function reorderTabs(group, dragged, target, placeAfter = false) {
    tabsWorkedIn = true;
    app.view.moveTab(group, dragged, target, placeAfter);
    renderTabs(app.controller.getProject());
    scheduleSaveUserState();
  }

  // The tab strips scroll instead of squeezing tabs down to unreadable slivers, so
  // a "⋯" button at the end lists EVERY open tab (activate or close from there).
  // renderTabStrip records what it drew here so the menu can rebuild the same list.
  const tabStripState = { left: null, right: null };
  const VIEW_NAMES = { source: "Source", preview: "Preview" };

  function tabOverflowButton(group) {
    return group === "left" ? app.elements.sourceTabOverflow : app.elements.previewTabOverflow;
  }

  function closeTabOverflowMenu() {
    const menu = app.elements.tabOverflowMenu;
    if (menu) menu.hidden = true;
    for (const group of ["left", "right"]) {
      const btn = tabOverflowButton(group);
      btn?.classList.remove("is-open");
      btn?.setAttribute("aria-expanded", "false");
    }
  }

  // Build the "all open tabs" list for one group from the last render's descriptor.
  function openTabOverflowMenu(group) {
    const menu = app.elements.tabOverflowMenu;
    const button = tabOverflowButton(group);
    const state = tabStripState[group];
    if (!menu || !button || !state) return;

    const rows = [];
    for (const tab of state.tabs) {
      const node = state.project?.nodes?.[tab.fileId];
      if (!node || node.kind !== "file") continue;
      rows.push({
        label: state.mixed ? `${node.name} · ${VIEW_NAMES[tab.view]}` : node.name,
        title: getPath(state.project, tab.fileId),
        active: sameTab(state.active, tab),
        activate: () => state.onActivate(tab),
        close: () => state.onClose(tab)
      });
    }
    for (const spec of state.extraTabs ?? []) {
      rows.push({
        label: spec.label,
        title: spec.title || spec.label,
        active: state.active?.fileId === spec.id,
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
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");

      item.append(name, close);
      item.addEventListener("click", (event) => {
        if (event.target === close) {
          event.stopPropagation();
          row.close();
          renderTabs(app.controller.getProject());
          openTabOverflowMenu(group); // keep the list open so several can be closed
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

  // One group's strip: its tabs ({ fileId, view }), each marked with its view
  // when the group holds both; then the pane views' tabs (History's diff).
  function renderTabStrip({ strip, group, project, tabs, active, emptyText, onActivate, onClose, extraTabs = [] }) {
    strip.replaceChildren();
    const mixed = new Set(tabs.map((tab) => tab.view)).size > 1;

    // Record what we're drawing so the "⋯" overflow menu can list the same tabs,
    // and show that button only when this group actually has tabs.
    tabStripState[group] = { project, tabs, active, mixed, onActivate, onClose, extraTabs };
    const overflowBtn = tabOverflowButton(group);
    if (overflowBtn) overflowBtn.hidden = (tabs.length + extraTabs.length) === 0;

    if (tabs.length === 0 && extraTabs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-tab is-empty";
      empty.textContent = emptyText;
      strip.append(empty);
      return;
    }

    tabs.forEach((entry) => {
      const { fileId, view } = entry;
      const file = project.nodes[fileId];
      if (!file || file.kind !== "file") {
        return;
      }

      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `editor-tab${sameTab(active, entry) ? " is-active" : ""}`;
      tab.dataset.fileId = fileId;
      tab.dataset.view = view;
      tab.title = `${getPath(project, fileId)} (${VIEW_NAMES[view]})`;
      tab.draggable = true;

      const icon = document.createElement("span");
      icon.className = `tab-file-icon file-icon ${builtinTypes.typeOf(file.name)?.icon ?? "is-file"}`;
      icon.setAttribute("aria-hidden", "true");

      const title = document.createElement("span");
      title.className = "tab-title";
      title.textContent = file.name;

      const parts = [icon, title];
      if (mixed) {
        const mark = document.createElement("span");
        mark.className = `tab-view-mark is-${view}`;
        mark.textContent = VIEW_NAMES[view];
        parts.push(mark);
      }

      const dirty = document.createElement("span");
      dirty.className = `tab-dirty${file.dirty ? " is-dirty" : ""}`;
      dirty.textContent = file.dirty ? "●" : "";

      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.setAttribute("aria-hidden", "true");

      const mark = app.marks.get(getPath(project, fileId));
      if (mark) {
        const badge = document.createElement("span");
        badge.className = `tab-mark-badge is-${mark.kind}`;
        badge.title = mark.title ?? "";
        parts.push(badge);
      }
      tab.append(...parts, dirty, close);
      tab.addEventListener("click", () => onActivate(entry));
      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        app.openTabMenu(group, entry, event.clientX, event.clientY);
      });
      // Reordered within the group by dragging, or dragged in from the other group.
      const dragging = () => app.view.get().draggingTabState;
      const reorders = () => dragging()?.group === group && !sameTab(dragging(), entry);
      const arrives = () => Boolean(dragging()) && dragging().group !== group;
      tab.addEventListener("dragstart", (event) => {
        app.view.dragTab({ group, fileId, view });
        event.dataTransfer?.setData("text/mdnotes-tab", JSON.stringify({ group, fileId, view }));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      tab.addEventListener("dragend", () => {
        app.view.dragTab(null);
      });
      tab.addEventListener("dragover", (event) => {
        if (reorders() || arrives()) event.preventDefault();
      });
      tab.addEventListener("drop", (event) => {
        if (!reorders() && !arrives()) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = tab.getBoundingClientRect();
        const placeAfter = event.clientX > rect.left + (rect.width / 2);
        const { group: from, fileId: draggedId, view: draggedView } = dragging();
        app.view.dragTab(null);
        if (from === group) reorderTabs(group, { fileId: draggedId, view: draggedView }, entry, placeAfter);
        else moveTabToGroup(from, { fileId: draggedId, view: draggedView }, { target: entry, placeAfter });
      });
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        onClose(entry);
      });
      strip.append(tab);
    });

    // Special (non-file) tabs — e.g. the preview diff view. Rendered after the file
    // tabs; not draggable/reorderable, but activate + close like any other tab.
    extraTabs.forEach((spec) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = `editor-tab${active?.fileId === spec.id ? " is-active" : ""}`;
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
      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        app.openViewTabMenu(() => spec.onClose(), event.clientX, event.clientY);
      });
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        spec.onClose();
      });
      strip.append(tab);
    });

    // Nudged into view when the active tab or the tabs changed (measuring it
    // forces a layout; the strip's own resizes are watched below).
    const shown = JSON.stringify([active ?? null, tabs.length, extraTabs.length]);
    if (strip.dataset.revealed !== shown) {
      strip.dataset.revealed = shown;
      revealActiveTab(strip);
    }
  }

  // The strip scrolls, so the active tab can sit off-screen after a switch or
  // when the strip narrows: it is nudged into view, no other scroll container
  // disturbed. Its place is measured in the strip (offsetLeft counted from the
  // header, the group's label included, and scrolled too far).
  function revealActiveTab(strip) {
    const activeTab = strip.querySelector(".editor-tab.is-active");
    if (!activeTab) return;
    const left = activeTab.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    const right = left + activeTab.getBoundingClientRect().width;
    // A tab wider than the strip shows its start (its name), not its ×.
    if (left < strip.scrollLeft || right - left > strip.clientWidth) {
      strip.scrollLeft = left;
    } else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = right - strip.clientWidth;
    }
  }

  // The strips show no scrollbar (it made the header of a full strip taller
  // than the other's): the wheel scrolls one sideways, and "⋯" lists every tab.
  const stripOf = (group) => (group === "left" ? app.elements.sourceTabStrip : app.elements.previewTabStrip);
  for (const strip of [stripOf("left"), stripOf("right")]) {
    if (strip && globalThis.ResizeObserver) new ResizeObserver(() => revealActiveTab(strip)).observe(strip);
    strip?.addEventListener("wheel", (event) => {
      if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    }, { passive: false });
  }

  function renderTabs(project) {
    const state = app.view.get();
    // Open pane views get tabs after the files', in the group holding the preview (History's diff).
    const paneViewTabs = app.paneViews.all().flatMap((paneView) => {
      const tab = paneView.tab();
      return tab ? [{ id: paneView.id, ...tab, onActivate: () => setPreviewFile(paneView.id), onClose: () => paneView.close() }] : [];
    });
    for (const group of state.groups) {
      const strip = stripOf(group.id);
      if (!strip) continue;
      renderTabStrip({
        strip,
        group: group.id,
        project,
        tabs: group.tabs,
        active: group.active,
        emptyText: "No file open",
        onActivate: (tab) => activateTab(group.id, tab),
        onClose: (tab) => closeTab(group.id, tab),
        extraTabs: state.hosts.preview === group.id ? paneViewTabs : []
      });
    }
  }

  // A tab dropped on a strip, past its tabs: to the end of the group (from the other group: moved there).
  function bindTabStripReorderTarget(strip, group) {
    strip.addEventListener("dragover", (event) => {
      if (!app.view.get().draggingTabState) {
        return;
      }
      event.preventDefault();
    });

    strip.addEventListener("drop", (event) => {
      const dragging = app.view.get().draggingTabState;
      if (!dragging || event.target.closest(".editor-tab[data-file-id]")) {
        return;
      }

      event.preventDefault();
      app.view.dragTab(null);
      const tab = { fileId: dragging.fileId, view: dragging.view };
      if (dragging.group === group) reorderTabs(group, tab, null);
      else moveTabToGroup(dragging.group, tab);
    });
  }

  return { ensureOpenTabs, openSourceTab, openPreviewTab, activateTab, switchTabView, setActiveSourceFile, currentWorkspaceView, cacheWorkspaceView, cachedWorkspaceView, resumeView, showResumedFile, scheduleSaveUserState, restoreResumeState, restoreOwnView, setActiveSourcePart, setPreviewFile, openFileFromExplorer, canOpenFileInPane, setPaneDropActive, clearPaneDropState, openDroppedFileInPane, openPartInPane, bindPaneDropTarget, closeTab, closeSourceTab, closePreviewTab, reorderTabs, moveTabToGroup, tabOverflowButton, closeTabOverflowMenu, openTabOverflowMenu, renderTabStrip, renderTabs, bindTabStripReorderTarget };
}
