import test from "node:test";
import assert from "node:assert/strict";

import { loadModules, MockDirectoryHandle, getDirectoryByPath, getFileByPath } from "./helpers/mocks.mjs";

const { projectModel, zipService, fsAccessService } = await loadModules();

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
