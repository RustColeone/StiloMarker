// Per-document view state (bmap pan/zoom, editor scroll and selection) cached client-side so
// the user resumes where they left off. Keyed by file id; lives in localStorage.
import { ignore } from "../kernel/index.js";

const VIEW_STATE_KEY = "mdnotes.viewstate.v1";

function loadViewStates() {
  try {
    const raw = globalThis.localStorage?.getItem(VIEW_STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveViewStates(states) {
  try {
    globalThis.localStorage?.setItem(VIEW_STATE_KEY, JSON.stringify(states ?? {}));
  } catch (error) {
    ignore(error, "saving the view state failed (storage disabled or full); resuming is best-effort");
  }
}

function clearViewStates() {
  try {
    globalThis.localStorage?.removeItem(VIEW_STATE_KEY);
  } catch (error) {
    ignore(error, "clearing the view state failed: storage is disabled");
  }
}

export { loadViewStates, saveViewStates, clearViewStates };
