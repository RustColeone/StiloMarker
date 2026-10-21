// What the web app may ask of the desktop app (Shell's adapters/desktop.js):
// its release, whether a newer one is out, and to open that one's download
// page. Nothing else of Electron or Node reaches the page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stiloDesktop", Object.freeze({
  version: () => ipcRenderer.invoke("stilo:version"),
  checkForUpdate: () => ipcRenderer.invoke("stilo:check-update"),
  openUpdate: () => ipcRenderer.invoke("stilo:open-update")
}));
