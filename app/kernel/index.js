// The kernel: starts modules in dependency order and hands each one only the
// public APIs it declared it uses. It knows no domain (docs/ARCHITECTURE.md,
// rule 8; a structure test keeps it that way). Its one piece of state is the
// page's trace (trace.js), which every emitter and ignore() reports into.
//
// A module is defined once, in its index.js:
//
//   export default defineModule({
//     name: "shell", level: 1, uses: [], owns: { registries: ["commands"] },
//     start(ctx) { ...; return api; }   // api = what other modules may call
//   });
//
// ctx.use(name) returns a declared dependency's api; ctx.registry() and
// ctx.emitter() make the module's own extension points and events, and
// ctx.state(initial) the state it owns (see createState).

import { trace, describe, brief, callerOf } from "./trace.js";

export { trace, ignore, ignored, describe, brief, callerOf, createTrace, formatEntry } from "./trace.js";

const MODULE_KEYS = ["name", "level", "uses", "owns", "start"];

export function defineModule(definition) {
  for (const key of MODULE_KEYS) {
    if (!(key in definition)) throw new Error(`Module definition needs "${key}"`);
  }
  const { name, level, uses, owns, start } = definition;
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Bad module name: ${name}`);
  if (!Number.isInteger(level) || level < 1) throw new Error(`${name}: level must be a whole number from 1`);
  if (!Array.isArray(uses)) throw new Error(`${name}: uses must be a list`);
  if (typeof start !== "function") throw new Error(`${name}: start must be a function`);
  return Object.freeze({ name, level, uses: Object.freeze([...uses]), owns, start });
}

// Starts every module, lowest level first. Resolves to a frozen map of
// name -> api. A module that throws while starting stops the whole start, so
// a broken dependency never leaves its users half-wired.
export async function startModules(definitions, { log = () => {} } = {}) {
  const byName = new Map();
  for (const definition of definitions) {
    if (byName.has(definition.name)) throw new Error(`Two modules are called ${definition.name}`);
    byName.set(definition.name, definition);
  }
  for (const definition of definitions) {
    for (const used of definition.uses) {
      const target = byName.get(used);
      if (!target) throw new Error(`${definition.name} uses ${used}, which is not being started`);
      if (target.level >= definition.level) {
        throw new Error(`${definition.name} (level ${definition.level}) may not use ${used} (level ${target.level})`);
      }
    }
  }
  const order = [...definitions].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const apis = new Map();
  for (const definition of order) {
    const ctx = Object.freeze({
      name: definition.name,
      use(used) {
        if (!definition.uses.includes(used)) {
          throw new Error(`${definition.name} did not declare that it uses ${used}`);
        }
        return apis.get(used);
      },
      registry: (options) => createRegistry({ ...options, owner: definition.name }),
      emitter: () => createEmitter(definition.name, log),
      state: (initial, options) => createState(definition.name, initial, trace, options),
      log: (...args) => { trace.record("log", definition.name, args.join(" ")); log(definition.name, ...args); }
    });
    const api = await definition.start(ctx);
    apis.set(definition.name, Object.freeze(api ?? {}));
    trace.record("log", "kernel", `started ${definition.name}`);
    log("kernel", `started ${definition.name}`);
  }
  return Object.freeze(Object.fromEntries(apis));
}

// A list of entries one module offers others to add to (an extension point).
// Each entry has a unique key; add() returns a function that removes it again.
export function createRegistry({ key = "id", validate = () => {}, owner = "" } = {}) {
  const entries = new Map();
  const listeners = new Set();
  const changed = () => { for (const listener of [...listeners]) listener(); };
  return Object.freeze({
    add(entry) {
      const id = entry?.[key];
      if (typeof id !== "string" || !id) throw new Error(`${owner}: an entry needs a "${key}"`);
      if (entries.has(id)) throw new Error(`${owner}: "${id}" is already registered`);
      validate(entry);
      entries.set(id, Object.freeze({ ...entry }));
      changed();
      return () => { if (entries.delete(id)) changed(); };
    },
    get: (id) => entries.get(id),
    has: (id) => entries.has(id),
    all: () => [...entries.values()],
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

// State one owner keeps. Only the owner holds this object; what it hands out
// is get() and on() and its own named actions, which call set(action, patch).
// Every change names the action that made it and lands in the trace, so "who
// changed this?" has an answer. A key it did not start with is refused, and
// arrays in it are frozen: pushing onto one throws instead of changing state
// behind the owner's back. Listeners get (state, changedKeys, action).
// options.secret: keys whose values the trace never shows (a password).
export function createState(owner, initial, into = trace, { secret = [] } = {}) {
  const seal = (state) => {
    for (const value of Object.values(state)) if (Array.isArray(value)) Object.freeze(value);
    return Object.freeze(state);
  };
  let current = seal({ ...initial });
  const listeners = new Set();
  return Object.freeze({
    get: () => current,
    set(action, patch) {
      for (const key of Object.keys(patch)) {
        if (!(key in current)) throw new Error(`${owner}: "${key}" is not part of its state`);
      }
      const changed = Object.keys(patch).filter((key) => !Object.is(current[key], patch[key]));
      if (!changed.length) return current;
      current = seal({ ...current, ...patch });
      into.record("state", owner, action, changed.map((key) => `${key}=${secret.includes(key) ? "(hidden)" : brief(current[key])}`).join(" "));
      for (const listener of [...listeners]) {
        try {
          listener(current, changed, action);
        } catch (error) {
          into.record("failed", owner, `a listener for ${action}`, describe(error));
        }
      }
      return current;
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

// A read-only, always-current view of a state, for code that only reads it
// (`view.theme`). `view.change(patch, why?)` changes it, recorded in the trace
// with `why` or else the file and line that called; `view.on(listener)` hears
// every change as (view, changedKeys). Assigning to the view throws, so a
// change can never happen unseen. The owner decides who gets change().
export function createLiveView(state) {
  const change = (patch, why) => state.set(why ?? `changed at ${callerOf(new Error().stack)}`, patch);
  const on = (listener) => state.on((current, changed) => listener(view, changed));
  const refuse = (key) => {
    throw new TypeError(`${String(key)} is read-only here: change it with .change({ ${String(key)}: … })`);
  };
  const view = new Proxy({}, {
    get: (_, key) => (key === "change" ? change : key === "on" ? on : state.get()[key]),
    has: (_, key) => key in state.get(),
    ownKeys: () => Reflect.ownKeys(state.get()),
    getOwnPropertyDescriptor(_, key) {
      const current = state.get();
      return key in current ? { value: current[key], enumerable: true, configurable: true, writable: false } : undefined;
    },
    set: (_, key) => refuse(key),
    deleteProperty: (_, key) => refuse(key),
    defineProperty: (_, key) => refuse(key)
  });
  return view;
}

// Named events a module emits for the modules above it. A listener that
// throws is logged and does not stop the others. Every emit and every failed
// listener is recorded in the trace.
export function createEmitter(owner = "", log = () => {}, into = trace) {
  const listeners = new Map();
  return Object.freeze({
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
      return () => listeners.get(event)?.delete(listener);
    },
    emit(event, payload) {
      into.record("event", owner, event, describe(payload));
      for (const listener of [...(listeners.get(event) ?? [])]) {
        try {
          listener(payload);
        } catch (error) {
          into.record("failed", owner, `a listener for ${event}`, describe(error));
          log(owner, `a listener for ${event} failed: ${error?.message ?? error}`);
        }
      }
    }
  });
}
