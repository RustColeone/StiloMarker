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
// API: attach(port) -> session: the live connection (connect, openWorkspace,
// publish, reconnect...), created once main.js gives it what only the app can
// do: { replaceProject(project), applyOperation(clientId, operation),
// preserveLocalFiles(files), reauthenticate(), uploadAsset(...) }.
// session() -> the same. status: the session as the app sees it, read-only
// (status.status, status.presence, status.role...; service/status.js); code
// that pings or reconnects says what happened with status.change({ … }).
// events.on(name, listener): "status" ({ next, previous }), "remote-cursor"
// (event), "host-counters" ({ path, counters }), "patch-confirmed", and
// "event" ({ event, ownClientId }): other modules' events on Sync's stream.
// mode, whether this tab works on a shared workspace or its own local
// project (service/mode.js): get() -> { workspaceMode, privateProject },
// share(currentProject), leave() -> the kept project, forgetKept(), restore(saved).
//   transformTextPatch   sanitizeProjectForSync
import { createLiveView, defineModule } from "../../kernel/index.js";
import * as api from "./adapters/api.js";
import { pageClock } from "./adapters/page.js";
import contract from "./model/contract.js";
import { createRuntime } from "./service/runtime.js";
import { LOCAL_MODE, createMode } from "./service/mode.js";
import { SESSION_STATUS, statusFromSession } from "./service/status.js";
import { addSessionView } from "./adapters/session-view.js";

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

    function attach(port) {
      if (session) throw new Error("sync: already attached");
      for (const name of ["replaceProject", "applyOperation", "preserveLocalFiles", "reauthenticate", "uploadAsset"]) {
        if (typeof port[name] !== "function") throw new Error(`sync.attach: the port lacks ${name}`);
      }
      session = createCollaborationRuntime({
        getProject: () => workspace.project().getProject(),
        replaceProject: port.replaceProject,
        applyOperation: port.applyOperation,
        preserveLocalFiles: port.preserveLocalFiles,
        reauthenticate: port.reauthenticate,
        uploadAsset: port.uploadAsset,
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
      return session;
    }
    // The session on the page: the status bar's collaborators and the Session panel.
    addSessionView({ shell: ctx.use("shell"), status, mode });
    return { createCollaborationRuntime, syncVersion, mode, status, attach, session: () => session, events: { on: events.on } };
  }
});
