// What the web app may ask of the desktop app (Shell's adapters/desktop.js,
// Cloud's adapters/desktop-server.js): its release, whether a newer one is
// out, and to open that one's download page; the server it connects to (none,
// one it runs on this computer, another), and that server's state as it
// changes, and its first admin; the window's zoom, and its title bar's look.
// Nothing else of Electron or Node reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stiloDesktop", Object.freeze({
  version: () => ipcRenderer.invoke("stilo:version"),
  checkForUpdate: () => ipcRenderer.invoke("stilo:check-update"),
  openUpdate: () => ipcRenderer.invoke("stilo:open-update"),
  // The window's zoom (1 is 100%): what it is, a step ("in", "out", "reset")
  // -> the zoom then, and each change (the keys and Ctrl+wheel are the app's).
  zoom: Object.freeze({
    get: () => ipcRenderer.invoke("stilo:zoom"),
    step: (direction) => ipcRenderer.invoke("stilo:zoom-step", direction),
    onChange(listener) {
      const relay = (event, factor) => listener(factor);
      ipcRenderer.on("stilo:zoom-changed", relay);
      return () => ipcRenderer.removeListener("stilo:zoom-changed", relay);
    }
  }),
  // The top bar is the window's title bar: its colours and height
  // ({ color, symbolColor, height }), for the system's buttons drawn over it.
  frame: Object.freeze({
    set: (look) => ipcRenderer.invoke("stilo:frame", look)
  }),
  server: Object.freeze({
    state: () => ipcRenderer.invoke("stilo:server-state"),
    choose: (choice) => ipcRenderer.invoke("stilo:server-choose", choice),
    // Accounts on the server this app runs: its first admin -> { ok } or { error }.
    firstAdmin: (username, password) => ipcRenderer.invoke("stilo:server-first-admin", { username, password }),
    onChange(listener) {
      const relay = (event, state) => listener(state);
      ipcRenderer.on("stilo:server-changed", relay);
      return () => ipcRenderer.removeListener("stilo:server-changed", relay);
    }
  })
}));
