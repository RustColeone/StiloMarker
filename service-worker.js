const CACHE_NAME = "mdnotes-shell-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./app/main.js",
  "./app/styles.css",
  "./app/domain/project-model.js",
  "./app/domain/project-service.js",
  "./app/services/chat-api-service.js",
  "./app/services/chat-storage-service.js",
  "./app/services/bmap-service.js",
  "./app/services/collaboration-service.js",
  "./app/services/file-content-service.js",
  "./app/services/fs-access-service.js",
  "./app/services/markdown-service.js",
  "./app/services/mtree-module-map-service.js",
  "./app/services/offline-service.js",
  "./app/services/settings-service.js",
  "./app/services/storage-service.js",
  "./app/services/sync-service.js",
  "./app/services/template-service.js",
  "./app/services/urldb-service.js",
  "./app/services/zip-service.js",
  "./app/ui/bmap-view.js",
  "./app/ui/dom.js",
  "./app/ui/explorer-view.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // Template payload should always be refreshed so default starter content stays up to date after deploys.
  if (url.pathname.includes("/Template/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
            return networkResponse;
          }

          // Never cache an HTML response for a non-HTML URL (SPA fallback poisoning).
          const ct = networkResponse.headers.get("content-type") || "";
          const isHtmlResponse = ct.includes("text/html");
          const isHtmlUrl = new URL(event.request.url).pathname.endsWith(".html")
            || new URL(event.request.url).pathname === "/";
          if (isHtmlResponse && !isHtmlUrl) {
            return networkResponse;
          }

          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return networkResponse;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
    })
  );
});