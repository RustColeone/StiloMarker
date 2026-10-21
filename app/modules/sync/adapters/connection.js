// The connection's life (Sync's, created when Sync is attached): joining a
// PIN session and keeping it (auto-reconnect with backoff), what changes as
// the session's status does, switching between the shared workspace and this
// tab's own, and sending a change.
import { UPDATE_FILE, isImageFileName } from "../../workspace/index.js";
import { ignore, ignored } from "../../../kernel/index.js";
import { patchStoredSettings } from "../../shell/index.js";

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 20000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;

export function createConnection({ session, status, mode, events, workspace, shell, log, doc = globalThis.document }) {
  const settings = shell.settings;
  // The shared-session section's border flashes on joining (or failing to).
  const flash = (type) => shell.flash(doc?.getElementById("connect-server-button")?.closest(".settings-section"), type);
  // Before joining, the user agrees: the host's workspace opens in place of
  // theirs (which this browser keeps, as its own copy, to switch back to).
  function confirmJoin() {
    const dialog = doc.getElementById("accept-connection-dialog");
    const message = doc.getElementById("accept-connection-message");
    if (message) message.textContent = "The host\u2019s workspace opens in place of yours. Yours stays in this browser: switch back to it at any time with the \u25d1 Private switch.";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "accept"), { once: true });
      dialog.showModal();
    });
  }
  const controller = () => workspace.project();
  const redraw = () => shell.render(controller().getProject());

  // ── Joining and keeping a PIN session ──
  // The last intended session (settings.wasConnected) is re-established on
  // start and after a dropped connection.
  const reconnect = { timer: null, attempts: 0, connecting: false };

  function clearReconnectTimer() {
    if (!reconnect.timer) return;
    clearTimeout(reconnect.timer);
    reconnect.timer = null;
  }

  // Connect with the saved address, PIN and name. `auto` skips asking (the user
  // agreed to this session when they first joined it).
  // The project on screen before joining: a client's is replaced by the host's
  // as it connects, and this is what is kept aside (to come back on leaving).
  // A join shows the host's workspace when it arrives, unless the user
  // switched to their own meanwhile (joinShows false): that choice stands.
  let joiningFrom = null;
  let joinShows = false;
  async function connectSaved({ auto = false } = {}) {
    if (reconnect.connecting) return false;
    if (!settings.serverPin) {
      if (auto) return false;
      throw new Error("PIN is required.");
    }
    reconnect.connecting = true;
    joiningFrom = controller().getProject();
    joinShows = true;
    try {
      await session.connect(settings.serverUrl, settings.serverPin, settings.displayName);
      settings.change({ wasConnected: true }, "joined a session");
      reconnect.attempts = 0;
      clearReconnectTimer();
      flash("success");
      log("Server connected", settings.displayName || "anonymous");
      return true;
    } finally {
      reconnect.connecting = false;
      joiningFrom = null;
      joinShows = false;
    }
  }

  function reconnectLater() {
    if (!settings.autoReconnect || !settings.wasConnected || !settings.serverPin) return;
    if (reconnect.connecting || reconnect.timer) return;
    if (reconnect.attempts >= MAX_RECONNECT_ATTEMPTS) {
      status.change({ detail: "Reconnect failed. Open collaboration settings to retry." }, "gave up reconnecting");
      redraw();
      log("Auto-reconnect gave up", `after ${reconnect.attempts} attempts`);
      return;
    }
    const delay = RECONNECT_DELAYS[Math.min(reconnect.attempts, RECONNECT_DELAYS.length - 1)];
    reconnect.attempts += 1;
    status.change({ detail: `Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnect.attempts})` }, "reconnecting later");
    redraw();
    reconnect.timer = setTimeout(() => {
      reconnect.timer = null;
      connectSaved({ auto: true }).catch((error) => {
        log("Auto-reconnect attempt failed", error.message);
        reconnectLater();
      });
    }, delay);
  }

  // Join (Settings → Collaboration): the fields as they are now, asked first.
  async function join() {
    const value = (id) => doc.getElementById(id)?.value ?? "";
    settings.change({ serverUrl: value("server-url-input").trim(), serverPin: value("server-pin-input"),
      displayName: value("display-name-input").trim() }, "Join");
    // Confirmed before any network call or change to the workspace.
    if (!await confirmJoin()) return;
    reconnect.attempts = 0;
    clearReconnectTimer();
    try {
      log("Server connect requested", settings.serverUrl);
      await connectSaved({ auto: false });
    } catch (error) {
      status.change({ status: "offline", detail: error.message }, "joining failed");
      log("Server connect failed", error.message);
      flash("error");
      redraw();
    }
  }

  // ── The shared workspace or this tab's own ──
  // Back to this tab's own workspace: as this browser last saved it (another
  // window may have changed it since; after a reload nothing is kept aside in
  // memory, and the pointer names it), else as kept aside. With neither, the
  // shared content stays on screen, as this browser's own from now on.
  async function leaveShared() {
    const copies = workspace.copies;
    const kept = mode.get().privateProject;
    const key = kept ? copies.localKey(kept) : await copies.ownKey();
    const stored = await copies.load(key);
    if (mode.get().workspaceMode !== "synced") return; // left meanwhile
    // Said first: an automatic resume of the shared workspace no longer applies.
    events.emit("switched", { mode: "private" });
    const keptNow = mode.leave();
    const back = stored ?? keptNow ?? controller().getProject();
    controller().replaceProject(back, { copyKey: copies.localKey(back) });
    // The local project is no longer a cloud workspace's content.
    settings.change({ syncedProjectId: null }, "back to this tab's own workspace");
    redraw();
  }

  function switchMode(next) {
    if (next === "private") joinShows = false;
    if (next === mode.get().workspaceMode) return;
    if (next === "synced") {
      mode.share(joiningFrom ?? controller().getProject());
      // Loading from the server replaces the project, which draws it.
      session.reloadFromServer("Switched to synced workspace.").catch(ignored("loading the synced workspace failed"));
    } else {
      void leaveShared().catch((error) => { shell.notify(`Could not go back to your own workspace: ${error.message}`); });
    }
  }

  // ── As the status changes ──
  events.on("status", ({ next, previous }) => {
    const before = previous.status;
    // The server refused this tab as too old (a stale cached app): stop and
    // bring the app up to date rather than let it overwrite content.
    if (next.status === "upgrade-required") { shell.upgradeApp(next.detail); return; }
    // A dropped stream recovers by itself; say the work is safe.
    if (next.status === "reconnecting" && before !== "reconnecting") shell.toast("Connection lost — reconnecting… your changes are kept.");
    if (next.status === "connected" && before === "reconnecting") shell.toast("Reconnected to the cloud workspace.");
    // A clean connect means this app is a good version: a later minimum-version
    // bump may reload it by itself again (shell.upgradeApp's one-time guard).
    if (next.status === "connected") {
      try { globalThis.sessionStorage?.removeItem("mdnotes.upgradeReloaded"); } catch (error) { ignore(error, "session storage is blocked"); }
    }
    const synced = mode.get().workspaceMode === "synced";
    // Which server revision this browser's copy matches: on the next open it
    // decides whether this device may push its copy or must pull.
    if (next.status === "connected" && synced && settings.syncedProjectId) {
      settings.change({ syncedRevision: status.revision }, "in step with the server");
    }
    if (before !== "connected" && next.status === "connected" && !synced) {
      // A client agreed before connecting: just sync.
      if (status.role === "client") {
        if (!reconnect.connecting || joinShows) switchMode("synced");
        return;
      }
      // The master already pushed its project as the workspace: share it, no reload.
      if (status.role === "master") { mode.share(controller().getProject()); redraw(); return; }
    }
    if (next.status === "offline") reconnectLater(); // dropped with a session intended
    // Only a session that was there can drop (connecting starts by saying
    // "offline": a page that opened a shared workspace's copy stays on it
    // while it rejoins).
    const dropped = ["connected", "reconnecting", "sync-error"].includes(before);
    if (next.status === "offline" && synced && dropped) {
      // A cloud workspace stays on screen and stays synced: its edits are kept
      // here and sent when the stream is back (going private here is what once
      // lost work for good). Only a PIN or guest session goes back to the
      // tab's own project.
      if (settings.syncedProjectId || settings.lastWorkspace?.team) {
        mode.forgetKept(); // don't later put the old content back over this
        status.change({ detail: "Offline — edits are saved locally and will sync when the connection returns." }, "offline, edits kept");
        redraw();
        return;
      }
      switchMode("private");
      return;
    }
    redraw();
  });

  // ── Sending a change ──
  async function publish(operation) {
    if (!session.isConnected() || mode.get().workspaceMode !== "synced") return;
    let op = operation;
    // A whole-file write declares the revision it is based on, so the server can
    // refuse one that would overwrite newer content. Stamped here for every caller.
    if (op.type === UPDATE_FILE && op.baseRevision === undefined) op = { ...op, baseRevision: session.getRevision?.() ?? 0 };
    // In a cloud workspace kept on disk, an image's bytes upload on their own
    // (a large image would exceed the stream's body limit as base64); the
    // operation carries no content and others fetch the image by its address.
    const name = op.name ?? op.path?.split("/").pop() ?? "";
    if (session.isDirectoryBacked?.() && (op.type === "create-file" || op.type === UPDATE_FILE) && isImageFileName(name)
      && typeof op.content === "string" && op.content.startsWith("data:")) {
      try {
        await session.uploadAsset(op.type === "create-file" ? [op.parentPath, op.name].filter(Boolean).join("/") : op.path, op.content);
        op = { ...op, content: "" };
      } catch (error) {
        shell.notify(error.message);
        return;
      }
    }
    session.publishOperation(op).catch((error) => {
      if (error?.status === 409) {
        // The server has a newer version of this file: take it, and say so.
        shell.notify("That file changed on the server — loading the newer version instead of overwriting it.");
        session.reloadFromServer?.("Stale write refused — pulled the newer copy.").catch(ignored("pulling the newer copy after a refused write failed"));
        return;
      }
      shell.notify(error.message);
    });
  }

  function publishSnapshot() {
    if (session.isConnected() && mode.get().workspaceMode === "synced") session.scheduleSnapshot(controller().getProject());
  }

  // As the page hides or goes: the revision this browser's copy matches is
  // stored, merged into what is stored now and only for the same workspace
  // (writing the whole settings clobbered what another tab saved since, and
  // another workspace's id with this revision would fool the push-or-pull
  // check); a page really going away leaves the session.
  const keepRevision = () => {
    if (!settings.syncedProjectId) return;
    patchStoredSettings((stored) => (stored.syncedProjectId === settings.syncedProjectId ? { syncedRevision: settings.syncedRevision } : null));
  };
  globalThis.window?.addEventListener("pagehide", (event) => {
    keepRevision();
    if (!event.persisted) session.leaveOnPageHide();
  });
  doc?.addEventListener("visibilitychange", () => { if (doc.visibilityState === "hidden") keepRevision(); });
  globalThis.window?.addEventListener("beforeunload", keepRevision);

  // Its controls: Join, the shared / own switch, auto-reconnect turned off.
  doc?.getElementById("connect-server-button")?.addEventListener("click", () => void join());
  doc?.getElementById("workspace-mode-toggle")?.addEventListener("click", () => switchMode(mode.get().workspaceMode === "synced" ? "private" : "synced"));
  settings.on((view, changed) => {
    // Turning auto-reconnect off cancels any pending retry and forgets the session.
    if (!changed.includes("autoReconnect") || view.autoReconnect) return;
    clearReconnectTimer();
    settings.change({ wasConnected: false }, "auto-reconnect turned off");
  });

  // joining(): a PIN session is being joined to be shown (its workspace arrives before the tab switches to it).
  return { connectSaved, reconnectLater, switchMode, publish, publishSnapshot, joining: () => reconnect.connecting && joinShows };
}
