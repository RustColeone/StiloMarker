// Opening a cloud workspace: pulling it (or pushing this browser's unsaved
// copy of it), and putting things back when the open fails.
// Part of the Cloud module: `app` is its shared context (surface.js).

export function createOpening(app) {
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
        && app.mode.get().workspaceMode === "synced"
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
    const previousMode = app.mode.get();
    // Reopening the workspace this browser already holds: the tabs the Editor
    // brings back (this page's, or the last visit's); else the server's resume.
    const previousView = app.settings.syncedProjectId === workspaceId ? app.resumeView(workspaceId) : null;
    try {
      // Preserve the user's local project once, so leaving the cloud workspace
      // restores it. Setting synced mode up-front stops onStatusChange's master
      // auto-switch from snapshotting the (just-pulled) cloud project by mistake.
      app.mode.share(app.controller.getProject());
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
      app.settings.change({ wasConnected: false }); // cloud opens are account-driven, not PIN auto-reconnect
      app.settings.change({ lastWorkspace: { team, path } }); // reopened on next boot
      app.settings.change({ syncedProjectId: `${team}/${path}` }); // the local project IS this cloud workspace now
      app.settings.change({ syncedRevision: app.collaboration.getRevision?.() ?? null }); // base for the next open
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
        app.mode.restore(previousMode);
      }
      if (!options.automatic) app.showToast(error.message || "Could not open workspace.");
      app.logDebug("response", "Open workspace failed", error.message);
      app.render(app.controller.getProject());
      if (options.automatic) throw error;
    } finally {
      openWorkspaceInFlight = null;
    }
  }

  return { getDeviceId, handleOpenWorkspace };
}
