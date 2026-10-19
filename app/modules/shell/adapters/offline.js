// The app's files kept for offline use (the service worker and its caches):
// registering it, and clearing them. Every version's cache is named
// "mdnotes-shell-v<version>" (service-worker.js).
const CACHE_PREFIX = "mdnotes-shell-";

async function registerOfflineShell() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return false;
  }

  try {
    await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
    return true;
  } catch (error) {
    console.warn("Service worker registration failed.", error);
    return false;
  }
}

async function clearOfflineShellData() {
  const deletedCacheKeys = [];
  const unregisteredScopes = [];

  if ("caches" in globalThis) {
    const cacheKeys = await caches.keys();
    for (const key of cacheKeys) {
      if (!key.startsWith(CACHE_PREFIX)) {
        continue;
      }
      if (await caches.delete(key)) {
        deletedCacheKeys.push(key);
      }
    }
  }

  if ("serviceWorker" in navigator && typeof navigator.serviceWorker.getRegistrations === "function") {
    const baseScope = new URL("./", globalThis.location?.href ?? "/").href;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      if (!registration.scope.startsWith(baseScope)) {
        continue;
      }
      if (await registration.unregister()) {
        unregisteredScopes.push(registration.scope);
      }
    }
  }

  return { deletedCacheKeys, unregisteredScopes };
}

export { CACHE_PREFIX, clearOfflineShellData, registerOfflineShell };
// The server refused this tab as out of date (a stale cached app, e.g. a tab
// open for days); syncing has already stopped. Bring the app up to date: the
// service worker unregistered (so the reload fetches fresh files instead of
// the old cache), then a reload. At most once per tab, so a misconfigured
// minimum can't trap it in a reload loop.
let upgrading = false;
export async function upgradeApp(detail, { log, notify, toast, ignore }) {
  if (upgrading) return;
  upgrading = true;
  const message = detail || "This app is out of date.";
  log("response", "Upgrade required", message);
  if (globalThis.sessionStorage?.getItem("mdnotes.upgradeReloaded")) {
    // Reloaded once already and still out of date: ask, rather than loop.
    notify(`${message} Please fully close this tab and reopen it to finish updating.`);
    return;
  }
  try { sessionStorage.setItem("mdnotes.upgradeReloaded", "1"); } catch (error) { ignore(error, "session storage is blocked"); }
  try { toast("Updating to the latest version…", { duration: 1500 }); } catch (error) { ignore(error, "showing the update toast failed"); }
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (error) { ignore(error, "unregistering the service worker failed; reloading anyway"); }
  setTimeout(() => globalThis.location.reload(), 1200);
}
