import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceBackup, diffLines, getServerSnapshotContent, listServerSnapshotPaths } from "../app/modules/history/index.js";

test("two versions compared line by line", () => {
  assert.deepEqual(diffLines("a\nb\nc", "a\nB\nc").map((op) => `${op.type}:${op.text}`), ["same:a", "del:b", "add:B", "same:c"]);
  assert.deepEqual(diffLines("", "x").map((op) => op.type), ["del", "add"]);
  const big = Array.from({ length: 1500 }, (_, i) => `line ${i}`).join("\n");
  const ops = diffLines(big, big.replace("line 700", "changed"));
  assert.equal(ops.filter((op) => op.type !== "same").length, 2, "a very large text still finds the one change");
});

test("History's calls carry the token and the project, and say what failed", async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: new URL(url), init });
    return url.includes("content") ? new Response(JSON.stringify({ message: "That snapshot no longer exists" }), { status: 400, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  };
  try {
    await listServerSnapshotPaths("https://notes.example/", "t1", "red", "Novel");
    assert.equal(sent[0].url.pathname, "/api/snapshots");
    assert.deepEqual(Object.fromEntries(sent[0].url.searchParams), { token: "t1", team: "red", path: "Novel" });
    await createWorkspaceBackup("https://notes.example", "t1", "red", "Novel", "by hand");
    assert.equal(sent[1].init.method, "POST");
    assert.deepEqual(Object.fromEntries(sent[1].url.searchParams), { token: "t1" });
    assert.deepEqual(JSON.parse(sent[1].init.body), { team: "red", path: "Novel", label: "by hand" });
    await assert.rejects(getServerSnapshotContent("https://notes.example", "t1", "red", "Novel", "x"),
      /^Error: Could not read snapshot\. That snapshot no longer exists$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
