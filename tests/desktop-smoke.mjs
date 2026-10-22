// Run inside Electron by desktop-browser.py: the desktop app (desktop/app.mjs)
// started as main.mjs does, with stand-ins for the native leave dialog and
// the system's browser, and a release feed of its own. Drives the window with
// real input events and prints one JSON line: what it found.
//   STILO_SMOKE_ROOT     the web app's files (a copy: its main.js exposes window.__ui, and
//                        a fresh profile starts with one note, flow.md)
//   STILO_SMOKE_PROFILE  the profile (one per run: the second phase reopens it)
//   STILO_SMOKE_PHASE    "first" (a fresh profile) or "again" (the same, reopened);
//                        "serve" (a fresh profile: runs a server, shares on it),
//                        "serve-again" (the same, reopened: back on it by itself),
//                        "remote" (another server: STILO_SMOKE_REMOTE, its PIN STILO_SMOKE_REMOTE_PIN)
//   STILO_SMOKE_PORT     the port for the server it runs
import { createServer } from "node:http";
import { app } from "electron";
import { start } from "../desktop/app.mjs";

const { STILO_SMOKE_ROOT: root, STILO_SMOKE_PROFILE: userData, STILO_SMOKE_PHASE: phase } = process.env;
const RELEASE = "https://github.com/RustColeone/StiloMarker/releases/tag/v9.9.9";
const found = { phase, asked: 0, opened: [], errors: [] };
const answers = ["stay", "leave"];
let finished = false;

function finish(extra = {}) {
  if (finished) return;
  finished = true;
  process.stdout.write(`SMOKE ${JSON.stringify({ ...found, ...extra })}\n`);
  app.exit(0);
}
setTimeout(() => finish({ failed: "timed out" }), 120000);

const feed = await new Promise((resolve) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ tag_name: "v9.9.9", html_url: RELEASE, draft: false, prerelease: false }));
  });
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}/releases/latest`));
});

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function until(contents, expression, what, seconds = 60) {
  for (let i = 0; i < seconds * 5; i += 1) {
    const yes = await contents.executeJavaScript(`Boolean(${expression})`).catch((error) => { found.lastWait = error.message; return false; });
    if (yes) return;
    await pause(200);
  }
  const state = await contents.executeJavaScript(`JSON.stringify({ file: window.__ui?.controller.getActiveFile()?.name,
    preview: document.querySelector("#preview-output")?.innerHTML.slice(0, 300), mathjax: typeof window.MathJax,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean).slice(-3) })`).catch((error) => String(error));
  throw new Error(`never: ${what} (${state})`);
}

// A real click (user activation, as a person's), at an element's centre.
async function click(contents, selector) {
  const [x, y] = await contents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  contents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  contents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
}

const page = (contents, code) => contents.executeJavaScript(`(async () => { ${code} })()`);

async function first(win) {
  const contents = win.webContents;
  found.where = await page(contents, "return location.href;");
  // No server: its addresses answer at once, as offline; nothing else is served.
  found.api = await page(contents, `const r = await fetch("api/session/state"); return [r.status, (await r.json()).error];`);
  found.missing = await page(contents, `return (await fetch("server/whitelist.json")).status;`);
  found.serviceWorkers = await page(contents, "return navigator.serviceWorker?.controller ? 1 : 0;");
  // The note (desktop-browser.py seeds it): its formula and diagram drawn from the app's own libraries.
  await until(contents, 'document.querySelector("#preview-output mjx-container svg")', "the formula drawn");
  await until(contents, 'document.querySelector("#preview-output .mermaid-diagram svg")', "the diagram drawn");
  found.drawn = true;
  // A link opens in the system's browser; the window stays on the app.
  await click(contents, '#preview-output a[href="https://example.com/stilo"]');
  await pause(800);
  await page(contents, 'location.href = "https://example.com/elsewhere";');
  await pause(800);
  found.stillHere = await page(contents, "return location.href;");
  // A newer release: the status bar says so, and its item opens the release's page.
  await until(contents, '!document.querySelector("#status-update-item").hidden', "Update available shown");
  found.updateItem = await page(contents, 'const item = document.querySelector("#status-update-item"); return [item.textContent.trim(), item.title];');
  await click(contents, "#status-update-item");
  await pause(800);
  // Typed (at the end of the note) and saved by auto-save, then typed without saving: closing asks.
  await click(contents, "#editor-content .editor-line:last-child");
  contents.sendInputEvent({ type: "keyDown", keyCode: "End", modifiers: ["control"] });
  contents.sendInputEvent({ type: "keyUp", keyCode: "End", modifiers: ["control"] });
  await pause(300);
  await contents.insertText(" First words kept.");
  await until(contents, 'window.__ui.controller.getActiveFile().content.endsWith("The end. First words kept.")', "typed");
  await until(contents, "!window.__ui.controller.getActiveFile().dirty", "saved by auto-save");
  await page(contents, 'window.__ui.shell.settings.change({ autoSave: false }, "test");');
  await contents.insertText(" Unsaved words.");
  await until(contents, "window.__ui.controller.getActiveFile().dirty", "an unsaved change");
  win.close(); // asked: Stay
  await pause(1500);
  found.stayed = !win.isDestroyed();
  found.askedAfterStay = found.asked;
  win.close(); // asked: Leave (the app quits when its window closes)
}

async function again(win) {
  const contents = win.webContents;
  found.where = await page(contents, "return location.href;");
  // The same origin at every start: the workspace is still in this profile.
  await until(contents, `[...document.querySelectorAll("#explorer-tree .tree-row")].some((row) => row.textContent.includes("flow.md"))`, "flow.md still there");
  found.kept = await page(contents, `const c = window.__ui.controller; const file = Object.values(c.getProject().nodes).find((n) => n.name === "flow.md");
    return file.content.includes("The end. First words kept.");`);
  found.ready = true; // desktop-browser.py starts a second instance now: it must hand over and quit
  process.stdout.write("READY\n");
  await pause(Number(process.env.STILO_SMOKE_HOLD ?? 6000));
  found.focusedBySecond = secondStarts;
  finish();
}

// Settings → Server: a choice made as a person would (the page's fields, Apply).
async function chooseServer(contents, connect, { port = 0, url = "" } = {}) {
  await page(contents, `window.__ui.shell.settingsDialog.open("desktop-server");
    const body = document.querySelector(".desktop-server");
    body.querySelector('input[name="desktop-server"][value="${connect}"]').click();
    if (${port}) body.querySelector("#desktop-server-port").value = "${port}";
    body.querySelector("#desktop-server-lan").checked = false;
    body.querySelector("#desktop-server-url").value = ${JSON.stringify(url)};
    body.querySelector("#desktop-server-apply").click();`);
}

const status = (contents) => page(contents, "return document.querySelector('#desktop-server-status')?.textContent ?? '';");
const connected = 'window.__ui.sync.status.status === "connected"';

async function serve(win) {
  const contents = win.webContents;
  await chooseServer(contents, "local", { port: Number(process.env.STILO_SMOKE_PORT) });
  await until(contents, "document.querySelector('#desktop-server-status').textContent.startsWith('Running')", "the server running", 60);
  found.status = await status(contents);
  const state = await page(contents, "return window.stiloDesktop.server.state();");
  found.server = { port: state.local.port, pin: state.pin, addresses: state.local.addresses };
  // Through the app: the app's own address, sent on to the server.
  found.ping = await page(contents, `const r = await fetch("api/ping"); return [r.status, (await r.json()).message];`);
  // Share This Workspace: this workspace is the server's (joined as its master).
  await page(contents, 'document.querySelector("#desktop-server-join").click();');
  await until(contents, connected, "connected to the server", 30);
  found.role = await page(contents, "return window.__ui.sync.status.role;");
  // What sync said (a dropped stream, a rejoin), for a failure's report.
  const syncLog = () => page(contents, `return window.__ui.shell.logLines()
    .filter((l) => /connect|sync|lost|stream|snapshot|rejoin|preserv|revision/i.test(l.message + " " + (l.detail ?? "")))
    .slice(-20).map((l) => l.kind + " " + l.message + " " + (l.detail ?? ""));`);
  found.syncLogAtJoin = await syncLog();
  await page(contents, 'window.__ui.shell.settingsDialog.close?.(); document.querySelector("#settings-dialog")?.close?.();');
  await click(contents, "#editor-content .editor-line:last-child");
  contents.sendInputEvent({ type: "keyDown", keyCode: "End", modifiers: ["control"] });
  contents.sendInputEvent({ type: "keyUp", keyCode: "End", modifiers: ["control"] });
  await pause(300);
  await contents.insertText(" Shared from the desktop.");
  await until(contents, 'window.__ui.controller.getActiveFile().content.endsWith("The end. Shared from the desktop.")', "typed", 30);
  process.stdout.write(`SERVING ${JSON.stringify(found.server)}\n`); // desktop-browser.py joins it as someone else now
  await pause(Number(process.env.STILO_SMOKE_HOLD ?? 8000));
  found.syncLog = await syncLog();
  finish();
}

async function serveAgain(win) {
  const contents = win.webContents;
  // Nothing clicked: the server started again, and the app back on its session.
  await until(contents, connected, "reconnected by itself", 60);
  found.status = await status(contents);
  found.role = await page(contents, "return window.__ui.sync.status.role;");
  // What sync said (a dropped stream, a rejoin), for a failure's report.
  const syncLog = () => page(contents, `return window.__ui.shell.logLines()
    .filter((l) => /connect|sync|lost|stream|snapshot|rejoin|preserv|revision/i.test(l.message + " " + (l.detail ?? "")))
    .slice(-20).map((l) => l.kind + " " + l.message + " " + (l.detail ?? ""));`);
  found.syncLogAtJoin = await syncLog();
  found.kept = await page(contents, `return Object.values(window.__ui.controller.getProject().nodes).some((n) => n.kind === "file" && (n.content ?? "").includes("Shared from the desktop."));`);
  finish();
}

async function remote(win) {
  const contents = win.webContents;
  await chooseServer(contents, "remote", { url: process.env.STILO_SMOKE_REMOTE });
  await until(contents, "document.querySelector('#desktop-server-status').textContent.startsWith('Connected through')", "the other server chosen", 20);
  found.status = await status(contents);
  found.ping = await page(contents, `const r = await fetch("api/ping"); return [r.status, (await r.json()).message];`);
  await page(contents, `window.__ui.shell.settings.change({ serverPin: ${JSON.stringify(process.env.STILO_SMOKE_REMOTE_PIN)} }, "test");
    await window.__ui.sync.connectSaved({ auto: false });`);
  await until(contents, connected, "joined the other server's session", 30);
  // None: the app on its own again; the server's addresses answer as offline.
  await page(contents, "await window.__ui.sync.session().disconnect?.();");
  await chooseServer(contents, "none");
  await until(contents, "document.querySelector('#desktop-server-status').textContent.startsWith('No server')", "no server chosen", 20);
  found.none = await page(contents, `const r = await fetch("api/ping"); return [r.status, (await r.json()).error];`);
  finish();
}

let secondStarts = 0;
app.on("second-instance", () => { secondStarts += 1; });
app.on("will-quit", () => finish());

start({ root, userData, feed,
  ask: () => { found.asked += 1; return answers.shift() === "leave"; },
  openExternal: async (url) => { found.opened.push(url); },
  onWindow(win) {
    win.webContents.on("console-message", (event, level, message) => {
      const [kind, text] = typeof event?.level === "string" ? [event.level, event.message] : [level, message];
      if (kind === "error" || kind === 3) found.errors.push(String(text).slice(0, 300));
    });
    win.webContents.on("render-process-gone", (event, details) => finish({ failed: `renderer gone: ${details.reason}` }));
    win.webContents.once("did-finish-load", async () => {
      try {
        await until(win.webContents, 'window.__ui && document.querySelector("#explorer-tree .tree-row")', "the app started");
        await ({ again, serve, "serve-again": serveAgain, remote }[phase] ?? first)(win);
      } catch (error) {
        finish({ failed: String(error?.message ?? error) });
      }
    });
  } });
