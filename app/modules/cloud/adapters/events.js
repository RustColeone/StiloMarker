// The cloud dialogs' controls: ping, sign in and out, the file browser's
// buttons (new folder or project, the trash, publish, the two sides, open,
// access, select, delete, move, copy, pick a destination), the access dialog
// and hosting. Moved from main.js; `app` is the Cloud module's shared context.

export function installCloudEvents(app) {
  app.elements.pingServerButton.addEventListener("click", () => { void app.pingCurrentServer(); });
  app.elements.accountLoginButton?.addEventListener("click", () => { void app.handleAccountLogin(); });
  app.elements.accountLogoutButton?.addEventListener("click", app.handleAccountLogout);
  app.elements.browserNewFolder?.addEventListener("click", () => { void app.handleNewFolder(); });
  app.elements.browserNewProject?.addEventListener("click", () => { void app.handleNewProject(); });
  app.elements.browserTrash?.addEventListener("click", () => { void app.handleOpenTrash(); });
  app.elements.browserPublishHere?.addEventListener("click", () => { void app.handlePublishHere(); });
  app.elements.browserSideLocal?.addEventListener("click", () => app.switchBrowserSide("local"));
  app.elements.browserSideServer?.addEventListener("click", () => app.switchBrowserSide("server"));
  app.elements.browserOpenBtn?.addEventListener("click", () => {
    if (app.browserState.selection) app.activateBrowserEntry(app.browserState.selection);
  });
  app.elements.browserAccessBtn?.addEventListener("click", () => {
    const sel = app.browserState.selection;
    if (sel && app.browserState.provider?.openAccess) void app.browserState.provider.openAccess(sel);
  });
  app.elements.browserSelectToggle?.addEventListener("click", app.toggleMultiSelect);
  app.elements.browserDeleteBtn?.addEventListener("click", () => { void app.handleDeleteSelected(); });
  app.elements.browserMoveBtn?.addEventListener("click", () => app.beginTransfer("move"));
  app.elements.browserCopyBtn?.addEventListener("click", () => app.beginTransfer("copy"));
  app.elements.browserPickBtn?.addEventListener("click", () => { void app.handleSelectDestination(); });
  app.elements.browserPickCancel?.addEventListener("click", app.cancelPick);
  app.elements.accessDialog?.querySelector("form")?.addEventListener("submit", (event) => {
    // "Cancel" (value=cancel) lets the dialog close normally; Save persists first.
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    void app.saveAccessEditor();
  });
  app.elements.hostButton?.addEventListener("click", () => { void app.handleHost(); });
  app.elements.accountPasswordInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void app.handleAccountLogin();
    }
  });
}
