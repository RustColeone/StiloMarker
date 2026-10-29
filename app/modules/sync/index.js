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
// API: session() -> the live connection (connect, openWorkspace, publishOperation,
// publishSnapshot, isConnected()...), created at start. It reaches the project and the Editor
// through Workspace (applyRemote, replace, "text-changed", presence…);
// keepers.add(async (files) => …) keeps local edits before a reload (History);
// configure({ reauthenticate }) (Cloud). The connection's life (adapters/connection.js): publish(op)
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
// awayPending() -> whether this tab did something away from the cloud workspace
// on screen that is not merged in yet (adapters/away.js).
// windows.state() -> { linked, leading, others, waiting }: this browser's other
// windows on the same own workspace, linked live (adapters/tabs.js): one keeps
// the copy and puts their edits in order; publish() reaches them too.
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
import { createTabLink } from "./adapters/tabs.js";
import { createAway } from "./adapters/away.js";
import { addWindowsItem } from "./adapters/windows-item.js";
import { withWindowView } from "./model/window-view.js";
import { isFatalSyncError } from "./model/errors.js";
import { normalizeServerUrl } from "../shell/index.js";
import { UPDATE_FILE, getNodeByPath, getPath } from "../workspace/index.js";

// How long Reload Window waits for this tab's typing to be confirmed.
const TYPING_WAIT = 5000;

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
    elements: ["the Session panel", "the collaborators in the status bar", "the linked windows in the status bar"],
    state: ["the live session", "the session's status", "unconfirmed typing", "shared or local work, and the local project kept aside",
      "the link between this browser's windows on one workspace"],
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
    // (Cloud: configure).
    const keepers = new Set();
    let supplied = { reauthenticate: async () => null };
    const shell = ctx.use("shell"), identity = ctx.use("identity");
    // Which of this browser's copies a shared workspace's content is saved as:
    // its own, named for the server and session (never this browser's own
    // workspace's). This browser's own workspace hosted for guests (a PIN
    // session's master) stays its own.
    const hostingOwn = () => session.isConnected() && !session.isDirectoryBacked() && session.getRole() === "master";
    function sharedCopyKey(project) {
      const info = session.getConnectionInfo();
      if (info?.sessionId) return `shared:${normalizeServerUrl(info.serverUrl)}/${info.sessionId}`;
      const { syncedProjectId, serverUrl } = shell.settings;
      return syncedProjectId ? `shared:${normalizeServerUrl(serverUrl)}/${syncedProjectId}` : `shared:${project?.id}`;
    }
    // What this tab does while away from a cloud workspace, for the merge when
    // it is back (adapters/away.js; the runtime's mergeAwayIntoServer).
    const live = () => session.isConnected() && !session.isReconnecting();
    const away = createAway({ key: () => (mode.get().workspaceMode === "synced" ? workspace.project()?.copyKey?.() ?? null : null),
      live, log: (message) => ctx.log(message) });
    // A tab switched to its own workspace stays connected, but the shared
    // workspace's changes stay off its screen (switching back loads it afresh).
    const showsShared = () => mode.get().workspaceMode === "synced" || !session.isConnected() || connection.joining();
    session = createCollaborationRuntime({
      getProject: () => workspace.project().getProject(),
      // Through Workspace, which the Editor hears (adapters/shared.js there).
      replaceProject(project) {
        if (!showsShared()) return;
        workspace.replace(project, { keepView: session.isReconnecting(), copyKey: hostingOwn() ? null : sharedCopyKey(project) });
      },
      applyOperation(clientId, operation) {
        if (!showsShared()) return;
        try {
          workspace.applyRemote(clientId, operation);
        } catch (error) {
          ignore(error, "applying a remote change failed; reloading from the server");
          session.reloadFromServer("Sync conflict — reloading from server.").catch(ignored("reloading after a failed remote change failed"));
        }
      },
      async preserveLocalFiles(files) { for (const keep of keepers) await keep(files); },
      reauthenticate: () => supplied.reauthenticate(),
      uploadAsset: (...args) => api.uploadAsset(...args),
      onStatusChange(next) {
        const previous = statusState.get();
        statusState.set("the session", statusFromSession(next));
        events.emit("status", { next, previous });
      },
      onRemoteCursor: (event) => events.emit("remote-cursor", event),
      onHostCounters: (path, counters) => events.emit("host-counters", { path, counters }),
      onPatchConfirmed: () => events.emit("patch-confirmed"),
      onEvent: (event, { ownClientId }) => events.emit("event", { event, ownClientId }),
      away: () => away.snapshot(),
      onAwayMerged({ skipped }) {
        if (!skipped.length) return;
        const what = skipped.map((op) => `${op.type === "delete-node" ? "deleting" : op.type === "rename-node" ? "renaming" : op.type === "move-node" ? "moving" : "making"} ${op.path ?? op.name}`);
        shell.toast(`Changes made offline that no longer fit were left out: ${what.slice(0, 3).join(", ")}${what.length > 3 ? ` and ${what.length - 3} more` : ""}.`);
        ctx.log(`Left out after being away: ${what.join("; ")}`);
      }
    });
    connection = createConnection({ session, status, mode, events, workspace, shell: ctx.use("shell"),
      log: (...parts) => ctx.log(parts.join(" ")) });

    // This browser's other windows on the same own workspace, linked live
    // (adapters/tabs.js): one keeps this browser's copy and puts their edits
    // in order; the others follow it, as devices follow the server. A window
    // on a shared workspace is on no link (the server links them).
    const windowsItem = globalThis.document ? addWindowsItem({ shell }) : { draw() {} };
    const link = createTabLink({
      createRuntime: (options) => createRuntime(options),
      getProject: () => workspace.project().getProject(),
      replace: (project) => workspace.replace(withWindowView(workspace.project().getProject(), project), { keepView: true }),
      applyOperation: (clientId, operation) => workspace.applyRemote(clientId, operation),
      async preserveLocalFiles(files) { for (const keep of keepers) await keep(files); },
      onChange: (state) => windowsItem.draw(state),
      // The window that keeps the workspace saved it: what this one confirmed is saved too.
      onSaved: () => void workspace.saving.runAutoSave("the other window saved"),
      // The window that kept the workspace went: this one writes its copy, all of it, now.
      onTakeOver: () => workspace.copies.takeOver(),
      log: (message) => ctx.log(message)
    });
    const linkKey = () => {
      if (mode.get().workspaceMode !== "private") return null;
      const key = workspace.project()?.copyKey?.() ?? null;
      return workspace.copies.isLocal(key) ? key : null;
    };
    const followLink = () => link.follow(linkKey());
    workspace.project()?.subscribe(followLink);
    mode.on(followLink);
    workspace.events.on("copy-saved", ({ project }) => link.saved(project));
    globalThis.window?.addEventListener("pagehide", () => link.flush());
    const windows = () => (link.runtime()?.isConnected() ? link.runtime() : null);

    // A change made here: to the shared workspace (the server), or to this
    // browser's other windows on this one.
    async function publishToWindows(operation) {
      const runtime = windows();
      if (!runtime) return;
      const op = operation.type === UPDATE_FILE && operation.baseRevision === undefined ? { ...operation, baseRevision: runtime.getRevision() } : operation;
      try {
        await runtime.publishOperation(op);
      } catch (error) {
        if (error?.status === 409) {
          shell.notify("Another window changed that file first: its version is shown now (yours is kept in Snapshots).");
          runtime.reloadFromServer("Another window changed it first.").catch(ignored("taking the other window's version failed"));
          return;
        }
        if (!isFatalSyncError(error)) shell.notify(error.message);
      }
    }
    // The new path a rename or move gives (for what follows paths).
    function movedTo(operation) {
      const from = String(operation.path ?? "");
      const name = operation.type === "rename-node" ? String(operation.name ?? "") : from.split("/").pop();
      const parent = operation.type === "rename-node" ? (from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "") : String(operation.parentPath ?? "");
      return parent ? `${parent}/${name}` : name;
    }
    // A change to the shared workspace: sent, or (away) noted for the merge
    // when the session is back (it was dropped before, as a known gap).
    function publishShared(operation) {
      if (operation.type === "rename-node" || operation.type === "move-node") away.moved(operation.path, movedTo(operation));
      if (live()) return connection.publish(operation);
      if (!["create-file", "create-folder", "rename-node", "move-node", "delete-node"].includes(operation.type)) return undefined;
      const node = operation.type === "delete-node" ? getNodeByPath(workspace.project().getProject(), operation.path) : null;
      away.recordOp(operation, node?.kind === "file" ? node.content ?? "" : undefined);
      return undefined;
    }
    const publish = (operation) => (mode.get().workspaceMode === "synced" ? publishShared(operation) : publishToWindows(operation));
    function publishSnapshot() {
      if (mode.get().workspaceMode === "synced") { connection.publishSnapshot(); return; }
      windows()?.scheduleSnapshot(workspace.project().getProject());
    }

    // What the Editor does, heard through Workspace: typing is sent as a patch,
    // an image replaced whole is published, my caret is shown to the others
    // (not while my text for that file is still on its way: they would see it
    // before the text). Others' carets go the other way.
    const sharing = () => session.isConnected() && mode.get().workspaceMode === "synced";
    workspace.events.on("text-changed", ({ path, previous, next }) => {
      if (mode.get().workspaceMode === "synced") away.edited(path, previous);
      if (sharing()) session.scheduleTextPatch(path, previous, next);
      else if (mode.get().workspaceMode === "private") windows()?.scheduleTextPatch(path, previous, next);
    });
    workspace.events.on("file-replaced", ({ operation }) => void publish(operation));
    const showMyCaret = (caret) => {
      if (caret && session.isConnected() && !session.hasPendingPatch(caret.path)) session.scheduleAwareness(caret.path, caret.start, caret.end);
    };
    workspace.events.on("own-caret", showMyCaret);
    // The server has a file's text again: its base is no longer needed.
    events.on("patch-confirmed", () => {
      for (const path of away.snapshot().bases.keys()) if (!session.hasUnsyncedText(path)) away.confirmed(path);
    });
    // Someone else's rename or move: bases follow the paths. The server's copy
    // opened (after a merge, or a reload): nothing left from being away.
    workspace.events.on("remote-applied", ({ operation }) => {
      if (mode.get().workspaceMode === "synced" && (operation?.type === "rename-node" || operation?.type === "move-node")) away.moved(operation.path, movedTo(operation));
    });
    workspace.events.on("replaced", () => { if (mode.get().workspaceMode === "synced") away.clear(); });
    events.on("status", ({ next }) => { if (next.status !== "connected") away.keep(); });
    globalThis.window?.addEventListener("pagehide", () => away.keep());
    // My text arrived: now my caret is right for them too.
    events.on("patch-confirmed", () => { const own = workspace.presence.own(); if (own && session.isConnected()) session.scheduleAwareness(own.path, own.start, own.end); });
    events.on("remote-cursor", (cursor) => workspace.presence.other(cursor));
    events.on("status", () => workspace.presence.keep(status.presence.map((person) => person.clientId).filter(Boolean)));

    const connected = (name) => (...args) => connection[name](...args);
    // The page opened a shared workspace's copy: it is on screen as shared (not
    // yet connected) until it resumes, so it is never taken for this browser's
    // own; with nothing to resume it, this browser's own workspace comes back.
    // Opened as this browser's own, it is no cloud workspace's copy (a reopen
    // must pull, never push this one's files into it).
    if (workspace.copies.isLocal(workspace.copies.restoredKey()) && shell.settings.syncedProjectId) {
      shell.settings.change({ syncedProjectId: null }, "the page opened this browser's own workspace");
    }
    if (String(workspace.copies.restoredKey() ?? "").startsWith("shared:")) {
      mode.share(null);
      const { syncedProjectId, lastWorkspace, autoReconnect, wasConnected, serverPin } = shell.settings;
      const resumable = (syncedProjectId && lastWorkspace?.team) || (autoReconnect && wasConnected && serverPin);
      if (!resumable) ctx.whenStarted(() => connection.switchMode("private"));
    }
    // The cloud workspace on screen, for code that talks to the server about it
    // (snapshots, comments, the agent's conversations): null unless signed in
    // and the open project is that workspace.
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
      confirmed(project, ids) {
        if (mode.get().workspaceMode === "synced") return session.isConnected?.() ? ids.filter((id) => !session.hasUnsyncedText?.(getPath(project, id))) : [];
        // Another window keeps this workspace: saved once it has saved what this one sent.
        if (!link.following()) return ids;
        const runtime = link.runtime();
        if (!runtime || !link.linked() || link.savedRevision() < runtime.getRevision()) return [];
        return ids.filter((id) => !runtime.hasUnsyncedText(getPath(project, id)));
      },
      // Another window keeps this workspace's copy in this browser.
      ownsCopy: () => !link.following(),
      assetsKey: () => connectionInfo()?.token ?? "",
      // A project opened in this tab while it works on a shared workspace is that workspace's content.
      copyKey: (project) => (mode.get().workspaceMode === "synced" && !hostingOwn() ? sharedCopyKey(project) : workspace.copies.localKey(project)),
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
    // Reload Window (Shell): this tab's typing confirmed by the server first.
    // A reload opens the server's copy, keeping unconfirmed typing in
    // Snapshots (History's keeper), so whatever is still on its way is said.
    shell.beforeReload.add({ id: "sync.typing", label: "Shared edits", order: 10, async keep() {
      // The server's, or (this browser's own workspace) the window that keeps it.
      const confirming = () => (mode.get().workspaceMode === "synced" ? session : link.following() ? link.runtime() : null);
      const unconfirmed = () => {
        const runtime = confirming();
        if (!runtime) return [];
        const project = workspace.project().getProject();
        const files = Object.values(project.nodes).filter((node) => node.kind === "file");
        // Offline or reconnecting, nothing is confirmed: the files still marked as changed are what is waiting.
        if (!runtime.isConnected() || runtime.isReconnecting()) return files.filter((node) => node.dirty);
        return files.filter((node) => runtime.hasUnsyncedText(getPath(project, node.id)));
      };
      const until = Date.now() + TYPING_WAIT;
      while (unconfirmed().length && Date.now() < until && confirming()?.isConnected()) await new Promise((resolve) => setTimeout(resolve, 100));
      const left = unconfirmed().map((node) => node.name);
      if (!left.length) return "";
      const names = left.length > 5 ? `${left.slice(0, 5).join(", ")} and ${left.length - 5} more` : left.join(", ");
      return mode.get().workspaceMode === "synced"
        ? `changes in ${names} are not confirmed by the server yet. If you reload now, the server's copy opens and these changes are kept in Snapshots.`
        : `changes in ${names} have not reached the window that keeps this workspace yet. If you reload now, they may be lost.`;
    } });
    return { createCollaborationRuntime, syncVersion, mode, status, session: () => session, events: { on: events.on },
      keepers: { add(keep) { keepers.add(keep); return () => keepers.delete(keep); } },
      configure(next) { supplied = { ...supplied, ...next }; },
      cloudWorkspace, connectionInfo, publish, publishSnapshot, switchMode: connected("switchMode"),
      awayPending: () => { const { bases, ops } = away.snapshot(); return bases.size > 0 || ops.length > 0; },
      windows: Object.freeze({ state: () => link.state() }),
      connectSaved: connected("connectSaved"), reconnectLater: connected("reconnectLater") };
  }
});
