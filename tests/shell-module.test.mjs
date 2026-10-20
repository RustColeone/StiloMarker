import test from "node:test";
import assert from "node:assert/strict";

import { parseChord, chordMatches } from "../app/modules/shell/model/keys.js";
import { layoutMenus } from "../app/modules/shell/model/menu-layout.js";
import { createCommands } from "../app/modules/shell/service/commands.js";
import { createRegistry } from "../app/kernel/index.js";

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

test("shortcuts: Mod is Ctrl or Cmd, Alt must match, Shift only when named", () => {
  const save = parseChord("Mod+S");
  assert.ok(chordMatches(save, key("s", { ctrlKey: true })));
  assert.ok(chordMatches(save, key("S", { metaKey: true, shiftKey: true })), "Shift held still saves, as before");
  assert.ok(!chordMatches(save, key("s", { ctrlKey: true, altKey: true })));
  assert.ok(!chordMatches(save, key("s")));
  const both = parseChord("Shift+Mod+Enter");
  assert.ok(chordMatches(both, key("Enter", { ctrlKey: true, shiftKey: true })));
  assert.ok(!chordMatches(both, key("Enter", { ctrlKey: true })));
  assert.throws(() => parseChord("Hyper+S"), /Unknown modifier/);
  assert.throws(() => parseChord(""), /Empty/);
  assert.throws(() => parseChord("Mod+"), /Empty/);
  assert.throws(() => parseChord("+S"), /Empty/);
  assert.throws(() => parseChord("Shift+Mod"), /names no key/);
  assert.ok(chordMatches(parseChord("Mod++"), key("+", { ctrlKey: true })));
});

test("menus: ordered by menu, group, order; titles may be live; unknown menus are left out", () => {
  let chat = "Show Chat";
  const laid = layoutMenus(
    [{ id: "view", label: "View", order: 2 }, { id: "file", label: "File", order: 1 }],
    [
      { id: "a.late", title: "Late", menu: { id: "file", group: 1, order: 1 } },
      { id: "a.save", title: "Save", menu: { id: "file", order: 2 }, danger: true },
      { id: "a.new", title: "New", menu: { id: "file", order: 1 } },
      { id: "a.chat", title: () => chat, menu: { id: "view" } },
      { id: "a.lost", title: "Lost", menu: { id: "nowhere" } },
      { id: "a.none", title: "No menu" }
    ]);
  assert.deepEqual(laid.map((m) => m.id), ["file", "view"]);
  assert.deepEqual(laid[0].items.map((i) => i.id), ["a.new", "a.save", "a.late"]);
  assert.equal(laid[0].items[1].danger, true);
  chat = "Hide Chat";
  assert.equal(layoutMenus([{ id: "view", label: "View" }], [{ id: "a.chat", title: () => chat, menu: { id: "view" } }])[0].items[0].title, "Hide Chat");
  // Each item says its group (a menu draws a line between groups) and its first shortcut.
  const items = layoutMenus([{ id: "file", label: "File" }], [
    { id: "a.save", title: "Save", menu: { id: "file", group: 2 }, keys: ["Mod+S", "Mod+Shift+S"] },
    { id: "a.new", title: "New", menu: { id: "file" } }])[0].items;
  assert.deepEqual(items.map(({ id, group, keys }) => [id, group, keys]), [["a.new", 0, ""], ["a.save", 2, "Mod+S"]]);
});

test("commands: ids look like owner.action, need a title and run, and respect enabled()", async () => {
  const logs = [];
  const ctx = { registry: (o) => createRegistry({ ...o, owner: "shell" }), log: (line) => logs.push(line) };
  const { commands, run } = createCommands(ctx);
  assert.throws(() => commands.add({ id: "save", title: "Save", run() {} }), /owner\.action/);
  assert.throws(() => commands.add({ id: "x.save", run() {} }), /needs a title/);
  assert.throws(() => commands.add({ id: "x.save", title: "Save" }), /needs run/);
  assert.throws(() => commands.add({ id: "x.save", title: "Save", run() {}, keys: ["Mod+"] }), /Empty shortcut part/);
  let ran = 0, on = false;
  commands.add({ id: "x.save", title: "Save", run: (n) => { ran += n; }, enabled: () => on });
  assert.equal(await run("x.save", 1), false, "turned off");
  on = true;
  assert.equal(await run("x.save", 2), true);
  assert.equal(ran, 2);
  assert.equal(await run("x.missing"), false);
  assert.ok(logs.some((line) => /unknown command x.missing/.test(line)));
});
