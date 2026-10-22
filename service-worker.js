const CACHE_NAME = "mdnotes-shell-v0.2.34";
// The libraries served with the app (vendor/: each in a folder named for its
// version), kept across the app's versions once used.
const VENDOR_CACHE = "mdnotes-vendor";
// MathJax, and the extensions' libraries (their vendor/ folders: EXTENSION_LIBRARIES).
const VENDOR_FILES = ["./vendor/mathjax/3.2.2/tex-svg.js"];
// The extensions' files (EXTENSION_FILES), written by tools/protocol-sync.mjs.
importScripts("./extensions/offline.js");
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icons/stliomarker-icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./app/main.js",
  "./app/extensions.js",
  "./app/modules/shell/model/version.js",
  "./app/modules/shell/model/contributed-settings.js",
  "./app/styles.css",
  "./app/boot-theme.js",
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
  "./app/modules/file-types/model/reserved-names.js",
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
  "./app/modules/assistant/model/agent-tools.js",
  "./app/modules/assistant/model/agent-contract.js",
  "./app/modules/assistant/adapters/manual.js",
  "./app/modules/assistant/service/local-agent.js",
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
  "./app/modules/shell/model/command-search.js",
  "./app/modules/shell/model/dialog-text.js",
  "./app/modules/shell/model/themes.js",
  "./app/modules/shell/model/contributed-themes.js",
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
  "./app/modules/shell/adapters/desktop.js",
  "./app/modules/shell/adapters/maintenance.js",
  "./app/modules/shell/adapters/render.js",
  "./app/modules/shell/adapters/log-panel.js",
  "./app/modules/shell/adapters/command-line.js",
  "./app/modules/shell/adapters/reload.js",
  "./app/modules/shell/adapters/theme-picker.js",
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
  "./app/modules/cloud/adapters/desktop-server.js",
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
  "./app/modules/editor/adapters/editor-window.js",
  "./app/modules/editor/adapters/search-files.js",
  "./app/modules/editor/model/search.js",
  "./app/modules/editor/model/json.js",
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
  "./app/modules/sync/adapters/tabs.js",
  "./app/modules/sync/adapters/windows-item.js",
  "./app/modules/sync/model/rebase-log.js",
  "./app/modules/sync/model/window-view.js",
  "./app/modules/sync/service/broker.js",
  "./app/modules/sync/service/offline-merge.js",
  "./app/modules/sync/model/merge.js",
  "./app/modules/sync/adapters/away.js",
  "./app/modules/models/index.js",
  "./app/modules/models/model/stream.js",
  "./app/modules/models/model/agent-status.js",
  "./app/modules/models/adapters/agent.js",
  "./app/modules/models/adapters/settings-section.js",
  "./app/modules/models/adapters/server-agent.js",
  "./app/modules/characters/model/request.js",
  "./app/modules/characters/model/reply-request.js",
  "./app/modules/characters/model/read-tools.js",
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

// A new version installs and waits: an open tab keeps the version it started
// with (what it imports later comes from that version's cache), until the user
// takes the new one (Reload Window, which asks it to "take-over") or every tab
// is closed. A first install has nothing to wait for.
// A version from before 0.2.25 took over open tabs at once, and its pages
// have no "Update ready" to start a waiting one: replacing such a version,
// this one still takes over at once (once; from then on, versions wait).
function tookOverAtOnce(key) {
  const match = /^mdnotes-shell-v(\d+)\.(\d+)\.(\d+)$/.exec(key);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major === 0 && (minor < 2 || (minor === 2 && patch < 25));
}

// The libraries are fetched once (each address names its version); failing
// that, at their first use.
self.addEventListener("install", (event) => {
  const libraries = caches.open(VENDOR_CACHE).then((cache) => Promise.all([...VENDOR_FILES, ...self.EXTENSION_LIBRARIES].map((file) =>
    cache.match(file).then((hit) => hit ?? cache.add(file))))).catch((error) => console.warn("Libraries not kept for offline use yet.", error));
  event.waitUntil(Promise.all([caches.open(CACHE_NAME).then((cache) => cache.addAll([...APP_SHELL, ...self.EXTENSION_FILES])), libraries])
    .then(() => caches.keys())
    .then((keys) => (keys.some(tookOverAtOnce) ? self.skipWaiting() : undefined)));
});

self.addEventListener("message", (event) => {
  const kind = event.data?.type;
  if (kind === "take-over") { void self.skipWaiting(); return; }
  if (kind === "version") event.ports[0]?.postMessage({ version: CACHE_NAME.replace("mdnotes-shell-v", "") });
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== VENDOR_CACHE)
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

  // The server's requests go straight to the network, never through this
  // worker (nor its cache: they are always fresh). A worker kept busy by them
  // could not be replaced: a waiting version takes over only once the one in
  // use has nothing in hand, and the app asks the server something every few
  // seconds.
  if (url.pathname.includes("/api/")) {
    return;
  }

  // A library served with the app: from its cache once fetched (its address
  // names its version, so it never changes).
  if (url.pathname.includes("/vendor/")) {
    event.respondWith(caches.open(VENDOR_CACHE).then((cache) => cache.match(event.request).then((hit) => hit ?? fetch(event.request).then((response) => {
      if (response.ok && response.type === "basic") void cache.put(event.request, response.clone());
      return response;
    }))));
    return;
  }

  // Template payload should always be refreshed so default starter content stays up to date after deploys.
  if (url.pathname.includes("/Template/")) {
    event.respondWith(fetch(event.request, { cache: "no-store" }));
    return;
  }

  // From this version's own cache (a newer version waiting has its own, which
  // must not reach a tab running this one).
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(event.request)).then((cachedResponse) => {
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
            return caches.open(CACHE_NAME).then((cache) => cache.match("./index.html"));
          }
          return new Response("Offline", { status: 503, statusText: "Offline" });
        });
    })
  );
});