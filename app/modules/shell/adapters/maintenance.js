// Looking after the app's own data: everything it stores in this browser
// (its "mdnotes." keys) and its offline files, and the two commands that clear
// them (Reset to Default Workspace; Clear All Cache). Workspace adds Empty
// Everything, which also writes an empty project.
import { clearOfflineShellData } from "./offline.js";

// Remove every key this app keeps in this browser (project, settings, chats,
// view positions, and any future "mdnotes." key). Returns how many.
export function clearAppStorage(store = globalThis.localStorage) {
  if (!store) return 0;
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith("mdnotes.")) keys.push(key);
  }
  keys.forEach((key) => store.removeItem(key));
  return keys.length;
}

export function addMaintenanceCommands({ commands, confirm, notify, closeMenus, events, log }) {
  commands.add({ id: "workspace.reset", title: "Reset to Default Workspace", menu: { id: "settings", group: 0, order: 3 }, async run() {
    const confirmed = await confirm({ title: "Reset to Default Workspace",
      message: "This deletes your current workspace, chat history, and settings, then reloads the default welcome workspace. This cannot be undone.",
      acceptLabel: "Reset" });
    if (!confirmed) return;
    closeMenus();
    log(`Workspace reset to default: keysRemoved=${clearAppStorage()}`);
    globalThis.location.reload();
  } });
  commands.add({ id: "shell.clear-cache", title: "Clear All Cache", menu: { id: "settings", group: 0, order: 5 }, danger: true, async run() {
    const confirmed = await confirm({ title: "Clear Cached App Data",
      message: "This clears the app's cached shell files and unregisters its service worker, then reloads the page. Your workspace content and settings will stay intact.",
      acceptLabel: "Clear Cache" });
    if (!confirmed) return;
    closeMenus();
    events.emit("clearing-caches"); // modules drop what they cache themselves (the Editor's resume positions)
    try {
      const result = await clearOfflineShellData();
      log(`App cache cleared: caches=${result.deletedCacheKeys.length} registrations=${result.unregisteredScopes.length}`);
      globalThis.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Cache clear failed: ${message}`);
      notify(`Failed to clear cache: ${message}`);
    }
  } });
}
