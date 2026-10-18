// Resuming the last session, so a reload or a return to the page is not a
// fresh start: ask the stored server what it offers, sign in again (only to
// a server and username that worked before), reopen the last cloud workspace,
// or rejoin a PIN session that was open. Runs at start (resumeSession), when
// the page comes back, when the network returns, and from the welcome page's
// Resume. A deliberate switch to the tab's own workspace cancels it.
// Part of Cloud: `app` is its shared context (surface.js).
import { createSessionRecovery, rememberedWorkspace } from "../service/recovery.js";

export function createResume(app, { sync, doc = globalThis.document, win = globalThis.window }) {
  const { settings, mode, syncState, identity } = app;

  async function restoreSession({ manual = false, isCurrent = () => true } = {}) {
    const last = rememberedWorkspace(settings.lastWorkspace);
    if (mode.get().workspaceMode === "synced" && app.collaboration.getConnectionInfo()) {
      const resumed = await app.collaboration.resumeConnection();
      if (!resumed && settings.autoReconnect && settings.wasConnected && settings.serverPin) await sync.connectSaved({ auto: true });
      if (manual || !app.controller.getActiveFile()) app.showResumedFile(app.cachedWorkspaceView(settings.syncedProjectId));
      return;
    }
    const ping = await app.pingCurrentServer({ silent: true });
    if (!isCurrent()) return;
    if (!ping) throw new Error("Waiting for the server — your workspace will resume automatically.");
    if (syncState.accountsAvailable && identity.canRestore()) {
      await app.performLogin(settings.accountUsername, settings.accountPassword, { silent: true, isCurrent });
    }
    const target = rememberedWorkspace(settings.lastWorkspace) ?? last;
    if (target && identity.account()) {
      await app.handleOpenWorkspace(target.team, target.path, { reason: manual ? "welcome-resume" : "automatic-restore", automatic: true, isCurrent });
      return;
    }
    if (manual && target) {
      app.openSettingsDialog("collaboration");
      app.showToast("Sign in to resume this workspace.");
      return;
    }
    if (settings.autoReconnect && settings.wasConnected && settings.serverPin) await sync.connectSaved({ auto: true });
  }

  const sessionRestorer = createSessionRecovery({
    restore: restoreSession,
    onError(error) {
      app.logDebug("response", "Workspace recovery waiting", error.message);
      syncState.change({ detail: error.message }, "waiting to resume");
      if ([401, 403].includes(error.status)) app.showToast("Sign in again to resume your workspace. Your local edits are kept.");
    }
  });

  // Worth trying again: a cloud workspace was open, nothing is, or an attempt is waiting.
  const worthResuming = () => mode.get().workspaceMode === "synced" || !app.controller.getActiveFile() || sessionRestorer.isPending();
  let suspended = false;
  doc?.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") {
      suspended = worthResuming();
    } else if (suspended) {
      suspended = false;
      void sessionRestorer.run();
    }
  });
  win?.addEventListener("online", () => {
    if (doc.visibilityState !== "hidden" && worthResuming()) void sessionRestorer.run();
  });
  win?.addEventListener("pageshow", (event) => {
    if (event.persisted && worthResuming()) void sessionRestorer.run();
  });
  sync.events.on("switched", ({ mode: next }) => { if (next === "private") sessionRestorer.cancel(); });
  doc?.getElementById("welcome-resume")?.addEventListener("click", () => void sessionRestorer.run({ manual: true }));

  return {
    sessionRestorer,
    resumeSession: () => sessionRestorer.run(),
    // The welcome page offers Resume unless the remembered workspace is already open or opening.
    resumeTarget() {
      const target = rememberedWorkspace(settings.lastWorkspace);
      const alreadyOpen = target && settings.syncedProjectId === `${target.team}/${target.path}`
        && mode.get().workspaceMode === "synced"
        && (["connected", "reconnecting"].includes(syncState.status) || sessionRestorer.isPending());
      return target && !alreadyOpen ? (target.path.split("/").pop() || target.team) : null;
    }
  };
}
