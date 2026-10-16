import test from "node:test";
import assert from "node:assert/strict";

import { defineModule, startModules, createRegistry, createEmitter } from "../app/kernel/index.js";

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
