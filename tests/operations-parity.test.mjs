import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { applySyncOperation, applyTextPatch, createProject, getNodeByPath, getPath } from "../app/domain/project-model.js";

// The browser's half of spec/workspace/operations.cases.json (the server's is
// operations-parity.test.py): both must build the same tree, and refuse the same operations.
const { cases } = JSON.parse(await readFile(new URL("../spec/workspace/operations.cases.json", import.meta.url), "utf8"));

function tree(project) {
  const out = [];
  const walk = (id) => {
    for (const child of project.nodes[id].children ?? []) {
      const node = project.nodes[child];
      const path = getPath(project, child);
      out.push(node.kind === "folder" ? `${path}/` : `${path}=${node.content ?? ""}`);
      if (node.kind === "folder") walk(child);
    }
  };
  walk(project.rootId);
  return out;
}

// What the browser does with an operation: a patch is first checked against
// the file strictly, as the sync runtime does before applying a remote one.
function apply(project, op) {
  if (op.type === "patch-file") applyTextPatch(getNodeByPath(project, op.path)?.content ?? "", op);
  return applySyncOperation(project, op);
}

for (const c of cases) {
  test(`operations: ${c.name}`, () => {
    let project = createProject("W");
    const ops = c.error ? c.ops.slice(0, -1) : c.ops;
    for (const op of ops) project = apply(project, op);
    if (c.error) {
      assert.throws(() => apply(project, c.ops.at(-1)));
    } else {
      assert.deepEqual(tree(project), c.tree);
    }
  });
}
