// The desktop app (Electron's main process): the web app in a window of its
// own, from its own files at one fixed origin (policy.mjs), with what a
// browser would otherwise do: asking before closing with unsaved work, links
// opened in the system's browser, and telling of a newer release. The app's
// requests to the server (/api/) are sent on from here to the server the
// desktop settings name (server-policy.mjs): none, the one this app runs on
// this computer (server.mjs), or another; the choice is kept, so at the next
// start that server is started again and the app reconnects on its own. The
// window's zoom (its keys and Ctrl+wheel are the app's: it has no menu with
// them) is kept too, and told to the page. The window has no title bar of the
// system's: the page's top bar is it, the system's buttons drawn over it in
// the colours the page tells.
// main.mjs starts it; tests/desktop-smoke.mjs starts it with stand-ins for
// the native dialog and the system's browser.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contextMenuTemplate } from "./context-menu.mjs";
import { DEFAULT_FRAME, FEED, ORIGIN, SCHEME, frameLook, keptZoom, linkAction, noServer, overlayOf, route, updateFrom, zoomKey, zoomStep } from "./policy.mjs";
import { createLocalServer } from "./server.mjs";
import { forwardHeaders, forwardTarget, forwardUrl, serverChoice } from "./server-policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
// What a page may ask for: copying (Copy buttons) and full screen. Nothing else (camera, location, …).
const PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

// Packaged, the web app's files and the server's code are beside the app, in
// a tree shaped like the repository (extraResources: stilo/); run from the
// repository, they are the repository's.
export const webRoot = () => (app.isPackaged ? join(process.resourcesPath, "stilo") : resolve(HERE, ".."));
export const serverRoot = () => join(webRoot(), "server");

const offline = () => {
  const reply = noServer();
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
};

// A request to /api/ sent on to the server (a stream, like the sync events,
// passes as it comes); none, or it can't be reached: answered as offline.
async function forward(request, target) {
  if (!target) return offline();
  const method = request.method;
  try {
    return await net.fetch(forwardUrl(target, request.url), { method, headers: forwardHeaders(request.headers),
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(), redirect: "follow" });
  } catch {
    return offline();
  }
}

async function serve(request, root, target) {
  const address = request.url;
  const answer = route(address, root);
  if (answer.api) return forward(request, target());
  // A file only (never a folder's listing), read by Electron, which gives its type.
  if (answer.file) {
    try {
      if ((await stat(answer.file)).isFile()) return await net.fetch(pathToFileURL(answer.file).href);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn(`Could not read ${answer.file}:`, error.message);
    }
  }
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// The page's beforeunload asked to stay (unsaved work): the user decides
// (Electron would otherwise silently keep the window open). true = leave.
function askToLeave(win) {
  const choice = dialog.showMessageBoxSync(win, { type: "question", buttons: ["Leave", "Stay"], defaultId: 1, cancelId: 1,
    title: "Stilo Marker", message: "Some changes are not saved.", detail: "Leave anyway and lose them, or stay and save them first?" });
  return choice === 0;
}

async function checkForUpdate(feed, version) {
  try {
    const reply = await net.fetch(feed, { headers: { accept: "application/vnd.github+json", "user-agent": `StiloMarker/${version}` } });
    if (!reply.ok) return { available: false, reason: `the release feed answered ${reply.status}` };
    return updateFrom(await reply.json(), version);
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

function openWindow({ root, ask, openExternal, zoom, look }) {
  const mac = process.platform === "darwin";
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 640, minHeight: 420, show: false, backgroundColor: "#0f172a",
    title: "Stilo Marker", icon: join(root, "assets/icons/icon-512.png"), autoHideMenuBar: true,
    // One bar: the page's top bar is the title bar, the system's window
    // buttons drawn over its end (a Mac's over its start, in their own colours).
    titleBarStyle: "hidden", titleBarOverlay: mac ? true : overlayOf(look, zoom.factor()),
    ...(mac ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: { preload: join(HERE, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
  win.once("ready-to-show", () => win.show());
  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (linkAction(url) === "external") void openExternal(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, legacyUrl) => {
    const url = event.url ?? legacyUrl;
    const action = linkAction(url);
    if (action === "app") return;
    event.preventDefault();
    if (action === "external") void openExternal(url);
  });
  contents.on("will-prevent-unload", (event) => { if (ask(win)) event.preventDefault(); });
  // Zoom: Ctrl+= / Ctrl+- / Ctrl+0 (Cmd on a Mac) before the page sees them,
  // and Ctrl+wheel; the kept zoom again on every load.
  contents.on("before-input-event", (event, input) => {
    const direction = zoomKey(input, process.platform === "darwin");
    if (!direction) return;
    event.preventDefault();
    zoom.step(direction);
  });
  // Ctrl+wheel: one step at most every tenth of a second (a touchpad may send
  // many in a moment; a wheel's notch is one).
  let wheelAt = 0;
  contents.on("zoom-changed", (event, direction) => {
    if (Date.now() - wheelAt < 100) return;
    wheelAt = Date.now();
    zoom.step(direction);
  });
  contents.on("did-finish-load", () => contents.setZoomFactor(zoom.factor()));
  // The right-click menu (Electron shows none of its own): a misspelled word's
  // suggestions where the page checks spelling, then cut, copy and paste, and
  // Select All as the keys do it (the page's own handling of Ctrl+A).
  contents.on("context-menu", (event, params) => {
    const template = contextMenuTemplate(params, {
      replace: (word) => contents.replaceMisspelling(word),
      learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      selectAll: () => {
        const modifiers = [process.platform === "darwin" ? "meta" : "control"];
        for (const type of ["keyDown", "keyUp"]) contents.sendInputEvent({ type, keyCode: "A", modifiers });
      }
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
  });
  void win.loadURL(`${ORIGIN}/`);
  return win;
}

// What the app keeps in its folder: the desktop settings (the server
// choice), the window's (its zoom, its title bar's look).
async function readKept(file, what) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`The ${what} could not be read; starting from the defaults.`, error.message);
    return {};
  }
}

// Starts the app: one instance (a second start shows the first's window).
// Options are for tests: the files, the profile, the dialog and the browser.

export function start({ root = webRoot(), server = serverRoot(), userData = null, ask = askToLeave, openExternal = (url) => shell.openExternal(url),
  feed = FEED, version = VERSION, onWindow = () => {} } = {}) {
  if (userData) app.setPath("userData", userData);
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  let win = null;
  let update = null;
  const fromApp = (event) => linkAction(event.senderFrame?.url ?? "") === "app";
  // The server choice, and the server this app runs when it is "local".
  const settingsFile = () => join(app.getPath("userData"), "desktop-settings.json");
  let choice = serverChoice();
  const tell = () => { if (win && !win.isDestroyed()) win.webContents.send("stilo:server-changed", serverState()); };
  const local = createLocalServer({ serverDir: server, staticDir: root, dataDir: join(app.getPath("userData"), "server"), onState: tell });
  const target = () => (choice.connect === "local" ? (local.state().status === "running" ? local.state().local : null) : forwardTarget(choice));
  // How many accounts the server this app runs has (0: it takes PINs only).
  let accountsHere = 0;
  const countAccounts = async () => {
    accountsHere = await local.accounts().catch((error) => { console.warn("Could not read the server's account file:", error.message); return accountsHere; });
  };
  const serverState = () => ({ connect: choice.connect, remoteUrl: choice.remoteUrl, port: choice.local.port, lan: choice.local.lan,
    pin: choice.local.pin, masterPin: choice.local.masterPin, local: local.state(), accounts: accountsHere });
  async function apply(next) {
    choice = serverChoice(next);
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(settingsFile(), `${JSON.stringify(choice, null, 2)}\n`, { mode: 0o600 });
    if (choice.connect === "local") await local.start(choice.local);
    else await local.stop();
    await countAccounts();
    tell();
    return serverState();
  }
  // The window's zoom and its title bar's look, kept for the next start.
  const windowFile = () => join(app.getPath("userData"), "window.json");
  let zoomFactor = 1;
  let look = DEFAULT_FRAME;
  const keepWindow = () => void writeFile(windowFile(), `${JSON.stringify({ zoom: zoomFactor, frame: look })}\n`)
    .catch((error) => console.warn("Could not keep the window's settings:", error.message));
  // The system's buttons over the bar, as the page and the zoom say (a Mac's keep their own).
  const drawButtons = () => {
    if (process.platform === "darwin" || !win || win.isDestroyed()) return;
    try {
      win.setTitleBarOverlay(overlayOf(look, zoomFactor));
    } catch (error) {
      console.warn("Could not colour the window's buttons:", error.message);
    }
  };
  // The zoom: a step from where it is, applied, told to the page, kept.
  const zoom = {
    factor: () => zoomFactor,
    step(direction) {
      const next = zoomStep(zoomFactor, direction);
      if (next !== zoomFactor) {
        zoomFactor = next;
        keepWindow();
      }
      if (win && !win.isDestroyed()) {
        win.webContents.setZoomFactor(zoomFactor);
        win.webContents.send("stilo:zoom-changed", zoomFactor);
        drawButtons();
      }
      return zoomFactor;
    }
  };
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => local.kill());
  void app.whenReady().then(async () => {
    protocol.handle(SCHEME, (request) => serve(request, root, target));
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(PERMISSIONS.has(permission)));
    ipcMain.handle("stilo:version", () => version);
    ipcMain.handle("stilo:check-update", async (event) => {
      if (!fromApp(event)) return null;
      update = await checkForUpdate(feed, version);
      return update;
    });
    // Only the release the feed named, never an address from the page.
    ipcMain.handle("stilo:open-update", (event) => {
      if (fromApp(event) && update?.url) void openExternal(update.url);
    });
    // The server: what it is now, and a new choice (kept, then applied).
    ipcMain.handle("stilo:server-state", (event) => (fromApp(event) ? serverState() : null));
    ipcMain.handle("stilo:server-choose", (event, next) => {
      if (!fromApp(event) || !next || typeof next !== "object") return null;
      return apply({ ...choice, ...next, local: { ...choice.local, ...(next.local ?? {}), pin: choice.local.pin, masterPin: choice.local.masterPin } });
    });
    // Accounts on the server this app runs: its first admin (whoever has this
    // app is trusted with that, as shell access is on a hosted server).
    ipcMain.handle("stilo:server-first-admin", async (event, request) => {
      if (!fromApp(event) || typeof request?.username !== "string" || typeof request?.password !== "string") return null;
      const made = await local.firstAdmin(request.username.slice(0, 200), request.password.slice(0, 1024));
      await countAccounts();
      tell();
      return made;
    });
    // The window's zoom: what it is, and a step ("in", "out", "reset").
    ipcMain.handle("stilo:zoom", (event) => (fromApp(event) ? zoomFactor : null));
    ipcMain.handle("stilo:zoom-step", (event, direction) => (fromApp(event) && ["in", "out", "reset"].includes(direction) ? zoom.step(direction) : null));
    // The top bar's colours and height (the theme's): the window's buttons drawn in them.
    ipcMain.handle("stilo:frame", (event, next) => {
      const valid = fromApp(event) ? frameLook(next) : null;
      if (!valid) return null;
      if (JSON.stringify(valid) !== JSON.stringify(look)) {
        look = valid;
        keepWindow();
      }
      drawButtons();
      return true;
    });
    // The app draws its own menus; macOS needs its application and Edit menus (copy and paste).
    Menu.setApplicationMenu(process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
    const keptWindow = await readKept(windowFile(), "window's settings");
    zoomFactor = keptZoom(keptWindow.zoom);
    look = frameLook(keptWindow.frame) ?? DEFAULT_FRAME;
    win = openWindow({ root, ask, openExternal, zoom, look });
    onWindow(win);
    // The kept choice: the server this app runs is started again.
    void readKept(settingsFile(), "desktop settings").then((kept) => apply(kept));
  });
}
