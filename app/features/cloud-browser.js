// Cloud file browser (server and on-device projects), accounts (log in / out),
// guest-PIN hosting, workspace access, and opening a cloud workspace.
// main.js creates this on first use and passes its shared values in `app`.
import { seedDefaultProject } from "../modules/workspace/index.js";
import { openProjectOpfs, supportsOpfs } from "../services/opfs-service.js";
import { saveSettings } from "../services/settings-service.js";
import { createProjectServer, pingServer } from "../services/sync-service.js";

export function createCloudBrowser(app) {
  async function pingCurrentServer({ silent = false } = {}) {
    try {
      app.logDebug("action", "Server ping requested", app.elements.serverUrlInput.value.trim());
      const result = await pingServer(app.elements.serverUrlInput.value);
      app.settings.serverUrl = app.elements.serverUrlInput.value.trim();
      saveSettings(app.settings);
      app.syncState.status = app.syncState.status === "connected" ? "connected" : "reachable";
      if (!silent) {
        app.syncState.detail = typeof result === "string" ? result : (result.message || "Server responded to ping.");
      }
      // Capability discovery: reveal the account Login / Share controls only when
      // this server advertises them (state 3).
      app.syncState.accountsAvailable = Boolean(result && typeof result === "object" && result.accounts);
      app.syncState.hostingAvailable = Boolean(result && typeof result === "object" && result.hosting);
      app.logDebug("response", "Server ping succeeded", app.syncState.detail);
      if (!silent) app.flashStatusPanel("success");
      renderAccountControls();
      void app.refreshChatStatus({ silent: true });
      app.render(app.controller.getProject());
      return result;
    } catch (error) {
      if (app.syncState.status !== "connected") {
        app.syncState.status = "offline";
        app.syncState.detail = error.message;
      }
      app.syncState.accountsAvailable = false;
      app.syncState.hostingAvailable = false;
      app.logDebug("response", "Server ping failed", error.message);
      if (!silent) app.flashStatusPanel("error");
      renderAccountControls();
      void app.refreshChatStatus({ silent: true });
      app.render(app.controller.getProject());
      return null;
    }
  }

  // ── Account login (accounts mode / state 3) ─────────────────────────────────
  function renderAccountControls() {
    const row = app.elements.accountLoginRow;
    if (!row) return;
    const loggedIn = Boolean(app.identity.account());
    // The block is only relevant once a pinged server advertises accounts, or
    // while a session is already active.
    row.hidden = !(app.syncState.accountsAvailable || loggedIn);
    if (app.elements.accountLockedNote) {
      app.elements.accountLockedNote.hidden = app.syncState.accountsAvailable || loggedIn;
    }
    // Logged in → collapse to just the name + Log Out (credential fields hidden).
    if (app.elements.accountLoginFields) {
      app.elements.accountLoginFields.hidden = loggedIn;
    }
    app.elements.accountLogoutButton.hidden = !loggedIn;
    if (loggedIn) {
      const teams = app.identity.account().teams ?? [];
      app.elements.accountStatusText.textContent = teams.length
        ? `Logged in as ${app.identity.account().username} · teams: ${teams.join(", ")}`
        : `Logged in as ${app.identity.account().username}`;
    } else {
      app.elements.accountStatusText.textContent = "";
    }
    // The unified file browser manages its own visibility (openFileBrowser) and
    // its login hint (renderBrowserSideToggle); nothing to toggle on login here.
    renderHostTargets();
  }

  // The share dropdown always offers ephemeral hosting ("No team (temporary)");
  // logged-in accounts additionally get their teams as persistent publish targets.
  function renderHostTargets() {
    if (!app.elements.hostTeamSelect) return;
    // Only surface hosting once a server advertising it has been pinged (or while
    // a host session is live), so the button can never 404 an older backend.
    if (app.elements.collabHosting) {
      const hosting = app.collaboration.isConnected() && app.workspaceMode === "synced";
      app.elements.collabHosting.hidden = !(app.syncState.hostingAvailable || hosting);
    }
    const previous = app.elements.hostTeamSelect.value;
    const options = [["", "No team (temporary)"]];
    for (const team of (app.identity.account()?.teams ?? [])) {
      options.push([team, `Team: ${team}`]);
    }
    app.elements.hostTeamSelect.replaceChildren(...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }));
    app.elements.hostTeamSelect.value = options.some(([v]) => v === previous) ? previous : "";
  }

  async function handleHost() {
    const team = app.elements.hostTeamSelect?.value ?? "";
    const displayName = app.settings.displayName || app.identity.account()?.username || "";
    try {
      if (app.workspaceMode === "private") {
        app.privateProjectSnapshot = app.controller.getProject();
      }
      if (team === "") {
        // Ephemeral guest session hosting the current local project.
        app.workspaceMode = "synced";
        const { guestPin } = await app.collaboration.hostForGuests(app.settings.serverUrl, displayName);
        app.settings.wasConnected = false;
        app.elements.hostPinText.textContent = `Sharing! Guests join with PIN ${guestPin} (enter it under PIN above). Ends when you disconnect.`;
        app.logDebug("action", "Hosting ephemeral session", `pin=${guestPin}`);
      } else {
        // Publish the current local project into a new persistent team workspace.
        if (!app.identity.account()) {
          app.notify("Log in to publish to a team.");
          return;
        }
        const name = await app.promptForName("Name this cloud workspace", "");
        if (!name) return;
        const localProject = app.controller.getProject();
        // Publish into a new project directory under the team's workspaces/ folder,
        // then open and push into it — same path the file browser's Publish uses.
        const created = await createProjectServer(app.settings.serverUrl, app.identity.token(), team, "workspaces", name);
        app.workspaceMode = "synced";
        await app.collaboration.openWorkspace(app.settings.serverUrl, app.identity.token(), team, created.path, { reason: "create-project" });
        // The freshly-opened workspace is empty; push our local project into it.
        app.controller.replaceProject(localProject);
        await app.collaboration.publishSnapshot(localProject);
        app.settings.wasConnected = false;
        app.settings.lastWorkspace = { team, path: created.path };
        saveSettings(app.settings);
        app.elements.hostPinText.textContent = `Published to ${created.id}.`;
        app.logDebug("action", "Published local project to team workspace", created.id);
      }
      app.render(app.controller.getProject());
    } catch (error) {
      app.workspaceMode = "private";
      if (app.privateProjectSnapshot) {
        app.controller.replaceProject(app.privateProjectSnapshot);
        app.privateProjectSnapshot = null;
      }
      app.notify(error.message || "Could not share workspace.");
      app.logDebug("response", "Host/share failed", error.message);
      app.render(app.controller.getProject());
    }
  }

  // ---- Unified file browser (Open a workspace) -------------------------------
  // One browser drives two backing stores through a small provider interface:
  //   serverProvider — team cloud folders (needs an account)
  //   opfsProvider   — this device's local (OPFS) store
  // It navigates an opaque `path` string and lists provider entries of the shape
  // { name, kind, path, modified, canEdit?, createdBy? }.

  function splitServerPath(path) {
    // The server addresses a workspace by (team, team-relative path); fold that
    // into one string whose FIRST segment is the team name.
    const segs = String(path || "").split("/").filter(Boolean);
    return { team: segs[0] ?? "", rel: segs.slice(1).join("/") };
  }

  function setBrowserStatus(message) {
    if (!app.elements.browserStatus) return;
    app.elements.browserStatus.textContent = message ?? "";
    app.elements.browserStatus.hidden = !message;
  }

  // Where each side lands when first shown or after switching the toggle.
  function defaultPathForProvider(provider) {
    // Server resumes in the last-used team; local starts at its root.
    if (provider.id === "server") return app.settings.lastWorkspace?.team ?? "";
    return "";
  }

  function openFileBrowser({ side, intent = "open", mode = "open" } = {}) {
    if (!app.elements.openServerDialog) return;
    const opfsOk = supportsOpfs();
    const serverOk = Boolean(app.identity.account());
    // Honour the requested side but fall back when it isn't available.
    let chosen = side;
    if (chosen === "server" && !serverOk) chosen = opfsOk ? "local" : "server";
    if (chosen === "local" && !opfsOk) chosen = serverOk ? "server" : "local";
    if (chosen !== "server" && chosen !== "local") chosen = serverOk ? "server" : "local";

    app.browserState.provider = chosen === "server" ? app.serverProvider : app.opfsProvider;
    app.browserState.intent = intent;
    app.browserState.mode = mode;
    app.browserState.multiSelect = false;
    app.browserState.checked = new Set();
    app.browserState.pendingTransfer = null;
    app.browserState.selection = null;

    if (app.elements.browserTitle) {
      app.elements.browserTitle.textContent = mode === "manage"
        ? "File Manager"
        : intent === "create" ? "New project" : "Open a workspace";
    }
    if (app.elements.browserSubtitle) {
      app.elements.browserSubtitle.textContent = mode === "manage"
        ? "Browse, organize, and delete your projects across this device and team folders."
        : intent === "create"
          ? "Choose where it lives, then press New Project."
          : "Browse your device and team folders, then open a project.";
    }
    if (app.elements.browserNewProject) {
      app.elements.browserNewProject.classList.toggle("is-suggested", intent === "create");
    }
    if (app.elements.serverBrowser) app.elements.serverBrowser.hidden = false;
    if (!app.elements.openServerDialog.open) app.elements.openServerDialog.showModal();
    void browseTo(defaultPathForProvider(app.browserState.provider));
  }

  function switchBrowserSide(side) {
    if (side === app.browserState.provider?.id) return;
    if (side === "server" && !app.identity.account()) {
      // Not signed in: close and route to the account login, pinging the server.
      if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
      app.openSettingsDialog("collaboration");
      void pingCurrentServer({ silent: true });
      return;
    }
    if (side === "local" && !supportsOpfs()) return;
    app.browserState.provider = side === "server" ? app.serverProvider : app.opfsProvider;
    app.browserState.selection = null;
    void browseTo(defaultPathForProvider(app.browserState.provider));
  }

  // Open an existing local (OPFS) project, first leaving any live cloud session so
  // we cleanly return to a private, on-device workspace.
  async function openLocalProjectFromBrowser(entry) {
    app.sessionRestorer?.cancel();
    const project = await openProjectOpfs(entry.path);
    if (app.collaboration.isConnected() && app.workspaceMode === "synced") {
      app.collaboration.disconnect("Opened a local workspace.");
    }
    app.workspaceMode = "private";
    app.privateProjectSnapshot = null;
    app.settings.wasConnected = false;
    app.settings.lastLocalProject = { path: entry.path };
    saveSettings(app.settings);
    app.controller.replaceProject(project);
    app.selectionNodeId = project.activeFileId ?? project.rootId;
    app.initializePaneState(project);
    if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
    app.logDebug("action", "Opened local project", entry.path);
    app.render(project);
  }

  async function browseTo(path) {
    const provider = app.browserState.provider;
    if (!provider) return;
    try {
      const view = await provider.list(path);
      app.browserState.path = view.path ?? path;
      app.browserState.entries = view.entries ?? [];
      app.browserState.atRoot = Boolean(view.atRoot);
      app.browserState.selection = null;
      app.browserState.checked.clear();
      renderBrowser();
    } catch (error) {
      app.browserState.entries = [];
      renderBrowser();
      setBrowserStatus(error.message || "Could not open this location.");
      app.logDebug("response", "Browse failed", error.message);
    }
  }

  function renderBrowser() {
    renderBrowserSideToggle();
    renderBrowserBreadcrumb();
    renderBrowserList();
    const provider = app.browserState.provider;
    const canCreate = provider?.canCreateAt?.(app.browserState.path) ?? false;
    const picking = app.browserState.mode === "pick";
    if (app.elements.browserNewFolder) app.elements.browserNewFolder.hidden = !canCreate;
    if (app.elements.browserNewProject) app.elements.browserNewProject.hidden = !canCreate || picking;
    if (app.elements.browserTrash) app.elements.browserTrash.hidden = picking || provider?.id !== "server" || !app.browserState.path;
    if (app.elements.browserPublishHere) app.elements.browserPublishHere.hidden = picking || !(canCreate && provider?.supportsPublish);
    if (app.elements.browserSelectToggle) {
      const manage = app.browserState.mode === "manage";
      app.elements.browserSelectToggle.hidden = !manage;
      app.elements.browserSelectToggle.classList.toggle("is-active", app.browserState.multiSelect);
      app.elements.browserSelectToggle.textContent = app.browserState.multiSelect ? "Done" : "Select";
    }
    renderBrowserActionbar();
  }

  function renderBrowserSideToggle() {
    const opfsOk = supportsOpfs();
    const serverOk = Boolean(app.identity.account());
    const current = app.browserState.provider?.id;
    // The side switch stays available while picking a destination, so a Copy/Move
    // can land on the other side (device ↔ team) than it started from.
    if (app.elements.browserSideToggle) app.elements.browserSideToggle.hidden = !(opfsOk || serverOk);
    if (app.elements.browserSideLocal) {
      app.elements.browserSideLocal.disabled = !opfsOk;
      app.elements.browserSideLocal.classList.toggle("is-active", current === "local");
      app.elements.browserSideLocal.setAttribute("aria-selected", String(current === "local"));
    }
    if (app.elements.browserSideServer) {
      app.elements.browserSideServer.classList.toggle("is-active", current === "server");
      app.elements.browserSideServer.setAttribute("aria-selected", String(current === "server"));
    }
    if (app.elements.openServerLoginNote) {
      // Only nag about logging in while the Server side is actually selected.
      app.elements.openServerLoginNote.hidden = serverOk || current !== "server";
    }
  }

  function renderBrowserBreadcrumb() {
    const nav = app.elements.browserBreadcrumb;
    if (!nav) return;
    nav.replaceChildren();
    const addCrumb = (label, onClick, isCurrent) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "breadcrumb-crumb";
      btn.textContent = label;
      if (isCurrent) {
        btn.setAttribute("aria-current", "true");
      } else {
        btn.addEventListener("click", onClick);
      }
      nav.append(btn);
    };
    const addSep = () => {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "›";
      nav.append(sep);
    };
    addCrumb(app.browserState.provider?.rootLabel ?? "Home", () => void browseTo(""), app.browserState.path === "");
    const segs = app.browserState.path ? app.browserState.path.split("/") : [];
    let acc = "";
    segs.forEach((seg, index) => {
      acc = acc ? `${acc}/${seg}` : seg;
      const target = acc;
      addSep();
      addCrumb(seg, () => void browseTo(target), index === segs.length - 1);
    });
  }

  function renderBrowserList() {
    const list = app.elements.browserList;
    if (!list) return;
    list.replaceChildren();
    setBrowserStatus("");
    const provider = app.browserState.provider;
    const entries = app.browserState.entries ?? [];
    if (entries.length === 0) {
      if (provider?.id === "server" && app.browserState.atRoot) {
        setBrowserStatus("You are not a member of any team yet.");
      } else if (provider?.canCreateAt?.(app.browserState.path)) {
        setBrowserStatus("This folder is empty. Use New Folder or New Project above to add something.");
      } else {
        setBrowserStatus("This folder is empty.");
      }
      return;
    }
    for (const entry of entries) list.append(makeBrowserRow(entry));
  }

  function formatModified(seconds) {
    if (!seconds) return "—";
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return "—";
    return `${date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })} ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  function isSameEntry(left, right) {
    return Boolean(left && right && left.path === right.path && left.kind === right.kind);
  }

  // A row is just selectable text now: single-click selects, double-click acts
  // (enter a folder/team or open a project). The Open/Access buttons live in the
  // bottom action bar and follow the current selection.
  function makeBrowserRow(entry) {
    const li = document.createElement("li");
    li.className = "browser-item";
    li.setAttribute("role", "option");
    li.tabIndex = -1;
    const selected = isSameEntry(entry, app.browserState.selection);
    li.setAttribute("aria-selected", String(selected));
    if (selected) li.classList.add("is-selected");

    const nameCell = document.createElement("div");
    nameCell.className = "browser-item-name";
    const icon = document.createElement("span");
    icon.className = "browser-item-icon";
    icon.textContent = entry.kind === "project" ? "📄"
      : entry.kind === "team" ? "👥"
      : entry.kind === "file" ? "📃"
      : "📁";
    const label = document.createElement("span");
    label.className = "browser-item-label";
    label.textContent = entry.name;
    if (entry.kind === "project" && entry.createdBy) label.title = `Owner: ${entry.createdBy}`;
    nameCell.append(icon, label);

    const dateCell = document.createElement("span");
    dateCell.className = "browser-item-date";
    dateCell.textContent = formatModified(entry.modified);

    const multi = app.browserState.mode === "manage" && app.browserState.multiSelect;
    if (multi && entry.kind !== "team") {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "browser-item-check";
      check.checked = app.browserState.checked.has(entry.path);
      check.addEventListener("click", (event) => {
        event.stopPropagation();
        setChecked(entry, check.checked);
        li.classList.toggle("is-checked", check.checked);
        renderBrowserActionbar();
      });
      nameCell.prepend(check);
      if (check.checked) li.classList.add("is-checked");
    }

    li.append(nameCell, dateCell);
    li.addEventListener("click", () => {
      if (multi && entry.kind !== "team") {
        const now = !app.browserState.checked.has(entry.path);
        setChecked(entry, now);
        renderBrowserList();
        renderBrowserActionbar();
      } else if (app.browserState.mode === "pick") {
        // Destination picking: only folders/teams are meaningful targets.
        if (entry.kind === "team" || entry.kind === "folder") selectBrowserEntry(entry);
      } else {
        selectBrowserEntry(entry);
      }
    });
    li.addEventListener("dblclick", () => {
      if (multi && entry.kind === "project") return;
      if (app.browserState.mode === "pick" && entry.kind === "project") return;
      activateBrowserEntry(entry);
    });
    return li;
  }

  function selectBrowserEntry(entry) {
    app.browserState.selection = entry;
    renderBrowserList();
    renderBrowserActionbar();
  }

  function activateBrowserEntry(entry) {
    if (entry.kind === "team" || entry.kind === "folder") {
      void browseTo(entry.path);
    } else if (entry.kind === "project") {
      void app.browserState.provider?.openProject(entry);
    }
    // Loose files aren't openable from the browser.
  }

  function renderBrowserActionbar() {
    const sel = app.browserState.selection;
    const provider = app.browserState.provider;
    const picking = app.browserState.mode === "pick";
    const manageMulti = app.browserState.mode === "manage" && app.browserState.multiSelect;
    const count = app.browserState.checked.size;
    // Multi-select management bar: a count + Move/Copy/Delete, with the single-
    // selection Open/Access controls hidden.
    const canTransfer = manageMulti && count > 0;
    for (const button of [app.elements.browserMoveBtn, app.elements.browserCopyBtn]) {
      if (button) Object.assign(button, { hidden: !manageMulti, disabled: !canTransfer });
    }
    if (app.elements.browserDeleteBtn) {
      app.elements.browserDeleteBtn.hidden = !manageMulti;
      app.elements.browserDeleteBtn.disabled = count === 0;
    }
    // Destination picker: primary "Select this folder" + Cancel. The current
    // browsed folder is the drop target, so it's enabled only where projects can
    // be created (a team subfolder, or any local folder).
    const canDrop = picking && Boolean(provider?.canCreateAt?.(app.browserState.path));
    if (app.elements.browserPickBtn) {
      app.elements.browserPickBtn.hidden = !picking;
      app.elements.browserPickBtn.disabled = !canDrop;
    }
    if (app.elements.browserPickCancel) app.elements.browserPickCancel.hidden = !picking;
    if (app.elements.browserSelectionLabel) {
      if (picking) {
        const op = app.browserState.pendingTransfer?.op === "move" ? "Move" : "Copy";
        const n = app.browserState.pendingTransfer?.entries?.length ?? 0;
        const here = app.browserState.path ? `“${app.browserState.path.split("/").pop()}”` : (provider?.rootLabel ?? "here");
        app.elements.browserSelectionLabel.textContent = canDrop
          ? `${op} ${n} item${n === 1 ? "" : "s"} into ${here}`
          : "Open a folder to drop into";
      } else {
        app.elements.browserSelectionLabel.textContent = manageMulti
          ? `${count} selected`
          : (sel ? sel.name : "");
      }
    }
    if (app.elements.browserOpenBtn) {
      app.elements.browserOpenBtn.hidden = manageMulti || picking;
      if (!sel || sel.kind === "file") {
        app.elements.browserOpenBtn.disabled = true;
        app.elements.browserOpenBtn.textContent = "Open";
      } else if (sel.kind === "project") {
        app.elements.browserOpenBtn.disabled = false;
        app.elements.browserOpenBtn.textContent = "Open project";
      } else {
        app.elements.browserOpenBtn.disabled = false;
        app.elements.browserOpenBtn.textContent = "Open";
      }
    }
    if (app.elements.browserAccessBtn) {
      const canAccess = !manageMulti && !picking && Boolean(sel && sel.kind === "project" && provider?.supportsAccess && sel.canEdit);
      app.elements.browserAccessBtn.hidden = !canAccess;
    }
  }

  async function handleNewFolder() {
    const provider = app.browserState.provider;
    if (!provider?.canCreateAt?.(app.browserState.path)) return;
    const name = await app.promptForName("New folder name", "");
    if (!name) return;
    try {
      await provider.mkdir(app.browserState.path, name);
      app.logDebug("action", "Created folder", `${provider.id}:${app.browserState.path}/${name}`);
      await browseTo(app.browserState.path);
    } catch (error) {
      setBrowserStatus(error.message || "Could not create folder.");
    }
  }

  async function handleNewProject() {
    const provider = app.browserState.provider;
    if (!provider?.canCreateAt?.(app.browserState.path)) return;
    const name = await app.promptForName("New project name", "");
    if (!name) return;
    try {
      const created = await provider.createProject(app.browserState.path, name);
      app.logDebug("action", "Created project", `${provider.id}:${created?.path ?? name}`);
      // "New Project" means start working: open the freshly created project.
      await provider.openProject({ name: created?.name ?? name, kind: "project", path: created?.path });
    } catch (error) {
      setBrowserStatus(error.message || "Could not create project.");
    }
  }

  function setChecked(entry, on) {
    if (on) app.browserState.checked.add(entry.path);
    else app.browserState.checked.delete(entry.path);
  }

  function toggleMultiSelect() {
    if (app.browserState.mode !== "manage") return;
    app.browserState.multiSelect = !app.browserState.multiSelect;
    if (app.browserState.multiSelect) {
      app.browserState.selection = null;
    } else {
      app.browserState.checked.clear();
    }
    renderBrowser();
  }

  // Does `entry` (a project, or a folder that holds it) correspond to the project
  // currently open in the editor? Used to fall back to a blank workspace when the
  // open project is deleted out from under the user.
  function isOpenEntry(provider, entry) {
    const within = (openPath) => Boolean(openPath) && (openPath === entry.path || openPath.startsWith(`${entry.path}/`));
    if (provider?.id === "local") {
      return within(app.controller.getProject()?.localPath);
    }
    if (provider?.id === "server" && app.workspaceMode === "synced" && app.settings.lastWorkspace) {
      return within(`${app.settings.lastWorkspace.team}/${app.settings.lastWorkspace.path}`);
    }
    return false;
  }

  // Lightweight reset when the open project vanishes: leave any live session and
  // drop back to a fresh default workspace (no reload, no extra confirmation).
  function fallbackToDefaultAfterDelete() {
    app.sessionRestorer?.cancel();
    if (app.collaboration.isConnected() && app.workspaceMode === "synced") {
      app.collaboration.disconnect("The open workspace was deleted.");
    }
    app.workspaceMode = "private";
    app.privateProjectSnapshot = null;
    app.settings.lastLocalProject = null;
    app.settings.lastWorkspace = null;
    app.settings.wasConnected = false;
    saveSettings(app.settings);
    const project = seedDefaultProject();
    app.controller.replaceProject(project);
    app.selectionNodeId = project.activeFileId ?? project.rootId;
    app.initializePaneState(project);
    app.render(project);
  }

  async function handleDeleteSelected() {
    const provider = app.browserState.provider;
    if (!provider?.delete) return;
    const targets = app.browserState.entries.filter((entry) => app.browserState.checked.has(entry.path));
    if (targets.length === 0) return;
    const label = targets.length === 1 ? `"${targets[0].name}"` : `${targets.length} items`;
    const it = targets.length === 1 ? "it" : "them";
    const confirmed = await app.showConfirmDialog({ title: "Delete", acceptLabel: "Delete", message: provider.id === "server"
      ? `Delete ${label}? The team's Trash keeps ${it} for 30 days, where the owner can restore ${it}.`
      : `Delete ${label}? This permanently removes ${it} and cannot be undone.` });
    if (!confirmed) return;
    let openWasDeleted = false;
    const failures = [];
    for (const entry of targets) {
      try {
        const wasOpen = isOpenEntry(provider, entry);
        await provider.delete(entry);
        if (wasOpen) openWasDeleted = true;
        app.logDebug("action", "Deleted entry", `${provider.id}:${entry.path}`);
      } catch (error) {
        failures.push(`${entry.name}: ${error.message || "failed"}`);
      }
    }
    app.browserState.checked.clear();
    if (openWasDeleted) fallbackToDefaultAfterDelete();
    await browseTo(app.browserState.path);
    if (failures.length) setBrowserStatus(`Could not delete — ${failures.join("; ")}`);
  }

  // The team's trash (History): deleted projects, restorable for a while.
  const handleOpenTrash = () => app.history.trash.open(app.browserState.path.split("/")[0], { onChange: () => void browseTo(app.browserState.path) });

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
    void browseTo(app.browserState.path);
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
    void browseTo(pending?.sourcePath ?? app.browserState.path);
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
    setBrowserStatus(`${op === "move" ? "Moving" : "Copying"} ${entries.length} item${entries.length === 1 ? "" : "s"}…`);
    const failures = [];
    let openWasMoved = false;
    for (const entry of entries) {
      try {
        const pkg = await sourceProvider.exportModel(entry);
        await destProvider.importModel(destPath, pkg.name ?? entry.name, pkg.project);
        if (op === "move") {
          const wasOpen = isOpenEntry(sourceProvider, entry);
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
    await browseTo(destPath);
    if (failures.length) setBrowserStatus(`Could not ${op} — ${failures.join("; ")}`);
  }

  // Publish the current local project as a new cloud project at the browsed path,
  // then open it — the same flow as Collaboration → Share to team, unified here.
  async function handlePublishHere() {
    const { team, rel } = splitServerPath(app.browserState.path);
    if (!app.identity.account() || !team) return;
    const name = await app.promptForName("Publish current workspace as", "");
    if (!name) return;
    const path = rel;
    try {
      if (app.workspaceMode === "private") {
        app.privateProjectSnapshot = app.controller.getProject();
      }
      const localProject = app.controller.getProject();
      const created = await createProjectServer(app.settings.serverUrl, app.identity.token(), team, path, name);
      app.workspaceMode = "synced";
      await app.collaboration.openWorkspace(app.settings.serverUrl, app.identity.token(), team, created.path, { reason: "create-project" });
      app.controller.replaceProject(localProject);
      await app.collaboration.publishSnapshot(localProject);
      app.settings.wasConnected = false;
      app.settings.lastWorkspace = { team, path: created.path };
      saveSettings(app.settings);
      app.logDebug("action", "Published local project to cloud", created.id);
      if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
      app.render(app.controller.getProject());
    } catch (error) {
      app.workspaceMode = "private";
      if (app.privateProjectSnapshot) {
        app.controller.replaceProject(app.privateProjectSnapshot);
        app.privateProjectSnapshot = null;
      }
      app.notify(error.message || "Could not publish workspace.");
      app.logDebug("response", "Publish failed", error.message);
      app.render(app.controller.getProject());
    }
  }

  let accessEditorTarget = null;

  function setAccessStatus(message) {
    if (!app.elements.accessStatus) return;
    app.elements.accessStatus.textContent = message ?? "";
    app.elements.accessStatus.hidden = !message;
  }

  async function openAccessEditor(team, path, name) {
    if (!app.identity.account()) return;
    accessEditorTarget = { team, path };
    if (app.elements.accessDialogTitle) app.elements.accessDialogTitle.textContent = `Access — ${name}`;
    if (app.elements.accessWhitelist) app.elements.accessWhitelist.value = "";
    if (app.elements.accessBlacklist) app.elements.accessBlacklist.value = "";
    setAccessStatus("");
    try {
      const data = await app.identity.getAccess(team, path);
      if (app.elements.accessWhitelist) app.elements.accessWhitelist.value = (data.whitelist ?? []).join("\n");
      if (app.elements.accessBlacklist) app.elements.accessBlacklist.value = (data.blacklist ?? []).join("\n");
    } catch (error) {
      setAccessStatus(error.message || "Could not load the access list.");
    }
    app.elements.accessDialog?.showModal();
  }

  async function saveAccessEditor() {
    if (!accessEditorTarget || !app.identity.account()) return;
    const parseList = (value) => String(value ?? "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    try {
      await app.identity.setAccess(
        accessEditorTarget.team,
        accessEditorTarget.path,
        parseList(app.elements.accessWhitelist?.value),
        parseList(app.elements.accessBlacklist?.value)
      );
      app.logDebug("action", "Updated project access", `${accessEditorTarget.team}/${accessEditorTarget.path}`);
      app.elements.accessDialog?.close();
      if (app.elements.openServerDialog?.open) {
        await browseTo(app.browserState.path);
      }
    } catch (error) {
      setAccessStatus(error.message || "Could not save the access list.");
    }
  }

  // A per-TAB id so the server can tell "this tab reconnected/refreshed" (replace
  // its old session) from "another tab/window/device" (a real second collaborator,
  // including self-collaboration between two windows of the same browser). It lives
  // in sessionStorage — unique per tab, but it SURVIVES a reload, so a refresh
  // still dedups while two separate windows coexist. localStorage was wrong here:
  // it's shared across a browser's tabs, so two windows got the same id and evicted
  // each other into a reconnect war (no cursor/content sync between them).
  function getDeviceId() {
    try {
      const KEY = "mdnotes.deviceId";
      let id = globalThis.sessionStorage?.getItem(KEY);
      if (!id) {
        id = globalThis.crypto?.randomUUID?.() ?? `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
        globalThis.sessionStorage?.setItem(KEY, id);
      }
      return id;
    } catch {
      return "dev-ephemeral";
    }
  }

  // In-flight guard: a second request for the same workspace while one is still
  // running would churn sessions (new token + clientId, evicting the first).
  let openWorkspaceInFlight = null;

  async function handleOpenWorkspace(team, path, options = {}) {
    if (!app.identity.account()) throw new Error("Sign in to resume this workspace.");
    const workspaceId = `${team}/${path}`;
    const reason = options.reason || "unspecified";
    // Already connected to exactly this workspace? Re-opening buys nothing and
    // costs a session swap, so skip it unless the caller insists.
    if (!options.force
        && app.collaboration.isConnected?.()
        && app.syncState.status === "connected"
        && app.workspaceMode === "synced"
        && app.settings.syncedProjectId === workspaceId) {
      app.showResumedFile(app.cachedWorkspaceView(workspaceId));
      app.logDebug("action", "Skipped redundant workspace open", `${workspaceId} (${reason})`);
      return;
    }
    if (openWorkspaceInFlight === workspaceId) {
      app.logDebug("action", "Workspace open already in flight", `${workspaceId} (${reason})`);
      return;
    }
    if (openWorkspaceInFlight) {
      if (options.automatic) throw new Error("Another workspace is still opening.");
      app.showToast("A workspace is still opening. Please try again shortly.");
      return;
    }
    if (!options.automatic) app.sessionRestorer.cancel();
    openWorkspaceInFlight = workspaceId;
    const previousMode = app.workspaceMode;
    const previousPrivate = app.privateProjectSnapshot;
    const previousView = app.settings.syncedProjectId === workspaceId
      ? (app.currentWorkspaceView().activeFile ? app.currentWorkspaceView() : app.cachedWorkspaceView(workspaceId)) : null;
    try {
      // Preserve the user's local project once, so leaving the cloud workspace
      // restores it. Setting synced mode up-front stops onStatusChange's master
      // auto-switch from snapshotting the (just-pulled) cloud project by mistake.
      if (app.workspaceMode === "private") {
        app.privateProjectSnapshot = app.controller.getProject();
      }
      app.workspaceMode = "synced";
      // Reopening the workspace the local project ALREADY is (boot auto-restore, a
      // second tab, a manual reopen): if this browser still holds unsaved edits for
      // it, ASK to push them instead of pulling. Whether that push actually happens
      // is decided inside openWorkspace by comparing revisions — a device whose copy
      // is older than the server must never overwrite it (that is what reverted the
      // whole workspace to an old version). A first open of a *different* workspace
      // always pulls, so one project's files can never leak into another.
      const reopeningSameWorkspace = app.settings.syncedProjectId === `${team}/${path}`;
      const hasUnsavedLocalEdits = Object.values(app.controller.getProject()?.nodes ?? {})
        .some((node) => node?.kind === "file" && node.dirty);
      const reconcileLocal = Boolean(options.reconcileLocal)
        || (reopeningSameWorkspace && hasUnsavedLocalEdits);
      // Safety net: snapshot unsaved work before opening. If the server turns out to
      // be ahead and we pull, those edits stay recoverable from Snapshots instead of
      // vanishing.
      if (reopeningSameWorkspace && hasUnsavedLocalEdits) {
        await app.snapshotDirtyFiles("auto: before reopening workspace");
      }
      if (options.isCurrent && !options.isCurrent()) throw Object.assign(new Error("Session restoration cancelled."), { status: 499 });
      const session = await app.collaboration.openWorkspace(
        app.settings.serverUrl, app.identity.token(), team, path,
        {
          reconcileLocal,
          reason,
          device: getDeviceId(),
          // The server revision this browser's copy was last in sync with. Unknown
          // (null) is treated as stale, so we pull rather than risk overwriting.
          localBaseRevision: reopeningSameWorkspace ? app.settings.syncedRevision : null
        }
      );
      if (options.isCurrent && !options.isCurrent()) throw Object.assign(new Error("Session restoration cancelled."), { status: 499 });
      app.settings.wasConnected = false; // cloud opens are account-driven, not PIN auto-reconnect
      app.settings.lastWorkspace = { team, path }; // reopened on next boot
      app.settings.syncedProjectId = `${team}/${path}`; // the local project IS this cloud workspace now
      app.settings.syncedRevision = app.collaboration.getRevision?.() ?? null; // base for the next open
      saveSettings(app.settings);
      app.logDebug("action", reconcileLocal ? "Reopened cloud workspace (restored local)" : "Opened cloud workspace", `${team}/${path}`);
      if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
      app.render(app.controller.getProject());
      // Restore the files this user had open here last time (server-side resume).
      app.showResumedFile(previousView ?? session?.resume);
      // Upload any snapshots this browser made before they lived on the server
      // (background; the Snapshots dialog awaits the same run if still going).
      void app.loadLineComments({ force: true });
      void app.ensureSnapshotsMigrated().then((count) => {
        if (count) app.showToast(`Uploaded ${count} earlier snapshot${count === 1 ? "" : "s"} to the server`);
        // Migration can add snapshots, so read the S.E.N baselines after it.
        void app.refreshSnapshotBaselines();
      });
      // Reveal the freshly-loaded tree — on mobile the explorer is a closed flyout,
      // so without this the just-opened project looks "empty" until the user taps ≡.
      if (!options.automatic) {
        app.setMobileExplorerOpen(true);
        app.showToast(`Opened ${path.split("/").pop() || app.controller.getProject().name}`);
      }
    } catch (error) {
      // A transport failure must never replace the visible draft with the old
      // private snapshot (often the empty welcome project).
      if (error.status !== 499) {
        app.collaboration.disconnect("Workspace open interrupted; local copy kept.");
        app.workspaceMode = previousMode;
        app.privateProjectSnapshot = previousPrivate;
      }
      if (!options.automatic) app.showToast(error.message || "Could not open workspace.");
      app.logDebug("response", "Open workspace failed", error.message);
      app.render(app.controller.getProject());
      if (options.automatic) throw error;
    } finally {
      openWorkspaceInFlight = null;
    }
  }

  async function performLogin(username, password, { silent = false, isCurrent = () => true } = {}) {
    const result = await app.identity.signIn(username, password, { isCurrent });
    // Cross-device resume: if THIS browser has no remembered workspace but the
    // account opened one elsewhere, adopt it so boot / the welcome page can resume.
    if (!app.settings.lastWorkspace?.team && result.lastWorkspace?.team) {
      app.settings.lastWorkspace = { team: result.lastWorkspace.team, path: result.lastWorkspace.path };
    }
    // The collaborator display name defaults to the username.
    if (!app.settings.displayName) {
      app.settings.displayName = result.username;
      if (app.elements.displayNameInput) app.elements.displayNameInput.value = result.username;
    }
    saveSettings(app.settings);
    app.logDebug("response", "Account login succeeded", `${result.username} teams=${(result.teams ?? []).join(",")}`);
    if (!silent) app.flashStatusPanel("success", app.elements.accountSection);
    renderAccountControls();
    app.render(app.controller.getProject());
    void app.refreshChatStatus({ silent: true }); // signing in unlocks the agent
  }

  async function handleAccountLogin() {
    const username = app.elements.accountUsernameInput.value.trim();
    const password = app.elements.accountPasswordInput.value;
    if (!username) {
      app.elements.accountStatusText.textContent = "Username is required.";
      return;
    }
    try {
      app.logDebug("action", "Account login requested", username);
      await performLogin(username, password);
      app.elements.accountPasswordInput.value = "";
    } catch (error) {
      app.identity.drop();
      app.logDebug("response", "Account login failed", error.message);
      app.flashStatusPanel("error", app.elements.accountSection);
      // Render first (it resets the status line), then surface the failure so the
      // "Invalid username or password" message isn't clobbered by the reset.
      renderAccountControls();
      app.elements.accountStatusText.textContent = error.message || "Login failed.";
      app.render(app.controller.getProject());
    }
  }

  function handleAccountLogout() {
    app.sessionRestorer.cancel();
    // Invalidate even a handshake that has not installed a connection yet.
    app.collaboration.disconnect("Logged out.");
    // Leaving the account also leaves any cloud workspace it opened.
    if (app.workspaceMode === "synced") app.switchWorkspaceMode?.("private");
    // Identity forgets the stored password and that this server knew the
    // account, so it is not signed in again by itself (the username stays).
    app.identity.signOut();
    app.settings.lastWorkspace = null;
    app.settings.syncedProjectId = null;
    saveSettings(app.settings);
    app.elements.browserList?.replaceChildren();
    app.logDebug("action", "Account logged out");
    renderAccountControls();
    app.render(app.controller.getProject());
    void app.refreshChatStatus({ silent: true }); // the server's agent needs an account
  }

  return {
    activateBrowserEntry, beginTransfer, cancelPick, handleAccountLogin, handleAccountLogout,
    handleDeleteSelected, handleHost, handleNewFolder, handleNewProject, handleOpenTrash, handleOpenWorkspace,
    handlePublishHere, handleSelectDestination, openAccessEditor, openFileBrowser,
    openLocalProjectFromBrowser, performLogin, pingCurrentServer, renderHostTargets,
    saveAccessEditor, splitServerPath, switchBrowserSide, toggleMultiSelect
  };
}
