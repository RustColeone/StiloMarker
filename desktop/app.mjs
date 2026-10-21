// The desktop app (Electron's main process): the web app in a window of its
// own, from its own files at one fixed origin (policy.mjs), with what a
// browser would otherwise do: asking before closing with unsaved work, links
// opened in the system's browser, no server unless Settings names one, and
// telling of a newer release. main.mjs starts it; tests/desktop-smoke.mjs
// starts it with stand-ins for the native dialog and the system's browser.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FEED, ORIGIN, SCHEME, linkAction, noServer, route, updateFrom } from "./policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
// What a page may ask for: copying (Copy buttons) and full screen. Nothing else (camera, location, …).
const PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen"]);

// Packaged, the web app's files are beside the app (extraResources: web/);
// run from the repository, they are the repository's.
export const webRoot = () => (app.isPackaged ? join(process.resourcesPath, "web") : resolve(HERE, ".."));

async function serve(address, root) {
  const answer = route(address, root);
  if (answer.api) {
    const reply = noServer();
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  }
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

function openWindow({ root, ask, openExternal }) {
  const win = new BrowserWindow({ width: 1280, height: 860, minWidth: 640, minHeight: 420, show: false, backgroundColor: "#0f172a",
    title: "Stilo Marker", icon: join(root, "assets/icons/icon-512.png"), autoHideMenuBar: true,
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
  void win.loadURL(`${ORIGIN}/`);
  return win;
}

// Starts the app: one instance (a second start shows the first's window).
// Options are for tests: the files, the profile, the dialog and the browser.
export function start({ root = webRoot(), userData = null, ask = askToLeave, openExternal = (url) => shell.openExternal(url),
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
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(() => {
    protocol.handle(SCHEME, (request) => serve(request.url, root));
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
    // The app draws its own menus; macOS needs its application and Edit menus (copy and paste).
    Menu.setApplicationMenu(process.platform === "darwin"
      ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null);
    win = openWindow({ root, ask, openExternal });
    onWindow(win);
  });
}
