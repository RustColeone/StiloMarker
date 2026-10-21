// The Log's command line (finding a command by what is typed) and Reload
// Window (the work kept before the page reloads): Shell's, without a page.
import test from "node:test";
import assert from "node:assert/strict";

import { searchCommands } from "../app/modules/shell/model/command-search.js";
import { chordLabel } from "../app/modules/shell/model/keys.js";
import { createCommands } from "../app/modules/shell/service/commands.js";
import { checkReloadStep, createReload } from "../app/modules/shell/adapters/reload.js";
import { createRegistry } from "../app/kernel/index.js";

const noop = () => {};
const COMMANDS = [
  { id: "shell.reload-window", title: "Reload Window", keywords: ["refresh", "stuck"], run: noop },
  { id: "workspace.save", title: "Save", keys: ["Mod+S"], run: noop },
  { id: "preview.save-pdf", title: "Save as PDF", run: noop },
  { id: "shell.clear-cache", title: "Clear All Cache", danger: true, run: noop },
  { id: "editor.toggle-preview", title: "Toggle Preview", run: noop },
  { id: "assistant.toggle-chat", title: () => "Hide Chat", run: noop },
  { id: "history.snapshots", title: "Snapshots…", enabled: () => false, run: noop },
  { id: "explorer.rename-file", title: "Rename File", args: true, run: noop }
];
const ids = (list) => list.map((item) => item.id);

test("command line: nothing typed lists every command, the first ones, then the recent, then by title", () => {
  const all = searchCommands(COMMANDS, "", { first: ["shell.reload-window"], recent: ["editor.toggle-preview", "workspace.save"] });
  assert.deepEqual(ids(all), ["shell.reload-window", "editor.toggle-preview", "workspace.save",
    "shell.clear-cache", "assistant.toggle-chat", "preview.save-pdf", "history.snapshots"]);
  assert.ok(!ids(all).includes("explorer.rename-file"), "a command that needs its caller's arguments is never offered");
  const chat = all.find((item) => item.id === "assistant.toggle-chat");
  assert.equal(chat.title, "Hide Chat", "a live title is read");
  assert.equal(all.find((item) => item.id === "history.snapshots").enabled, false);
  assert.equal(all.find((item) => item.id === "shell.clear-cache").danger, true);
  assert.deepEqual(all.find((item) => item.id === "workspace.save").keys, ["Mod+S"]);
});

test("command line: words typed find a command by title, keyword, id or letters in order", () => {
  const top = (query) => searchCommands(COMMANDS, query)[0]?.id;
  assert.equal(top("reload"), "shell.reload-window");
  assert.equal(top("RELOAD win"), "shell.reload-window", "case and word order do not matter");
  assert.equal(top("refresh"), "shell.reload-window", "a keyword");
  assert.equal(top("stuck"), "shell.reload-window");
  assert.equal(top("rlw"), "shell.reload-window", "its letters in order");
  assert.equal(top("save"), "workspace.save", "the exact title before a longer one");
  assert.deepEqual(ids(searchCommands(COMMANDS, "save")), ["workspace.save", "preview.save-pdf"]);
  assert.equal(top("pdf"), "preview.save-pdf");
  assert.equal(top("clear-cache"), "shell.clear-cache", "its id");
  assert.equal(top("toggle prev"), "editor.toggle-preview");
  assert.deepEqual(searchCommands(COMMANDS, "zzz"), [], "nothing matches");
  assert.deepEqual(searchCommands(COMMANDS, "rename"), [], "not even one needing arguments");
});

test("commands: keywords are a list of words", () => {
  const { commands } = createCommands({ registry: (o) => createRegistry({ ...o, owner: "shell" }), log: noop });
  assert.throws(() => commands.add({ id: "x.a", title: "A", run: noop, keywords: "refresh" }), /keywords/);
  assert.throws(() => commands.add({ id: "x.b", title: "B", run: noop, keywords: [""] }), /keywords/);
  commands.add({ id: "x.c", title: "C", run: noop, keywords: ["refresh"] });
  assert.ok(commands.get("x.c"));
});

test("shortcuts read as Ctrl, or Cmd on a Mac", () => {
  assert.equal(chordLabel("Mod+S"), "Ctrl+S");
  assert.equal(chordLabel("Shift+Mod+Enter", true), "Shift+Cmd+Enter");
  assert.equal(chordLabel("F1"), "F1");
});

function reloader({ answer = true, timeout } = {}) {
  const steps = createRegistry({ owner: "shell", validate: checkReloadStep });
  const asked = [];
  const lines = [];
  let reloads = 0;
  const reload = createReload({ steps, timeout, log: (kind, message, detail) => lines.push({ kind, message, detail }),
    confirm: async (request) => { asked.push(request); return answer; }, reload: () => { reloads += 1; } });
  return { steps, reload, asked, lines, reloads: () => reloads };
}

test("Reload Window: each module keeps its work in order, then the page reloads without asking", async () => {
  const { steps, reload, asked, reloads } = reloader();
  const order = [];
  steps.add({ id: "b.files", label: "Your files", order: 20, keep: async () => { order.push("files"); } });
  steps.add({ id: "a.typing", label: "Shared edits", order: 10, keep: async () => { order.push("typing"); return ""; } });
  steps.add({ id: "c.view", label: "Where you were", order: 30, keep: () => { order.push("view"); } });
  assert.equal(reload.reloading(), false);
  assert.equal(await reload.reloadWindow(), true);
  assert.deepEqual(order, ["typing", "files", "view"]);
  assert.equal(asked.length, 0, "everything kept: no question");
  assert.equal(reloads(), 1);
  assert.equal(reload.reloading(), true, "the page must not ask Leave site? now");
  assert.equal(await reload.reloadWindow(), false, "once");
  assert.throws(() => steps.add({ id: "d.bad", label: "Bad" }), /keep/);
  assert.throws(() => steps.add({ id: "d.bad", keep: noop }), /label/);
});

test("Reload Window: what could not be kept is said, and the user chooses", async () => {
  const stay = reloader({ answer: false });
  stay.steps.add({ id: "a.typing", label: "Shared edits", order: 10, keep: async () => "changes in a.md are not confirmed" });
  stay.steps.add({ id: "b.files", label: "Your files", order: 20, keep: async () => { throw new Error("disk full"); } });
  assert.equal(await stay.reload.reloadWindow(), false);
  assert.equal(stay.reloads(), 0, "the user stayed");
  assert.equal(stay.reload.reloading(), false);
  assert.match(stay.asked[0].message, /Shared edits: changes in a\.md are not confirmed/);
  assert.match(stay.asked[0].message, /Your files: disk full/);
  assert.ok(stay.lines.some((line) => line.kind === "failed" && /Your files not kept/.test(line.message)));

  const go = reloader({ answer: true, timeout: 20 });
  go.steps.add({ id: "a.slow", label: "Slow", keep: () => new Promise(noop) });
  assert.equal(await go.reload.reloadWindow(), true, "reload anyway");
  assert.match(go.asked[0].message, /Slow: still not done/, "a step that hangs counts as a problem");
  assert.equal(go.reloads(), 1);
});

test("Reload Window: a reload that declines (a new version that could not start yet) leaves the page as it was", async () => {
  const steps = createRegistry({ owner: "shell", validate: checkReloadStep });
  const lines = [];
  let declines = 1;
  let reloads = 0;
  const reload = createReload({ steps, log: (kind, message) => lines.push(message), confirm: async () => true,
    reload: async () => { if (declines > 0) { declines -= 1; return false; } reloads += 1; return undefined; } });
  assert.equal(await reload.reloadWindow(), false);
  assert.equal(reload.reloading(), false, "Leave site? still asked: the page stays");
  assert.ok(lines.includes("Reload Window: not reloaded"));
  assert.equal(await reload.reloadWindow(), true, "and it can be tried again");
  assert.equal(reloads, 1);
  assert.equal(reload.reloading(), true);
});
