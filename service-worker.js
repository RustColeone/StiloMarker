const CACHE_NAME = "mdnotes-shell-v86";
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
  "./app/services/opfs-service.js",
  "./app/services/settings-service.js",
  "./app/services/storage-service.js",
  "./app/services/snapshot-service.js",
  "./app/services/sync-service.js",
  "./app/services/template-service.js",
  "./app/services/urldb-service.js",
  "./app/services/view-state-service.js",
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

  // NEVER intercept the SSE / EventSource stream. A service worker is terminated
  // by the browser after ~30s idle; if the SW is proxying the event stream via
  // respondWith(fetch(...)), that termination aborts the stream and forces the
  // EventSource to reconnect — a ~30s reconnect loop that drops realtime sync and
  // reverts in-progress edits. Returning (no respondWith) lets the browser own the
  // stream directly, independent of the SW lifecycle.
  if (
    url.pathname.endsWith("/api/events/stream") ||
    event.request.headers.get("accept") === "text/event-stream"
  ) {
    return;
  }

  // API responses are dynamic (server browse, access, workspace state): always
  // hit the network and never serve a cached copy, or the UI would show stale
  // data after server-side changes (e.g. a deleted project lingering in a list).
  if (url.pathname.includes("/api/")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(
        () => new Response(JSON.stringify({ error: "offline" }), {
          status: 503,
          headers: { "content-type": "application/json" }
        })
      )
    );
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