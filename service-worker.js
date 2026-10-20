const CACHE_NAME = "mdnotes-shell-v0.2.6";
// The extensions' files (EXTENSION_FILES), written by tools/protocol-sync.mjs.
importScripts("./extensions/offline.js");
const APP_SHELL = [
  "./",
  "./index.html",
  "./app/main.js",
  "./app/extensions.js",
  "./app/modules/shell/model/version.js",
  "./app/modules/shell/model/contributed-settings.js",
  "./app/styles.css",
  "./app/domain/project-model.js",
  "./app/services/persona-service.js",
  "./app/modules/identity/adapters/stored-sign-in.js",
  "./app/modules/workspace/adapters/template.js",
  "./app/kernel/index.js",
  "./app/kernel/trace.js",
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
  "./app/modules/characters/index.js",
  "./app/modules/characters/model/persona.js",
  "./app/modules/assistant/index.js",
  "./app/modules/assistant/model/edits.js",
  "./app/modules/assistant/model/undo.js",
  "./app/modules/assistant/model/review.js",
  "./app/modules/assistant/adapters/review.js",
  "./app/modules/assistant/adapters/panel.js",
  "./app/modules/assistant/adapters/conversations.js",
  "./app/modules/assistant/adapters/threads.js",
  "./app/modules/assistant/adapters/render.js",
  "./app/modules/assistant/adapters/turns.js",
  "./app/modules/assistant/adapters/proposals.js",
  "./app/modules/assistant/adapters/events.js",
  "./app/modules/assistant/adapters/api.js",
  "./app/modules/assistant/adapters/store.js",
  "./app/modules/assistant/adapters/workspace-sync.js",
  "./app/modules/assistant/adapters/mcp.js",
  "./app/modules/shell/model/keys.js",
  "./app/modules/shell/model/menu-layout.js",
  "./app/modules/shell/service/commands.js",
  "./app/modules/shell/adapters/dialogs.js",
  "./app/modules/shell/adapters/keyboard.js",
  "./app/modules/shell/adapters/menu-bar.js",
  "./app/modules/shell/adapters/page-errors.js",
  "./app/modules/shell/adapters/pages.js",
  "./app/modules/shell/adapters/settings-dialog.js",
  "./app/modules/shell/adapters/status-bar.js",
  "./app/modules/shell/adapters/offline.js",
  "./app/modules/shell/adapters/maintenance.js",
  "./app/modules/shell/adapters/render.js",
  "./app/modules/shell/adapters/log-panel.js",
  "./app/modules/editor/adapters/debug-trace.js",
  "./app/modules/editor/adapters/together.js",
  "./app/modules/shell/adapters/frame/index.js",
  "./app/modules/shell/adapters/frame/areas.js",
  "./app/modules/shell/adapters/frame/drawer.js",
  "./app/modules/shell/adapters/frame/sheet.js",
  "./app/modules/shell/adapters/frame/phone.js",
  "./app/modules/editor/adapters/frame-parts.js",
  "./app/modules/shell/adapters/theme.js",
  "./app/modules/shell/adapters/conversation.js",
  "./app/modules/shell/adapters/settings-store.js",
  "./app/modules/shell/service/settings.js",
  "./app/modules/shell/adapters/server.js",
  "./app/modules/identity/index.js",
  "./app/modules/identity/model/colors.js",
  "./app/modules/identity/model/credentials.js",
  "./app/modules/identity/service/account.js",
  "./app/modules/identity/adapters/api.js",
  "./app/modules/editor/index.js",
  "./app/modules/cloud/index.js",
  "./app/modules/cloud/adapters/surface.js",
  "./app/modules/cloud/adapters/api.js",
  "./app/modules/cloud/adapters/accounts.js",
  "./app/modules/cloud/adapters/settings-section.js",
  "./app/modules/cloud/adapters/server-item.js",
  "./app/modules/cloud/adapters/resume.js",
  "./app/modules/cloud/adapters/projects.js",
  "./app/modules/cloud/service/recovery.js",
  "./app/modules/cloud/adapters/browser.js",
  "./app/modules/cloud/adapters/manage.js",
  "./app/modules/cloud/adapters/access.js",
  "./app/modules/cloud/adapters/opening.js",
  "./app/modules/cloud/adapters/providers.js",
  "./app/modules/cloud/adapters/events.js",
  "./app/modules/explorer/index.js",
  "./app/modules/explorer/model/names.js",
  "./app/modules/explorer/adapters/surface.js",
  "./app/modules/explorer/adapters/tree.js",
  "./app/modules/explorer/adapters/moves.js",
  "./app/modules/explorer/adapters/adding.js",
  "./app/modules/explorer/adapters/naming.js",
  "./app/modules/explorer/adapters/exporting.js",
  "./app/modules/explorer/adapters/actions.js",
  "./app/modules/explorer/adapters/events.js",
  "./app/modules/workspace/adapters/file-content.js",
  "./app/modules/workspace/adapters/zip.js",
  "./app/modules/workspace/adapters/browser-copy.js",
  "./app/modules/workspace/adapters/disk-folders.js",
  "./app/modules/workspace/adapters/device-folders.js",
  "./app/modules/workspace/adapters/save-queue.js",
  "./app/modules/workspace/adapters/saving.js",
  "./app/modules/workspace/adapters/status-items.js",
  "./app/modules/workspace/adapters/page-life.js",
  "./app/modules/workspace/adapters/location.js",
  "./app/modules/workspace/adapters/shared.js",
  "./app/modules/editor/model/markdown.js",
  "./app/modules/editor/model/html.js",
  "./app/modules/workspace/model/paths.js",
  "./app/modules/editor/service/view.js",
  "./app/modules/editor/service/marks.js",
  "./app/modules/editor/model/font.js",
  "./app/modules/editor/adapters/settings-fields.js",
  "./app/modules/editor/adapters/char-count.js",
  "./app/modules/editor/adapters/preview-pane.js",
  "./app/modules/editor/adapters/editor-core.js",
  "./app/modules/editor/adapters/surface.js",
  "./app/modules/editor/adapters/editor-events.js",
  "./app/modules/editor/adapters/show-file.js",
  "./app/modules/editor/adapters/resume.js",
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
  "./app/modules/chats/adapters/page.js",
  "./app/modules/chats/index.js",
  "./app/modules/chats/adapters/api.js",
  "./app/modules/chats/adapters/local-records.js",
  "./app/modules/chats/adapters/view.js",
  "./app/modules/chats/service/local-chats.js",
  "./app/modules/comments/index.js",
  "./app/modules/comments/model/anchors.js",
  "./app/modules/comments/adapters/api.js",
  "./app/modules/history/index.js",
  "./app/modules/history/adapters/surface.js",
  "./app/modules/history/adapters/snapshots.js",
  "./app/modules/history/adapters/snapshots-dialog.js",
  "./app/modules/history/adapters/workspace-history.js",
  "./app/modules/history/model/diff.js",
  "./app/modules/history/adapters/api.js",
  "./app/modules/history/adapters/trash.js",
  "./app/modules/history/adapters/local-store.js",
  "./app/modules/sync/index.js",
  "./app/modules/sync/adapters/session-view.js",
  "./app/modules/sync/adapters/connection.js",
  "./app/modules/sync/model/contract.js",
  "./app/modules/sync/model/rebase.js",
  "./app/modules/sync/model/paths.js",
  "./app/modules/sync/model/errors.js",
  "./app/modules/sync/service/mode.js",
  "./app/modules/sync/service/status.js",
  "./app/modules/sync/service/runtime.js",
  "./app/modules/sync/service/patches.js",
  "./app/modules/sync/adapters/api.js",
  "./app/modules/sync/adapters/page.js",
  "./app/modules/models/index.js",
  "./app/modules/models/model/stream.js",
  "./app/modules/models/model/agent-status.js",
  "./app/modules/models/adapters/agent.js",
  "./app/modules/models/adapters/settings-section.js",
  "./app/modules/models/adapters/server-agent.js",
  "./app/modules/characters/model/request.js",
  "./app/modules/models/model/catalog.js",
  "./app/modules/models/adapters/direct.js",
  "./app/modules/chats/adapters/sheet.js",
  "./app/modules/editor/adapters/tabs.js",
  "./app/modules/editor/adapters/tab-menu.js",
  "./app/modules/editor/adapters/groups.js",
  "./app/modules/editor/adapters/elements.js",
  "./app/modules/explorer/adapters/elements.js",
  "./app/modules/cloud/adapters/elements.js",
  "./app/modules/assistant/adapters/elements.js",
  "./app/modules/editor/adapters/preview.js"
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