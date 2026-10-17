const CACHE_NAME = "mdnotes-shell-v0.1.48";
// The extensions' files (EXTENSION_FILES), written by tools/protocol-sync.mjs.
importScripts("./extensions/offline.js");
const APP_SHELL = [
  "./",
  "./index.html",
  "./app/main.js",
  "./app/extensions.js",
  "./app/version.js",
  "./app/styles.css",
  "./app/domain/project-model.js",
  "./app/services/chat-api-service.js",
  "./app/services/chat-sync-service.js",
  "./app/services/chat-ui-service.js",
  "./app/services/mcp-ui-service.js",
  "./app/services/session-recovery-service.js",
  "./app/services/chat-storage-service.js",
  "./app/services/bmap-service.js",
  "./app/services/project-save-service.js",
  "./app/services/file-content-service.js",
  "./app/services/fs-access-service.js",
  "./app/services/mtree-module-map-service.js",
  "./app/services/offline-service.js",
  "./app/services/opfs-service.js",
  "./app/services/persona-service.js",
  "./app/services/settings-service.js",
  "./app/services/storage-service.js",
  "./app/services/sync-service.js",
  "./app/services/template-service.js",
  "./app/services/view-state-service.js",
  "./app/services/zip-service.js",
  "./app/ui/bmap-view.js",
  "./app/ui/dom.js",
  "./app/ui/explorer-view.js",
  "./app/kernel/index.js",
  "./app/modules/shell/index.js",
  "./app/modules/file-types/index.js",
  "./app/modules/file-types/model/types.js",
  "./app/modules/file-types/model/builtin-types.js",
  "./app/modules/file-types/adapters/page.js",
  "./app/modules/workspace/index.js",
  "./app/modules/workspace/model/hunks.js",
  "./app/modules/workspace/model/text-patch.js",
  "./app/modules/workspace/service/writer.js",
  "./app/modules/workspace/model/project.js",
  "./app/modules/workspace/service/project-store.js",
  "./app/features/workspace-ports.js",
  "./app/features/agent-undo.js",
  "./app/modules/characters/index.js",
  "./app/modules/characters/model/persona.js",
  "./app/modules/assistant/index.js",
  "./app/modules/assistant/model/edits.js",
  "./app/modules/shell/model/keys.js",
  "./app/modules/shell/model/menu-layout.js",
  "./app/modules/shell/service/commands.js",
  "./app/modules/shell/adapters/dialogs.js",
  "./app/modules/shell/adapters/keyboard.js",
  "./app/modules/shell/adapters/menu-bar.js",
  "./app/modules/shell/adapters/server.js",
  "./app/modules/identity/index.js",
  "./app/modules/identity/model/credentials.js",
  "./app/modules/identity/service/account.js",
  "./app/modules/identity/adapters/api.js",
  "./app/modules/editor/index.js",
  "./app/modules/editor/model/markdown.js",
  "./app/modules/editor/adapters/editor-core.js",
  "./app/modules/editor/adapters/editor-dom.js",
  "./app/modules/editor/adapters/editor-render.js",
  "./app/modules/editor/adapters/editor-history.js",
  "./app/modules/editor/adapters/editor-cursors.js",
  "./app/modules/editor/adapters/editor-toolbar.js",
  "./app/modules/editor/adapters/editor-keys.js",
  "./app/modules/editor/adapters/highlight.js",
  "./app/modules/editor/adapters/find-replace.js",
  "./app/modules/editor/adapters/autocomplete.js",
  "./app/modules/editor/adapters/links.js",
  "./app/modules/editor/adapters/format-toolbar.js",
  "./app/modules/editor/adapters/table-picker.js",
  "./app/modules/comments/adapters/popover.js",
  "./app/modules/chats/index.js",
  "./app/modules/chats/adapters/api.js",
  "./app/modules/chats/adapters/local-records.js",
  "./app/modules/chats/adapters/view.js",
  "./app/modules/chats/service/local-chats.js",
  "./app/modules/comments/index.js",
  "./app/modules/comments/model/anchors.js",
  "./app/modules/comments/adapters/api.js",
  "./app/modules/history/index.js",
  "./app/modules/history/model/diff.js",
  "./app/modules/history/adapters/api.js",
  "./app/modules/history/adapters/local-store.js",
  "./app/modules/sync/index.js",
  "./app/modules/sync/model/contract.js",
  "./app/modules/sync/model/rebase.js",
  "./app/modules/sync/model/paths.js",
  "./app/modules/sync/model/errors.js",
  "./app/modules/sync/service/runtime.js",
  "./app/modules/sync/service/patches.js",
  "./app/modules/sync/adapters/api.js",
  "./app/modules/sync/adapters/page.js",
  "./app/modules/models/index.js",
  "./app/modules/models/model/stream.js",
  "./app/modules/models/model/catalog.js",
  "./app/modules/models/adapters/direct.js",
  "./app/features/module-map-tools.js",
  "./app/features/workspace-history.js",
  "./app/features/snapshots-dialog.js",
  "./app/features/chat-panel.js",
  "./app/features/cloud-browser.js",
  "./app/features/file-actions.js",
  "./app/features/previews.js",
  "./app/modules/editor/adapters/tabs.js",
  "./app/modules/editor/adapters/preview.js",
  "./app/ui/layout.js",
  "./app/ui/dialogs.js",
  "./app/features/snapshots.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...self.EXTENSION_FILES])).then(() => self.skipWaiting())
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
  // stream directly, independent of the SW lifecycle. (EventSource always
  // asks for text/event-stream.)
  if (event.request.headers.get("accept") === "text/event-stream") {
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