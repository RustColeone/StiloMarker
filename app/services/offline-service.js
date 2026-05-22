const CACHE_NAME = "mdnotes-shell-v1";
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
      if (key !== CACHE_NAME && !key.startsWith(CACHE_PREFIX)) {
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

export { CACHE_NAME, clearOfflineShellData, registerOfflineShell };