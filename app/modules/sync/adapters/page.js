// The page as the sync runtime needs it: timers, and whether the tab is
// hidden. Read at call time, so tests can stand in their own `window`.
export const pageClock = {
  setTimeout: (fn, delay) => window.setTimeout(fn, delay),
  clearTimeout: (id) => window.clearTimeout(id),
  hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden"
};
