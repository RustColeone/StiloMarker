import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { hiddenFromCharacters, notesMode, parsePersona, personaSummary, splitAuthorNotes, withoutAuthorNotes } from "../app/modules/characters/index.js";

// The browser's half of spec/characters/sheets.cases.json (the server's is characters-parity.test.py).
const table = JSON.parse(await readFile(new URL("../spec/characters/sheets.cases.json", import.meta.url), "utf8"));

test("headers and bodies", () => {
  for (const c of table.headers) {
    const parsed = parsePersona(c.content, "x.persona.skill");
    assert.equal(parsed.body, c.body.trim(), JSON.stringify(c.content));
    if (c.header.name) assert.equal(parsed.name, c.header.name);
    assert.equal(parsed.notesMode, notesMode(c.header));
  }
});
test("summaries", () => { for (const c of table.summaries) assert.equal(personaSummary(c.body), c.summary, JSON.stringify(c.body)); });
test("author's notes", () => {
  for (const c of table.notes) assert.deepEqual(splitAuthorNotes(c.body), { sheet: c.sheet, notes: c.notes }, JSON.stringify(c.body));
  for (const c of table.modes) assert.equal(notesMode(c.header), c.mode);
  for (const c of table.without) assert.equal(withoutAuthorNotes(c.content), c.result);
});
test("what characters cannot see", () => { for (const c of table.hidden) assert.equal(hiddenFromCharacters(c.path), c.hidden, c.path); });

test("the browser runner's view of a project: no Plans, nobody's notes, the project untouched", async () => {
  const { charactersView } = await import("../app/modules/characters/index.js");
  const project = { rootId: "root", nodes: {
    root: { id: "root", kind: "folder", name: "W", children: ["plans", "ch", "mara", "end"] },
    plans: { id: "plans", kind: "folder", name: "Plans", parentId: "root", children: ["act"] },
    act: { id: "act", kind: "file", name: "act.md", parentId: "plans", content: "secret" },
    ch: { id: "ch", kind: "file", name: "ch1.md", parentId: "root", content: "story" },
    mara: { id: "mara", kind: "file", name: "mara.persona.skill", parentId: "root", content: "## Who\nKeeper.\n## Author's notes\nblind" },
    end: { id: "end", kind: "file", name: "end.plan.md", parentId: "root", content: "plan" } } };
  const view = charactersView(project);
  assert.deepEqual(Object.keys(view.nodes).sort(), ["ch", "mara", "root"]);
  assert.deepEqual(view.nodes.root.children, ["ch", "mara"]);
  assert.equal(view.nodes.mara.content, "## Who\nKeeper.");
  assert.match(project.nodes.mara.content, /blind/);
});
