// Sync (browser): this tab's live connection to a shared workspace. Joining
// (a PIN session, a team workspace, hosting this project for guests), sending
// this tab's changes, applying everyone else's in revision order, rebasing
// concurrent typing, reconnecting, and keeping unconfirmed typing safe. The
// server's half is server/stilo/modules/sync; their messages and version are
// protocol/sync.contract.json.
//
// Static, for code from before the restructure:
//   createCollaborationRuntime({ getProject, replaceProject, applyOperation,
//     onStatusChange, onRemoteCursor, onPatchConfirmed, onHostCounters,
//     onEvent(event, { ownClientId }), preserveLocalFiles, reauthenticate,
//     uploadAsset, clock? }) -> the runtime (connect, openWorkspace, …)
//     Events Sync does not own (other modules' events on its stream) go to onEvent.
//   syncVersion          the sync compatibility level this tab speaks
// API: session() -> the live connection (connect, openWorkspace, publish,
// reconnect...), created at start. It reaches the project and the Editor
// through Workspace (applyRemote, replace, "text-changed", presence…);
// keepers.add(async (files) => …) keeps local edits before a reload (History);
// configure({ reauthenticate, uploadAsset }) (Cloud). The connection's life (adapters/connection.js): publish(op)
// sends a change (stamped, an image's bytes uploaded first, a refused write
// reloaded), publishSnapshot(), switchMode("synced" | "private"),
// connectSaved({ auto }), reconnectLater(); Join, the shared/own switch and
// auto-reconnect are bound here, and the app follows the status as it changes.
// status: the session as the app sees it, read-only
// (status.status, status.presence, status.role...; service/status.js); code
// that pings or reconnects says what happened with status.change({ … }).
// events.on(name, listener): "status" ({ next, previous }), "switched" ({ mode }),
// "remote-cursor"
// (event), "host-counters" ({ path, counters }), "patch-confirmed", and
// "event" ({ event, ownClientId }): other modules' events on Sync's stream.
// mode, whether this tab works on a shared workspace or its own local
// project (service/mode.js): get() -> { workspaceMode, privateProject },
// share(currentProject), leave() -> the kept project, forgetKept(), restore(saved).
// connectionInfo() -> this tab's connection while on the shared workspace, or null.
// It tells Workspace where the open project lives (workspace.location).
// cloudWorkspace() -> { serverUrl, token, team, path } | null: the cloud
// workspace on screen (signed in, and the open project is it).
//   transformTextPatch   sanitizeProjectForSync
import { createLiveView, defineModule, ignore, ignored } from "../../kernel/index.js";
import * as api from "./adapters/api.js";
import { pageClock } from "./adapters/page.js";
import contract from "./model/contract.js";
import { createRuntime } from "./service/runtime.js";
import { LOCAL_MODE, createMode } from "./service/mode.js";
import { SESSION_STATUS, statusFromSession } from "./service/status.js";
import { addSessionView } from "./adapters/session-view.js";
import { createConnection } from "./adapters/connection.js";
import { normalizeServerUrl } from "../shell/index.js";
import { getPath } from "../workspace/index.js";

export { transformTextPatch } from "./model/rebase.js";
export { sanitizeProjectForSync } from "./model/paths.js";
export const syncVersion = contract.version;

export function createCollaborationRuntime(options) {
  return createRuntime({ ...options, clock: options.clock ?? pageClock, api });
}

export default defineModule({
  name: "sync",
  level: 3,
  uses: ["shell", "file-types", "workspace", "identity"],
  owns: {
    names: ["sync protocol number"],
    elements: ["the Session panel", "the collaborators in the status bar"],
    state: ["the live session", "the session's status", "unconfirmed typing", "shared or local work, and the local project kept aside"],
    rules: ["rebasing a text patch"]
  },
  start(ctx) {
    // Shared or local work: read mode.get(), change it through its actions.
    const mode = createMode(ctx.state(LOCAL_MODE));
    const workspace = ctx.use("workspace");
    const events = ctx.emitter();
    const statusState = ctx.state(SESSION_STATUS);
    const status = createLiveView(statusState);
    let session = null;
    let connection = null; // joining, reconnecting, switching, sending (adapters/connection.js)

    // What higher modules supply: keeping local edits before a reload replaces
    // them (History: keepers), signing in again when the account's token died
    // and uploading an image's bytes (Cloud: configure).
    const keepers = new Set();
    let supplied = { reauthenticate: async () => null, uploadAsset: async () => { throw new Error("Uploading needs the Cloud module."); } };
    session = createCollaborationRuntime({
      getProject: () => workspace.project().getProject(),
      // Through Workspace, which the Editor hears (adapters/shared.js there).
      replaceProject: (project) => workspace.replace(project, { keepView: session.isReconnecting() }),
      applyOperation(clientId, operation) {
        try {
          workspace.applyRemote(clientId, operation);
        } catch (error) {
          ignore(error, "applying a remote change failed; reloading from the server");
          session.reloadFromServer("Sync conflict — reloading from server.").catch(ignored("reloading after a failed remote change failed"));
        }
      },
      async preserveLocalFiles(files) { for (const keep of keepers) await keep(files); },
      reauthenticate: () => supplied.reauthenticate(),
      uploadAsset: (...args) => supplied.uploadAsset(...args),
      onStatusChange(next) {
        const previous = statusState.get();
        statusState.set("the session", statusFromSession(next));
        events.emit("status", { next, previous });
      },
      onRemoteCursor: (event) => events.emit("remote-cursor", event),
      onHostCounters: (path, counters) => events.emit("host-counters", { path, counters }),
      onPatchConfirmed: () => events.emit("patch-confirmed"),
      onEvent: (event, { ownClientId }) => events.emit("event", { event, ownClientId })
    });
    connection = createConnection({ session, status, mode, events, workspace, shell: ctx.use("shell"),
      log: (...parts) => ctx.log(parts.join(" ")) });

    // What the Editor does, heard through Workspace: typing is sent as a patch,
    // an image replaced whole is published, my caret is shown to the others
    // (not while my text for that file is still on its way: they would see it
    // before the text). Others' carets go the other way.
    const sharing = () => session.isConnected() && mode.get().workspaceMode === "synced";
    workspace.events.on("text-changed", ({ path, previous, next }) => { if (sharing()) session.scheduleTextPatch(path, previous, next); });
    workspace.events.on("file-replaced", ({ operation }) => void connection.publish(operation));
    const showMyCaret = (caret) => {
      if (caret && session.isConnected() && !session.hasPendingPatch(caret.path)) session.scheduleAwareness(caret.path, caret.start, caret.end);
    };
    workspace.events.on("own-caret", showMyCaret);
    // My text arrived: now my caret is right for them too.
    events.on("patch-confirmed", () => { const own = workspace.presence.own(); if (own && session.isConnected()) session.scheduleAwareness(own.path, own.start, own.end); });
    events.on("remote-cursor", (cursor) => workspace.presence.other(cursor));
    events.on("status", () => workspace.presence.keep(status.presence.map((person) => person.clientId).filter(Boolean)));

    const connected = (name) => (...args) => connection[name](...args);
    // The cloud workspace on screen, for code that talks to the server about it
    // (snapshots, comments, the agent's conversations): null unless signed in
    // and the open project is that workspace.
    const shell = ctx.use("shell"), identity = ctx.use("identity");
    function cloudWorkspace() {
      const token = identity.token();
      const { lastWorkspace: ws, serverUrl, syncedProjectId } = shell.settings;
      if (!token || !ws?.team || !ws?.path) return null;
      if (syncedProjectId !== `${ws.team}/${ws.path}`) return null;
      return { serverUrl, token, team: ws.team, path: ws.path };
    }
    // This tab's connection while it works on the shared workspace (else null).
    const connectionInfo = () => (mode.get().workspaceMode === "synced" ? session?.getConnectionInfo?.() ?? null : null);
    // Where the open project lives (Workspace's location): a shared session's
    // key, kept while its stream reconnects; and an image's address, the
    // server's while connected (the bytes are on disk there, not in the operation).
    workspace.location.configure({
      shared: () => mode.get().workspaceMode === "synced",
      // A reader may open the shared workspace but not change it.
      readOnly: () => mode.get().workspaceMode === "synced" && status.role === "reader",
      // A shared workspace's durable home is the server: only text it confirmed is saved.
      confirmed: (project, ids) => (mode.get().workspaceMode !== "synced" ? ids
        : session.isConnected?.() ? ids.filter((id) => !session.hasUnsyncedText?.(getPath(project, id))) : []),
      assetsKey: () => connectionInfo()?.token ?? "",
      key(project) {
        const connection = connectionInfo();
        if (connection?.sessionId) return `cloud:${normalizeServerUrl(connection.serverUrl)}/${connection.sessionId}`;
        if (mode.get().workspaceMode === "synced" && shell.settings.syncedProjectId) {
          return `cloud:${normalizeServerUrl(shell.settings.serverUrl)}/${shell.settings.syncedProjectId}`;
        }
        return project?.id ?? "local";
      },
      assetSrc(project, node) {
        const content = typeof node.content === "string" ? node.content : "";
        const connection = connectionInfo();
        if (content.startsWith("data:") || !connection) return content;
        return `${normalizeServerUrl(connection.serverUrl)}/api/workspaces/asset?token=${encodeURIComponent(connection.token)}&path=${encodeURIComponent(getPath(project, node.id))}`;
      }
    });
    // The session on the page: the status bar's collaborators and the Session panel.
    addSessionView({ shell: ctx.use("shell"), status, mode });
    return { createCollaborationRuntime, syncVersion, mode, status, session: () => session, events: { on: events.on },
      keepers: { add(keep) { keepers.add(keep); return () => keepers.delete(keep); } },
      configure(next) { supplied = { ...supplied, ...next }; },
      cloudWorkspace, connectionInfo, publish: connected("publish"), publishSnapshot: connected("publishSnapshot"), switchMode: connected("switchMode"),
      connectSaved: connected("connectSaved"), reconnectLater: connected("reconnectLater") };
  }
});
