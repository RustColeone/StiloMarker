// Who may open a cloud project: its access list, edited by its owner.
// Part of the Cloud module: `app` is its shared context (surface.js).

export function createAccess(app) {
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
        await app.browseTo(app.browserState.path);
      }
    } catch (error) {
      setAccessStatus(error.message || "Could not save the access list.");
    }
  }

  return { setAccessStatus, openAccessEditor, saveAccessEditor };
}
