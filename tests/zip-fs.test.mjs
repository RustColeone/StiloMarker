import test from "node:test";
import assert from "node:assert/strict";

import { loadModules, MockDirectoryHandle, getDirectoryByPath, getFileByPath } from "./helpers/mocks.mjs";

const { projectModel, zipService, fsAccessService } = await loadModules();
const { readFileAsProjectContent } = await import("../app/modules/workspace/adapters/file-content.js");

test("zip: create archive and extract entries", async () => {
  const blob = zipService.createZip([{ path: "docs/readme.md", content: "Hello" }]);
  assert.equal(blob.type, "application/zip");
  assert.ok(blob.size > 0);

  const entries = await zipService.extractZipEntries(blob);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, "docs/readme.md");
  assert.equal(entries[0].content, "Hello");
  assert.ok(entries[0].bytes instanceof Uint8Array);
});

test("fs-access: import ZIP archive", async () => {
  const blob = zipService.createZip([{ path: "docs/readme.md", content: "Hello" }]);
  const zipProject = await fsAccessService.importZipArchive(new File([blob], "bundle.zip", { type: "application/zip" }));
  const zipFile = Object.values(zipProject.nodes).find((node) => node.kind === "file" && node.name === "readme.md");
  assert.ok(zipFile, "Expected imported ZIP markdown file");
});

const filePaths = (project) => Object.values(project.nodes).filter((node) => node.kind === "file")
  .map((node) => projectModel.getPath(project, node.id)).sort();

test("fs-access: a folder opened leaves out its own manifest at the top and text files over 5 MB, and says which", async () => {
  const root = new MockDirectoryHandle("Results");
  (await root.getFileHandle("manifest.json", { create: true })).content = '{"name":"Results"}';
  (await root.getFileHandle("notes.txt", { create: true })).content = "hello";
  const runs = await root.getDirectoryHandle("runs", { create: true });
  (await runs.getFileHandle("manifest.json", { create: true })).content = "{}";
  const big = await runs.getFileHandle("big.log", { create: true });
  big.size = 6 * 1024 * 1024;
  const project = await fsAccessService.buildProjectFromDirectoryHandle(root, "Results", "opfs");
  assert.deepEqual(filePaths(project), ["notes.txt", "runs/manifest.json"], "inside a folder a manifest is an ordinary file");
  assert.deepEqual(fsAccessService.leftOutOf(project), ["manifest.json (a name kept for the app's own file)", "runs/big.log (6.0 MB, too large to open here)"]);
  // The app's own local folder: its manifest is its own, not a file left out.
  const own = await fsAccessService.buildProjectFromDirectoryHandle(root, "Results", "opfs", { ownFolder: true });
  assert.deepEqual(fsAccessService.leftOutOf(own), ["runs/big.log (6.0 MB, too large to open here)"]);
  // A name a disk allows but the app cannot keep (a control character): left out, the rest opens.
  (await root.getFileHandle("odd\u0007.md", { create: true })).content = "x";
  const odd = await fsAccessService.buildProjectFromDirectoryHandle(root, "Results", "opfs", { ownFolder: true });
  assert.ok(fsAccessService.leftOutOf(odd).includes("odd\u0007.md (a name the app cannot keep)"), fsAccessService.leftOutOf(odd).join(" | "));
  assert.deepEqual(filePaths(odd), ["notes.txt", "runs/manifest.json"]);
});

test("fs-access: renaming a folder keeps a file the project left out (it stays in the old folder)", async () => {
  const root = new MockDirectoryHandle("Results");
  const runs = await root.getDirectoryHandle("runs", { create: true });
  (await runs.getFileHandle("small.log", { create: true })).content = "ok";
  const big = await runs.getFileHandle("big.log", { create: true });
  big.size = 6 * 1024 * 1024;
  let project = await fsAccessService.buildProjectFromDirectoryHandle(root, "Results", "opfs", { ownFolder: true });
  const folderId = Object.values(project.nodes).find((node) => node.name === "runs").id;
  project = projectModel.renameNode(project, folderId, "runs2");
  project.handles = { [projectModel.ROOT_ID]: root };
  await fsAccessService.saveProjectToHandles(project);
  assert.ok(root.directories.get("runs2")?.files.has("small.log"), "the project's file moved");
  assert.ok(root.directories.get("runs")?.files.has("big.log"), "the left-out file stays, with its folder");
  assert.ok(!root.directories.get("runs").files.has("small.log"), "the project's own file is gone from the old folder");
});

test("fs-access: a ZIP the same; a text file over 5 MB is not read", async () => {
  const blob = zipService.createZip([
    { path: "chat.json", content: "[]" },
    { path: "comments.json/a.md", content: "x" },
    { path: "data/run.csv", content: "a,b\n1,2\n" },
    { path: "data/huge.log", bytes: new Uint8Array(5 * 1024 * 1024 + 1) }
  ]);
  const project = await fsAccessService.importZipArchive(new File([blob], "results.zip", { type: "application/zip" }));
  assert.deepEqual(filePaths(project), ["data/run.csv"]);
  assert.deepEqual(fsAccessService.leftOutOf(project), ["chat.json (a name kept for the app's own file)",
    "comments.json/a.md (in a folder named like the app's own file)", "data/huge.log (5.0 MB, too large to open here)"]);
  const sneaky = await fsAccessService.importZipArchive(new File([zipService.createZip([
    { path: "../outside.md", content: "x" }, { path: "a/./b.md", content: "y" }, { path: "ok/c.md", content: "z" }])], "s.zip", { type: "application/zip" }));
  assert.deepEqual(filePaths(sneaky), ["ok/c.md"], "a path that walks out is left out whole");
  assert.deepEqual(fsAccessService.leftOutOf(sneaky), ["../outside.md (a path the app cannot keep)", "a/./b.md (a path the app cannot keep)"]);
  await assert.rejects(readFileAsProjectContent({ name: "big.csv", size: 6 * 1024 * 1024, text: async () => "" }, "big.csv"),
    /big\.csv is 6\.0 MB: a text file over 5\.0 MB can't be opened here/);
  assert.equal(await readFileAsProjectContent({ name: "ok.txt", size: 2, text: async () => "ok" }, "ok.txt"), "ok");
});

test("fs-access: import single image file", async () => {
  const imageProject = await fsAccessService.importSingleFile(
    new File([Uint8Array.from([137, 80, 78, 71])], "diagram.png", { type: "image/png" })
  );
  const imageFile = Object.values(imageProject.nodes).find((node) => node.kind === "file" && node.name === "diagram.png");
  assert.ok(imageFile, "Expected imported image file");
  assert.match(imageFile.content, /^data:image\/png;base64,/);
});

test("fs-access: rename, edit, delete persists to disk handles", async () => {
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
});
