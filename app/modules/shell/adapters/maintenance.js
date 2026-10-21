// Looking after the app's own data: everything it stores in this browser
// (its "mdnotes." keys) and its offline files, and the two commands that clear
// them (Reset to Default Workspace; Clear All Cache). Workspace adds Empty
// Everything, which also writes an empty project.
import { clearOfflineShellData } from "./offline.js";
import { ignore } from "../../../kernel/index.js";

// Remove every key this app keeps in this browser (project, settings, chats,
// view positions, and any future "mdnotes." key), and note when: a module
// keeping data elsewhere (IndexedDB) drops what it saved before (clearedAt).
// Returns how many keys.
const CLEARED_KEY = "mdnotes.cleared-at.v1";
export function clearAppStorage(store = globalThis.localStorage) {
  if (!store) return 0;
  const keys = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key && key.startsWith("mdnotes.")) keys.push(key);
  }
  keys.forEach((key) => store.removeItem(key));
  store.setItem(CLEARED_KEY, String(Date.now()));
  return keys.length;
}

// The app's other windows in this browser are told its storage was cleared
// (once what replaces it is written): they reload too, keeping nothing, since
// what they hold was just deleted. One channel per page, so a page never
// hears its own announcement.
const CHANNEL = "mdnotes-app";
let channel = null;
function appChannel() {
  // Only in a page (in Node an open channel keeps the process running).
  if (!channel && globalThis.window && globalThis.BroadcastChannel) channel = new BroadcastChannel(CHANNEL);
  return channel;
}
export function announceCleared() {
  try { appChannel()?.postMessage({ type: "cleared" }); } catch (error) { ignore(error, "other windows reload when they are next used"); }
}
export function followClears({ reload, log }) {
  const listening = appChannel();
  if (!listening) return;
  listening.addEventListener("message", (event) => {
    if (event.data?.type !== "cleared") return;
    log("The app's storage was cleared in another window: reloading");
    reload();
  });
}

// When this app's storage was last cleared (0: never).
export function clearedAt(store = globalThis.localStorage) {
  try { return Number(store?.getItem(CLEARED_KEY)) || 0; } catch (error) { ignore(error, "storage is blocked: never cleared, as far as can be told"); return 0; }
}

export function addMaintenanceCommands({ commands, confirm, notify, closeMenus, events, log, reloadNow = () => globalThis.location.reload() }) {
  commands.add({ id: "workspace.reset", title: "Reset to Default Workspace", menu: { id: "settings", group: 2, order: 1 }, async run() {
    const confirmed = await confirm({ title: "Reset to Default Workspace",
      message: "This deletes your current workspace, chat history, and settings, then reloads the default welcome workspace. This cannot be undone.",
      acceptLabel: "Reset", danger: true });
    if (!confirmed) return;
    closeMenus();
    log(`Workspace reset to default: keysRemoved=${clearAppStorage()}`);
    announceCleared();
    reloadNow();
  } });
  commands.add({ id: "shell.clear-cache", title: "Clear All Cache", menu: { id: "settings", group: 2, order: 3 }, danger: true, async run() {
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
