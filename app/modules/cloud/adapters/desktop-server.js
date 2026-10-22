// Settings → Server, in the desktop app only (desktop/: window.stiloDesktop):
// where its workspaces are shared from: no server; a server this app runs on
// this computer (its port, and whether other devices on the network reach
// it: they open its address in a browser and join with its PIN); or another
// server. The app reaches the chosen server through the desktop app (its
// requests to /api/ are sent on there), so the Server URL stays blank. Share
// This Workspace joins this computer's server with its master PIN: this
// workspace becomes the server's, and others join with the session's PIN.
// The choice is kept by the desktop app: at the next start that server is
// started again, and the app reconnects to its session as it would to any
// (Remember & reconnect).
export function addDesktopServer({ dialog, settings, sync, ping = () => {}, log = () => {}, doc = globalThis.document,
  bridge = globalThis.window?.stiloDesktop?.server }) {
  if (!bridge || !doc) return null;
  // A page of the Settings dialog, beside the others (their panels are in index.html).
  const panel = doc.createElement("div");
  panel.id = "settings-panel-desktop-server";
  panel.className = "settings-tab-panel";
  panel.hidden = true;
  const body = doc.createElement("section");
  body.className = "settings-section desktop-server";
  panel.append(body);
  doc.querySelector(".settings-tab-panels")?.append(panel);
  body.innerHTML = `
    <h3>Server</h3>
    <p class="subtle-label">Where this app's shared workspaces live. A server on this computer can be opened by other devices on your network, in a browser.</p>
    <div class="desktop-server-choices" role="radiogroup" aria-label="Server">
      <label class="checkbox-row"><input type="radio" name="desktop-server" value="none"><span>None: this app on its own</span></label>
      <label class="checkbox-row"><input type="radio" name="desktop-server" value="local"><span>Run a server on this computer</span></label>
      <div class="desktop-server-local">
        <label>Port <input id="desktop-server-port" type="number" min="1024" max="65535" step="1"></label>
        <label class="checkbox-row"><input id="desktop-server-lan" type="checkbox"><span>Other devices on this network can connect</span></label>
      </div>
      <label class="checkbox-row"><input type="radio" name="desktop-server" value="remote"><span>Connect to another server</span></label>
      <div class="desktop-server-remote">
        <label>Address <input id="desktop-server-url" type="url" autocomplete="off" placeholder="https://… or http://192.168.1.20:8000"></label>
      </div>
    </div>
    <p id="desktop-server-status" class="desktop-server-status subtle-label" aria-live="polite"></p>
    <div class="settings-actions-row">
      <button id="desktop-server-apply" type="button">Apply</button>
      <button id="desktop-server-join" type="button" hidden>Share This Workspace</button>
    </div>`;
  const $ = (selector) => body.querySelector(selector);
  const radios = () => [...body.querySelectorAll('input[name="desktop-server"]')];
  let state = null;

  function describe(next) {
    if (next.connect === "remote") return `Connected through this app to ${next.remoteUrl}.`;
    if (next.connect !== "local") return "No server: this app on its own.";
    const local = next.local ?? {};
    if (local.status === "starting") return "Starting the server…";
    if (local.status === "failed") return local.reason || "The server could not start.";
    if (local.status !== "running") return "The server is stopped.";
    if (local.addresses?.length) return `Running. Others open ${local.addresses.join(" or ")} in a browser and join with PIN ${next.pin}.`;
    return `Running, on this computer only (${local.local}). Its session's PIN is ${next.pin}.`;
  }

  function show(next) {
    state = next;
    for (const radio of radios()) radio.checked = radio.value === next.connect;
    if (doc.activeElement !== $("#desktop-server-port")) $("#desktop-server-port").value = String(next.port);
    $("#desktop-server-lan").checked = Boolean(next.lan);
    if (doc.activeElement !== $("#desktop-server-url")) $("#desktop-server-url").value = next.remoteUrl ?? "";
    $(".desktop-server-local").hidden = next.connect !== "local";
    $(".desktop-server-remote").hidden = next.connect !== "remote";
    $("#desktop-server-status").textContent = describe(next);
    $("#desktop-server-join").hidden = !(next.connect === "local" && next.local?.status === "running");
  }

  // The server came up (or changed): the app finds it, and a session it was
  // in before is joined again. One it is in now is left as it is: joining
  // again would drop it, and right after Share This Workspace (the PIN saved
  // is already the guest's) take the server's copy over typing not yet sent.
  async function followed(next) {
    const reachable = next.connect === "remote" || (next.connect === "local" && next.local?.status === "running");
    ping();
    const inSession = ["connected", "reconnecting"].includes(sync.status?.status);
    if (reachable && !inSession && settings.autoReconnect && settings.wasConnected && settings.serverPin) {
      await sync.connectSaved({ auto: true }).catch((error) => log("Reconnecting to the desktop app's server failed", error.message));
    }
  }

  async function choose() {
    const connect = radios().find((radio) => radio.checked)?.value ?? "none";
    const next = await bridge.choose({ connect, remoteUrl: $("#desktop-server-url").value.trim(),
      local: { port: Number($("#desktop-server-port").value), lan: $("#desktop-server-lan").checked } });
    if (!next) return;
    // The desktop app sends the requests on: the app's own address stays blank.
    // Another server than before: the session joined there is not rejoined here.
    const moved = state && (state.connect !== next.connect || state.remoteUrl !== next.remoteUrl);
    settings.change({ serverUrl: "", ...(moved ? { wasConnected: false } : {}) }, "Settings: the desktop app's server");
    show(next);
    log("Desktop server", describe(next));
    await followed(next);
  }

  // Share this workspace on the server this app runs: joined once with its
  // master PIN, so this workspace becomes the session's (others join with its
  // PIN). From then on this app rejoins with that PIN too, as anyone does: a
  // master pushes its own copy on joining, which after a crash (an older copy)
  // or while others edited would overwrite the server's newer one.
  async function join() {
    if (!state?.masterPin) return;
    settings.change({ serverUrl: "", serverPin: state.masterPin }, "Settings: share on the desktop app's server");
    const joined = await sync.connectSaved({ auto: false }).catch((error) => {
      log("Sharing on the desktop app's server failed", error.message);
      return false;
    });
    if (joined) settings.change({ serverPin: state.pin }, "Settings: rejoin the desktop app's server with its PIN");
  }

  for (const radio of radios()) radio.addEventListener("change", () => {
    $(".desktop-server-local").hidden = radio.value !== "local" || !radio.checked;
    $(".desktop-server-remote").hidden = radio.value !== "remote" || !radio.checked;
  });
  $("#desktop-server-apply").addEventListener("click", () => void choose());
  $("#desktop-server-join").addEventListener("click", () => void join());
  bridge.onChange((next) => { const was = state; show(next); if (was?.local?.status !== next.local?.status) void followed(next); });
  void bridge.state().then((next) => { if (next) show(next); });

  dialog.addPage({ id: "desktop-server", label: "Server", order: 25, body: panel });
  return { show, choose, join };
}
