// Reload Window: the page reloaded without losing work. Unlike the browser's
// reload it first asks each module to keep what it holds (beforeReload steps,
// in order: shared typing confirmed by the server, the files written to this
// browser and their folder, where the reader was) and reloads only when all of
// it is kept, or the user says to reload anyway. While it reloads, the page
// does not ask "Leave site?" (reloading()). A step that takes longer than
// STEP_TIMEOUT counts as a problem.
const STEP_TIMEOUT = 10000;

// steps: a registry of { id, label, order?, keep: async () => problem text | nothing };
// confirm: Shell's; log(kind, message, detail): the log panel's.
export function createReload({ steps, confirm, log, reload = () => globalThis.location.reload(), timeout = STEP_TIMEOUT }) {
  let busy = false;
  let reloading = false;

  function inTime(promise) {
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(`still not done after ${Math.round(timeout / 1000)} s`), timeout); });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }

  // Each step in order; what could not be kept, as "label: problem".
  async function keepWork() {
    const problems = [];
    const ordered = [...steps.all()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    for (const step of ordered) {
      let problem = "";
      try {
        problem = await inTime(Promise.resolve(step.keep()));
      } catch (error) {
        problem = error?.message ?? String(error);
      }
      if (problem) {
        problems.push(`${step.label}: ${problem}`);
        log("failed", `Reload Window: ${step.label} not kept`, problem);
      }
    }
    return problems;
  }

  // Resolves false when it did not reload (already under way, or the user
  // chose to stay); otherwise the page goes.
  async function reloadWindow() {
    if (busy || reloading) return false;
    busy = true;
    try {
      log("action", "Reload Window: keeping your work");
      const problems = await keepWork();
      if (problems.length) {
        const accepted = await confirm({ title: "Reload Window",
          message: `Some work could not be kept:\n\n${problems.join("\n\n")}\n\nReload anyway?`, acceptLabel: "Reload Anyway" });
        if (!accepted) {
          log("response", "Reload Window cancelled: nothing was reloaded");
          return false;
        }
      }
      reloading = true;
      log("response", "Reload Window: work kept, reloading");
      reload();
      return true;
    } finally {
      busy = false;
    }
  }

  return { reloadWindow, reloading: () => reloading };
}

// What a reload step must be (the registry's check).
export function checkReloadStep(entry) {
  if (typeof entry.label !== "string" || !entry.label) throw new Error(`Reload step ${entry.id} needs a label`);
  if (typeof entry.keep !== "function") throw new Error(`Reload step ${entry.id} needs keep()`);
}
