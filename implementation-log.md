# MDNotes Implementation Log

## Phase 1

### 2026-03-11
- Switched the architecture from React/Vite to a static minimal-JS app using native ES modules.
- Defined a three-layer structure: domain, services, and UI.
- Started the first runnable vertical slice with these targets:
  - VS Code-style shell
  - project tree model with `.md` and `.mtree` gating
  - explorer actions
  - markdown editor with live preview
  - theme persistence
  - Chromium directory access scaffolding
  - export and self-test entry points

### Notes
- Rich-text WYSIWYG remains deferred. The current implementation path is source editing plus rendered preview.
- Zip import is intentionally deferred in the first slice to keep the implementation dependency-light.
- Export zip support is included in the first slice through a minimal built-in writer.

## Next Steps
- Finish the static app shell and initial services.
- Wire domain operations to the explorer and editor.
- Add tests for tree operations and export packaging.

## Validation

### 2026-03-11
- Added the first self-test entry point through `npm run selftest`.
- Verified the domain model, markdown preview renderer, zip export generator, and static shell markers through the self-test script.
- Fixed the initial accessibility error reported by the editor diagnostics.
- Tightened live-directory save logic so newly created folders can be materialized on disk in Chromium-backed sessions.
- Started the local static server and verified the served page exposes the expected shell: explorer, settings, save/export actions, source editor, and preview pane.

### Known Gaps After Phase 1 Slice
- Filesystem rename and delete are not yet mirrored back to disk. Current live-directory save behavior covers writing existing files and creating newly added folders/files.
- Service worker offline shell and Python sync are still deferred.

## Phase Status

### Phase 1 Result
- Complete enough for a first runnable slice.
- Entry points available:
  - `npm start` for local serving
  - `npm run selftest` for project self-validation

### Recommended Next Increment
- Mirror rename and delete operations back to the live filesystem when running against a Chromium-opened directory.
- Add a service worker so the app shell remains available offline.

## Phase 2

### 2026-03-11
- Added `.zip` to the fallback import path so users can reconstruct a project tree from an archive in-browser.
- Implemented a dependency-light ZIP reader that supports stored archives and deflate-compressed entries when the browser exposes `DecompressionStream`.
- Reconstructed imported ZIP contents into the same canonical project tree used by normal explorer actions.
- Extended the self-test to cover ZIP round-trip parsing and ZIP-to-project import.

### Current ZIP Import Scope
- Supported: `.md` and `.mtree` files inside ZIP archives.
- Ignored: unrelated file types in imported archives.
- Limitation: compressed ZIP entries rely on browser support for `DecompressionStream`; stored ZIP archives work without it.

## Phase 3

### 2026-03-11
- Added live-directory save reconciliation for Chromium-backed sessions so renamed and deleted items are mirrored back to disk on save.
- Rebuilt filesystem handles from the canonical project tree during save rather than trusting stale handles after rename operations.
- Added source-index tracking for imported live directories so save can determine which old paths must be removed before writing the new tree.
- Marked filesystem handles as transient storage-only state so reloaded browser sessions fall back to normal in-browser mode instead of pretending a live directory connection still exists.
- Extended the self-test with a mock filesystem to verify folder rename, file rewrite, and file deletion behavior.

### Current Live Directory Scope
- Supported on save: creating new folders/files, updating file contents, renaming folders/files, deleting folders/files.
- Limitation: reconnecting to a previously opened live directory after a page reload still requires the user to reopen that directory explicitly.

## Phase 4

### 2026-03-11
- Added a service worker and bootstrap registration so the static app shell can remain available offline after the first successful load.
- Pre-cached the current app shell assets and added a same-origin cache strategy with navigation fallback to `index.html`.
- Kept offline support isolated behind a small bootstrap service so it does not couple UI, domain, or filesystem code to service-worker APIs.
- Extended the self-test to verify the service worker entry points are present.

### Current Offline Scope
- Supported: cached app shell availability after an online load on secure contexts such as GitHub Pages or localhost.
- Limitation: the service worker caches the frontend shell, not live directory permissions or browser file handles.

## Phase 5

### 2026-03-11
- Added a thin frontend sync boundary with saved server URL and PIN settings, plus explicit Ping and Connect actions.
- Added a server status badge and settings feedback so the app can distinguish offline, reachable, and connected states without coupling collaboration code to the editor workflow.
- Defined initial backend expectations on the client side: `GET /api/ping` and `POST /api/session/connect`.
- Extended the self-test with a temporary mock HTTP server to validate the new ping and connect adapters.

### Current Sync Boundary Scope
- Supported: saving server URL and PIN, pinging a backend endpoint, and attempting a PIN-based connection handshake.
- Limitation: no event-stream synchronization is implemented yet; this is the boundary and handshake layer only.

## Phase 6

### 2026-03-11
- Implemented a real collaboration transport using a Python backend with HTTP session endpoints plus Server-Sent Events for live state propagation.
- Added a browser-side collaboration runtime that connects once, hydrates from server state, publishes local project snapshots, and applies remote project snapshots without feedback loops.
- Kept the sync payload free of browser-local handles by sanitizing project state before transport.
- Added a backend entry point that can also serve the static frontend directly on LAN so the app remains usable without GitHub Pages.
- Added backend self-test support through `python server/mdnotes_server.py --selftest`.

### Current Collaboration Transport Scope
- Supported: PIN-gated session connect, shared project snapshot state, SSE-based update delivery, browser-to-server state publish, and server-served static frontend.
- Limitation: transport currently syncs the canonical project snapshot rather than fine-grained text operations, so concurrent edits follow last-write-wins at the snapshot level.

### Validation
- Verified frontend transport contract through `npm run selftest`.
- Verified backend transport contract through `python server/mdnotes_server.py --selftest`.
- Smoke-tested the integrated backend-hosted mode by serving the app through the Python server and confirming both `/` and `/api/ping` responded correctly.

## Phase 7

### 2026-03-12
- Replaced whole-file text synchronization with minimal single-range text patch operations so normal typing no longer republishes the full file body on each edit.
- Added conflict detection on both client and server so overlapping remote edits force a state reload instead of silently overwriting newer content.
- Added optional collaborator display names to the PIN handshake and surfaced that identity in session status text.
- Aligned backend ping metadata with the active transport contract so runtime smoke checks report text-operation sync instead of the older snapshot label.

### Current Text Sync Scope
- Supported: file creation, rename, delete, full project replacement when needed, and incremental single-range text patches for editor typing.
- Limitation: this is still ordered server-mediated patching, not OT or CRDT; conflicting overlapping edits trigger a state reload instead of merge resolution.

## Phase 8

### 2026-03-12
- Reworked the editor pane into a scroll-contained workbench surface so long source or preview content no longer stretches the page viewport.
- Added line numbers, markdown-oriented source coloring, and persisted pane splitters for the explorer and preview widths.
- Added a real multi-tab strip that tracks more than one open file at a time instead of mirroring only the active file.
- Added a word-wrap setting with wrap enabled by default so the source pane fits the available width by default.
- Added `Save as PDF` under `File`, backed by print-to-PDF export of the rendered preview.
- Added optional MathJax preview typesetting through a CDN-loaded runtime so inline and display math render when network access is available.
- Tightened explorer context-menu cleanup so hidden menus do not retain stale positioning artifacts.

### Current Editor Scope
- Supported: internal scrolling for source and preview, persistent horizontal pane resizing, line numbering, markdown token coloring, multi-tab open-file state, wrap toggle, PDF export, and MathJax-enhanced preview rendering.
- Limitation: source highlighting is a lightweight in-house tokenizer rather than a full parser, and PDF export relies on the browser print dialog for final save behavior.

## Phase 9

### 2026-03-12 to 2026-03-15
- Split source and preview tab state so each pane can track its own open-file history instead of sharing a single active-tab model.
- Added drag from the explorer into either pane so files can be opened directly in source or preview targets.
- Reworked `.mtree` support to remove the older one-shot generate flow and replace it with live regeneration, editable output, and explicit keep/undo behavior.
- Added `Ctrl+S` and `Cmd+S` interception so save behavior is consistent inside the workbench.

### Current Pane Scope
- Supported: separate source and preview tab strips, drag-open from the explorer into either pane, live `.mtree` draft regeneration, and keyboard save shortcuts.
- Limitation: tab state is still local workbench state rather than a persisted session layout.

## Phase 10

### 2026-03-12 to 2026-03-15
- Fixed markdown preview rendering so inline and block HTML are preserved instead of escaped.
- Stopped module-map marker comments like `<!-- MODULE_MAP_END -->` from appearing as literal text in rendered preview.
- Kept comment passthrough narrow enough that preview rendering still follows the app's simple markdown model rather than becoming a full HTML document renderer.

### Current Markdown Rendering Scope
- Supported: raw inline HTML, block HTML passthrough, hidden HTML comments, standard markdown links, images, code fences, lists, and headings.
- Limitation: rendering is still intentionally lightweight and does not aim for full CommonMark parity.

## Phase 11

### 2026-03-13 to 2026-03-15
- Added first-class image asset support across the project model, filesystem import/save, zip import/export, and preview rendering.
- Added markdown image resolution against project-relative assets so local image references render correctly in preview and PDF export.
- Added custom `.mtree` source coloring and explorer icon differentiation.
- Added an explorer `+` quick-add menu, a funnel-based filter menu, delegated explorer right-click handling, image hover previews, and image replacement support.
- Added internal path and image reference autocomplete plus drag-an-image-into-editor insertion helpers for markdown authoring.

### Current Asset and Explorer Scope
- Supported: image files as project assets, previewing local images, explorer add/replace workflows, funnel filter menu, explorer hover thumbnails, path autocomplete, and markdown image insertion helpers.
- Limitation: remote image fetches still depend on browser/network policy and may be blocked by source hosts.

## Phase 12

### 2026-03-14 to 2026-03-15
- Added a docked debug panel with persistent visibility state and action/response logging around key user workflows.
- Reworked that panel into a VS Code-like bottom dock that reduces editor space instead of overlaying it.
- Added fixed debug tabs for `All`, `Actions`, and `Responses`, along with a `Copy All` clipboard action and scrollable log output.
- Added drag-to-reorder for source and preview tabs while intentionally keeping debug tabs fixed-order.
- Replaced the temporary text funnel with a CSS-drawn funnel icon.

### Current Debug Dock Scope
- Supported: bottom-docked debug panel, persisted height and visibility, filtered log tabs, clipboard export of log text, and non-reorderable debug tabs.
- Limitation: log export is clipboard-only; there is no dedicated file export or session replay view yet.

## Phase 13

### 2026-03-15
- Added `.urldb` as a first-class text file type for bookmark-style remote image albums.
- Implemented `.urldb` parsing, serialization, preview-table rendering, explorer expansion into derived image entries, and markdown drag/drop insertion from those entries.
- Added entry-level editing semantics so selecting a `.urldb` entry shows only its editable body in the source pane while the `[Entry Name]` header remains managed by the parent `.urldb` structure.
- Added entry-level rename and delete behaviors through the explorer so bookmark entries can be managed similarly to normal workspace items.
- Replaced browser `alert`, `confirm`, and `prompt` flows with in-app dialogs.
- Simplified create-file and create-folder behavior so new items are created immediately with sequential default names like `new markdown 1.md` and renamed later if needed.
- Added a clearer fallback for blocked remote image downloads by steering those cases toward `.urldb` entries instead of leaving a raw `NetworkError`.

### Current URL Album and Dialog Scope
- Supported: `.urldb` import/export/save, explorer expansion, entry preview, entry drag/drop into markdown, body-only entry editing in source, entry rename/delete, and workbench-native notice/confirm/input dialogs.
- Limitation: `.urldb` entries are explorer-derived children rather than true standalone nodes in the canonical project tree, so they are managed through file transforms rather than their own persisted node records.

## Validation

### 2026-03-12 to 2026-03-15
- Re-ran `npm run selftest` after each major frontend expansion, including tab split behavior, HTML preview fixes, image asset support, debug dock work, `.urldb` support, and dialog-based workflows.
- Kept editor diagnostics clean across the main runtime, explorer view, styles, project model, and new `.urldb` service during each implementation round.
- Extended the self-test to cover `.urldb` parsing and serialization helpers, the expanded static shell markers, and the newer debug dock and dialog entry points.

## Phase Status

### Current Frontend Result
- The static minimal-JS frontend is now well past the initial runnable slice and includes a substantially more complete workbench UX:
  - separate source and preview panes with independent tabs
  - markdown, `.mtree`, image, and `.urldb` workspace support
  - live filesystem save reconciliation in Chromium
  - fallback import/export in other browsers
  - offline shell support
  - Python-backed collaboration transport boundary and live session runtime
  - debug dock, autocomplete, asset helpers, and workbench-native dialogs

### Recommended Next Increment
- Tighten backend-side collaboration behavior around richer concurrent editing cases and decide whether `.urldb` entries should remain explorer-derived children or graduate into explicit domain-level subnodes.
- Consider replacing remaining browser-native flows that are still unavoidable, such as final PDF save through the print dialog, only if a browser-compatible alternative is worth the added complexity.