// Saving the open project (moved from main.js when Workspace took saving):
//   - this browser's copy of it (IndexedDB, adapters/browser-copy.js), the
//     one the project store names (copyKey: each workspace has its own, so
//     one is never written over another's): a trailing write after edits;
//     a write pending for one copy is written as the project switches to
//     another; as the page may go away, what changed is journaled at once
//     and the write begun. A write that fails is reported (report(error),
//     report(null) once one succeeds again): the user is told, never silently.
//     Nothing is written once the app's storage was cleared (cleared()),
//     nor by a window that follows another on the same workspace (that one
//     keeps the copy: ownsCopy(), Sync's); saved(project) hears each write;
//   - a local (on-device) project mirrored to its folder, debounced per folder;
//   - auto-save, when idle and every 15 s, which clears a file's dirty mark
//     once it is durably stored (a real folder on disk saves only on Save);
//   - the Save command for the open file.
// Whether a file of a shared workspace is durably stored is the session's to
// say (Sync, above Workspace): the hooks given to attach() answer it.
import { keepJournal, saveProject } from "./browser-copy.js";
import { saveProjectToHandles } from "./disk-folders.js";
import { savedFileIds, snapshotProject } from "./save-queue.js";

const RECOVERY_SAVE_IDLE_MS = 800;
const RECOVERY_SAVE_MAX_MS = 3000;
const AUTOSAVE_IDLE_MS = 1500;
const AUTOSAVE_PERIODIC_MS = 15000;

const dirtyFileIds = (project) => Object.values(project.nodes)
  .filter((node) => node.kind === "file" && node.dirty)
  .map((node) => node.id);

// store(): the open project's store; settings: Shell's; log(...): the module log;
// report(error | null): this browser's copy failed, or works again;
// cleared(): the app's storage was cleared while this page was open;
// saved(project): this browser's copy of `project` was written;
// io: the writes (tests give their own).
export function createSaving({ store, settings, log, report = () => {}, cleared = () => false, saved = () => {},
  io = { saveProject, saveProjectToHandles, keepJournal } }) {
  // The copy the open project is saved as (a stub store names none: its own id's).
  const copyKey = () => store().copyKey?.() ?? `local:${store().getProject()?.id}`;
  // What the app above says (attach): busy() while an IME composition is under
  // way; scope() names the workspace a save belongs to (a save that finishes
  // after a switch confirms nothing); shared() when the project is a shared
  // workspace; confirmed(project, ids) the files the server (or the window
  // that keeps this workspace) has confirmed; ownsCopy() unless another
  // window on this workspace keeps its copy.
  let hooks = { busy: () => false, scope: () => "local", shared: () => false, confirmed: (project, ids) => ids, ownsCopy: () => true };
  const writes = () => !cleared() && hooks.ownsCopy();
  let attached = false;

  // ---- This browser's copy. Serialising the whole project used to run on
  // every render — every keystroke, and every collaborator's keystroke. Now it
  // trails edits slightly and is flushed whenever the page may go away.
  let recoveryTimer = null;
  let recoveryDeadline = 0;
  let recoveryPending = null;

  function scheduleRecoverySave(project) {
    const key = copyKey();
    // The project switched copies: what was waiting is written to its own now.
    if (recoveryPending && recoveryPending.key !== key) void flushRecoverySave();
    recoveryPending = { project, key };
    const now = performance.now();
    if (!recoveryDeadline) recoveryDeadline = now + RECOVERY_SAVE_MAX_MS;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(flushRecoverySave, Math.max(0, Math.min(RECOVERY_SAVE_IDLE_MS, recoveryDeadline - now)));
  }

  // Resolves once written (or once the failure is reported).
  async function flushRecoverySave() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    recoveryDeadline = 0;
    const pending = recoveryPending;
    recoveryPending = null;
    if (!pending || !writes()) return;
    try {
      await io.saveProject(pending.project, pending.key);
      report(null);
      saved(pending.project);
    } catch (error) {
      log("browser recovery save failed:", error.message);
      report(error);
    }
  }

  // The page may go: what changed is journaled at once, and the write begun.
  function keepNow(project = store().getProject()) {
    if (!writes()) return;
    const key = copyKey();
    try { io.keepJournal?.(project, key); } catch (error) { log("browser journal failed:", error.message); }
    if (recoveryPending && recoveryPending.key !== key) void flushRecoverySave();
    recoveryPending = { project, key };
    void flushRecoverySave();
  }

  // ---- A local (OPFS) project mirrors changes to its folder. Debounced per
  // folder; the shared writer serializes background, automatic and explicit saves.
  const folderTimers = new Map();

  function scheduleFolderSave(project) {
    if (project?.sourceMode !== "opfs") return;
    const root = project.handles?.[project.rootId];
    if (!root) return;
    const previous = folderTimers.get(root);
    if (previous) clearTimeout(previous);
    // Capture this workspace: switching views must not redirect its pending save.
    folderTimers.set(root, setTimeout(() => {
      folderTimers.delete(root);
      if (!writes()) return;
      void io.saveProjectToHandles(project).catch((error) => log("local workspace save failed:", error.message));
    }, 500));
  }

  // ---- Auto-save: clears the dirty mark (the tab's dot and the leave-page
  // question) once content is durably stored: localStorage for an in-browser
  // workspace, its folder for a local one, the server for a shared one.
  let autoSaveTimer = null;

  function scheduleAutoSave(project = store().getProject()) {
    if (!settings.autoSave || project.sourceMode === "filesystem") return;
    if (!dirtyFileIds(project).length) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null;
      void runAutoSave("idle");
    }, AUTOSAVE_IDLE_MS);
  }

  async function runAutoSave(reason) {
    if (!settings.autoSave) return;
    // Don't churn a render (markManySaved) mid-IME-composition; wait until it ends.
    if (hooks.busy() || cleared()) return;
    const project = snapshotProject(store().getProject());
    const key = copyKey();
    const scope = hooks.scope();
    if (project.sourceMode === "filesystem") return; // explicit save only
    const dirty = dirtyFileIds(project);
    if (!dirty.length) return;
    try {
      // Another window keeps this workspace: it writes; this one only marks what it saved.
      if (!hooks.ownsCopy()) {
        // nothing written here
      } else if (project.sourceMode === "opfs") {
        await io.saveProjectToHandles(project);
      } else {
        await io.saveProject(project, key); // propagate quota/storage errors before clearing dirty
        report(null);
        saved(project);
      }
      if (scope !== hooks.scope()) return;
      const unchanged = new Set(savedFileIds(store().getProject(), project));
      const savedDirty = dirty.filter((id) => unchanged.has(id));
      // A shared workspace's durable home is the SERVER, so a file is only clean
      // once the server confirmed its text (nothing pending, in flight or
      // mid-reconnect): the dot must never lie about being saved. While offline
      // nothing is confirmed, so every edit stays dirty — that mark is what tells
      // a later reconnect which files still need pushing.
      const savable = hooks.confirmed(project, savedDirty);
      if (savable.length) {
        store().markManySaved(savable, !hooks.shared()); // the host owns the counters when shared
        log(`auto-saved ${savable.length} file(s) (${reason})`);
      }
    } catch (error) {
      log("auto-save failed:", error.message);
      if (project.sourceMode !== "opfs") report(error);
    }
  }

  // ---- Save (the command): the open file, to its folder or this browser.
  async function saveActiveFile() {
    const saved = snapshotProject(store().getProject());
    const key = copyKey();
    const scope = hooks.scope();
    const activeId = saved.activeFileId;
    if (!activeId || cleared()) return;
    if (hooks.ownsCopy()) {
      const wroteToDisk = await io.saveProjectToHandles(saved);
      if (!wroteToDisk) await io.saveProject(saved, key);
    }
    if (scope !== hooks.scope()) return;
    const current = store().getProject();
    if (!savedFileIds(current, saved).includes(activeId)) return;
    if (hooks.confirmed(current, [activeId]).includes(activeId)) store().markSaved(activeId, !hooks.shared());
  }

  // Reload Window (Shell): everything written now (this browser's copy, a
  // local project's folder, auto-save's marks). Says what it could not keep.
  async function keepAll() {
    const project = store().getProject();
    if (cleared()) return "";
    // Another window keeps this workspace: what is confirmed is marked.
    if (!hooks.ownsCopy()) { await runAutoSave("reload"); return ""; }
    if (recoveryPending && recoveryPending.key !== copyKey()) await flushRecoverySave();
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    recoveryDeadline = 0;
    recoveryPending = null;
    try { await io.saveProject(project, copyKey()); } catch (error) { report(error); return `this browser's copy could not be written (${error.message}).`; }
    if (project.sourceMode === "opfs" && project.handles?.[project.rootId]) {
      try { await io.saveProjectToHandles(project); } catch (error) { return `the project's folder could not be written (${error.message}).`; }
    }
    await runAutoSave("reload");
    // A folder picked on this device saves only on Save, and a reload can't
    // reopen it without asking: its unsaved files stay in this browser only.
    const unsaved = project.sourceMode === "filesystem" ? dirtyFileIds(store().getProject()) : [];
    if (unsaved.length) {
      const all = unsaved.map((id) => store().getProject().nodes[id]?.name).filter(Boolean);
      const names = all.length > 5 ? `${all.slice(0, 5).join(", ")} and ${all.length - 5} more` : all.join(", ");
      return `${unsaved.length} file(s) have changes not saved to the folder on disk (${names}). After a reload they are kept in this browser, but the folder must be opened again; Save (Ctrl+S) writes them there first.`;
    }
    return "";
  }

  // The project changed (or the app rendered it): schedule each kind of save.
  function schedule(project) {
    scheduleRecoverySave(project);
    scheduleFolderSave(project);
    scheduleAutoSave(project);
  }

  // Starts the page listeners and the periodic save: only in a page, once.
  function attach(given) {
    if (attached) throw new Error("workspace.saving: already attached");
    attached = true;
    hooks = { ...hooks, ...given };
    // Anything that might end the page's life gets the pending copy written now.
    window.addEventListener("pagehide", () => { void flushRecoverySave(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushRecoverySave();
    });
    // A safety net, so a long typing session (the idle timer keeps resetting)
    // still gets saved regularly.
    window.setInterval(() => {
      if (settings.autoSave && dirtyFileIds(store().getProject()).length) void runAutoSave("periodic");
    }, AUTOSAVE_PERIODIC_MS);
  }

  return Object.freeze({ attach, schedule, scheduleAutoSave, runAutoSave, saveActiveFile, keepAll, keepNow, flush: flushRecoverySave, dirtyFileIds });
}

