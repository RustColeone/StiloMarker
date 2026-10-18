// The server in the status bar: the session's state and who is signed in, with
// a dot (connected, reachable, offline). Clicking it opens Settings →
// Collaboration and checks the server. The same detail shows under Server in
// that section.
export function addServerItem({ shell, sync, identity, ping, doc = globalThis.document }) {
  const item = shell.statusBar.add({ id: "server", order: 30, dot: true, title: "Open collaboration settings", text: "Server offline",
    action() {
      shell.settingsDialog.open("collaboration");
      void ping();
    } });

  function draw() {
    const { status, detail } = sync.status;
    const account = identity.account();
    item.set({
      text: status === "sync-error" ? "Sync paused"
        : account ? (status === "connected" ? account.username : `Logged in as ${account.username}`)
          : status === "connected" ? "Connected" : status === "reachable" ? "Server reachable" : "Server offline",
      tone: status === "connected" ? "success" : (status === "reachable" || status === "reconnecting") ? "warning" : "danger"
    });
    const settingsLine = doc?.getElementById("server-status-text");
    if (settingsLine && settingsLine.textContent !== detail) settingsLine.textContent = detail;
  }
  sync.status.on(draw);
  identity.events.on("account", draw);
  draw();
}
