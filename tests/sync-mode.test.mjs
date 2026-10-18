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

test("the session's status: its reports change it; an out-of-date tab only learns that", async () => {
  const { SESSION_STATUS, statusFromSession } = await import("../app/modules/sync/service/status.js");
  const { createLiveView } = await import("../app/kernel/index.js");
  const state = createState("sync", SESSION_STATUS, createTrace({ now: () => 0 }));
  const status = createLiveView(state);
  state.set("the session", statusFromSession({ status: "connected", detail: "ok", presence: [{ clientId: "a" }], sessionId: "t/p", revision: 7, role: "client" }));
  assert.equal(status.status, "connected");
  assert.equal(status.revision, 7);
  assert.equal(status.displayName, null, "what the report leaves out is reset");
  state.set("the session", statusFromSession({ status: "upgrade-required", detail: "Reload to update" }));
  assert.deepEqual([status.status, status.detail, status.revision, status.role], ["upgrade-required", "Reload to update", 7, "client"]);
  status.change({ detail: "Reconnecting in 2s" });
  assert.equal(status.detail, "Reconnecting in 2s");
  assert.throws(() => { status.status = "offline"; }, /read-only/);
});
