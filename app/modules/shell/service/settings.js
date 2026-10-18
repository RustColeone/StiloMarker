// The app's settings, with one owner (Shell). What other code holds is a
// read-only view: `settings.theme` reads the current value, and a change goes
// through `settings.change({ theme: "dark" }, why?)`, which saves it and lands
// in the trace (with `why`, or else the file and line that changed it). A plain
// assignment (`settings.theme = …`) throws instead of changing it unseen.
// `settings.on(listener)` hears every change: (settings, changedKeys).
import { callerOf } from "../../../kernel/index.js";

// Settings whose values the trace never shows.
export const SECRET_SETTINGS = ["serverPin", "accountPassword", "agentApiKey"];

export function createSettingsView(state) {
  function change(patch, why) {
    state.set(why ?? `changed at ${callerOf(new Error().stack, ["/shell/service/settings.js"])}`, patch);
  }
  const on = (listener) => state.on((current, changed) => listener(view, changed));
  const refuse = (key) => {
    throw new TypeError(`settings.${String(key)} is read-only here: change it with settings.change({ ${String(key)}: … })`);
  };

  const view = new Proxy({}, {
    get(_, key) {
      if (key === "change") return change;
      if (key === "on") return on;
      return state.get()[key];
    },
    has: (_, key) => key in state.get(),
    ownKeys: () => Reflect.ownKeys(state.get()),
    getOwnPropertyDescriptor(_, key) {
      const current = state.get();
      return key in current ? { value: current[key], enumerable: true, configurable: true, writable: false } : undefined;
    },
    set: (_, key) => refuse(key),
    deleteProperty: (_, key) => refuse(key),
    defineProperty: (_, key) => refuse(key)
  });
  return view;
}

// The keys a change saves: the changed ones. The revision a cloud copy was
// last in sync with is saved only together with the workspace it belongs to
// (or by the guarded merge when the page goes away): saved alone, it could
// pair with another tab's workspace and make a reopen push stale text over
// newer work.
export function keysToSave(changed) {
  return changed.includes("syncedProjectId") ? [...new Set([...changed, "syncedRevision"])]
    : changed.filter((key) => key !== "syncedRevision");
}
