// Errors nothing caught (a handler that threw, a promise nobody awaited) go
// into the trace with where they came from, so a bug that only shows as
// "nothing happened" leaves a mark. `stiloTrace()` in the console prints the
// trace and returns its entries.
import { describe, trace } from "../../../kernel/index.js";

export function watchPageErrors(win = globalThis.window) {
  if (!win?.addEventListener) return; // not a page (tests in Node)
  win.addEventListener("error", (event) => {
    const where = event.filename ? `${new URL(event.filename, win.location.href).pathname.replace(/^\//, "")}:${event.lineno}` : "page";
    trace.record("uncaught", where, describe(event.error ?? event.message));
  });
  win.addEventListener("unhandledrejection", (event) => {
    trace.record("uncaught", "promise", describe(event.reason));
  });
  win.stiloTrace = () => {
    console.log(trace.text());
    return trace.entries();
  };
}
