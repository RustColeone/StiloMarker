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
// API: mode, whether this tab works on a shared workspace or its own local
// project (service/mode.js): get() -> { workspaceMode, privateProject },
// share(currentProject), leave() -> the kept project, forgetKept(), restore(saved).
//   transformTextPatch   sanitizeProjectForSync
import { defineModule } from "../../kernel/index.js";
import * as api from "./adapters/api.js";
import { pageClock } from "./adapters/page.js";
import contract from "./model/contract.js";
import { createRuntime } from "./service/runtime.js";
import { LOCAL_MODE, createMode } from "./service/mode.js";

export { transformTextPatch } from "./model/rebase.js";
export { sanitizeProjectForSync } from "./model/paths.js";
export const syncVersion = contract.version;

export function createCollaborationRuntime(options) {
  return createRuntime({ ...options, clock: options.clock ?? pageClock, api });
}

export default defineModule({
  name: "sync",
  level: 3,
  uses: ["shell", "file-types", "workspace"],
  owns: {
    names: ["sync protocol number"],
    state: ["the live session", "unconfirmed typing", "shared or local work, and the local project kept aside"],
    rules: ["rebasing a text patch"]
  },
  start(ctx) {
    // Shared or local work: read mode.get(), change it through its actions.
    const mode = createMode(ctx.state(LOCAL_MODE));
    return { createCollaborationRuntime, syncVersion, mode };
  }
});
