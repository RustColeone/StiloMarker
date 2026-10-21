// The broker that puts the edits of this browser's linked windows in order
// (sync/service/broker.js) and its rebase log (sync/model/rebase-log.js, the
// twin of the server's RebaseLog: the same scenario through both must give
// the same answers).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createBroker, touchedPaths } from "../app/modules/sync/service/broker.js";
import { createRebaseLog } from "../app/modules/sync/model/rebase-log.js";
import { applySyncOperation } from "../app/modules/workspace/index.js";

function project(files = { "notes.md": "Hello world" }) {
  const nodes = { root: { id: "root", kind: "folder", name: "W", children: [] } };
  Object.entries(files).forEach(([name, content], index) => {
    const id = `f${index}`;
    nodes[id] = { id, kind: "file", parentId: "root", name, content };
    nodes.root.children.push(id);
  });
  return { id: "w", name: "W", rootId: "root", nodes, activeFileId: null };
}
const text = (broker, name = "notes.md") => Object.values(broker.state().project.nodes).find((node) => node.name === name)?.content;
const patch = (path, start, end, insert, baseRevision) => ({ type: "patch-file", path, start, end, text: insert, baseRevision });

test("broker: concurrent patches to one file are put in order, the later moved over the earlier", () => {
  const broker = createBroker({ project: project(), revision: 0, applyOperation: applySyncOperation });
  const first = broker.apply("a", patch("notes.md", 0, 0, ">> ", 0));
  assert.equal(first.revision, 1);
  const second = broker.apply("b", patch("notes.md", 11, 11, "!", 0)); // made against revision 0
  assert.deepEqual([second.operation.start, second.operation.end, second.revision], [14, 14, 2]);
  assert.equal(text(broker), ">> Hello world!");
});

test("broker: what it refuses (based on an older copy: 409; does not fit: 400)", () => {
  const broker = createBroker({ project: project(), revision: 0, applyOperation: applySyncOperation });
  broker.apply("a", patch("notes.md", 0, 5, "Howdy", 0));
  assert.throws(() => broker.apply("b", { type: "update-file", path: "notes.md", content: "old", baseRevision: 0 }), (error) => error.status === 409);
  assert.throws(() => broker.apply("b", patch("notes.md", 0, 5, "Hi", 0)), (error) => error.status === 409, "overlapping replacements");
  broker.apply("a", { type: "rename-node", path: "notes.md", name: "renamed.md" });
  assert.throws(() => broker.apply("b", patch("renamed.md", 0, 0, "x", 1)), (error) => error.status === 409, "renamed since its base");
  assert.throws(() => broker.apply("b", { type: "rename-node", path: "missing.md", name: "x.md" }), (error) => error.status === 400);
  assert.throws(() => broker.replace("b", project(), 0), (error) => error.status === 409, "a whole replace only from the current revision");
  const event = broker.replace("b", project({ "fresh.md": "new" }), broker.revision());
  assert.equal(event.type, "state");
  assert.equal(text(broker, "fresh.md"), "new");
});

test("broker: a follower's copy that follows every change takes over in the same state", () => {
  const broker = createBroker({ project: project(), revision: 5, applyOperation: applySyncOperation });
  const mirror = createBroker({ project: structuredClone(broker.state().project), revision: 5, applyOperation: applySyncOperation });
  const events = [
    broker.apply("a", patch("notes.md", 0, 0, "1 ", 5)),
    broker.apply("b", { type: "create-file", parentPath: "", name: "b.md", content: "B" }),
    broker.apply("b", patch("notes.md", 11, 11, " 2", 5)),
    broker.replace("a", project({ "only.md": "x" }), 8),
    broker.apply("a", patch("only.md", 1, 1, "y", 9))
  ];
  for (const event of events) assert.equal(mirror.follow(structuredClone(event)), true);
  assert.equal(mirror.follow(structuredClone(events[1])), true, "an event already followed is ignored");
  assert.equal(mirror.revision(), broker.revision());
  assert.deepEqual(text(mirror, "only.md"), text(broker, "only.md"));
  // A gap: out of step.
  const later = broker.apply("a", patch("only.md", 0, 0, "z", 10));
  broker.apply("a", patch("only.md", 0, 0, "w", 11));
  assert.equal(mirror.follow(structuredClone({ ...later, revision: later.revision + 1 })), false);
});

test("touchedPaths names what the server's touched_paths does", () => {
  assert.deepEqual(touchedPaths({ type: "patch-file", path: "a/b.md" }), ["a/b.md"]);
  assert.deepEqual(touchedPaths({ type: "create-file", parentPath: "a", name: "c.md" }), ["a/c.md"]);
  assert.deepEqual(touchedPaths({ type: "create-folder", parentPath: "", name: "d" }), ["d"]);
  assert.deepEqual(touchedPaths({ type: "rename-node", path: "a/b.md", name: "e.md" }), ["a/b.md", "a/e.md"]);
  assert.deepEqual(touchedPaths({ type: "move-node", path: "a/b.md", parentPath: "z" }), ["a/b.md", "z/b.md"]);
  assert.deepEqual(touchedPaths({ type: "delete-node", path: "a" }), ["a"]);
});

// One scenario through both rebase logs: the server's (Python) and the browser's.
test("the browser's rebase log answers as the server's does", () => {
  const steps = [
    ["record", 1, "a.md", 0, 0, "abc"], ["note", ["a.md"], 1, true],
    ["rebase", "a.md", 5, 5, 0, 1],
    ["rebase", "a.md", 1, 2, 0, 1],
    ["record", 2, "a.md", 10, 12, ""], ["note", ["a.md"], 2, true],
    ["rebase", "a.md", 20, 20, 0, 2],
    ["rebase", "a.md", 11, 11, 1, 2],
    ["note", ["dir"], 3, false],
    ["rebase", "dir/x.md", 0, 0, 2, 3],
    ["lastChange", "dir/x.md"],
    ["reset", 10],
    ["rebase", "a.md", 0, 0, 5, 10],
    ["lastChange", "a.md"]
  ];
  const js = createRebaseLog({ floor: 0 });
  const answers = steps.map(([kind, ...args]) => {
    try {
      if (kind === "record") return js.record(...args) ?? null;
      if (kind === "note") return js.note(...args) ?? null;
      if (kind === "reset") return js.reset(...args) ?? null;
      if (kind === "lastChange") return js.lastChange(...args);
      const { start, end } = js.rebase(...args);
      return [start, end];
    } catch (error) {
      assert.equal(error.status, 409);
      return "conflict";
    }
  });
  const python = `
import json, sys
sys.path.insert(0, "server")
from stilo.modules.sync.model.rebase import RebaseLog
log = RebaseLog(floor=0)
out = []
for kind, *args in json.loads(sys.argv[1]):
    try:
        if kind == "record":
            revision, path, start, end, text = args
            out.append(log.record_patch(revision, path, start, end, len(text)))
        elif kind == "note": out.append(log.note(*args))
        elif kind == "reset": out.append(log.reset(*args))
        elif kind == "lastChange": out.append(log.last_change(*args))
        else: out.append(list(log.rebase(*args)))
    except ValueError:
        out.append("conflict")
print(json.dumps(out))`;
  const server = JSON.parse(execFileSync("python3", ["-B", "-c", python, JSON.stringify(steps)], { encoding: "utf8" }));
  assert.deepEqual(answers, server);
});
