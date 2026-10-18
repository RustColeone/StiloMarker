// The trace: what happened lately, in order, and who did it. Events modules
// emit, listeners that failed, errors code chose to ignore (with why) and
// errors nothing caught. It answers "who changed this, and what happened just
// before?" when a bug shows up. A ring buffer of the last entries; the log
// panel's Trace tab shows it and `stiloTrace()` in the console prints it.
//
// The kernel's one piece of state: one trace per page, so code anywhere
// (including code that is not a module yet) can report into it.

export function createTrace({ limit = 1000, now = () => Date.now() } = {}) {
  const entries = [];
  const listeners = new Set();
  let seq = 0;

  function record(kind, owner, message, detail = "") {
    const last = entries[entries.length - 1];
    if (last && last.kind === kind && last.owner === owner && last.message === message && last.detail === detail) {
      last.count += 1; // the same thing again: count it instead of pushing older entries out
      last.time = now();
      notify(last);
      return last;
    }
    const entry = { seq: ++seq, time: now(), kind, owner, message, detail, count: 1 };
    entries.push(entry);
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    notify(entry);
    return entry;
  }

  function notify(entry) {
    for (const listener of [...listeners]) {
      try { listener(entry); } catch (error) { console.error("trace listener failed", error); }
    }
  }

  return Object.freeze({
    record,
    entries: () => entries.slice(),
    clear() { entries.length = 0; notify(null); },
    onRecord(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    text: () => entries.map(formatEntry).join("\n")
  });
}

export function formatEntry(entry) {
  const time = new Date(entry.time).toISOString().slice(11, 23);
  const count = entry.count > 1 ? ` (x${entry.count})` : "";
  const detail = entry.detail ? ` :: ${entry.detail}` : "";
  return `${time} ${entry.kind} ${entry.owner}: ${entry.message}${count}${detail}`;
}

export const trace = createTrace();

// For a catch that means to carry on: say why, and the error still reaches
// the trace. `catch (error) { ignore(error, "why") }`, or for a promise
// `.catch(ignored("why"))`. A structure test refuses empty catches.
export function ignore(error, why) {
  trace.record("ignored", callerOf(new Error().stack), why, describe(error));
}

export function ignored(why) {
  const where = callerOf(new Error().stack);
  return (error) => { trace.record("ignored", where, why, describe(error)); };
}

// A short, cheap description of an error or an event's payload.
export function describe(value) {
  if (value == null) return "";
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value !== "object") return String(value).slice(0, 120);
  const named = ["type", "kind", "path", "id", "status", "name"].filter((key) => typeof value[key] === "string" || typeof value[key] === "number");
  if (named.length) return named.map((key) => `${key}=${String(value[key]).slice(0, 80)}`).join(" ");
  return `{${Object.keys(value).slice(0, 6).join(", ")}}`;
}

// "app/x/y.js:12" for the first stack frame outside this file.
export function callerOf(stack = "") {
  for (const line of String(stack).split("\n").slice(1)) {
    const match = /([a-z][\w+.-]*:\/\/[^\s)]+?):(\d+):\d+/.exec(line);
    if (!match || match[1].endsWith("/kernel/trace.js")) continue;
    let path = match[1];
    try { path = new URL(path).pathname.replace(/^\//, ""); } catch (error) { console.error("trace: odd stack line", error); }
    return `${path}:${match[2]}`;
  }
  return "?";
}
