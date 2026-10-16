// The eight structure rules (docs/ARCHITECTURE.md). Each failure says which
// rule broke and how to fix it. Today's violations are recorded in
// baseline.json and may only shrink: `node tools/structure-baseline.mjs`
// lowers it after a cleanup and refuses to raise it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROOT, codeFiles, read, lineCount, oversized, spellings, jsImports, pyImports,
  loadModules, moduleOf, KERNEL_MAX_LINES, DOMAIN_WORDS, MAX_LINES
} from "./scan.mjs";

const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));
const baseline = json("tests/structure/baseline.json");
const files = codeFiles();
const all = await loadModules();

test("module manifests are complete and their uses are acyclic and point down (rule 2)", () => {
  const byName = new Map();
  for (const m of all) {
    for (const key of ["name", "level", "uses", "owns"]) {
      assert.ok(m[key] !== undefined, `${m.dir}: the module definition needs "${key}"`);
    }
    assert.ok(Number.isInteger(m.level) && m.level >= 1, `${m.dir}: level must be a whole number from 1`);
    const key = `${m.root}:${m.name}`;
    assert.ok(!byName.has(key), `two modules are called ${m.name} under ${m.root}`);
    byName.set(key, m);
  }
  for (const m of all) {
    for (const used of m.uses) {
      const target = byName.get(`${m.root}:${used}`);
      assert.ok(target, `${m.name} uses "${used}", which is not a module under ${m.root}`);
      assert.ok(target.level < m.level,
        `${m.name} (level ${m.level}) uses ${used} (level ${target.level}): a module may only use lower levels. ` +
        "Tell a higher module about changes with an event or an extension point instead.");
    }
  }
});

test("modules are reached only through their public API, and only if declared (rules 1, 2)", () => {
  const problems = [];
  for (const file of files.filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))) {
    const from = moduleOf(file, all);
    for (const target of jsImports(file)) {
      const to = moduleOf(target, all);
      if (!to || to === from) continue;
      if (target !== `${to.dir}/index.js`) {
        problems.push(`${file} imports ${target}: import ${to.dir}/index.js instead (rule 1)`);
      }
      if (from && !from.uses.includes(to.name)) {
        problems.push(`${file} imports ${to.name}, which the ${from.name} module does not list in "uses" (rule 2)`);
      }
    }
  }
  for (const file of files.filter((f) => f.endsWith(".py"))) {
    const from = moduleOf(file, all);
    for (const name of pyImports(file)) {
      const match = /^stilo\.modules\.([\w]+)(\..+)?$/.exec(name);
      if (!match) continue;
      const to = all.find((m) => m.root === "server/stilo/modules" && m.name === match[1]);
      if (!to || to === from) continue;
      if (match[2]) problems.push(`${file} imports ${name}: import stilo.modules.${match[1]} instead (rule 1)`);
      if (from && !from.uses.includes(to.name)) {
        problems.push(`${file} imports ${to.name}, which the ${from.name} module does not list in "uses" (rule 2)`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("each owned name is spelled only by its owner, and the legacy spellings only shrink (rule 4)", () => {
  const now = spellings(files);
  const problems = [];
  // A module's browser and server halves share its names, so ownership is per end.
  const owners = new Map();
  for (const m of all) {
    for (const name of m.owns.names ?? []) {
      const key = `${m.root}:${name}`;
      assert.ok(!owners.has(key), `"${name}" is owned by both ${owners.get(key)?.name} and ${m.name}`);
      owners.set(key, m);
    }
  }
  for (const [name, spelled] of Object.entries(now)) {
    const allowed = new Set(baseline.spellings[name] ?? []);
    for (const file of spelled) {
      const owner = owners.get(`${endOf(file)}:${name}`);
      if (owner && moduleOf(file, all) === owner) continue;
      if (!allowed.has(file)) {
        problems.push(`${file} spells ${name}. ` + (owner
          ? `Ask the ${owner.name} module instead.`
          : "Use the existing definition (see baseline.json for where it lives today) instead of a new copy."));
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("what each module owns does not overlap (rule 4)", () => {
  const seen = new Map();
  for (const m of all) {
    for (const [kind, items] of Object.entries(m.owns)) {
      for (const item of items) {
        const key = `${m.root}:${kind}:${item}`;
        assert.ok(!seen.has(key), `${kind} "${item}" is owned by both ${seen.get(key)} and ${m.name}`);
        seen.set(key, m.name);
      }
    }
  }
});

test("model and service code does no input or output (rule 5)", () => {
  const jsIo = /\b(document|window|localStorage|sessionStorage|indexedDB|navigator)\b|\bfetch\(|new (WebSocket|EventSource|XMLHttpRequest)\b/;
  const pyIo = /^\s*(import|from)\s+(sqlite3|socket|subprocess|urllib|http|requests)\b|\bopen\(/m;
  const problems = [];
  for (const file of files) {
    const m = moduleOf(file, all);
    if (!m) continue;
    const layer = file.slice(m.dir.length + 1).split("/")[0];
    if (layer !== "model" && layer !== "service") continue;
    const io = file.endsWith(".py") ? pyIo : jsIo;
    if (io.test(read(file))) problems.push(`${file} does input or output; move that into ${m.dir}/adapters/ behind a port`);
  }
  assert.deepEqual(problems, []);
});

test("every twin rule has a shared case table that both languages run (rule 6)", () => {
  const twins = json("spec/twins.json");
  const tests = (ext) => codeFilesIn("tests", ext);
  for (const twin of twins.covered) {
    assert.ok(existsSync(join(ROOT, twin.cases)), `${twin.name}: ${twin.cases} is missing`);
    const caseFile = twin.cases.split("/").pop();
    assert.ok(tests(".mjs").some((f) => read(f).includes(caseFile)), `${twin.name}: no JavaScript test reads ${twin.cases}`);
    assert.ok(tests(".py").some((f) => read(f).includes(caseFile)), `${twin.name}: no Python test reads ${twin.cases}`);
  }
  assert.ok(Array.isArray(twins.uncovered), "spec/twins.json needs an uncovered list (twins still without a table)");
  assert.ok(twins.uncovered.length <= baseline.uncoveredTwins,
    `spec/twins.json lists ${twins.uncovered.length} twins without a case table; it may not grow past ${baseline.uncoveredTwins}`);
});

test("the legacy contract matches the messages the code sends and handles (rule 7)", () => {
  const contract = json("protocol/legacy.contract.json");
  const ops = new Set(contract.operations.types);
  const events = new Set([...contract.workspaceEvents.types, ...contract.agentTurnEvents.types]);
  const server = files.filter((f) => f.startsWith("server/") && f.endsWith(".py"));

  // Operations the server applies: exactly the contract's.
  const handled = new Set();
  for (const file of server) {
    const text = read(file);
    for (const m of text.matchAll(/(?:operation_type|op_type) == "([a-z-]+)"/g)) handled.add(m[1]);
    for (const m of text.matchAll(/op_type in \(([^)]*)\)/g)) for (const t of m[1].matchAll(/"([a-z-]+)"/g)) handled.add(t[1]);
  }
  assert.deepEqual([...handled].sort(), [...ops].sort(), "operation types the server applies differ from protocol/legacy.contract.json");

  // Message types the server writes: each in the contract. JSON-schema and
  // provider words are not messages.
  const notMessages = new Set(["string", "object", "function", "integer", "array", "boolean", "number", "enabled",
    "text", "image_url", "input_text", "input_image", "function_call", "function_call_output"]);
  const sent = new Set();
  for (const file of server) {
    for (const m of read(file).matchAll(/["']type["']\s*:\s*["']([a-z_-]+)["']/g)) if (!notMessages.has(m[1])) sent.add(m[1]);
  }
  const unknownSent = [...sent].filter((t) => !ops.has(t) && !events.has(t)).sort();
  assert.deepEqual(unknownSent, [], "the server sends message types that protocol/legacy.contract.json does not list");

  // Types the browser checks on server messages: each in the contract.
  // These are the browser's own words, not messages.
  const local = new Set(["node", "connector", "del", "add", "same", "image", "text", "link", "touchcancel"]);
  const checked = new Set();
  for (const file of files.filter((f) => f.startsWith("app/"))) {
    for (const m of read(file).matchAll(/\.type === "([a-z-]+)"/g)) if (!local.has(m[1])) checked.add(m[1]);
  }
  const unknownChecked = [...checked].filter((t) => !ops.has(t) && !events.has(t)).sort();
  assert.deepEqual(unknownChecked, [], "the browser handles message types that protocol/legacy.contract.json does not list");

  // One protocol number, the same in all three places, until each module has its own.
  const client = /SYNC_PROTOCOL_VERSION = (\d+)/.exec(read("app/version.js"))?.[1];
  const floor = /MIN_CLIENT_VERSION = _read_int_env\("MDNOTES_MIN_CLIENT_VERSION", (\d+)/.exec(read("server/mdnotes_server.py"))?.[1];
  assert.equal(Number(client), contract.version, "app/version.js and protocol/legacy.contract.json disagree on the version");
  assert.equal(Number(floor), contract.version, "the server's MIN_CLIENT_VERSION and the contract disagree on the version");
});

test("the browser's copies of protocol data are up to date", async () => {
  const { COPIES, render } = await import("../../tools/protocol-sync.mjs");
  for (const copy of COPIES) {
    assert.equal(read(copy.to), render(copy), `${copy.to} is stale: run node tools/protocol-sync.mjs`);
  }
});

test("files stay within the size budget, and the kernel stays small and domain-free (rule 8)", () => {
  const now = oversized(files);
  const problems = [];
  for (const [file, lines] of Object.entries(now)) {
    const allowed = baseline.oversized[file];
    if (allowed === undefined) problems.push(`${file} has ${lines} lines (budget ${MAX_LINES}); split it by job`);
    else if (lines > allowed) problems.push(`${file} grew to ${lines} lines (recorded ${allowed}); it may only shrink`);
  }
  for (const file of files.filter((f) => /^(app\/kernel|server\/stilo\/kernel)\//.test(f))) {
    if (lineCount(file) > KERNEL_MAX_LINES) problems.push(`${file}: the kernel budget is ${KERNEL_MAX_LINES} lines`);
    const word = DOMAIN_WORDS.exec(read(file).replace(/\/\/.*$|#.*$/gm, ""));
    if (word) problems.push(`${file} mentions "${word[0]}": the kernel knows no domain; move that into a module`);
  }
  assert.deepEqual(problems, []);
});

test("the baseline lists nothing that has already been fixed", () => {
  const now = oversized(files);
  const stale = Object.keys(baseline.oversized).filter((file) => !(file in now) || now[file] < baseline.oversized[file]);
  const spelled = spellings(files);
  for (const [name, list] of Object.entries(baseline.spellings)) {
    for (const file of list) if (!spelled[name]?.includes(file)) stale.push(`${name} in ${file}`);
  }
  assert.deepEqual(stale, [], "run `node tools/structure-baseline.mjs` to lower the baseline after a cleanup");
});

// Which end a file belongs to, as a modules root.
function endOf(file) {
  return file.startsWith("server/") ? "server/stilo/modules" : "app/modules";
}

// Test files of one kind under a folder (for rule 6).
function codeFilesIn(dir, ext) {
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "__pycache__") walk(full); }
      else if (entry.name.endsWith(ext)) out.push(full.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, dir));
  return out;
}
