// The Editor's view (app/modules/editor/service/view.js): what each pane shows,
// changed only through named actions that land in the trace.
import test from "node:test";
import assert from "node:assert/strict";

import { createState, createTrace } from "../app/kernel/index.js";
import { EMPTY_VIEW, createView, moveTabWithinList } from "../app/modules/editor/service/view.js";

const project = (active, ...files) => ({
  rootId: "root", activeFileId: active,
  nodes: Object.fromEntries([["root", { id: "root", kind: "folder" }], ...files.map((id) => [id, { id, kind: "file" }])])
});

function fresh() {
  const log = createTrace({ now: () => 0 });
  return { view: createView(createState("editor", EMPTY_VIEW, log)), log };
}

test("reset: the active file is the one tab of each pane, and it is selected", () => {
  const { view } = fresh();
  view.reset(project("a", "a", "b"));
  assert.deepEqual(view.get(), { ...EMPTY_VIEW, sourceOpenTabIds: ["a"], previewOpenTabIds: ["a"], previewFileId: "a", selectionNodeId: "a" });
  view.reset(project(null));
  assert.equal(view.get().selectionNodeId, "root", "no active file: the root is selected");
  assert.deepEqual(view.get().sourceOpenTabIds, []);
});

test("pick selects a node or one part of a file; select moves only the selection", () => {
  const { view, log } = fresh();
  view.pick("album", "entry-2");
  assert.deepEqual(view.get().sourcePart, { fileId: "album", partId: "entry-2" });
  view.select("folder");
  assert.equal(view.get().selectionNodeId, "folder");
  assert.deepEqual(view.get().sourcePart, { fileId: "album", partId: "entry-2" }, "select leaves the part alone");
  view.pick("notes");
  assert.equal(view.get().sourcePart, null);
  assert.deepEqual(log.entries().map((e) => e.message), ["pick", "select", "pick"]);
});

test("tabs open once, close (the preview falls back to the last tab) and move", () => {
  const { view } = fresh();
  view.reset(project("a", "a", "b", "c"));
  view.openTab("preview", "b");
  view.openTab("preview", "b");
  view.openTab("preview", "c");
  assert.deepEqual(view.get().previewOpenTabIds, ["a", "b", "c"]);
  view.showPreview("b", "part-1");
  view.closeTab("preview", "b");
  assert.deepEqual(view.get().previewOpenTabIds, ["a", "c"]);
  assert.equal(view.get().previewFileId, "c");
  view.moveTab("preview", "c", "a");
  assert.deepEqual(view.get().previewOpenTabIds, ["c", "a"]);
  view.moveTab("preview", "c", null);
  assert.deepEqual(view.get().previewOpenTabIds, ["a", "c"], "no target: to the end");
  assert.deepEqual(moveTabWithinList(["a", "b", "c"], "a", "b", true), ["b", "a", "c"]);
  assert.throws(() => view.get().previewOpenTabIds.push("x"), TypeError, "only actions change the tabs");
});

test("the diff tab: shown, then closed back to the last file tab", () => {
  const { view } = fresh();
  view.reset(project("a", "a"));
  view.showDiff("__diff__");
  assert.equal(view.get().previewFileId, "__diff__");
  view.closeTab("preview", "__diff__");
  assert.equal(view.get().previewFileId, "a");
});

test("keepTabs: tabs only for files that still exist, the active file among them, the preview on a tab", () => {
  const { view } = fresh();
  view.reset(project("a", "a", "b"));
  view.openTab("source", "b");
  view.openTab("preview", "b");
  view.showPreview("b");
  view.keepTabs(project("c", "a", "c"), { diffTabId: "__diff__", diffActive: false });
  assert.deepEqual(view.get().sourceOpenTabIds, ["a", "c"]);
  assert.deepEqual(view.get().previewOpenTabIds, ["a"]);
  assert.equal(view.get().previewFileId, "a", "the shown file is gone: the last tab is shown");
  view.showDiff("__diff__");
  view.keepTabs(project("c", "a", "c"), { diffTabId: "__diff__", diffActive: true });
  assert.equal(view.get().previewFileId, "__diff__", "an open diff stays shown");
  view.keepTabs(project(null, "a", "c"), { diffTabId: "__diff__", diffActive: false });
  assert.deepEqual(view.get().sourceOpenTabIds, [], "no active file: no source tabs");
  assert.equal(view.get().previewFileId, "a");
});
