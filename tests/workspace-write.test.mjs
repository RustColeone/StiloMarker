import test from "node:test";
import assert from "node:assert/strict";

import { diffHunks, placeHunks, applyHunks } from "../app/modules/workspace/model/hunks.js";
import workspaceModule from "../app/modules/workspace/index.js";
import fileTypesModule from "../app/modules/file-types/index.js";
import { startModules } from "../app/kernel/index.js";
import { undoSteps } from "../app/features/agent-undo.js";

const ORIGINAL = "one\ntwo\nthree\nfour\nfive\n";

test("a diff applied to its own text gives the target, for many random edits", () => {
  let seed = 11;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  const words = ["alpha", "beta", "", "# Head", "- item", "é 漢字 🙂", "the lamp"];
  for (let i = 0; i < 500; i += 1) {
    const lines = Array.from({ length: rnd(25) }, () => words[rnd(words.length)]);
    const before = lines.join("\n") + (rnd(2) ? "\n" : "");
    const after = [...lines];
    for (let k = 0; k < 1 + rnd(3); k += 1) {
      const at = rnd(after.length + 1);
      const kind = rnd(3);
      if (kind === 0) after.splice(at, 0, `new ${k}`); else if (kind === 1) after.splice(at, 1); else after[at] = `${after[at] ?? ""} x`;
    }
    const target = after.join("\n");
    assert.equal(applyHunks(before, diffHunks(before, target)), target);
  }
});

test("an edit lands beside other people's changes, and refuses to guess", () => {
  const agent = ORIGINAL.replace("two", "TWO (agent)");
  const hunks = diffHunks(ORIGINAL, agent);
  // Someone changed a line elsewhere: the agent's edit still lands, both stay.
  const typed = ORIGINAL.replace("five", "five (bob)");
  assert.equal(applyHunks(typed, placeHunks(hunks, ORIGINAL, typed)), "one\nTWO (agent)\nthree\nfour\nfive (bob)\n");
  // Someone changed the same line: it cannot be placed safely.
  assert.equal(placeHunks(hunks, ORIGINAL, ORIGINAL.replace("two", "two (bob)")), null);
  // The context is no longer unique: no guess.
  const repeated = "a\nb\na\nb\n";
  assert.equal(placeHunks(diffHunks(repeated, "a\nB\na\nb\n"), repeated, `x\n${repeated}${repeated}`), null);
});

async function harness(files) {
  const { workspace } = await startModules([fileTypesModule, workspaceModule]);
  const commits = [], replaced = [], written = [];
  workspace.attach({
    read: (path) => (path in files ? { content: files[path] } : null),
    commit: (path, previous, next, source) => { commits.push({ path, previous, next, source }); files[path] = next; },
    replace: async (operation) => { replaced.push(operation); files[operation.path] = operation.content; }
  });
  workspace.events.on("written", (event) => written.push(event));
  return { workspace, files, commits, replaced, written };
}

test("write: a text file changes by commit (a patch), merged when the file moved on, stale when it cannot fit", async () => {
  const h = await harness({ "notes.md": ORIGINAL.replace("five", "five (bob)"), "art.png": "data:image/png;base64,AAAA" });
  const agent = ORIGINAL.replace("two", "TWO (agent)");
  const result = await h.workspace.write("notes.md", agent, { base: ORIGINAL, source: "assistant" });
  assert.deepEqual(result, { changed: true, text: "one\nTWO (agent)\nthree\nfour\nfive (bob)\n" });
  assert.equal(h.commits[0].previous, ORIGINAL.replace("five", "five (bob)"));
  assert.deepEqual(h.written, [{ path: "notes.md", source: "assistant" }]);

  // Undo is the same write backwards: only the agent's line goes back.
  await h.workspace.write("notes.md", ORIGINAL, { base: agent, source: "assistant undo" });
  assert.equal(h.files["notes.md"], ORIGINAL.replace("five", "five (bob)"));

  // A conflicting edit changes nothing.
  h.files["notes.md"] = ORIGINAL.replace("two", "two (bob)");
  const before = h.commits.length;
  await assert.rejects(h.workspace.write("notes.md", agent, { base: ORIGINAL }), (error) => h.workspace.isStale(error));
  assert.equal(h.commits.length, before);
  assert.equal(h.workspace.fits("notes.md", agent, ORIGINAL), false);

  // Writing what is already there is not a change; an image is replaced whole.
  assert.equal((await h.workspace.write("notes.md", h.files["notes.md"])).changed, false);
  await h.workspace.write("art.png", "data:image/png;base64,BBBB", { source: "replace file" });
  assert.deepEqual(h.replaced, [{ type: "update-file", path: "art.png", content: "data:image/png;base64,BBBB" }]);
  await assert.rejects(h.workspace.write("missing.md", "x"), /No file at missing.md/);
});

test("asPatch: a text file's whole-file update travels as a patch; images and other operations pass through", async () => {
  const h = await harness({ "notes.md": ORIGINAL, "art.png": "data:x" });
  const patch = h.workspace.asPatch({ type: "update-file", path: "notes.md", content: ORIGINAL.replace("three", "3") }, 9);
  assert.deepEqual({ type: patch.type, removed: patch.removedText, text: patch.text, base: patch.baseRevision },
    { type: "patch-file", removed: "three", text: "3", base: 9 });
  assert.equal(h.workspace.asPatch({ type: "update-file", path: "notes.md", content: ORIGINAL }, 9), null, "nothing to send");
  const image = { type: "update-file", path: "art.png", content: "data:y" };
  assert.equal(h.workspace.asPatch(image, 9), image);
  const create = { type: "create-file", parentPath: "", name: "x.md", content: "" };
  assert.equal(h.workspace.asPatch(create, 9), create);
});

test("undo steps for the agent's structural changes", () => {
  const checkpoint = { rootId: "root", nodes: {
    root: { id: "root", kind: "folder", name: "W", children: ["cast"] },
    cast: { id: "cast", kind: "folder", name: "Cast", parentId: "root", children: ["aria"] },
    aria: { id: "aria", kind: "file", name: "aria.persona.skill", parentId: "cast", content: "A smuggler." } } };
  assert.deepEqual(undoSteps({ type: "create-file", parentPath: "Notes", name: "a.md" }), [{ type: "delete-node", path: "Notes/a.md" }]);
  assert.deepEqual(undoSteps({ type: "rename-node", path: "Notes/a.md", name: "b.md" }), [{ type: "rename-node", path: "Notes/b.md", name: "a.md" }]);
  assert.deepEqual(undoSteps({ type: "move-node", path: "Notes/a.md", parentPath: "Old" }), [{ type: "move-node", path: "Old/a.md", parentPath: "Notes" }]);
  assert.deepEqual(undoSteps({ type: "delete-node", path: "Cast" }, checkpoint), [
    { type: "create-folder", parentPath: "", name: "Cast" },
    { type: "create-file", parentPath: "Cast", name: "aria.persona.skill", content: "A smuggler." }]);
  assert.throws(() => undoSteps({ type: "delete-node", path: "Gone.md" }, checkpoint), /Nothing to bring back/);
});
