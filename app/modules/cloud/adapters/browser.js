// The file browser: the server's teams and folders, or this device's
// projects, listed, navigated and opened.
// Part of the Cloud module: `app` is its shared context (surface.js).
import { openProjectOpfs, supportsOpfs } from "../../workspace/index.js";

export function createBrowser(app) {
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
    if (app.elements.browserTrash) app.elements.browserTrash.hidden = true; // until the folder it belongs to is shown
    if (!app.elements.openServerDialog.open) app.elements.openServerDialog.showModal();
    void browseTo(defaultPathForProvider(app.browserState.provider));
  }

  function switchBrowserSide(side) {
    if (side === app.browserState.provider?.id) return;
    if (side === "server" && !app.identity.account()) {
      // Not signed in: close and route to the account login, pinging the server.
      if (app.elements.openServerDialog?.open) app.elements.openServerDialog.close();
      app.openSettingsDialog("collaboration");
      void app.pingCurrentServer({ silent: true });
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
    if (app.collaboration.isConnected() && app.mode.get().workspaceMode === "synced") {
      app.collaboration.disconnect("Opened a local workspace.");
    }
    app.mode.leave(); // the kept project is not brought back: another one opens
    app.settings.change({ wasConnected: false, lastLocalProject: { path: entry.path } });
    app.controller.replaceProject(project);
    app.view.reset(project);
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

  // A row is just selectable text now: single-click selects; double-click enters
  // a folder or team. A project opens only with Open (the bottom action bar's
  // Open/Access buttons follow the selection): two quick clicks on a project,
  // which the browser counts as a double-click, must not open it unasked.
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
      if (entry.kind === "team" || entry.kind === "folder") activateBrowserEntry(entry);
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
    if (app.elements.browserDeleteBtn) Object.assign(app.elements.browserDeleteBtn, { hidden: !manageMulti, disabled: count === 0 });
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
    if (provider?.id === "server" && app.mode.get().workspaceMode === "synced" && app.settings.lastWorkspace) {
      return within(`${app.settings.lastWorkspace.team}/${app.settings.lastWorkspace.path}`);
    }
    return false;
  }

  return { splitServerPath, setBrowserStatus, defaultPathForProvider, openFileBrowser, switchBrowserSide, openLocalProjectFromBrowser, browseTo, renderBrowser, renderBrowserSideToggle, renderBrowserBreadcrumb, renderBrowserList, formatModified, isSameEntry, makeBrowserRow, selectBrowserEntry, activateBrowserEntry, renderBrowserActionbar, handleNewFolder, handleNewProject, setChecked, toggleMultiSelect, isOpenEntry };
}
