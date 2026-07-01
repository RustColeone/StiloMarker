import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { resolveFromRoot } from "./helpers/mocks.mjs";

test("required workspace files exist", () => {
  const requiredFiles = [
    "index.html",
    "app/main.js",
    "app/services/collaboration-service.js",
    "app/services/file-content-service.js",
    "app/services/mtree-module-map-service.js",
    "app/services/urldb-service.js",
    "app/domain/project-model.js",
    "app/services/zip-service.js",
    "app/services/offline-service.js",
    "app/services/sync-service.js",
    "server/mdnotes_server.py",
    "service-worker.js",
    "implementation-log.md"
  ];
  requiredFiles.forEach((relativePath) => {
    assert.equal(existsSync(resolveFromRoot(relativePath)), true, `Missing required file: ${relativePath}`);
  });
});

test("index.html exposes required element ids", async () => {
  const page = await readFile(resolveFromRoot("index.html"), "utf8");
  const ids = [
    "explorer-tree",
    "editor-content",
    "file-menu-button",
    "explorer-toggle-button",
    "presence-strip",
    "workspace-mode-toggle",
    "workspace-mode-row",
    "server-indicator",
    "display-name-input",
    "explorer-context-menu",
    "explorer-add-button",
    "explorer-filter-button",
    "add-file-dialog",
    "add-file-dropzone",
    "replace-file-input",
    "settings-menu-button",
    "toggle-debug-menu-button",
    "clear-cache-menu-button",
    "debug-panel",
    "debug-splitter",
    "debug-copy-button",
    "debug-tab-all",
    "editor-autocomplete",
    "new-urldb-button",
    "notice-dialog",
    "confirm-dialog",
    "input-dialog",
    "bookmark-entry-dialog",
    "mtree-tools-dialog",
    "mtree-target-file-select",
    "mtree-render-preview",
    "mtree-keep-button",
    "mtree-undo-button",
    "source-pane",
    "preview-pane",
    "editor-cursors"
  ];
  ids.forEach((id) => {
    assert.match(page, new RegExp(`id="${id}"`), `Missing element id: ${id}`);
  });
  assert.match(page, /accept="\.md,\.mtree,\.urldb,\.bmap,\.png,\.jpg,\.jpeg,\.gif,\.svg,\.webp,\.bmp,\.zip"/);
  assert.ok(!/id="mtree-generate-button"/.test(page));
});

test("main.js wires core feature symbols", async () => {
  const mainSource = await readFile(resolveFromRoot("app/main.js"), "utf8");
  const symbols = [
    /registerOfflineShell\(\)/,
    /createCollaborationRuntime/,
    /scheduleTextPatch/,
    /presenceSummaryText/,
    /generate-module-map/,
    /buildModuleMapSection/,
    /sourceOpenTabIds/,
    /previewOpenTabIds/,
    /text\/mdnotes-file-id/,
    /handleSaveCommand/,
    /openAddFileDialog/,
    /renderPreviewContent/,
    /isImageFileName/,
    /showEditorAutocomplete/,
    /replaceImageFile/,
    /logDebug/,
    /settingsMenuButton/,
    /toggleQuickAddMenu/,
    /toggleFilterMenu/,
    /workspaceMode/,
    /privateProjectSnapshot/,
    /switchWorkspaceMode/,
    /quickGenerateBmapFile/,
    /sendGenerationRequest/,
    /bmapGenerateScopeSelect/
  ];
  symbols.forEach((pattern) => assert.match(mainSource, pattern));
});

test("bmap-view.js wires interaction controls", async () => {
  const bmapViewSource = await readFile(resolveFromRoot("app/ui/bmap-view.js"), "utf8");
  assert.match(bmapViewSource, /const MIN_SNAP_STEP = 10/);
  assert.match(bmapViewSource, /let interactionMode = "readonly"/);
  assert.match(bmapViewSource, /function toggleInspectorCollapsed\(\)/);
  assert.match(bmapViewSource, /Snap \$\{snapStep\}/);
  assert.match(bmapViewSource, /setInteractionMode\(/);
  assert.match(bmapViewSource, /data-action="quick-generate"/);
  assert.match(bmapViewSource, /function collectGenerationContextFiles\(/);
  assert.match(bmapViewSource, /function buildBmapOverview\(/);
  assert.match(bmapViewSource, /onQuickGenerate/);
});

test("chat-api-service.js exposes generation request", async () => {
  const chatApiSource = await readFile(resolveFromRoot("app/services/chat-api-service.js"), "utf8");
  assert.match(chatApiSource, /function sendGenerationRequest\(/);
  assert.match(chatApiSource, /\/api\/generate/);
});

test("collaboration-service.js wires transport and OT", async () => {
  const collaborationSource = await readFile(resolveFromRoot("app/services/collaboration-service.js"), "utf8");
  const symbols = [
    /publishOperation/,
    /openEventStream/,
    /presence/,
    /reloadFromServer/,
    /baseRevision/,
    /localRevision/,
    /inFlightPatches/,
    /transformOffset/,
    /scheduleAwareness/,
    /getRole/,
    /session\.role/
  ];
  symbols.forEach((pattern) => assert.match(collaborationSource, pattern));
});

test("service-worker.js caches the app shell", async () => {
  const serviceWorkerSource = await readFile(resolveFromRoot("service-worker.js"), "utf8");
  assert.match(serviceWorkerSource, /mdnotes-shell-v\d+/);
  assert.match(serviceWorkerSource, /cache.addAll\(APP_SHELL\)/);
});

test("backend exposes collaboration + OT endpoints", async () => {
  const backendSource = await readFile(resolveFromRoot("server/mdnotes_server.py"), "utf8");
  const symbols = [
    /api\/events\/stream/,
    /api\/operations/,
    /sse-text-ops/,
    /patch-file/,
    /Persisting collaborative state/,
    /Backend self-test passed\./,
    /operation_log/,
    /_transform_offset/,
    /_rebase_patch/,
    /broadcast_cursor/,
    /api\/session\/presence/,
    /master_pin/,
    /master_tokens/,
    /master-pin/,
    /api\/generate/,
    /def _handle_generate\(/,
    /def generate\(/
  ];
  symbols.forEach((pattern) => assert.match(backendSource, pattern));
});
