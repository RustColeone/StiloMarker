import test from "node:test";
import assert from "node:assert/strict";

import { getAccessServer, setAccessServer } from "../app/modules/cloud/adapters/api.js";

const SERVER = "https://notes.example";

test("a project's access list is read and set with the account's token (Projects' routes)", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method ?? "GET", path: pathname, query: Object.fromEntries(searchParams),
      body: init.body ? JSON.parse(init.body) : undefined });
    const status = searchParams.get("token") === "t1" ? 200 : 403;
    const payload = status === 200 ? { whitelist: ["amy"], createdBy: "amy" } : { message: "Invalid account token" };
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  try {
    assert.deepEqual(await getAccessServer(SERVER, "t1", "red", "Novel"), { whitelist: ["amy"], createdBy: "amy" });
    assert.deepEqual(calls.at(-1), { method: "GET", path: "/api/workspaces/access", query: { token: "t1", team: "red", path: "Novel" }, body: undefined });
    await setAccessServer(SERVER, "t1", "red", "Novel", ["amy"], ["ben"]);
    assert.deepEqual(calls.at(-1), { method: "POST", path: "/api/workspaces/access", query: { token: "t1" },
      body: { team: "red", path: "Novel", whitelist: ["amy"], blacklist: ["ben"] } });
    await assert.rejects(getAccessServer(SERVER, "nope", "red", "Novel"), /Could not read access list/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
