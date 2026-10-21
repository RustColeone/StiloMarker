// One workspace's edits put in order, for the windows of this browser that
// share it: the server's SharedWorkspace (server/stilo/modules/sync/service/
// shared.py) in the browser, run by one window (adapters/tabs.js). Every
// change goes through apply(): checked against the revision it was made at
// (a whole-file write older than the file's last change is refused; a text
// patch is moved over the patches applied since), applied to the broker's
// project, and given the next revision. A window that only follows keeps a
// copy (follow(event)), so it can take over where the last one stopped.
// Pure: no page, no storage. Refusals carry a status (409: based on an older
// copy; 400: the change does not fit the project).
import { createRebaseLog } from "../model/rebase-log.js";
import { PATCH_FILE, REPLACE_PROJECT, UPDATE_FILE } from "../../workspace/index.js";

const refused = (status, message) => Object.assign(new Error(message), { status });
const joined = (parent, name) => (parent ? `${parent}/${name}` : name);
const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// The paths an operation changes (the server's touched_paths; a move or a
// rename names the old and new path: what is under them follows by prefix).
export function touchedPaths(operation) {
  const path = String(operation.path ?? "");
  switch (operation.type) {
    case PATCH_FILE: case UPDATE_FILE: case "delete-node": return [path];
    case "create-file": case "create-folder": return [joined(String(operation.parentPath ?? ""), String(operation.name ?? ""))];
    case "rename-node": return [path, ...(operation.name ? [joined(parentOf(path), String(operation.name))] : [])];
    case "move-node": return [path, joined(String(operation.parentPath ?? ""), path.split("/").pop())];
    default: return [];
  }
}

// applyOperation(project, operation) -> the next project (Workspace's applySyncOperation).
export function createBroker({ project, revision = 0, applyOperation }) {
  let current = project;
  let at = Number(revision) || 0;
  const log = createRebaseLog({ floor: at });

  // A change checked, applied and given the next revision. Returns the
  // operation as applied (a patch's range moved over the ones before it).
  function commit(operation) {
    const kind = operation.type;
    const base = operation.baseRevision === undefined || operation.baseRevision === null ? null : Number(operation.baseRevision);
    let applied = operation;
    if (kind === REPLACE_PROJECT && base !== at) {
      throw refused(409, `replace-project conflict: based on revision ${base} but the workspace is at ${at} — reload before publishing over it`);
    }
    if (kind === UPDATE_FILE) {
      if (base === null) throw refused(409, "update-file conflict: the change did not say which revision it is based on");
      const changedAt = log.lastChange(String(operation.path));
      if (base < changedAt || base > at) {
        throw refused(409, `update-file conflict on "${operation.path}": based on revision ${base} but that file changed at revision ${changedAt}`);
      }
    }
    if (kind === PATCH_FILE) {
      if (base === null || base < 0 || base > at) throw refused(409, "patch conflict: invalid or missing base revision");
      const start = Number(operation.start), end = Number(operation.end);
      if (!(start >= 0) || !(end >= start)) throw refused(400, "Invalid text patch range");
      applied = { ...operation, ...log.rebase(String(operation.path), start, end, base, at) };
    }
    let next;
    try {
      next = kind === REPLACE_PROJECT ? operation.project : applyOperation(current, applied);
    } catch (error) {
      throw refused(400, error.message);
    }
    current = next;
    at += 1;
    if (kind === REPLACE_PROJECT) log.reset(at);
    if (kind === PATCH_FILE) log.record(at, String(applied.path), applied.start, applied.end, String(applied.text ?? ""));
    log.note(touchedPaths(applied), at, kind === PATCH_FILE);
    return applied;
  }

  return {
    state: () => ({ project: current, revision: at }),
    revision: () => at,
    // A window's change: the event every window hears (its own confirms it).
    apply(clientId, operation) {
      const applied = commit(operation);
      return { type: "operation", clientId, revision: at, operation: applied };
    },
    // The whole project replaced (publishing a project over the shared one),
    // only from the revision it is now.
    replace(clientId, nextProject, baseRevision) {
      commit({ type: REPLACE_PROJECT, project: nextProject, baseRevision });
      return { type: "state", clientId, revision: at, project: current };
    },
    // A follower's copy: an event the leading window committed, in order.
    // Returns false when it does not follow on (the copy is then out of step).
    follow(event) {
      if (Number(event.revision) !== at + 1) return Number(event.revision) <= at;
      if (event.type === "state") {
        current = event.project;
        at = Number(event.revision);
        log.reset(at);
        return true;
      }
      const operation = event.operation;
      current = operation.type === REPLACE_PROJECT ? operation.project : applyOperation(current, operation);
      at = Number(event.revision);
      if (operation.type === REPLACE_PROJECT) log.reset(at);
      if (operation.type === PATCH_FILE) log.record(at, String(operation.path), operation.start, operation.end, String(operation.text ?? ""));
      log.note(touchedPaths(operation), at, operation.type === PATCH_FILE);
      return true;
    }
  };
}
