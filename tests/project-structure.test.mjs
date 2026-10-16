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
    // Docs: the planning files were consolidated into docs/ (see docs/HISTORY.md).
    "README.md",
    "docs/ISSUES.md",
    "docs/HISTORY.md"
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
    "debug-panel",
    "debug-splitter",
    "debug-copy-button",
    "debug-tab-all",
    "editor-autocomplete",
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
  // File inputs ask the File types module for their accept list (no type is spelled here).
  assert.match(page, /id="import-file-input" type="file" data-file-accept="all" data-file-accept-extra=".zip"/);
  assert.ok(!/id="mtree-generate-button"/.test(page));
});

test("main.js wires core feature symbols", async () => {
  // Code split out of main.js lives in app/features/, app/editor/ and app/ui/;
  // the wiring may be in any of them.
  const { readdir } = await import("node:fs/promises");
  const split = [];
  for (const dir of ["app/features", "app/editor", "app/ui"]) {
    for (const name of (await readdir(resolveFromRoot(dir))).filter((n) => n.endsWith(".js"))) split.push(`${dir}/${name}`);
  }
  const mainSource = [await readFile(resolveFromRoot("app/main.js"), "utf8"),
    ...await Promise.all(split.map((file) => readFile(resolveFromRoot(file), "utf8")))].join("\n");
  const symbols = [
    /registerOfflineShell\(\)/,
    /createCollaborationRuntime/,
    /scheduleTextPatch/,
    /presenceSummaryText/,
    /generate-module-map/,
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
    /shell\.menus\.add\(\{ id: "settings"/,
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

test("feature modules split out of main.js load on demand", async () => {
  const mainSource = await readFile(resolveFromRoot("app/main.js"), "utf8");
  const moduleMap = await readFile(resolveFromRoot("app/features/module-map-tools.js"), "utf8");
  assert.match(moduleMap, /buildModuleMapSection/);
  assert.match(mainSource, /import\("\.\/features\/module-map-tools\.js"\)/);
  assert.match(mainSource, /import\("\.\/ui\/bmap-view\.js"\)/);
  // Not imported statically any more (that would load them at startup).
  assert.doesNotMatch(mainSource, /^import .*(bmap-view|module-map-tools|mtree-module-map-service)/m);
});

test("module instances created on first use are declared with var", async () => {
  // main.js forwards calls to split-out modules through functions that create
  // the module on first use. Those functions are hoisted and can run during
  // startup, before the line holding the instance — a \`let\` there throws.
  const mainSource = await readFile(resolveFromRoot("app/main.js"), "utf8");
  assert.doesNotMatch(mainSource, /^(let|const) \w+Instance\b/m);
  assert.ok((mainSource.match(/^var \w+Instance;/gm) ?? []).length >= 4);
});

test("the offline app shell lists every app module", async () => {
  // The service worker precaches this list; a module missing from it breaks the
  // app offline (or after an update) the first time that module is needed.
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => (await Promise.all((await readdir(resolveFromRoot(dir), { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const worker = await readFile(resolveFromRoot("service-worker.js"), "utf8");
  const missing = (await walk("app")).filter((file) => file.endsWith(".js") && !worker.includes(`"./${file}"`));
  assert.deepEqual(missing, []);
});

test("every on-demand import points at a file that exists", async () => {
  // Modules split out of main.js load with import("..."); a wrong relative path
  // only fails when that feature is first opened, so check them all here.
  const { readdir } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const walk = async (dir) => (await Promise.all((await readdir(resolveFromRoot(dir), { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const files = (await walk("app")).filter((file) => file.endsWith(".js"));
  let checked = 0;
  for (const file of files) {
    const source = await readFile(resolveFromRoot(file), "utf8");
    for (const [, target] of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const resolved = join(dirname(file), target);
      assert.equal(existsSync(resolveFromRoot(resolved)), true, `${file}: import("${target}") → missing ${resolved}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 6, `expected the on-demand modules, found ${checked}`);
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
    /transformTextPatch/,
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
    /_transform_range/,
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
