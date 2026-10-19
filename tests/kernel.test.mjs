import test from "node:test";
import assert from "node:assert/strict";

import { defineModule, startModules, createRegistry, createEmitter, createState, createTrace, trace, ignore, ignored, describe } from "../app/kernel/index.js";
import { callerOf } from "../app/kernel/trace.js";

const mod = (name, level, uses, start = () => ({})) => defineModule({ name, level, uses, owns: {}, start });

test("modules start lowest level first and see only what they declared", async () => {
  const order = [];
  const apis = await startModules([
    mod("top", 2, ["base"], (ctx) => { order.push("top"); return { sum: ctx.use("base").one + 1 }; }),
    mod("base", 1, [], () => { order.push("base"); return { one: 1 }; }),
    mod("other", 1, [], () => { order.push("other"); return {}; })
  ]);
  assert.deepEqual(order, ["base", "other", "top"]);
  assert.equal(apis.top.sum, 2);
  assert.throws(() => { apis.top.sum = 3; }, TypeError, "apis are frozen");
});

test("using an undeclared, missing, same-level or higher module is refused", async () => {
  await assert.rejects(startModules([mod("a", 1, []), mod("b", 2, [], (ctx) => ctx.use("a"))]), /did not declare/);
  await assert.rejects(startModules([mod("b", 2, ["a"])]), /not being started/);
  await assert.rejects(startModules([mod("a", 1, ["b"]), mod("b", 1, [])]), /may not use/);
  await assert.rejects(startModules([mod("a", 1, []), mod("a", 2, [])]), /Two modules/);
  assert.throws(() => defineModule({ name: "Bad Name", level: 1, uses: [], owns: {}, start() {} }), /Bad module name/);
  assert.throws(() => defineModule({ name: "x", level: 1, uses: [], start() {} }), /needs "owns"/);
});

test("whenStarted runs once every module has started, in start order", async () => {
  const seen = [];
  await startModules([
    mod("top", 2, ["base"], (ctx) => { seen.push("start top"); ctx.whenStarted(() => seen.push("then top")); }),
    mod("base", 1, [], (ctx) => { seen.push("start base"); ctx.whenStarted(async () => { await null; seen.push("then base"); }); })
  ]);
  assert.deepEqual(seen, ["start base", "start top", "then base", "then top"]);
});

test("a module that fails to start stops the start", async () => {
  const started = [];
  await assert.rejects(startModules([
    mod("a", 1, [], () => { throw new Error("broken"); }),
    mod("b", 2, ["a"], () => { started.push("b"); })
  ]), /broken/);
  assert.deepEqual(started, []);
});

test("registries: unique keys, removal, validation and change listeners", () => {
  const registry = createRegistry({ validate: (e) => { if (!e.run) throw new Error("needs run"); }, owner: "t" });
  let changes = 0;
  registry.onChange(() => { changes += 1; });
  const remove = registry.add({ id: "one", run() {} });
  assert.throws(() => registry.add({ id: "one", run() {} }), /already registered/);
  assert.throws(() => registry.add({ id: "two" }), /needs run/);
  assert.throws(() => registry.add({ run() {} }), /needs a "id"/);
  assert.equal(registry.all().length, 1);
  assert.ok(Object.isFrozen(registry.get("one")));
  remove();
  remove();
  assert.equal(registry.has("one"), false);
  assert.equal(changes, 2);
});

test("emitters: a failing listener is logged and the others still run", () => {
  const logged = [];
  const events = createEmitter("t", (...args) => logged.push(args.join(" ")));
  const seen = [];
  events.on("x", () => { throw new Error("boom"); });
  const off = events.on("x", (value) => seen.push(value));
  events.emit("x", 1);
  off();
  events.emit("x", 2);
  assert.deepEqual(seen, [1]);
  assert.equal(logged.length, 2);
  assert.match(logged[0], /boom/);
});

test("the trace records events, failed listeners and ignored errors, counting repeats", () => {
  const trace = createTrace({ limit: 3, now: () => 0 });
  const events = createEmitter("t", () => {}, trace);
  events.on("x", () => { throw new Error("boom"); });
  events.emit("x", { type: "patch-file", path: "a.md", content: "long text" });
  assert.deepEqual(trace.entries().map((e) => [e.kind, e.owner, e.message, e.detail]), [
    ["event", "t", "x", "type=patch-file path=a.md"],
    ["failed", "t", "a listener for x", "Error: boom"]
  ]);
  trace.record("log", "t", "same");
  trace.record("log", "t", "same");
  assert.equal(trace.entries().at(-1).count, 2, "a repeat is counted, not pushed");
  trace.record("log", "t", "newer");
  assert.equal(trace.entries().length, 3, "the oldest entries fall off past the limit");
  assert.match(trace.text(), /log t: same \(x2\)/);
  trace.clear();
  assert.deepEqual(trace.entries(), []);
});

test("ignore() and ignored() put the error, the reason and the caller in the page's trace", async () => {
  trace.clear();
  try { JSON.parse("{"); } catch (error) { ignore(error, "a broken payload"); }
  await Promise.reject(new Error("offline")).catch(ignored("a background call"));
  const [first, second] = trace.entries();
  assert.equal(first.kind, "ignored");
  assert.equal(first.message, "a broken payload");
  assert.match(first.detail, /^SyntaxError: /);
  assert.match(first.owner, /tests\/kernel\.test\.mjs:\d+$/);
  assert.equal(second.message, "a background call");
  assert.equal(second.detail, "Error: offline");
  assert.equal(callerOf("Error\n    at f (https://host/app/x/y.js?v=2:12:5)"), "app/x/y.js:12");
  assert.equal(describe({ a: 1, b: 2 }), "{a, b}");
});

test("state: changes go through named actions, are traced, and cannot happen behind the owner's back", async () => {
  const log = createTrace({ now: () => 0 });
  const view = createState("editor", { tabs: [], open: null }, log);
  const seen = [];
  view.on((state, changed, action) => seen.push([action, changed, state.open]));
  view.set("open a file", { open: "a", tabs: ["a"] });
  view.set("open a file", { open: "a" }); // no change: nothing recorded
  assert.deepEqual(seen, [["open a file", ["open", "tabs"], "a"]]);
  assert.deepEqual(log.entries().map((e) => [e.kind, e.owner, e.message, e.detail]), [["state", "editor", "open a file", "open=a tabs=[a]"]]);
  assert.throws(() => view.get().tabs.push("b"), TypeError, "its lists are frozen");
  assert.throws(() => { view.get().open = "b"; }, TypeError, "the state object is frozen");
  assert.throws(() => view.set("typo", { opne: "b" }), /not part of its state/);
  const failing = view.on(() => { throw new Error("listener broke"); });
  view.set("close", { open: null });
  assert.equal(view.get().open, null);
  assert.ok(log.entries().some((e) => e.kind === "failed" && e.detail === "Error: listener broke"));
  failing();
  const apis = await startModules([defineModule({ name: "m", level: 1, uses: [], owns: {}, start: (ctx) => ({ state: ctx.state({ n: 0 }) }) })]);
  apis.m.state.set("count", { n: 1 });
  const keys = createState("shell", { pin: "", theme: "light" }, log, { secret: ["pin"] });
  keys.set("sign in", { pin: "1234", theme: "dark" });
  assert.equal(log.entries().at(-1).detail, "pin=(hidden) theme=dark", "a secret's value never reaches the trace");
  assert.ok(trace.entries().some((e) => e.kind === "state" && e.owner === "m" && e.message === "count"));
});
