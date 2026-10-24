// The app's settings, with one owner (Shell). What other code holds is a
// read-only view (kernel createLiveView): `settings.theme` reads the current
// value, and a change goes through `settings.change({ theme: "dark" }, why?)`,
// which saves it and lands in the trace (with `why`, or else the file and line
// that changed it). A plain assignment (`settings.theme = …`) throws instead of
// changing it unseen. `settings.on(listener)` hears every change.

// Settings whose values the trace never shows.
export const SECRET_SETTINGS = ["serverPin", "accountToken", "accountPassword", "agentApiKey"];

// The keys a change saves: the changed ones. The revision a cloud copy was
// last in sync with is saved only together with the workspace it belongs to
// (or by the guarded merge when the page goes away): saved alone, it could
// pair with another tab's workspace and make a reopen push stale text over
// newer work.
export function keysToSave(changed) {
  return changed.includes("syncedProjectId") ? [...new Set([...changed, "syncedRevision"])]
    : changed.filter((key) => key !== "syncedRevision");
}
