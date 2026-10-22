// The desktop app's server (desktop/server-policy.mjs, desktop/server.mjs):
// the choice kept, where requests go, the server's command line, which Python
// runs it; and the server itself started, answering, and stopped (this
// computer's Python, a temporary folder). The app in Electron: desktop-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { forwardHeaders, forwardTarget, forwardUrl, lanAddresses, LOCAL_PORT, pythonCandidates, pythonUsable, serverAddress,
  serverArgs, serverChoice } from "../desktop/server-policy.mjs";
import { createLocalServer, findPython } from "../desktop/server.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("desktop server: an address to forward to is http or https, a host, nothing else", () => {
  assert.equal(serverAddress("https://stilomarker.example/"), "https://stilomarker.example");
  assert.equal(serverAddress(" http://192.168.1.20:8000 "), "http://192.168.1.20:8000");
  assert.equal(serverAddress("https://example.com/stilo/?x=1#y"), "https://example.com/stilo");
  for (const bad of ["", "ftp://example.com", "file:///etc", "javascript:alert(1)", "https://user:pw@example.com", "not a url", null]) {
    assert.equal(serverAddress(bad), null, String(bad));
  }
});

test("desktop server: the kept choice made whole (defaults, PINs made once, nonsense dropped)", () => {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2];
  let at = 0;
  const random = () => digits[at++ % digits.length] / 10 + 0.01;
  const fresh = serverChoice({}, random);
  assert.equal(fresh.connect, "none");
  assert.equal(fresh.local.port, LOCAL_PORT);
  assert.equal(fresh.local.lan, false);
  assert.match(fresh.local.pin, /^\d{6}$/);
  assert.match(fresh.local.masterPin, /^\d{6}$/);
  assert.notEqual(fresh.local.pin, fresh.local.masterPin);
  const kept = serverChoice({ connect: "local", local: { port: 9000, lan: true, pin: "112233", masterPin: "445566" } });
  assert.deepEqual(kept.local, { port: 9000, lan: true, pin: "112233", masterPin: "445566" });
  assert.equal(serverChoice({ connect: "remote", remoteUrl: "nope" }).connect, "none", "no address: no server");
  assert.equal(serverChoice({ connect: "elsewhere" }).connect, "none");
  assert.equal(serverChoice({ local: { port: 80 } }).local.port, LOCAL_PORT, "not a privileged port");
  assert.equal(serverChoice({ local: { pin: "12" } }).local.pin.length, 6);
});

test("desktop server: where the app's /api/ requests go", () => {
  const choice = serverChoice({ connect: "local", local: { pin: "111111", masterPin: "222222" } });
  assert.equal(forwardTarget(choice, 8770), "http://127.0.0.1:8770");
  assert.equal(forwardTarget(serverChoice({ connect: "remote", remoteUrl: "https://example.com/stilo/" })), "https://example.com/stilo");
  assert.equal(forwardTarget(serverChoice({})), null);
  assert.equal(forwardUrl("https://example.com/stilo", "app://stilo/api/session/state?token=t"), "https://example.com/stilo/api/session/state?token=t");
  const headers = forwardHeaders(new Map([["Content-Type", "application/json"], ["Accept", "text/event-stream"], ["Cookie", "a=b"],
    ["Origin", "app://stilo"], ["Host", "stilo"], ["Last-Event-ID", "7"]]));
  assert.deepEqual(headers, { "Content-Type": "application/json", Accept: "text/event-stream", "Last-Event-ID": "7" });
});

test("desktop server: its command line, its Python, this computer's addresses", () => {
  const args = serverArgs({ script: "/s/mdnotes_server.py", port: 8765, lan: false, pin: "1", masterPin: "2", staticDir: "/web",
    dataDir: "/d", join: (...parts) => parts.join("/") });
  assert.deepEqual(args, ["/s/mdnotes_server.py", "--host", "127.0.0.1", "--port", "8765", "--pin", "1", "--master-pin", "2",
    "--static-dir", "/web", "--state-file", "/d/session-state.json", "--whitelist", "/d/accounts.json", "--data-dir", "/d/data"]);
  assert.equal(serverArgs({ script: "s", port: 1, lan: true, pin: "1", masterPin: "2", staticDir: "w", dataDir: "d", join: (...p) => p.join("/") })[2], "0.0.0.0");
  assert.deepEqual(pythonCandidates("linux", {}), [["python3", []], ["python", []]]);
  assert.deepEqual(pythonCandidates("win32", {})[0], ["py", ["-3"]]);
  assert.deepEqual(pythonCandidates("darwin", { STILO_PYTHON: "/opt/py/bin/python3" })[0], ["/opt/py/bin/python3", []]);
  assert.equal(pythonUsable("3.10\n"), true);
  assert.equal(pythonUsable("3.13"), true);
  assert.equal(pythonUsable("3.9"), false);
  assert.equal(pythonUsable("2.7"), false);
  assert.equal(pythonUsable("garbage"), false);
  assert.deepEqual(lanAddresses({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }, { family: "IPv6", address: "fe80::1", internal: false }],
    wlan0: [{ family: 4, address: "10.0.0.5", internal: false }] }), ["192.168.1.20", "10.0.0.5"]);
});

const freePort = () => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

test("desktop server: started with this computer's Python, it answers, and stops", { timeout: 60000 }, async (t) => {
  if (!await findPython()) { t.skip("no Python 3.10 or later here"); return; }
  const dataDir = await mkdtemp(join(tmpdir(), "stilo-desktop-server-"));
  const states = [];
  const server = createLocalServer({ serverDir: join(ROOT, "server"), staticDir: ROOT, dataDir, onState: (s) => states.push(s.status) });
  try {
    const port = await freePort();
    const running = await server.start({ port, lan: false, pin: "135791", masterPin: "246802" });
    assert.equal(running.status, "running", running.reason);
    assert.equal(running.port, port);
    assert.deepEqual(running.addresses, [], "this computer only");
    const ping = await (await fetch(`${running.local}/api/ping`)).json();
    assert.equal(ping.message, "pong");
    // Its PIN joins its session; its state is kept in this app's folder.
    const joined = await fetch(`${running.local}/api/session/connect`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "135791", displayName: "test" }) });
    assert.equal(joined.status, 200);
    await server.stop();
    assert.equal(server.state().status, "stopped");
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(2000) }), "stopped: nothing answers");
    assert.deepEqual(states.filter((s, i) => s !== states[i - 1]), ["stopped", "starting", "running", "stopping", "stopped"]);
  } finally {
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("desktop server: its port taken, the next one", { timeout: 60000 }, async (t) => {
  if (!await findPython()) { t.skip("no Python 3.10 or later here"); return; }
  const dataDir = await mkdtemp(join(tmpdir(), "stilo-desktop-server-"));
  const server = createLocalServer({ serverDir: join(ROOT, "server"), staticDir: ROOT, dataDir });
  const port = await freePort();
  const taken = createServer();
  await new Promise((resolve) => { taken.listen(port, "127.0.0.1", resolve); });
  try {
    const running = await server.start({ port, lan: false, pin: "135791", masterPin: "246802" });
    assert.equal(running.status, "running", running.reason);
    assert.ok(running.port > port && running.port < port + 20, running.port);
  } finally {
    taken.close();
    await server.stop();
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("desktop server: without a usable Python it says so", async () => {
  const server = createLocalServer({ serverDir: ROOT, staticDir: ROOT, dataDir: tmpdir(), python: async () => null });
  const state = await server.start({ port: 8765, lan: false, pin: "1", masterPin: "2" });
  assert.equal(state.status, "failed");
  assert.match(state.reason, /Python 3\.10 or later/);
});
