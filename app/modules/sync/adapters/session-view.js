// The session as the page shows it: the collaborators item in the status bar
// (a dot per person, in their colour, and how many) and the Session panel in
// the sidebar (the session's name and state, who is in it, and for a client
// the switch between the shared workspace and its own). Drawn from Sync's
// status and mode as they change.
import { participantColor } from "../../identity/index.js";

export function addSessionView({ shell, status, mode, doc = globalThis.document }) {
  const $ = (id) => doc?.getElementById(id);
  // The left area's Session section (Shell's pages), the connection state in its header.
  if (doc) {
    shell.pages.add({ host: "left", id: "session", order: 20, label: "Session", title: "Collaboration panel",
      body: $("session-panel-body"), toolbar: $("session-id-label"), className: "collaboration-sidebar-panel" });
  }
  const item = shell.statusBar.add({ id: "presence", order: 40, grow: true, title: "Show the session panel", text: "0 collaborators",
    extra: { id: "presence-dots", className: "peer-badge-dots" },
    action: () => void shell.run("layout.show-session") });
  item.extra?.setAttribute("aria-hidden", "true");

  const chip = (entry) => {
    const element = doc.createElement("div");
    element.className = "presence-chip";
    const avatar = doc.createElement("span");
    avatar.className = "presence-avatar";
    // The person's colour, as their cursor's: the person and their caret are visibly linked.
    if (entry.clientId) avatar.style.background = participantColor(entry.clientId);
    const label = doc.createElement("span");
    label.textContent = entry.displayName || entry.clientId;
    element.append(avatar, label);
    return element;
  };
  const note = (text) => Object.assign(doc.createElement("span"), { className: "subtle-label", textContent: text });

  function draw() {
    const s = status;
    const count = s.presence.length;
    // Nobody else here is no news: the item shows once someone is.
    item.set({ hidden: count === 0, text: count === 1 ? "1 collaborator online" : `${count} collaborators online` });
    item.extra?.replaceChildren(...s.presence.slice(0, 6).map((entry) => {
      const dot = doc.createElement("span");
      dot.className = "peer-badge-dot";
      if (entry.clientId) dot.style.background = participantColor(entry.clientId);
      return dot;
    }));

    // The Session panel (also the only connection readout on the phone, where
    // the status bar is hidden): from the live connection, not just a PIN; a
    // cloud workspace is a connected session too.
    const label = $("session-id-label");
    const detail = $("session-detail-text");
    const name = s.sessionId
      ? (s.sessionId === "default" ? "Shared session" : s.sessionId.split("/").filter(Boolean).pop() || s.sessionId)
      : null;
    if (label && detail) {
      if (s.status === "connected") {
        label.textContent = name ?? "Connected";
        label.title = `${s.sessionId ?? "Connected"} (internal revision ${s.revision})`;
        detail.textContent = name
          ? `${name}${s.displayName ? ` as ${s.displayName}` : ""}${s.role ? ` (${s.role})` : ""}.`
          : (s.detail || "Connected to the server.");
      } else if (s.status === "sync-error") {
        label.textContent = "Sync paused"; label.title = ""; detail.textContent = s.detail;
      } else if (s.status === "reachable") {
        label.textContent = "Reachable"; label.title = ""; detail.textContent = s.detail || "Server reachable — not in a shared session.";
      } else {
        label.textContent = "Offline"; label.title = ""; detail.textContent = "Not connected to a shared session.";
      }
    }
    const strip = $("presence-strip");
    const list = $("presence-list");
    if (strip && list) {
      if (!count) {
        strip.replaceChildren(note(s.status === "connected" ? "Connected — no one else here yet." : "No collaborators connected."));
        list.replaceChildren(note("No active session members."));
      } else {
        strip.replaceChildren(...s.presence.map(chip));
        list.replaceChildren(...s.presence.map(chip));
      }
    }
    // Only a client chooses between the shared workspace and its own: the master is the workspace.
    const row = $("workspace-mode-row");
    const toggle = $("workspace-mode-toggle");
    if (row) {
      const client = s.status === "connected" && s.role === "client";
      row.hidden = !client;
      if (client && toggle) {
        const synced = mode.get().workspaceMode === "synced";
        toggle.textContent = synced ? "⟳ Synced" : "◑ Private";
        toggle.title = synced ? "Click to switch to your private local workspace" : "Click to switch back to the shared synced workspace";
      }
    }
  }
  status.on(draw);
  mode.on(draw);
  draw();
}
