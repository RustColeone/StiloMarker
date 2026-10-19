import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { resolveFromRoot } from "./helpers/mocks.mjs";

test("required workspace files exist", () => {
  const requiredFiles = [
    "index.html",
    "app/main.js",
    "app/modules/sync/service/runtime.js",
    "app/modules/workspace/adapters/file-content.js",
    "extensions/module-map/browser/model/module-map.js",
    "app/domain/project-model.js",
    "app/modules/workspace/adapters/zip.js",
    "app/modules/shell/adapters/offline.js",
    "app/modules/cloud/adapters/api.js",
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
  // The module map dialog is the module-map extension's own markup.
  const dialog = await readFile(resolveFromRoot("extensions/module-map/browser/adapters/dialog.js"), "utf8");
  for (const id of ["mtree-tools-dialog", "mtree-target-file-select", "mtree-render-preview", "mtree-keep-button", "mtree-undo-button"]) {
    assert.match(dialog, new RegExp(`id="${id}"`), `Missing element id: ${id}`);
  }
});

test("main.js only starts the modules; the features are wired in them", async () => {
  // Every feature lives in a module (or an extension) and wires itself there.
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => (await Promise.all((await readdir(resolveFromRoot(dir), { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const files = [...await walk("app/modules"), ...await walk("extensions")].filter((file) => file.endsWith(".js"));
  const source = (await Promise.all(files.map((file) => readFile(resolveFromRoot(file), "utf8")))).join("\n");
  const symbols = [
    /registerOfflineShell\(\)/,
    /workspace\.typed\(/,
    /layout\.show-session/,
    /view\.reset\(/,
    /text\/mdnotes-file-id/,
    /cloud\.import-file/,
    /openAddFileDialog/,
    /renderPreviewContent/,
    /showEditorAutocomplete/,
    /replaceImageFile/,
    /menus\.add\(\{ id: "settings"/,
    /toggleQuickAddMenu/,
    /toggleFilterMenu/,
    /mode\.share\(/,
    /mode\.leave\(/,
    /switchWorkspaceMode/,
    /explorer\.newFiles\.add/,
    /sendGenerationRequest/,
    /resumeSession\(\)/,
    /loadTemplateProject\(\)/
  ];
  symbols.forEach((pattern) => assert.match(source, pattern));
  // main.js imports the modules and starts them; it touches nothing on the page.
  const main = await readFile(resolveFromRoot("app/main.js"), "utf8");
  assert.match(main, /await startModules\(/);
  assert.doesNotMatch(main, /document|window|querySelector|\.attach\(|\.parts\(\)/);
  for (const [, target] of main.matchAll(/^import .* from "([^"]+)";$/gm)) {
    assert.match(target, /^\.\/(kernel|modules\/[a-z-]+)\/index\.js$|^\.\/extensions\.js$/, `main.js imports ${target}`);
  }
});

test("feature modules split out of main.js load on demand", async () => {
  const mainSource = await readFile(resolveFromRoot("app/main.js"), "utf8");
  // The module map dialog is the module-map extension's, loaded the first time it opens.
  const moduleMap = await readFile(resolveFromRoot("extensions/module-map/browser/adapters/tools.js"), "utf8");
  assert.match(moduleMap, /buildModuleMapSection/);
  const moduleMapExtension = await readFile(resolveFromRoot("extensions/module-map/browser/index.js"), "utf8");
  assert.match(moduleMapExtension, /import\("\.\/adapters\/tools\.js"\)/);
  assert.doesNotMatch(moduleMapExtension, /^import .*(tools|model\/module-map)\.js/m);
  // Its entry on a .mtree file's menu is the Explorer's extension point.
  assert.match(moduleMapExtension, /fileMenus\.add\(\{\s*id: TYPE,\s*entries: \[\["Generate Module Map", "generate-module-map"\]\]/);
  // The diagram editor is the diagram extension's, loaded the first time a diagram is shown.
  const diagramPreview = await readFile(resolveFromRoot("extensions/bmap-diagram/browser/adapters/preview.js"), "utf8");
  assert.match(diagramPreview, /import\("\.\/view\.js"\)/);
  // Not imported statically any more (that would load them at startup).
  assert.doesNotMatch(mainSource, /^import .*(bmap-view|module-map-tools|mtree-module-map-service)/m);
});

test("the server's entry only reads its settings and starts the modules", async () => {
  // Everything the server does is a module's (server/stilo/modules); the entry
  // file reads the command line and environment, starts them and listens.
  const entry = await readFile(resolveFromRoot("server/mdnotes_server.py"), "utf8");
  assert.doesNotMatch(entry, /^class /m, "no classes: a module owns any behaviour");
  assert.doesNotMatch(entry, /BaseHTTPRequestHandler|add_route|threading/, "no HTTP or threads of its own");
  for (const [, target] of entry.matchAll(/^from (\S+) import/gm)) {
    assert.match(target, /^(stilo\.kernel(\.log)?|stilo\.modules(\.identity)?|pathlib)$/, `the entry imports ${target}`);
  }
});

test("the offline app shell lists every app module", async () => {
  // The service worker precaches this list; a module missing from it breaks the
  // app offline (or after an update) the first time that module is needed.
  const { readdir } = await import("node:fs/promises");
  const walk = async (dir) => (await Promise.all((await readdir(resolveFromRoot(dir), { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const worker = await readFile(resolveFromRoot("service-worker.js"), "utf8") + await readFile(resolveFromRoot("extensions/offline.js"), "utf8");
  const missing = [...await walk("app"), ...await walk("extensions")].filter((file) => /\.(js|css)$/.test(file) && !worker.includes(`"./${file}"`));
  assert.deepEqual(missing, []);
});

test("every on-demand import points at a file that exists", async () => {
  // Modules split out of main.js load with import("..."); a wrong relative path
  // only fails when that feature is first opened, so check them all here.
  const { readdir } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const walk = async (dir) => (await Promise.all((await readdir(resolveFromRoot(dir), { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]))).flat();
  const files = [...await walk("app"), ...await walk("extensions")].filter((file) => file.endsWith(".js"));
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

test("the diagram editor (extensions/bmap-diagram) wires interaction controls", async () => {
  const bmapViewSource = await readFile(resolveFromRoot("extensions/bmap-diagram/browser/adapters/view.js"), "utf8");
  assert.match(bmapViewSource, /const MIN_SNAP_STEP = 10/);
  assert.match(bmapViewSource, /let interactionMode = "readonly"/);
  assert.match(bmapViewSource, /function toggleInspectorCollapsed\(\)/);
  assert.match(bmapViewSource, /Snap \$\{snapStep\}/);
  assert.match(bmapViewSource, /setInteractionMode\(/);
  assert.match(bmapViewSource, /data-action="quick-generate"/);
  assert.match(bmapViewSource, /function collectGenerationContextFiles\(/);
  assert.match(bmapViewSource, /function buildBmapOverview\(/);
  assert.match(bmapViewSource, /onQuickGenerate/);
  // Its settings, its Export As entries and a new diagram's content are registered by the extension.
  const extension = await readFile(resolveFromRoot("extensions/bmap-diagram/browser/index.js"), "utf8");
  assert.match(extension, /bmap-generate-scope-select/);
  assert.match(extension, /explorer\.fileMenus\.add/);
  assert.match(extension, /explorer\.newFiles\.add/);
});

test("the Assistant's api.js exposes generation request", async () => {
  const chatApiSource = await readFile(resolveFromRoot("app/modules/assistant/adapters/api.js"), "utf8");
  assert.match(chatApiSource, /function sendGenerationRequest\(/);
  assert.match(chatApiSource, /\/api\/generate/);
});

test("the sync runtime wires transport and OT", async () => {
  const collaborationSource = await readFile(resolveFromRoot("app/modules/sync/service/runtime.js"), "utf8")
    + await readFile(resolveFromRoot("app/modules/sync/model/rebase.js"), "utf8")
    + await readFile(resolveFromRoot("app/modules/sync/service/patches.js"), "utf8");
  const symbols = [
    /publishOperation/,
    /openEventStream/,
    /presence/,
    /reloadFromServer/,
    /baseRevision/,
    /localRevision/,
    /inFlight/,
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
  assert.match(serviceWorkerSource, /cache\.addAll\(\[\.\.\.APP_SHELL, \.\.\.self\.EXTENSION_FILES\]\)/);
});

test("backend exposes collaboration + OT endpoints", async () => {
  // Sharing a workspace live is the Sync module's (step 7c).
  const backendSource = await readFile(resolveFromRoot("server/mdnotes_server.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/sync/service/shared.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/sync/model/rebase.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/sync/adapters/routes.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/sync/__init__.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/assistant/adapters/routes.py"), "utf8")
    + await readFile(resolveFromRoot("server/stilo/modules/assistant/service/agent.py"), "utf8")
    + await readFile(resolveFromRoot("tests/backend-selftest.py"), "utf8");
  const symbols = [
    /api\/events\/stream/,
    /api\/operations/,
    /sse-text-ops/,
    /patch-file/,
    /Persisting collaborative state/,
    /Backend self-test passed\./,
    /class RebaseLog/,
    /def transform_range\(/,
    /def rebase\(/,
    /broadcast_cursor/,
    /api\/session\/presence/,
    /master_pin/,
    /role != "master"/,
    /master-pin/,
    /api\/generate/,
    /def generate\(/
  ];
  symbols.forEach((pattern) => assert.match(backendSource, pattern));
});
