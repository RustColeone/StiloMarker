// The server this app runs on this computer (the desktop settings' connect:
// "local"): the same server as the web app's, started with this computer's
// Python, its state, accounts and data in this app's folder, listening on
// this computer only or (lan) for other devices on the network too. Its
// state is told as it changes: stopped, starting, running (port, the
// addresses others use), failed (why). Its accounts: how many there are,
// and the first admin made (after that, the admins manage them in the app).
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { ACCOUNTS_FILE, accountCount, firstAdminArgs, lanAddresses, pythonCandidates, pythonUsable, serverArgs } from "./server-policy.mjs";

const ASK_PYTHON = "import sys; print('%d.%d' % sys.version_info[:2])";
const UP_WITHIN = 20000; // ms for the server to take connections
const STOP_WITHIN = 3000; // ms before a server that won't stop is killed
const PORTS_TRIED = 20;  // the chosen port taken: the next ones

const quietly = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
});

// The first Python that can run the server (3.10 or later), or null.
export async function findPython(platform = process.platform, env = process.env) {
  for (const [cmd, pre] of pythonCandidates(platform, env)) {
    const printed = await quietly(cmd, [...pre, "-c", ASK_PYTHON]);
    if (printed && pythonUsable(printed)) return { cmd, pre, version: printed.trim() };
  }
  return null;
}

// A port free on that interface, from `from` on: the port, or null.
function freePort(from, host) {
  const tryPort = (port) => new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
  return (async () => {
    for (let port = from; port < from + PORTS_TRIED && port <= 65535; port += 1) if (await tryPort(port)) return port;
    return null;
  })();
}

// The server listens (it takes connections once its modules have started).
const takes = (port) => new Promise((resolve) => {
  const socket = connect({ port, host: "127.0.0.1" });
  socket.setTimeout(2000);
  const done = (ok) => { socket.destroy(); resolve(ok); };
  socket.once("connect", () => done(true));
  socket.once("error", () => done(false));
  socket.once("timeout", () => done(false));
});

async function upOn(port, within, gaveUp) {
  const until = Date.now() + within;
  while (Date.now() < until && !gaveUp()) {
    if (await takes(port)) return true;
    await new Promise((resolve) => { setTimeout(resolve, 300); });
  }
  return false;
}

const lastLine = (text) => text.trim().split("\n").filter(Boolean).pop() ?? "";

export function createLocalServer({ serverDir, staticDir, dataDir, onState = () => {}, python = findPython }) {
  let child = null;
  let state = { status: "stopped" };
  const set = (next) => { state = next; onState(state); return state; };

  async function stop() {
    const old = child;
    child = null;
    if (!old) return set({ status: "stopped" });
    set({ status: "stopping" });
    await new Promise((resolve) => {
      const timer = setTimeout(() => { old.kill("SIGKILL"); resolve(); }, STOP_WITHIN);
      old.once("exit", () => { clearTimeout(timer); resolve(); });
      old.kill("SIGTERM");
    });
    return set({ status: "stopped" });
  }

  // At once (the app is quitting): no waiting.
  function kill() {
    child?.kill("SIGTERM");
    child = null;
  }

  async function start({ port, lan, pin, masterPin }) {
    await stop();
    set({ status: "starting" });
    const found = await python();
    if (!found) return set({ status: "failed", reason: "Python 3.10 or later is needed to run a server on this computer (python.org)." });
    const host = lan ? "0.0.0.0" : "127.0.0.1";
    const listening = await freePort(port, host);
    if (!listening) return set({ status: "failed", reason: `No free port from ${port} to ${port + PORTS_TRIED - 1}.` });
    await mkdir(join(dataDir, "data"), { recursive: true });
    const args = [...found.pre, ...serverArgs({ script: join(serverDir, "mdnotes_server.py"), port: listening, lan, pin, masterPin,
      staticDir, dataDir, join, parentPid: process.pid })];
    const mine = spawn(found.cmd, args, { cwd: serverDir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" } });
    child = mine;
    let output = "";
    const note = (chunk) => { output = (output + chunk).slice(-4000); };
    mine.stdout.on("data", note);
    mine.stderr.on("data", note);
    mine.on("error", (error) => note(`\n${error.message}`));
    mine.on("exit", (code, signal) => {
      if (child !== mine) return; // stopped on purpose, or replaced
      child = null;
      set({ status: "failed", reason: `The server stopped (${code ?? signal}). ${lastLine(output)}`.trim() });
    });
    const up = await upOn(listening, UP_WITHIN, () => child !== mine);
    if (child !== mine) return state;
    if (!up) {
      await stop();
      return set({ status: "failed", reason: `The server did not answer. ${lastLine(output)}`.trim() });
    }
    const addresses = lan ? lanAddresses(networkInterfaces()).map((address) => `http://${address}:${listening}`) : [];
    return set({ status: "running", port: listening, lan, addresses, local: `http://127.0.0.1:${listening}`, python: found.version });
  }

  // How many accounts the server has (only that leaves the file); null when
  // the file is there but does not read.
  async function accounts() {
    try {
      return accountCount(await readFile(join(dataDir, ACCOUNTS_FILE), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return 0; // none yet: the server takes PINs only
      throw error;
    }
  }

  // The first admin, made with the server's own tool (its rules, its hashing),
  // the password on standard input: { ok: true } or { error }. Refused once
  // the server has accounts: the admins manage them in Settings → Accounts.
  async function firstAdmin(username, password) {
    const count = await accounts();
    if (count === null) return { error: `The account file (${ACCOUNTS_FILE} in the server's folder) does not read: fix or remove it first.` };
    if (count) return { error: "This server has accounts already: an admin manages them in Settings → Accounts." };
    const found = await python();
    if (!found) return { error: "Python 3.10 or later is needed to run a server on this computer (python.org)." };
    await mkdir(dataDir, { recursive: true });
    const args = [...found.pre, ...firstAdminArgs({ script: join(serverDir, "accounts.py"), dataDir, username, join })];
    return new Promise((resolve) => {
      const tool = spawn(found.cmd, args, { cwd: serverDir, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" } }); // a name in any script, on any system
      let said = "";
      tool.stdout.resume(); // "Added …": nothing to keep
      tool.stderr.on("data", (chunk) => { said = (said + chunk).slice(-2000); });
      tool.on("error", (error) => resolve({ error: error.message }));
      tool.on("exit", (code) => resolve(code === 0 ? { ok: true } : { error: lastLine(said).replace(/^accounts:\s*/, "") || "The account was not made." }));
      tool.stdin.end(`${password}\n`);
    });
  }

  return { start, stop, kill, state: () => state, accounts, firstAdmin };
}
