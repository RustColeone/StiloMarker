// Sync's mode (app/modules/sync/service/mode.js): shared or local work, and
// the local project kept aside while shared.
import test from "node:test";
import assert from "node:assert/strict";

import { createState, createTrace } from "../app/kernel/index.js";
import { LOCAL_MODE, createMode } from "../app/modules/sync/service/mode.js";

function fresh() {
  const log = createTrace({ now: () => 0 });
  return { mode: createMode(createState("sync", LOCAL_MODE, log)), log };
}

test("sharing keeps the local project aside once; leaving hands it back", () => {
  const { mode, log } = fresh();
  const local = { id: "local" }, cloud = { id: "cloud" };
  mode.share(local);
  mode.share(cloud); // already shared: the kept project stays the local one
  assert.deepEqual(mode.get(), { workspaceMode: "synced", privateProject: local });
  assert.equal(mode.leave(), local);
  assert.deepEqual(mode.get(), LOCAL_MODE);
  assert.equal(mode.leave(), null, "nothing kept: nothing to bring back");
  assert.deepEqual(log.entries().map((e) => e.message), ["share", "leave"]);
});

test("forgetKept stays shared; restore undoes a failed open", () => {
  const { mode } = fresh();
  const local = { id: "local" };
  const before = mode.get();
  mode.share(local);
  mode.forgetKept();
  assert.deepEqual(mode.get(), { workspaceMode: "synced", privateProject: null });
  mode.restore(before);
  assert.deepEqual(mode.get(), LOCAL_MODE);
  assert.throws(() => { mode.get().workspaceMode = "synced"; }, TypeError, "only actions change the mode");
});
