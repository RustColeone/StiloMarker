// The ten structure rules (docs/ARCHITECTURE.md). Each failure says which
// rule broke and how to fix it. Today's violations are recorded in
// baseline.json and may only shrink: `node tools/structure-baseline.mjs`
// lowers it after a cleanup and refuses to raise it.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ROOT, GENERATED, codeFiles, codeOf, read, lineCount, oversized, spellings, jsImports, pyImports,
  loadModules, moduleOf, silentCatches, setters, mainGetters, KERNEL_MAX_LINES, DOMAIN_WORDS, MAX_LINES
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

test("the core never names an extension, and an extension reaches the app only through public APIs", () => {
  const exts = all.filter((m) => m.extension);
  const core = all.filter((m) => !m.extension && m.root === "app/modules");
  const problems = [];
  for (const m of exts) {
    const home = `extensions/${m.extension}/`;
    const manifest = json(`${home}extension.json`);
    const handles = [manifest.name, ...(manifest.fileTypes ?? []).flatMap((type) => [type.id, type.label])];
    const pattern = new RegExp(handles.map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[ -]/g, "[ _-]?")).join("|"), "i");
    for (const file of files.filter((f) => !f.startsWith(home) && !GENERATED.has(f))) {
      const hit = pattern.exec(codeOf(file));
      if (hit) problems.push(`${file} names the ${m.extension} extension ("${hit[0]}"): offer an extension point it can register into instead`);
    }
    for (const file of files.filter((f) => f.startsWith(home) && f.endsWith(".js"))) {
      for (const target of jsImports(file)) {
        if (target.startsWith(home) || target === "app/kernel/index.js") continue;
        if (!core.some((c) => target === `${c.dir}/index.js`)) problems.push(`${file} imports ${target}: an extension uses only the kernel and modules' index.js`);
      }
    }
    const top = Math.max(...core.map((c) => c.level));
    if (m.level <= top) problems.push(`${m.name} is on level ${m.level}: extensions sit above every module (level ${top + 1} or more)`);
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
  // Uses, not words: "its document" in a message is fine, document.querySelector is not.
  const jsIo = /\b(document|window|navigator)\.|\b(localStorage|sessionStorage|indexedDB)\b|\bfetch\(|new (WebSocket|EventSource|XMLHttpRequest)\b/;
  const pyIo = /^\s*(import|from)\s+(sqlite3|socket|subprocess|urllib|http|requests)\b|\bopen\(/m;
  const problems = [];
  for (const file of files) {
    const m = moduleOf(file, all);
    if (!m) continue;
    const layer = file.slice(m.dir.length + 1).split("/")[0];
    if (layer !== "model" && layer !== "service") continue;
    const io = file.endsWith(".py") ? pyIo : jsIo;
    if (io.test(codeOf(file))) problems.push(`${file} does input or output; move that into ${m.dir}/adapters/ behind a port`);
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
  // Operations and events: the legacy contract's, and each module contract's.
  const contract = json("protocol/legacy.contract.json");
  const modules = readdirSync(join(ROOT, "protocol")).filter((f) => f.endsWith(".contract.json") && f !== "legacy.contract.json")
    .map((f) => json(`protocol/${f}`));
  const ops = new Set(modules.flatMap((m) => m.operations?.types ?? []));
  const events = new Set([...contract.workspaceEvents.types, ...contract.agentTurnEvents.types,
    ...modules.flatMap((m) => m.events?.types ?? [])]);
  const server = files.filter((f) => f.startsWith("server/") && f.endsWith(".py"));

  // Operations the server applies: exactly the contract's.
  const handled = new Set();
  for (const file of server) {
    const text = read(file);
    // In the modules that apply operations, the type is called `kind`.
    const kind = /^server\/stilo\/modules\/(workspace|sync)\//.test(file) ? "|kind" : "";
    for (const m of text.matchAll(new RegExp(`(?:operation_type|op_type${kind}) == "([a-z-]+)"`, "g"))) handled.add(m[1]);
    for (const m of text.matchAll(new RegExp(`(?:op_type${kind}) in \\(([^)]*)\\)`, "g"))) for (const t of m[1].matchAll(/"([a-z-]+)"/g)) handled.add(t[1]);
    // Names a module spells once as constants (Workspace's PATCH_FILE = "patch-file").
    if (kind) for (const m of text.matchAll(/^[A-Z_, ]+ = ("[a-z-]+"(?:, "[a-z-]+")*)$/gm)) for (const t of m[1].matchAll(/"([a-z-]+)"/g)) handled.add(t[1]);
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
  for (const file of files.filter((f) => f.startsWith("app/") || f.startsWith("extensions/"))) {
    for (const m of read(file).matchAll(/\.type === "([a-z-]+)"/g)) if (!local.has(m[1])) checked.add(m[1]);
  }
  const unknownChecked = [...checked].filter((t) => !ops.has(t) && !events.has(t)).sort();
  assert.deepEqual(unknownChecked, [], "the browser handles message types that protocol/legacy.contract.json does not list");

  // Sync's version is read from its contract on both ends (the browser's copy is
  // checked below with the other protocol copies); nobody else writes it down.
  assert.ok(Number.isInteger(json("protocol/sync.contract.json").version));
});

test("each module's contract lists exactly the routes it serves, and only that module calls them (rule 7)", () => {
  const contracts = readdirSync(join(ROOT, "protocol")).filter((f) => f.endsWith(".contract.json") && f !== "legacy.contract.json");
  const problems = [];
  for (const name of contracts) {
    const contract = json(`protocol/${name}`);
    const where = `protocol/${name}`;
    if (!Number.isInteger(contract.version) || contract.version < 1) problems.push(`${where}: version must be a whole number from 1`);
    const serverDir = `server/stilo/modules/${contract.module.replaceAll("-", "_")}`;
    const browserDir = `app/modules/${contract.module.replaceAll("_", "-")}`;
    const listed = new Set(contract.routes.map((r) => `${r.method} ${r.path}`));
    const served = new Set();
    for (const file of files.filter((f) => f.startsWith(`${serverDir}/`))) {
      for (const m of codeOf(file).matchAll(/add_(?:stream_)?route\(\s*"(GET|POST)",\s*"([^"]+)"/g)) served.add(`${m[1]} ${m[2]}`);
    }
    const missing = [...listed].filter((r) => !served.has(r)), extra = [...served].filter((r) => !listed.has(r));
    if (missing.length || extra.length) problems.push(`${serverDir} serves ${[...served].join(", ") || "nothing"} but ${where} lists ${[...listed].join(", ")}`);
    for (const path of new Set(contract.routes.map((r) => r.path))) {
      const quoted = new RegExp(`["'\`}]${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`?]`);
      const spelled = files.filter((f) => quoted.test(codeOf(f)));
      const outside = spelled.filter((f) => !f.startsWith(`${serverDir}/`) && !f.startsWith(`${browserDir}/`));
      if (outside.length) problems.push(`${outside.join(", ")} call ${path}, which belongs to ${contract.module}: use its API`);
      if (existsSync(join(ROOT, browserDir)) && !spelled.some((f) => f.startsWith(`${browserDir}/`))) {
        problems.push(`${path} is in ${where} but ${browserDir} never calls it`);
      }
    }
  }
  assert.deepEqual(problems, []);
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

test("no catch swallows an error without a word (rule 9)", () => {
  const found = silentCatches(files).map((where) => `${where}: an empty catch hides the error. ` +
    "Handle it, or carry on with ignore(error, \"why\") (kernel) so it still reaches the trace or the server log");
  assert.deepEqual(found, []);
});

test("no code writes another file's variables, and main.js hands out fewer and fewer of them (rule 10)", () => {
  const found = setters(files).map((where) => `${where}: a setter lets other code write this file's variable, so nobody owns it. ` +
    "Give the state one owner (kernel createState) and change it through the owner's named actions, or keep it inside the one file that uses it");
  assert.deepEqual(found, []);
  const getters = mainGetters();
  assert.ok(getters <= baseline.mainGetters, `app/main.js hands out ${getters} getters (recorded ${baseline.mainGetters}); it may only shrink`);
});

test("the baseline lists nothing that has already been fixed", () => {
  const now = oversized(files);
  const stale = Object.keys(baseline.oversized).filter((file) => !(file in now) || now[file] < baseline.oversized[file]);
  const spelled = spellings(files);
  for (const [name, list] of Object.entries(baseline.spellings)) {
    for (const file of list) if (!spelled[name]?.includes(file)) stale.push(`${name} in ${file}`);
  }
  if (mainGetters() < baseline.mainGetters) stale.push(`main.js getters (${mainGetters()} now, ${baseline.mainGetters} recorded)`);
  assert.deepEqual(stale, [], "run `node tools/structure-baseline.mjs` to lower the baseline after a cleanup");
});

// Which end a file belongs to, as a modules root.
function endOf(file) {
  return file.startsWith("server/") ? "server/stilo/modules" : "app/modules"; // extensions are browser modules
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
