// Signing in and out, asking the server what it offers (a ping), and hosting
// this project for guests or publishing it to a team.
// Part of the Cloud module: `app` is its shared context (surface.js).
import { createProjectServer, pingServer } from "./api.js";

export function createAccounts(app) {
  async function pingCurrentServer({ silent = false } = {}) {
    try {
      app.logDebug("action", "Server ping requested", app.elements.serverUrlInput.value.trim());
      const result = await pingServer(app.elements.serverUrlInput.value);
      app.settings.change({ serverUrl: app.elements.serverUrlInput.value.trim() });
      // Capability discovery: reveal the account Login / Share controls only when
      // this server advertises them (state 3).
      app.syncState.change({
        status: app.syncState.status === "connected" ? "connected" : "reachable",
        ...(silent ? {} : { detail: typeof result === "string" ? result : (result.message || "Server responded to ping.") }),
        accountsAvailable: Boolean(result && typeof result === "object" && result.accounts),
        hostingAvailable: Boolean(result && typeof result === "object" && result.hosting)
      }, "the server answered a ping");
      app.logDebug("response", "Server ping succeeded", app.syncState.detail);
      if (!silent) app.flashStatusPanel("success");
      renderAccountControls();
      void app.refreshChatStatus({ silent: true });
      app.render(app.controller.getProject());
      return result;
    } catch (error) {
      app.syncState.change({
        ...(app.syncState.status !== "connected" ? { status: "offline", detail: error.message } : {}),
        accountsAvailable: false,
        hostingAvailable: false
      }, "the server did not answer a ping");
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
      const hosting = app.collaboration.isConnected() && app.mode.get().workspaceMode === "synced";
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
      if (team === "") {
        // Ephemeral guest session hosting the current local project.
        app.mode.share(app.controller.getProject());
        const { guestPin } = await app.collaboration.hostForGuests(app.settings.serverUrl, displayName);
        app.settings.change({ wasConnected: false });
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
        app.mode.share(app.controller.getProject());
        await app.collaboration.openWorkspace(app.settings.serverUrl, app.identity.token(), team, created.path, { reason: "create-project" });
        // The freshly-opened workspace is empty; push our local project into it.
        app.controller.replaceProject(localProject);
        await app.collaboration.publishSnapshot(localProject);
        app.settings.change({ wasConnected: false, lastWorkspace: { team, path: created.path } });
        app.elements.hostPinText.textContent = `Published to ${created.id}.`;
        app.logDebug("action", "Published local project to team workspace", created.id);
      }
      app.render(app.controller.getProject());
    } catch (error) {
      const kept = app.mode.leave();
      if (kept) app.controller.replaceProject(kept);
      app.notify(error.message || "Could not share workspace.");
      app.logDebug("response", "Host/share failed", error.message);
      app.render(app.controller.getProject());
    }
  }

  async function performLogin(username, password, { silent = false, isCurrent = () => true } = {}) {
    const result = await app.identity.signIn(username, password, { isCurrent });
    // Cross-device resume: if THIS browser has no remembered workspace but the
    // account opened one elsewhere, adopt it so boot / the welcome page can resume.
    if (!app.settings.lastWorkspace?.team && result.lastWorkspace?.team) {
      app.settings.change({ lastWorkspace: { team: result.lastWorkspace.team, path: result.lastWorkspace.path } });
    }
    // The collaborator display name defaults to the username.
    if (!app.settings.displayName) {
      app.settings.change({ displayName: result.username });
    }
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
    if (app.mode.get().workspaceMode === "synced") app.switchWorkspaceMode?.("private");
    // Identity forgets the stored password and that this server knew the
    // account, so it is not signed in again by itself (the username stays).
    app.identity.signOut();
    app.settings.change({ lastWorkspace: null, syncedProjectId: null });
    app.elements.browserList?.replaceChildren();
    app.logDebug("action", "Account logged out");
    renderAccountControls();
    app.render(app.controller.getProject());
    void app.refreshChatStatus({ silent: true }); // the server's agent needs an account
  }

  return { pingCurrentServer, renderAccountControls, renderHostTargets, handleHost, performLogin, handleAccountLogin, handleAccountLogout };
}
