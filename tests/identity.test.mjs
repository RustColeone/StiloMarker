import test from "node:test";
import assert from "node:assert/strict";

import { defineModule, startModules } from "../app/kernel/index.js";
import identityModule from "../app/modules/identity/index.js";
import { mayRestore, provenAfterSignIn, provenAfterSignOut } from "../app/modules/identity/model/credentials.js";
import { createServer, normalizeServerUrl } from "../app/modules/shell/adapters/server.js";

const SERVER = "https://notes.example";

test("the browser signs in by itself only where that account signed in before, with its token kept", () => {
  const proven = provenAfterSignIn({}, SERVER, "amy");
  assert.equal(mayRestore({ username: "amy", token: "t1", proven }, SERVER), true);
  assert.equal(mayRestore({ username: "amy", token: "", password: "pw", proven }, SERVER), true, "a page before v0.3.1: its password, once");
  assert.equal(mayRestore({ username: "amy", token: "", password: "", proven }, SERVER), false, "nothing kept");
  assert.equal(mayRestore({ username: "ben", token: "t1", proven }, SERVER), false, "another account");
  assert.equal(mayRestore({ username: "amy", token: "t1", proven }, "https://other.example"), false, "another server");
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
  const stored = { username: "", token: "", password: "", proven: {} };
  identity.attach({ read: () => ({ ...stored }), write: (next) => Object.assign(stored, next) });
  const events = [];
  identity.events.on("account", ({ account }) => events.push(account?.username ?? null));
  return { identity, stored, calls, events, restore: () => { globalThis.fetch = realFetch; } };
}

test("signing in, out and in again by itself, with the token kept (never the password)", async () => {
  const signedIn = new Set();
  const h = await harness({
    "POST /api/auth/login": (body) => {
      if (body.password !== "pw") return [403, { message: "Invalid username or password" }];
      signedIn.add("t1");
      return [200, { token: "t1", username: "amy", teams: ["red"], lastWorkspace: null }];
    },
    "GET /api/auth/me": (body, query) => (signedIn.has(query.token)
      ? [200, { username: "amy", teams: ["red", "blue"], admin: false, lastWorkspace: null }] : [403, { message: "Not logged in" }]),
    "POST /api/auth/logout": (body, query) => { signedIn.delete(query.token); return [200, { message: "Signed out" }]; }
  });
  try {
    await assert.rejects(h.identity.signIn("amy", "nope"), /^Error: Login failed\. Invalid username or password$/);
    assert.equal(h.identity.account(), null);

    await h.identity.signIn(" amy ", "pw");
    assert.deepEqual({ ...h.identity.account(), teams: [...h.identity.account().teams] }, { token: "t1", username: "amy", teams: ["red"], admin: false });
    assert.throws(() => { h.identity.account().teams.push("x"); }, TypeError, "callers cannot change the account");
    assert.deepEqual(h.stored, { username: "amy", token: "t1", password: "", proven: { [SERVER]: "amy" } }, "the token kept, not the password");
    assert.equal(h.identity.canRestore(), true);

    h.identity.drop();
    assert.equal(h.identity.token(), null);
    const logins = h.calls.filter((call) => call.path === "/api/auth/login").length;
    const again = await h.identity.restore();
    assert.equal(again.token, "t1", "the kept token brings it back");
    assert.deepEqual([...h.identity.account().teams], ["red", "blue"], "as the server has the account now");
    assert.equal(h.calls.filter((call) => call.path === "/api/auth/login").length, logins, "no password sent");

    h.identity.signOut();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(h.calls.at(-1), { method: "POST", path: "/api/auth/logout", query: { token: "t1" }, body: undefined }, "the server ends it too");
    assert.deepEqual(h.stored, { username: "amy", token: "", password: "", proven: {} }, "the username stays for autofill");
    assert.equal(h.identity.canRestore(), false);
    assert.equal(await h.identity.restore(), null);
    assert.deepEqual(h.events, ["amy", null, "amy", null]);

    await assert.rejects(h.identity.signIn("amy", "pw", { isCurrent: () => false }), (error) => error.status === 499);
    assert.equal(h.identity.account(), null, "a cancelled sign-in signs nobody in");
    assert.deepEqual(h.stored, { username: "amy", token: "", password: "", proven: {} }, "and stores nothing");
  } finally {
    h.restore();
  }
});

test("a page from before v0.3.1 signs in once with its kept password, then keeps the token only; an ended token is forgotten", async () => {
  let live = null;
  const h = await harness({
    "POST /api/auth/login": (body) => { live = "t2"; return body.password === "pw" ? [200, { token: "t2", username: "amy", teams: [] }] : [403, {}]; },
    "GET /api/auth/me": (body, query) => (query.token === live ? [200, { username: "amy", teams: [], admin: false }] : [403, { message: "Not logged in" }])
  });
  try {
    Object.assign(h.stored, { username: "amy", password: "pw", proven: { [SERVER]: "amy" } });
    assert.equal((await h.identity.restore()).token, "t2");
    assert.deepEqual(h.stored, { username: "amy", token: "t2", password: "", proven: { [SERVER]: "amy" } }, "the password is gone");

    live = null; // a new password elsewhere, or 30 days unused: the server ended it
    h.identity.drop();
    assert.equal(await h.identity.restore(), null, "nothing to sign in with: by hand");
    assert.equal(h.stored.token, "", "the ended token forgotten");
    assert.equal(h.identity.canRestore(), false);
    assert.equal(h.calls.filter((call) => call.path === "/api/auth/login").length, 1, "no password was there to send again");
  } finally {
    h.restore();
  }
});
