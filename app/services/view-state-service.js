// Per-document view state (bmap pan/zoom, document scroll) cached client-side so
// the user resumes where they left off. Keyed by file id; lives in localStorage.
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
  } catch {
    // Storage disabled or over quota — resume-position is best-effort.
  }
}

function clearViewStates() {
  try {
    globalThis.localStorage?.removeItem(VIEW_STATE_KEY);
  } catch {
    // ignore
  }
}

export { loadViewStates, saveViewStates, clearViewStates };
