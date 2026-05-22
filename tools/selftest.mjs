import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function run() {
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
    assert.equal(existsSync(resolve(root, relativePath)), true, `Missing required file: ${relativePath}`);
  });

  const projectModel = await import(pathToFileURL(resolve(root, "app/domain/project-model.js")).href);
  const zipService = await import(pathToFileURL(resolve(root, "app/services/zip-service.js")).href);
  const markdownService = await import(pathToFileURL(resolve(root, "app/services/markdown-service.js")).href);
  const mtreeService = await import(pathToFileURL(resolve(root, "app/services/mtree-module-map-service.js")).href);
  const urldbService = await import(pathToFileURL(resolve(root, "app/services/urldb-service.js")).href);
  const fsAccessService = await import(pathToFileURL(resolve(root, "app/services/fs-access-service.js")).href);
  const syncService = await import(pathToFileURL(resolve(root, "app/services/sync-service.js")).href);

  class MockFileHandle {
    constructor(name, content = "") {
      this.kind = "file";
      this.name = name;
      this.content = content;
    }

    async createWritable() {
      return {
        write: async (value) => {
          this.content = typeof value === "string" ? value : String(value);
        },
        close: async () => {}
      };
    }
  }

  class MockDirectoryHandle {
    constructor(name) {
      this.kind = "directory";
      this.name = name;
      this.directories = new Map();
      this.files = new Map();
    }

    async queryPermission() {
      return "granted";
    }

    async requestPermission() {
      return "granted";
    }

    async getDirectoryHandle(name, options = {}) {
      const current = this.directories.get(name);
      if (current) {
        return current;
      }
      if (!options.create) {
        throw new Error(`Directory not found: ${name}`);
      }
      const handle = new MockDirectoryHandle(name);
      this.directories.set(name, handle);
      return handle;
    }

    async getFileHandle(name, options = {}) {
      const current = this.files.get(name);
      if (current) {
        return current;
      }
      if (!options.create) {
        throw new Error(`File not found: ${name}`);
      }
      const handle = new MockFileHandle(name, "");
      this.files.set(name, handle);
      return handle;
    }

    async removeEntry(name, options = {}) {
      if (this.files.delete(name)) {
        return;
      }
      if (this.directories.has(name)) {
        if (!options.recursive) {
          throw new Error(`Recursive delete required for directory: ${name}`);
        }
        this.directories.delete(name);
        return;
      }
      throw new Error(`Entry not found: ${name}`);
    }
  }

  function getDirectoryByPath(rootHandle, path) {
    return path.split("/").filter(Boolean).reduce((handle, segment) => handle.directories.get(segment), rootHandle);
  }

  function getFileByPath(rootHandle, path) {
    const segments = path.split("/").filter(Boolean);
    const fileName = segments.pop();
    const parent = segments.length === 0 ? rootHandle : getDirectoryByPath(rootHandle, segments.join("/"));
    return parent?.files.get(fileName) ?? null;
  }

  let project = projectModel.createProject("Test");
  project = projectModel.addFolder(project, projectModel.ROOT_ID, "docs");
  const docsFolder = Object.values(project.nodes).find((node) => node.kind === "folder" && node.name === "docs");
  assert.ok(docsFolder, "Expected docs folder");

  project = projectModel.addFile(project, docsFolder.id, "readme.md", "# Hello");
  const fileNode = Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "readme.md");
  assert.ok(fileNode, "Expected markdown file");
  assert.equal(projectModel.getPath(project, fileNode.id), "docs/readme.md");

  assert.throws(() => projectModel.addFile(project, docsFolder.id, "bad.txt", "x"), /supported image files/);
  project = projectModel.addFile(project, docsFolder.id, "diagram.png", "data:image/png;base64,AAAA");
  assert.ok(Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "diagram.png"));
  project = projectModel.addFile(project, docsFolder.id, "references.urldb", "[Cover]\nurl = https://example.com/cover.jpg");
  assert.ok(Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "references.urldb"));
  assert.equal(projectModel.isUrlDbFileName("references.urldb"), true);

  project = projectModel.updateFileContent(project, fileNode.id, "## Updated");
  assert.equal(project.nodes[fileNode.id].dirty, true);
  project = projectModel.markFileSaved(project, fileNode.id);
  assert.equal(project.nodes[fileNode.id].dirty, false);
  project = projectModel.applySyncOperation(project, { type: "create-file", parentPath: "docs", name: "shared.md", content: "# Shared" });
  assert.ok(projectModel.getNodeIdByPath(project, "docs/shared.md"), "Expected synced file path lookup");
  project = projectModel.applySyncOperation(project, { type: "patch-file", path: "docs/shared.md", start: 8, end: 8, removedText: "", text: " live" });
  assert.equal(projectModel.getNodeByPath(project, "docs/shared.md").content, "# Shared live");

  const html = markdownService.renderMarkdown("# Title\n\n- item\n\n**bold**");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>item<\/li><\/ul>/);
  assert.match(html, /<strong>bold<\/strong>/);

  const htmlWithImage = markdownService.renderMarkdown("![Sketch](./diagram.png)", {
    resolveUrl(url) {
      return `resolved:${url}`;
    }
  });
  assert.match(htmlWithImage, /<img src="resolved:\.\/diagram\.png" alt="Sketch">/);

  const htmlWithRawMarkup = markdownService.renderMarkdown("Inline <sup>2</sup>\n\n<!-- MODULE_MAP_END -->\n<div class=\"callout\">Block HTML</div>");
  assert.match(htmlWithRawMarkup, /<p>Inline <sup>2<\/sup><\/p>/);
  assert.ok(!htmlWithRawMarkup.includes("&lt;!-- MODULE_MAP_END --&gt;"));
  assert.match(htmlWithRawMarkup, /<!-- MODULE_MAP_END -->/);
  assert.match(htmlWithRawMarkup, /<div class="callout">Block HTML<\/div>/);

  const moduleMap = mtreeService.buildModuleMapSection("Core; Root module\n\tChild; Child module\n");
  assert.match(moduleMap.section, /## Module Map/);
  assert.match(moduleMap.section, /Core/);
  assert.match(moduleMap.section, /Child/);
  assert.equal(moduleMap.warnings.length, 0);

  const updatedMarkdown = mtreeService.replaceOrAppendModuleMap("# Notes\n", moduleMap.section);
  assert.match(updatedMarkdown, /MODULE_MAP_START/);
  assert.match(updatedMarkdown, /## Module Map/);

  const urldbContent = urldbService.serializeUrlDb([
    { name: "Reference", url: "https://example.com/reference.jpg", description: "Pose sheet" }
  ]);
  assert.match(urldbContent, /\[Reference\]/);
  assert.match(urldbContent, /url = https:\/\/example.com\/reference.jpg/);
  const parsedUrlDb = urldbService.parseUrlDb(urldbContent);
  assert.equal(parsedUrlDb.length, 1);
  assert.equal(parsedUrlDb[0].description, "Pose sheet");
  const entryBody = urldbService.formatUrlDbEntryBody(parsedUrlDb[0]);
  assert.match(entryBody, /url = https:\/\/example.com\/reference.jpg/);
  const parsedEntryBody = urldbService.parseUrlDbEntryBody(entryBody);
  assert.equal(parsedEntryBody.description, "Pose sheet");
  const renamedUrlDb = urldbService.updateUrlDbEntry(urldbContent, parsedUrlDb[0].id, { name: "Reference 2" });
  assert.match(renamedUrlDb, /\[Reference 2\]/);
  const removedUrlDb = urldbService.removeUrlDbEntry(renamedUrlDb, urldbService.parseUrlDb(renamedUrlDb)[0].id);
  assert.equal(removedUrlDb, "");

  const blob = zipService.createZip([{ path: "docs/readme.md", content: "Hello" }]);
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);

  const entries = await zipService.extractZipEntries(blob);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "docs/readme.md");
  assert.equal(entries[0].content, "Hello");
  assert.ok(entries[0].bytes instanceof Uint8Array);

  const zipProject = await fsAccessService.importZipArchive(new File([blob], "bundle.zip", { type: "application/zip" }));
  const zipFile = Object.values(zipProject.nodes).find((node) => node.kind === "file" && node.name === "readme.md");
  assert.ok(zipFile, "Expected imported ZIP markdown file");

  const imageProject = await fsAccessService.importSingleFile(new File([Uint8Array.from([137, 80, 78, 71])], "diagram.png", { type: "image/png" }));
  const imageFile = Object.values(imageProject.nodes).find((node) => node.kind === "file" && node.name === "diagram.png");
  assert.ok(imageFile, "Expected imported image file");
  assert.match(imageFile.content, /^data:image\/png;base64,/);

  const rootHandle = new MockDirectoryHandle("root");
  const docsHandle = await rootHandle.getDirectoryHandle("docs", { create: true });
  const readmeHandle = await docsHandle.getFileHandle("readme.md", { create: true });
  readmeHandle.content = "# Old";
  const notesHandle = await rootHandle.getFileHandle("notes.md", { create: true });
  notesHandle.content = "notes";

  let liveProject = projectModel.createProject("Disk");
  liveProject = projectModel.addFolder(liveProject, projectModel.ROOT_ID, "docs");
  const docsNode = Object.values(liveProject.nodes).find((node) => node.kind === "folder" && node.name === "docs");
  liveProject = projectModel.addFile(liveProject, docsNode.id, "readme.md", "# Old");
  liveProject = projectModel.addFile(liveProject, projectModel.ROOT_ID, "notes.md", "notes");
  const liveReadme = Object.values(liveProject.nodes).find((node) => node.kind === "file" && node.name === "readme.md");
  const liveNotes = Object.values(liveProject.nodes).find((node) => node.kind === "file" && node.name === "notes.md");
  liveProject.sourceMode = "filesystem";
  liveProject.handles = { [projectModel.ROOT_ID]: rootHandle };
  liveProject.sourceIndex = {
    [docsNode.id]: { path: "docs", kind: "folder" },
    [liveReadme.id]: { path: "docs/readme.md", kind: "file" },
    [liveNotes.id]: { path: "notes.md", kind: "file" }
  };

  liveProject = projectModel.renameNode(liveProject, docsNode.id, "articles");
  liveProject = projectModel.updateFileContent(liveProject, liveReadme.id, "# Updated");
  liveProject = projectModel.removeNodeRecursive(liveProject, liveNotes.id);
  liveProject.handles = { [projectModel.ROOT_ID]: rootHandle };
  await fsAccessService.saveProjectToHandles(liveProject);

  assert.equal(getDirectoryByPath(rootHandle, "docs"), undefined);
  assert.ok(getDirectoryByPath(rootHandle, "articles"), "Expected renamed directory");
  assert.equal(getFileByPath(rootHandle, "notes.md"), null);
  assert.equal(getFileByPath(rootHandle, "articles/readme.md")?.content, "# Updated");
  assert.equal(liveProject.sourceIndex[liveReadme.id].path, "articles/readme.md");

  const syncServer = createServer((request, response) => {
    if (request.url === "/api/ping" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "pong", transport: "sse-text-ops" }));
      return;
    }

    if (request.url === "/api/session/connect" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        const payload = JSON.parse(body || "{}");
        if (payload.pin !== "2468") {
          response.writeHead(403, { "content-type": "application/json" });
          response.end(JSON.stringify({ message: "bad pin" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "connected", token: "good-token", clientId: "client-a", displayName: payload.displayName || "Peer a", revision: 0, sessionId: "default" }));
      });
      return;
    }

    if (request.url === "/api/session/state?token=good-token" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ project: projectModel.createProject("Server"), revision: 0, presence: [{ clientId: "client-a", displayName: "Peer a" }], sessionId: "default" }));
      return;
    }

    if (request.url === "/api/session/state?token=good-token" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "state stored", revision: 1 }));
      return;
    }

    if (request.url === "/api/operations?token=good-token" && request.method === "POST") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "operation stored", revision: 2 }));
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  const port = await new Promise((resolvePort) => {
    syncServer.listen(0, () => {
      resolvePort(syncServer.address().port);
    });
  });

  const serverUrl = `http://127.0.0.1:${port}`;
  const pingResult = await syncService.pingServer(serverUrl);
  assert.equal(pingResult.message, "pong");
  assert.equal(pingResult.transport, "sse-text-ops");
  const connectResult = await syncService.connectToServer(serverUrl, "2468", "Tester");
  assert.equal(connectResult.token, "good-token");
  assert.equal(connectResult.displayName, "Tester");
  const stateResult = await syncService.fetchSessionState(serverUrl, connectResult.token);
  assert.equal(stateResult.revision, 0);
  assert.equal(stateResult.sessionId, "default");
  const pushResult = await syncService.pushSessionState(serverUrl, connectResult.token, project);
  assert.equal(pushResult.revision, 1);
  const operationResult = await syncService.pushOperation(serverUrl, connectResult.token, { type: "patch-file", path: "docs/readme.md", start: 0, end: 0, removedText: "", text: "# New\n" });
  assert.equal(operationResult.revision, 2);
  await new Promise((resolveClose) => syncServer.close(resolveClose));

  const page = await readFile(resolve(root, "index.html"), "utf8");
  assert.match(page, /id="explorer-tree"/);
  assert.match(page, /id="editor-content"/);
  assert.match(page, /id="file-menu-button"/);
  assert.match(page, /id="explorer-toggle-button"/);
  assert.match(page, /id="presence-strip"/);
  assert.match(page, /id="workspace-mode-toggle"/);
  assert.match(page, /id="workspace-mode-row"/);
  assert.match(page, /accept="\.md,\.mtree,\.urldb,\.bmap,\.png,\.jpg,\.jpeg,\.gif,\.svg,\.webp,\.bmp,\.zip"/);
  assert.match(page, /id="server-indicator"/);
  assert.match(page, /id="display-name-input"/);
  assert.match(page, /id="explorer-context-menu"/);
  assert.match(page, /id="explorer-add-button"/);
  assert.match(page, /id="explorer-filter-button"/);
  assert.match(page, /id="add-file-dialog"/);
  assert.match(page, /id="add-file-dropzone"/);
  assert.match(page, /id="replace-file-input"/);
  assert.match(page, /id="settings-menu-button"/);
  assert.match(page, /id="toggle-debug-menu-button"/);
  assert.match(page, /id="clear-cache-menu-button"/);
  assert.match(page, /id="debug-panel"/);
  assert.match(page, /id="debug-splitter"/);
  assert.match(page, /id="debug-copy-button"/);
  assert.match(page, /id="debug-tab-all"/);
  assert.match(page, /id="editor-autocomplete"/);
  assert.match(page, /id="new-urldb-button"/);
  assert.match(page, /id="notice-dialog"/);
  assert.match(page, /id="confirm-dialog"/);
  assert.match(page, /id="input-dialog"/);
  assert.match(page, /id="bookmark-entry-dialog"/);
  assert.match(page, /id="mtree-tools-dialog"/);
  assert.ok(!/id="mtree-generate-button"/.test(page));
  assert.match(page, /id="mtree-target-file-select"/);
  assert.match(page, /id="mtree-render-preview"/);
  assert.match(page, /id="mtree-keep-button"/);
  assert.match(page, /id="mtree-undo-button"/);
  assert.match(page, /id="source-pane"/);
  assert.match(page, /id="preview-pane"/);
  assert.match(page, /id="editor-cursors"/);

  const mainSource = await readFile(resolve(root, "app/main.js"), "utf8");
  assert.match(mainSource, /registerOfflineShell\(\)/);
  assert.match(mainSource, /createCollaborationRuntime/);
  assert.match(mainSource, /scheduleTextPatch/);
  assert.match(mainSource, /presenceSummaryText/);
  assert.match(mainSource, /generate-module-map/);
  assert.match(mainSource, /buildModuleMapSection/);
  assert.match(mainSource, /sourceOpenTabIds/);
  assert.match(mainSource, /previewOpenTabIds/);
  assert.match(mainSource, /text\/mdnotes-file-id/);
  assert.match(mainSource, /handleSaveCommand/);
  assert.match(mainSource, /openAddFileDialog/);
  assert.match(mainSource, /renderPreviewContent/);
  assert.match(mainSource, /isImageFileName/);
  assert.match(mainSource, /showEditorAutocomplete/);
  assert.match(mainSource, /replaceImageFile/);
  assert.match(mainSource, /logDebug/);
  assert.match(mainSource, /settingsMenuButton/);
  assert.match(mainSource, /toggleQuickAddMenu/);
  assert.match(mainSource, /toggleFilterMenu/);
  // Workspace mode toggle
  assert.match(mainSource, /workspaceMode/);
  assert.match(mainSource, /privateProjectSnapshot/);
  assert.match(mainSource, /switchWorkspaceMode/);

  const collaborationSource = await readFile(resolve(root, "app/services/collaboration-service.js"), "utf8");
  assert.match(collaborationSource, /publishOperation/);
  assert.match(collaborationSource, /openEventStream/);
  assert.match(collaborationSource, /presence/);
  assert.match(collaborationSource, /reloadFromServer/);
  // OT additions
  assert.match(collaborationSource, /baseRevision/);
  assert.match(collaborationSource, /localRevision/);
  assert.match(collaborationSource, /inFlightPatches/);
  assert.match(collaborationSource, /transformOffset/);
  assert.match(collaborationSource, /scheduleAwareness/);
  // Role-aware connect
  assert.match(collaborationSource, /getRole/);
  assert.match(collaborationSource, /session\.role/);

  const serviceWorkerSource = await readFile(resolve(root, "service-worker.js"), "utf8");
  assert.match(serviceWorkerSource, /mdnotes-shell-v1/);
  assert.match(serviceWorkerSource, /cache.addAll\(APP_SHELL\)/);

  const backendSource = await readFile(resolve(root, "server/mdnotes_server.py"), "utf8");
  assert.match(backendSource, /api\/events\/stream/);
  assert.match(backendSource, /api\/operations/);
  assert.match(backendSource, /sse-text-ops/);
  assert.match(backendSource, /patch-file/);
  assert.match(backendSource, /Persisting collaborative state/);
  assert.match(backendSource, /Backend self-test passed\./);
  // OT additions
  assert.match(backendSource, /operation_log/);
  assert.match(backendSource, /_transform_offset/);
  assert.match(backendSource, /_rebase_patch/);
  assert.match(backendSource, /broadcast_cursor/);
  assert.match(backendSource, /api\/session\/presence/);
  // Master PIN
  assert.match(backendSource, /master_pin/);
  assert.match(backendSource, /master_tokens/);
  assert.match(backendSource, /master-pin/);

  console.log("Self-test passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});