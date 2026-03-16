const CACHE_NAME = "mdnotes-shell-v1";

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

export { CACHE_NAME, registerOfflineShell };