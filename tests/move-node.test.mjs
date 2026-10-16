import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { addFile, addFolder, applySyncOperation, createProject, getNodeIdByPath, moveNode } from "../app/domain/project-model.js";

// The same table the server's tests/move-node.test.py uses: a broadcast
// move-node is applied with this moveNode() in every peer, so the two must
// agree on the resulting order case for case.
const CASES = JSON.parse(readFileSync(new URL("../spec/workspace/move-node.cases.json", import.meta.url), "utf8"));

function seeded() {
  let project = createProject("X");
  for (const name of CASES.start) project = addFile(project, project.rootId, name);
  return project;
}

const names = (project, folderId = project.rootId) =>
  project.nodes[folderId].children.map((id) => project.nodes[id].name);

for (const c of CASES.cases) {
  test(`moveNode order matches the server: ${c.name}`, () => {
    const project = seeded();
    const id = getNodeIdByPath(project, c.move);
    assert.deepEqual(names(moveNode(project, id, project.rootId, c.index)), c.expect);
    // ...and through the sync path peers actually use.
    const op = { type: "move-node", path: c.move, parentPath: "", ...(c.index === null ? {} : { index: c.index }) };
    assert.deepEqual(names(applySyncOperation(project, op)), c.expect);
  });
}

test("dropping a file after the last item of its own folder puts it at the end", () => {
  const project = seeded();
  const b = getNodeIdByPath(project, "b.md");
  // What the explorer computes for "after d.md": d's index + 1.
  assert.deepEqual(names(moveNode(project, b, project.rootId, 4)), ["a.md", "c.md", "d.md", "b.md"]);
});

test("moving into a different folder is unaffected by the same-folder adjustment", () => {
  let project = addFolder(seeded(), createProject("X").rootId, "F");
  const folder = getNodeIdByPath(project, "F");
  project = addFile(project, folder, "x.md");
  project = addFile(project, folder, "y.md");
  const moved = moveNode(project, getNodeIdByPath(project, "a.md"), folder, 1);
  assert.deepEqual(names(moved, folder), ["x.md", "a.md", "y.md"]);
  assert.equal(getNodeIdByPath(moved, "a.md"), null);
});
