// The app's files kept for offline use (the service worker and its caches):
// registering it, and clearing them. Every version's cache is named
// "mdnotes-shell-v<version>" (service-worker.js).
import { ignored } from "../../../kernel/index.js";

const CACHE_PREFIX = "mdnotes-shell-";

// A new version that waits (service-worker.js): onUpdate(version) is told
// once it has installed, while this tab keeps its own, and Reload Window
// starts it (takeUpdate). Taken in another window, it controls this one too
// (onTakenElsewhere: this one reloads, or it would mix versions). New
// versions are looked for every half hour and when the page shows again.
const LOOK_EVERY = 30 * 60 * 1000;
let registration = null;
let taking = false; // this window asked the waiting version to take over

const ask = (worker, message, ms = 3000) => new Promise((resolve) => {
  const channel = new MessageChannel();
  const timer = setTimeout(() => resolve(null), ms);
  channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
  worker.postMessage(message, [channel.port2]);
});

// The waiting version takes over: resolves true once it controls the page, or
// false after TAKE_WAIT. The browser swaps versions once the one in use has
// stopped, and asks it to stop as soon as it is idle only if it is running
// when the new one asks to take over; it asks again only after the old one
// has handled another request. A message to the old one would not do (the
// browser may still count it as work when the old one asks to stop), a
// request from this page does: so a small file is asked for through it first
// (it is then running), the new version asked once (asking again changes
// nothing), and the file asked for again every second until the swap.
const TAKE_WAIT = 45000;
const NUDGE_EVERY = 1000;
async function takeOver(worker) {
  taking = true;
  let nudging = null;
  const changed = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), TAKE_WAIT);
    navigator.serviceWorker.addEventListener("controllerchange", () => { clearTimeout(timer); resolve(true); }, { once: true });
  }).finally(() => clearInterval(nudging));
  const nudge = () => fetch("./manifest.webmanifest", { cache: "no-store" })
    .catch(ignored("a nudge to the version in use failed: the next one may not"));
  await nudge();
  worker.postMessage({ type: "take-over" });
  nudging = setInterval(nudge, NUDGE_EVERY);
  return changed;
}

async function registerOfflineShell({ onUpdate = () => {}, onTakenElsewhere = () => {} } = {}) {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    return false;
  }

  try {
    registration = await navigator.serviceWorker.register("./service-worker.js", { scope: "./" });
  } catch (error) {
    console.warn("Service worker registration failed.", error);
    return false;
  }
  // Service workers turned off (a browser's setting, or a test's): none to watch.
  if (!registration) return false;
  // Only an update matters: the first install controls nothing yet.
  const ready = async (worker) => {
    if (!worker || !navigator.serviceWorker.controller) return;
    const answer = await ask(worker, { type: "version" });
    onUpdate(answer?.version ?? null);
  };
  const watch = (worker) => worker?.addEventListener("statechange", () => { if (worker.state === "installed") void ready(worker); });
  // The first install controls this page too (it claims it): nothing to follow then.
  const controlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (controlled && !taking) onTakenElsewhere(); });
  void ready(registration.waiting);
  watch(registration.installing);
  registration.addEventListener("updatefound", () => watch(registration.installing));
  const look = () => { void registration.update().catch(ignored("looking for a new version failed (offline?): looked for again later")); };
  setInterval(look, LOOK_EVERY);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") look(); });
  return true;
}

// The waiting version takes over this tab (and every other): resolves true
// once it controls the page (the caller then reloads), false if it did not.
async function takeUpdate() {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  return takeOver(waiting);
}

const updateWaiting = () => Boolean(registration?.waiting && navigator.serviceWorker?.controller);

async function clearOfflineShellData() {
  const deletedCacheKeys = [];
  const unregisteredScopes = [];

  if ("caches" in globalThis) {
    const cacheKeys = await caches.keys();
    for (const key of cacheKeys) {
      if (!key.startsWith(CACHE_PREFIX) && key !== "mdnotes-vendor") {
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

export { CACHE_PREFIX, clearOfflineShellData, registerOfflineShell, takeUpdate, updateWaiting };
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
