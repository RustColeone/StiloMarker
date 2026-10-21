// What a tab did while away from a cloud workspace, put together with what
// others did meanwhile, file by file (sync/service/offline-merge.js), against a
// stand-in server that applies operations as the real one does.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeOffline } from "../app/modules/sync/service/offline-merge.js";
import { applySyncOperation, buildTextPatch, getNodeIdByPath } from "../app/modules/workspace/index.js";

function project(files) {
  let p = { id: "w", name: "W", rootId: "root", nodes: { root: { id: "root", kind: "folder", name: "W", children: [] } } };
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const folder = parts.slice(0, i).join("/");
      if (!getNodeIdByPath(p, folder)) p = applySyncOperation(p, { type: "create-folder", parentPath: parts.slice(0, i - 1).join("/"), name: parts[i - 1] });
    }
    p = applySyncOperation(p, { type: "create-file", parentPath: parts.slice(0, -1).join("/"), name: parts.at(-1), content });
  }
  return p;
}
const files = (p) => {
  const out = {};
  const walk = (id, prefix) => {
    for (const child of p.nodes[id].children ?? []) {
      const node = p.nodes[child], path = prefix ? `${prefix}/${node.name}` : node.name;
      if (node.kind === "file") out[path] = node.content; else walk(child, path);
    }
  };
  walk(p.rootId, "");
  return out;
};

// A server holding a project at a revision; push applies, or refuses as it would.
function server(initial) {
  const state = { project: initial, revision: 10, pushed: [] };
  return {
    state,
    fetchState: async () => ({ project: structuredClone(state.project), revision: state.revision }),
    push: async (op) => {
      state.pushed.push(op.type);
      if (op.type === "patch-file" && op.baseRevision !== state.revision && !state.pushed.slice(0, -1).includes("patch-file")) {
        throw Object.assign(new Error("patch conflict: base revision too far behind"), { status: 409 });
      }
      try { state.project = applySyncOperation(state.project, op); } catch (error) { throw Object.assign(error, { status: 400 }); }
      state.revision += 1;
    }
  };
}

const base = { "notes.md": "One.\nTwo.\nThree.\n", "plan.md": "Plan A.\n", "old.md": "Old.\n" };

test("away: a file only this tab changed gets its edit; one only they changed keeps theirs; a new file is made", async () => {
  const there = server(project({ ...base, "plan.md": "Plan B.\n" }));
  const local = project({ ...base, "notes.md": "One.\nTwo, edited away.\nThree.\n", "away.md": "Made away." });
  const result = await mergeOffline({ fetchState: there.fetchState, push: there.push, buildTextPatch, local,
    unsynced: new Map([["notes.md", "One.\nTwo, edited away.\nThree.\n"]]), bases: new Map([["notes.md", base["notes.md"]]]),
    ops: [{ type: "create-file", parentPath: "", name: "away.md", content: "Made away." }] });
  assert.deepEqual(files(there.state.project), { ...base, "notes.md": "One.\nTwo, edited away.\nThree.\n", "plan.md": "Plan B.\n", "away.md": "Made away." });
  assert.deepEqual([...result.merged].sort(), ["away.md", "notes.md"]);
  assert.equal(result.kept.size, 0);
});

test("away: a file both changed is merged line by line; where they clash, this tab's text is kept for Snapshots", async () => {
  const there = server(project({ ...base, "notes.md": "One.\nTwo.\nThree, theirs.\n", "plan.md": "Plan, theirs.\n" }));
  const local = project({ ...base, "notes.md": "One, mine.\nTwo.\nThree.\n", "plan.md": "Plan, mine.\n" });
  const result = await mergeOffline({ fetchState: there.fetchState, push: there.push, buildTextPatch, local,
    unsynced: new Map([["notes.md", "One, mine.\nTwo.\nThree.\n"], ["plan.md", "Plan, mine.\n"]]),
    bases: new Map([["notes.md", base["notes.md"]], ["plan.md", base["plan.md"]]]) });
  assert.equal(files(there.state.project)["notes.md"], "One, mine.\nTwo.\nThree, theirs.\n");
  assert.equal(files(there.state.project)["plan.md"], "Plan, theirs.\n", "theirs stands");
  assert.deepEqual([...result.kept], [["plan.md", "Plan, mine.\n"]]);
});

test("away: renamed and edited here, the rename is made first and the edit lands at the new name", async () => {
  const plan = "Plan A.\n\nNotes.\n";
  const there = server(project({ ...base, "plan.md": "Plan A, theirs.\n\nNotes.\n" }));
  const local = project({ "notes.md": base["notes.md"], "old.md": "Old.\n", "renamed.md": "Plan A.\n\nNotes.\nMore, mine.\n" });
  const result = await mergeOffline({ fetchState: there.fetchState, push: there.push, buildTextPatch, local,
    unsynced: new Map([["renamed.md", "Plan A.\n\nNotes.\nMore, mine.\n"]]), bases: new Map([["renamed.md", plan]]),
    ops: [{ type: "rename-node", path: "plan.md", name: "renamed.md" }] });
  assert.deepEqual(files(there.state.project)["renamed.md"], "Plan A, theirs.\n\nNotes.\nMore, mine.\n");
  assert.equal(files(there.state.project)["plan.md"], undefined);
  assert.equal(result.kept.size, 0);
});

test("away: a deletion only of what nobody changed meanwhile; an edited file removed there is kept", async () => {
  const there = server(project({ ...base, "old.md": "Old, but they edited it.\n" }));
  const local = project({ "notes.md": "One.\nTwo, mine.\nThree.\n" });
  const result = await mergeOffline({ fetchState: there.fetchState, push: there.push, buildTextPatch, local,
    unsynced: new Map([["notes.md", "One.\nTwo, mine.\nThree.\n"]]), bases: new Map([["notes.md", base["notes.md"]]]),
    ops: [{ type: "delete-node", path: "plan.md", had: "Plan A.\n" }, { type: "delete-node", path: "old.md", had: "Old.\n" }] });
  const after = files(there.state.project);
  assert.equal(after["plan.md"], undefined, "unchanged there: deleted");
  assert.equal(after["old.md"], "Old, but they edited it.\n", "changed there: kept");
  assert.deepEqual(result.skipped.map((op) => op.path), ["old.md"]);
  assert.equal(after["notes.md"], "One.\nTwo, mine.\nThree.\n");

  const gone = server(project({ "notes.md": base["notes.md"] }));
  const edited = project({ "notes.md": base["notes.md"], "plan.md": "Plan, mine.\n" });
  const lost = await mergeOffline({ fetchState: gone.fetchState, push: gone.push, buildTextPatch, local: edited,
    unsynced: new Map([["plan.md", "Plan, mine.\n"]]), bases: new Map([["plan.md", "Plan A.\n"]]) });
  assert.deepEqual([...lost.kept], [["plan.md", "Plan, mine.\n"]], "removed there while edited here: kept, not made again");
});

test("away, the workspace unchanged: everything here is pushed (text first, then new files), no base needed", async () => {
  const there = server(project(base));
  const local = project({ ...base, "notes.md": "One.\nTwo, mine.\nThree.\n", "folder/new.md": "New." });
  const result = await mergeOffline({ fetchState: there.fetchState, push: there.push, buildTextPatch, local, inStepAt: 10,
    unsynced: new Map([["notes.md", "One.\nTwo, mine.\nThree.\n"]]) });
  assert.deepEqual(files(there.state.project), { ...base, "notes.md": "One.\nTwo, mine.\nThree.\n", "folder/new.md": "New." });
  assert.deepEqual(there.state.pushed, ["patch-file", "create-folder", "create-file"], "text first: its base revision stays the one read");
  assert.equal(result.kept.size, 0);
});

test("away: a connection that fails ends the merge (the reconnect tries again); a refusal is one file's", async () => {
  const there = server(project(base));
  const local = project({ ...base, "notes.md": "x\n" });
  const failing = async () => { throw new Error("Failed to fetch"); };
  await assert.rejects(mergeOffline({ fetchState: there.fetchState, push: failing, buildTextPatch, local, inStepAt: 10,
    unsynced: new Map([["notes.md", "x\n"]]) }), /Failed to fetch/);
  const refusing = async () => { throw Object.assign(new Error("conflict"), { status: 409 }); };
  const result = await mergeOffline({ fetchState: there.fetchState, push: refusing, buildTextPatch, local, inStepAt: 10,
    unsynced: new Map([["notes.md", "x\n"]]) });
  assert.deepEqual([...result.kept], [["notes.md", "x\n"]]);
});
