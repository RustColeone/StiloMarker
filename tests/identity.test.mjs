import test from "node:test";
import assert from "node:assert/strict";

import { defineModule, startModules } from "../app/kernel/index.js";
import identityModule from "../app/modules/identity/index.js";
import { mayRestore, provenAfterSignIn, provenAfterSignOut } from "../app/modules/identity/model/credentials.js";
import { createServer, normalizeServerUrl } from "../app/modules/shell/adapters/server.js";

const SERVER = "https://notes.example";

test("the browser signs in by itself only where that account signed in before, with a stored password", () => {
  const proven = provenAfterSignIn({}, SERVER, "amy");
  assert.equal(mayRestore({ username: "amy", password: "pw", proven }, SERVER), true);
  assert.equal(mayRestore({ username: "amy", password: "", proven }, SERVER), false, "no password");
  assert.equal(mayRestore({ username: "ben", password: "pw", proven }, SERVER), false, "another account");
  assert.equal(mayRestore({ username: "amy", password: "pw", proven }, "https://other.example"), false, "another server");
  assert.deepEqual(provenAfterSignOut({ ...proven, x: "ben" }, SERVER), { x: "ben" });
});

test("the server address: empty means this page's origin and base path; a trailing slash goes", () => {
  assert.equal(normalizeServerUrl("https://a.example/stilo/"), "https://a.example/stilo");
  assert.equal(normalizeServerUrl(""), "", "no page, no origin");
});

// Identity on a fake Shell whose server answers from a table.
async function harness(replies) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method ?? "GET", path: pathname, query: Object.fromEntries(searchParams), body });
    const [status, payload] = replies[`${init.method ?? "GET"} ${pathname}`](body, Object.fromEntries(searchParams));
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  const server = createServer();
  server.configure({ address: () => SERVER });
  const fakeShell = defineModule({ name: "shell", level: 1, uses: [], owns: {}, start: () => ({ server }) });
  const { identity } = await startModules([fakeShell, identityModule]);
  const stored = { username: "", password: "", proven: {} };
  identity.attach({ read: () => ({ ...stored }), write: (next) => Object.assign(stored, next) });
  const events = [];
  identity.events.on("account", ({ account }) => events.push(account?.username ?? null));
  return { identity, stored, calls, events, restore: () => { globalThis.fetch = realFetch; } };
}

test("signing in, out and in again by itself", async () => {
  const h = await harness({
    "POST /api/auth/login": (body) => body.password === "pw"
      ? [200, { token: "t1", username: "amy", teams: ["red"], lastWorkspace: null }]
      : [403, { message: "Invalid username or password" }]
  });
  try {
    await assert.rejects(h.identity.signIn("amy", "nope"), /^Error: Login failed\. Invalid username or password$/);
    assert.equal(h.identity.account(), null);

    await h.identity.signIn(" amy ", "pw");
    assert.deepEqual({ ...h.identity.account(), teams: [...h.identity.account().teams] }, { token: "t1", username: "amy", teams: ["red"] });
    assert.throws(() => { h.identity.account().teams.push("x"); }, TypeError, "callers cannot change the account");
    assert.deepEqual(h.stored, { username: "amy", password: "pw", proven: { [SERVER]: "amy" } });
    assert.equal(h.identity.canRestore(), true);

    h.identity.drop();
    assert.equal(h.identity.token(), null);
    assert.equal((await h.identity.restore()).token, "t1", "the stored sign-in brings it back");

    h.identity.signOut();
    assert.deepEqual(h.stored, { username: "amy", password: "", proven: {} }, "the username stays for autofill");
    assert.equal(h.identity.canRestore(), false);
    assert.equal(await h.identity.restore(), null);
    assert.deepEqual(h.events, ["amy", null, "amy", null]);

    await assert.rejects(h.identity.signIn("amy", "pw", { isCurrent: () => false }), (error) => error.status === 499);
    assert.equal(h.identity.account(), null, "a cancelled sign-in signs nobody in");
    assert.deepEqual(h.stored, { username: "amy", password: "", proven: {} }, "and stores nothing");
  } finally {
    h.restore();
  }
});
