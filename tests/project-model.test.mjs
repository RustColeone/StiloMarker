import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";

const { projectModel } = await loadModules();

test("project model: folders, files, and path lookup", () => {
  let project = projectModel.createProject("Test");
  project = projectModel.addFolder(project, projectModel.ROOT_ID, "docs");
  const docsFolder = Object.values(project.nodes).find((node) => node.kind === "folder" && node.name === "docs");
  assert.ok(docsFolder, "Expected docs folder");

  project = projectModel.addFile(project, docsFolder.id, "readme.md", "# Hello");
  const fileNode = Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "readme.md");
  assert.ok(fileNode, "Expected markdown file");
  assert.equal(projectModel.getPath(project, fileNode.id), "docs/readme.md");
});

test("project model: rejects unsupported binary, accepts images and urldb", () => {
  let project = projectModel.createProject("Test");
  project = projectModel.addFolder(project, projectModel.ROOT_ID, "docs");
  const docsFolder = Object.values(project.nodes).find((node) => node.kind === "folder" && node.name === "docs");

  assert.throws(() => projectModel.addFile(project, docsFolder.id, "bad.txt", "x"), /supported image files/);

  project = projectModel.addFile(project, docsFolder.id, "diagram.png", "data:image/png;base64,AAAA");
  assert.ok(Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "diagram.png"));

  project = projectModel.addFile(project, docsFolder.id, "references.urldb", "[Cover]\nurl = https://example.com/cover.jpg");
  assert.ok(Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "references.urldb"));
  assert.equal(projectModel.isUrlDbFileName("references.urldb"), true);
});

test("project model: dirty tracking and save", () => {
  let project = projectModel.createProject("Test");
  project = projectModel.addFile(project, projectModel.ROOT_ID, "readme.md", "# Hello");
  const fileNode = Object.values(project.nodes).find((node) => node.kind === "file" && node.name === "readme.md");

  project = projectModel.updateFileContent(project, fileNode.id, "## Updated");
  assert.equal(project.nodes[fileNode.id].dirty, true);
  project = projectModel.markFileSaved(project, fileNode.id);
  assert.equal(project.nodes[fileNode.id].dirty, false);
});

test("project model: applySyncOperation create + patch", () => {
  let project = projectModel.createProject("Test");
  project = projectModel.addFolder(project, projectModel.ROOT_ID, "docs");
  project = projectModel.applySyncOperation(project, { type: "create-file", parentPath: "docs", name: "shared.md", content: "# Shared" });
  assert.ok(projectModel.getNodeIdByPath(project, "docs/shared.md"), "Expected synced file path lookup");
  project = projectModel.applySyncOperation(project, { type: "patch-file", path: "docs/shared.md", start: 8, end: 8, removedText: "", text: " live" });
  assert.equal(projectModel.getNodeByPath(project, "docs/shared.md").content, "# Shared live");
});
