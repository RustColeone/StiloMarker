// The server this app runs on this computer (the desktop settings' connect:
// "local"): the same server as the web app's, started with this computer's
// Python, its state, accounts and data in this app's folder, listening on
// this computer only or (lan) for other devices on the network too. Its
// state is told as it changes: stopped, starting, running (port, the
// addresses others use), failed (why).
import { execFile, spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { lanAddresses, pythonCandidates, pythonUsable, serverArgs } from "./server-policy.mjs";

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
      env: { ...process.env, PYTHONUNBUFFERED: "1" } });
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

  return { start, stop, kill, state: () => state };
}
