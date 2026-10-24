// The explorer's name search (explorer/model/filter.js): the rows a query
// leaves, the folders holding them open; nothing typed, the tree as it is.
import test from "node:test";
import assert from "node:assert/strict";
import { firstFileMatching, rowsMatching } from "../app/modules/explorer/model/filter.js";

function project() {
  const nodes = {
    root: { id: "root", kind: "folder", name: "Book", children: ["ch", "notes", "img"], expanded: true },
    ch: { id: "ch", kind: "folder", name: "Chapters", parentId: "root", children: ["c1", "c2", "deep"], expanded: false },
    c1: { id: "c1", kind: "file", name: "Lantern.md", parentId: "ch", content: "" },
    c2: { id: "c2", kind: "file", name: "River.md", parentId: "ch", content: "" },
    deep: { id: "deep", kind: "folder", name: "drafts", parentId: "ch", children: ["d1"], expanded: false },
    d1: { id: "d1", kind: "file", name: "old lantern draft.md", parentId: "deep", content: "" },
    notes: { id: "notes", kind: "file", name: "notes.md", parentId: "root", content: "" },
    img: { id: "img", kind: "folder", name: "lanterns", parentId: "root", children: [], expanded: false }
  };
  return { id: "p", name: "Book", rootId: "root", nodes };
}

test("explorer search: matching names in any case, the folders holding them open, in the tree's order", () => {
  const rows = rowsMatching(project(), "LANTERN");
  assert.deepEqual(rows.map((row) => [row.node.name, row.depth, row.open]), [
    ["Chapters", 0, true], ["Lantern.md", 1, false], ["drafts", 1, true], ["old lantern draft.md", 2, false], ["lanterns", 0, false]
  ]);
  assert.equal(project().nodes.ch.expanded, false, "the folders' own state left as it was");
  assert.equal(rows[1].path, "Chapters/Lantern.md");
});

test("explorer search: nothing typed leaves the tree as it is; nothing found is no rows; Enter's file", () => {
  assert.equal(rowsMatching(project(), "  "), null);
  assert.deepEqual(rowsMatching(project(), "zzz"), []);
  assert.equal(firstFileMatching(project(), "lantern").name, "Lantern.md", "a folder named alike is not opened");
  assert.equal(firstFileMatching(project(), "river").id, "c2");
  assert.equal(firstFileMatching(project(), "zzz"), null);
});
