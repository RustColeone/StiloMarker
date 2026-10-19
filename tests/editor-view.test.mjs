// The Editor's view (app/modules/editor/service/view.js): its groups of tabs,
// a tab being a file in a view, changed only through named actions that land
// in the trace.
import test from "node:test";
import assert from "node:assert/strict";

import { createState, createTrace } from "../app/kernel/index.js";
import { EMPTY_VIEW, createView, filesIn, groupOf, hostOf, moveTabWithinList } from "../app/modules/editor/service/view.js";

const project = (active, ...files) => ({
  rootId: "root", activeFileId: active,
  nodes: Object.fromEntries([["root", { id: "root", kind: "folder" }], ...files.map((id) => [id, { id, kind: "file" }])])
});
const source = (fileId) => ({ fileId, view: "source" });
const preview = (fileId) => ({ fileId, view: "preview" });
const plain = (value) => JSON.parse(JSON.stringify(value));

function fresh() {
  const log = createTrace({ now: () => 0 });
  return { view: createView(createState("editor", EMPTY_VIEW, log)), log };
}

test("reset: today's layout, the active file the one tab of each view, and it is selected", () => {
  const { view } = fresh();
  view.reset(project("a", "a", "b"));
  const state = view.get();
  assert.deepEqual(plain(state.groups), [
    { id: "left", tabs: [source("a")], active: source("a") },
    { id: "right", tabs: [preview("a")], active: preview("a") }
  ]);
  assert.deepEqual({ ...state.hosts }, { source: "left", preview: "right" });
  assert.equal(hostOf(state, "source").id, "left");
  assert.equal(state.previewFileId, "a");
  assert.equal(state.selectionNodeId, "a");
  view.reset(project(null));
  assert.equal(view.get().selectionNodeId, "root", "no active file: the root is selected");
  assert.deepEqual(filesIn(view.get(), "source"), []);
  assert.equal(groupOf(view.get(), "left").active, null);
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

test("tabs open once, in the group holding their view; close (the preview falls back to the last tab) and move", () => {
  const { view, log } = fresh();
  view.reset(project("a", "a", "b", "c"));
  view.openTab("preview", "b");
  const before = log.entries().length;
  view.openTab("preview", "b");
  assert.equal(log.entries().length, before, "a tab already open changes nothing");
  view.openTab("preview", "c");
  assert.deepEqual(filesIn(view.get(), "preview"), ["a", "b", "c"]);
  assert.deepEqual(plain(groupOf(view.get(), "left").tabs), [source("a")], "the source group is left alone");
  view.showPreview("b", "part-1");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("b"));
  assert.equal(view.get().focus, "right");
  view.closeTab("preview", "b");
  assert.deepEqual(filesIn(view.get(), "preview"), ["a", "c"]);
  assert.equal(view.get().previewFileId, "c");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("c"), "the group shows its last tab");
  view.moveTab("preview", "c", "a");
  assert.deepEqual(filesIn(view.get(), "preview"), ["c", "a"]);
  view.moveTab("preview", "c", null);
  assert.deepEqual(filesIn(view.get(), "preview"), ["a", "c"], "no target: to the end");
  assert.deepEqual(moveTabWithinList(["a", "b", "c"], "a", "b", true), ["b", "a", "c"]);
  assert.throws(() => view.get().groups[0].tabs.push(source("x")), TypeError, "only actions change the tabs");
  assert.throws(() => { view.get().groups[0].active.fileId = "x"; }, TypeError);
});

test("showSource: the source group's active tab, and the focus", () => {
  const { view } = fresh();
  view.reset(project("a", "a", "b"));
  view.showPreview("a");
  view.openTab("source", "b");
  view.showSource("b");
  assert.deepEqual(plain(groupOf(view.get(), "left").active), source("b"));
  assert.equal(view.get().focus, "left");
  view.closeTab("source", "b");
  assert.deepEqual(plain(groupOf(view.get(), "left").active), source("a"), "closing the shown tab shows the last one left");
});

test("a pane view (the diff): shown, then closed back to the last file tab", () => {
  const { view } = fresh();
  view.reset(project("a", "a"));
  view.showView("__diff__");
  assert.equal(view.get().previewFileId, "__diff__");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("__diff__"));
  view.closeTab("preview", "__diff__");
  assert.equal(view.get().previewFileId, "a");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("a"));
});

test("keepTabs: tabs only for files that still exist, the active file among them, the preview on a tab", () => {
  const { view, log } = fresh();
  view.reset(project("a", "a", "b"));
  view.openTab("source", "b");
  view.openTab("preview", "b");
  view.showPreview("b");
  view.keepTabs(project("c", "a", "c"), { views: ["__diff__"], open: [] });
  assert.deepEqual(filesIn(view.get(), "source"), ["a", "c"]);
  assert.deepEqual(plain(groupOf(view.get(), "left").active), source("c"), "the source group shows the active file");
  assert.deepEqual(filesIn(view.get(), "preview"), ["a"]);
  assert.equal(view.get().previewFileId, "a", "the shown file is gone: the last tab is shown");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("a"));
  const settled = log.entries().length;
  view.keepTabs(project("c", "a", "c"), { views: ["__diff__"], open: [] });
  assert.equal(log.entries().length, settled, "nothing changed: nothing recorded");
  view.showView("__diff__");
  view.keepTabs(project("c", "a", "c"), { views: ["__diff__"], open: ["__diff__"] });
  assert.equal(view.get().previewFileId, "__diff__", "an open view stays shown");
  assert.deepEqual(plain(groupOf(view.get(), "right").active), preview("__diff__"));
  view.keepTabs(project(null, "a", "c"), { views: ["__diff__"], open: [] });
  assert.deepEqual(filesIn(view.get(), "source"), [], "no active file: no source tabs");
  assert.equal(groupOf(view.get(), "left").active, null);
  assert.equal(view.get().previewFileId, "a");
});
