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
// ctx.emitter() make the module's own extension points and events.

import { trace, describe } from "./trace.js";

export { trace, ignore, ignored, describe, createTrace, formatEntry } from "./trace.js";

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
