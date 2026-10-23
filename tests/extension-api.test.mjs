// The extension API (protocol/extension-api.json, described in
// docs/EXTENSIONS.md): every extension declares the version and uses only
// what the list names (its static imports, the modules it uses, their
// members, and what editor.parts() and workspace.project() return); all of
// it still exists in the modules, and the page describes all of it. A use the
// test cannot read (a module's API reached by brackets, a namespace or
// dynamic import of the app) is refused, so nothing passes unread: a module's
// API under another name, destructured, over lines, the project store kept
// in a variable or a getter, the module context destructured are all read.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT, codeOf, read, rel } from "./structure/scan.mjs";
import { EXTENSION_API, checkManifest, extensions } from "../tools/protocol-sync.mjs";

const api = JSON.parse(read("protocol/extension-api.json"));
const modules = api.modules;

// Every .js file of an extension (its own; the libraries it ships aside).
function extensionFiles(folder) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(ROOT, path)).isDirectory()) { if (name !== "vendor") walk(path); }
      else if (name.endsWith(".js")) out.push(path);
    }
  };
  if (existsSync(join(ROOT, folder))) walk(folder);
  return out;
}
const all = extensions({ strict: false }).map((extension) => ({ ...extension, files: extensionFiles(`extensions/${extension.folder}`) }));

// The names an import statement brings in ({ a, b as c } -> a, b; default -> "default").
function imports(file, code) {
  const out = [];
  for (const m of code.matchAll(/import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = rel(join(ROOT, dirname(file), m[3]));
    const names = (m[2] ?? "").split(",").map((part) => part.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    if (m[1]) names.push("default");
    out.push({ target, names });
  }
  return out;
}

// The names a module's index.js exports (following `export * from`).
function exportsOf(file) {
  const text = codeOf(file);
  const names = new Set();
  for (const m of text.matchAll(/export\s*\*\s*from\s*["'](\.[^"']+)["']/g)) {
    for (const name of exportsOf(rel(join(ROOT, dirname(file), m[1])))) names.add(name);
  }
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) names.add(name);
  }
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+(\w+)/g)) names.add(m[1]);
  return names;
}

const word = (name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, "\\$")}(?![\\w$])`);

test("extension API: every extension declares the version, and its manifest only what the API reads", () => {
  const problems = [];
  for (const extension of all) {
    const where = `extensions/${extension.folder}/extension.json`;
    if (extension.api !== api.version) problems.push(`${where} declares api ${extension.api}, not ${api.version}`);
    for (const key of Object.keys(extension).filter((key) => !["folder", "files"].includes(key))) {
      if (!api.manifest.includes(key)) problems.push(`${where}: "${key}" is not a manifest field of the API`);
    }
    for (const key of Object.keys(extension.contributes ?? {})) {
      if (!api.contributes.includes(key)) problems.push(`${where}: contributes "${key}", which the API does not read`);
    }
  }
  assert.deepEqual(problems, []);
});

test("extension API: an extension written for another version is refused when the copies are written", () => {
  assert.equal(EXTENSION_API, api.version);
  assert.doesNotThrow(() => checkManifest("fine", { name: "fine", api: api.version }));
  assert.throws(() => checkManifest("newer", { name: "newer", api: api.version + 1 }), /extensions\/newer is written for extension API 2; this app offers 1/);
  assert.throws(() => checkManifest("old", { name: "old" }), /extension API \(none\)/);
});

// What a file of an extension imports that the API does not list (or that
// the test cannot read: all of a module, or a module when it runs).
function importProblems(file, code) {
  const problems = [];
  const ofApp = (path) => rel(join(ROOT, dirname(file), path)).startsWith("app/");
  for (const { target, names } of imports(file, code)) {
    const module = target.match(/^app\/modules\/([\w-]+)\/index\.js$/)?.[1];
    const allowed = target === "app/kernel/index.js" ? api.kernel.static : module ? modules[module]?.static ?? [] : null;
    if (allowed === null) continue; // its own files (anything else of the app is refused by the structure test)
    for (const name of names) if (!allowed.includes(name)) problems.push(`${file} imports ${name} from ${target}, which the API does not list`);
  }
  for (const m of code.matchAll(/import\s*\*\s*as\s+\w+\s+from\s*["'](\.[^"']+)["']/g)) {
    if (ofApp(m[1])) problems.push(`${file} imports all of ${m[1]}: import the names it uses (the API lists them)`);
  }
  for (const m of code.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)) {
    if (ofApp(m[1])) problems.push(`${file} imports ${m[1]} when it runs: import the names it uses (the API lists them)`);
  }
  return problems;
}

test("extension API: an extension imports only what is listed", () => {
  const problems = all.flatMap((extension) => extension.files.flatMap((file) => importProblems(file, codeOf(file))));
  assert.deepEqual(problems, []);
});

// The names in a destructuring pattern's braces ({ a, b: c, ...d } -> a, b; d is everything else).
const destructured = (inside) => inside.split(",").map((part) => part.trim()).filter(Boolean)
  .map((part) => (part.startsWith("...") ? "..." : part.split(/\s*[:=]\s*/)[0]));

// What editor.parts() and workspace.project() return, kept in a name: a
// variable (`const store = workspace.project();`, not what a longer chain
// gives) or a function (`const store = () => workspace.project();`), read in
// its file; or a getter (`get controller() { return workspace.project(); }`),
// read wherever the extension reads that name (x.controller too).
function keptIn(code, call) {
  const kept = { names: [], functions: [], getters: [] };
  for (const m of code.matchAll(new RegExp(`(?:const|let|var|,)\\s*(\\w+)\\s*=\\s*${call}\\s*[;,)\\n]`, "g"))) kept.names.push(m[1]);
  for (const m of code.matchAll(new RegExp(`get\\s+(\\w+)\\s*\\(\\)\\s*\\{\\s*return\\s+${call}\\s*;?\\s*\\}`, "g"))) kept.getters.push(m[1]);
  for (const m of code.matchAll(new RegExp(`(?:const|let|var|,)\\s*(\\w+)\\s*=\\s*\\(\\)\\s*=>\\s*${call}\\s*[;,)\\n]`, "g"))) kept.functions.push(m[1]);
  return kept;
}

// What an extension's files ([[file, code]]) use of the modules that the API
// does not list (or that the test cannot read).
function memberProblems(codes) {
  const problems = [];
  // Members after a name: name.member, name?.member, over lines too.
  const after = (name) => new RegExp(`(?<![\\w$.])${name}\\s*\\??\\.\\s*(\\w+)`, "g");
  const brackets = (name) => new RegExp(`(?<![\\w$.])${name}\\s*(?:\\?\\.)?\\[`);
  {
    // The project store and the editor's parts (a getter's name is the extension's, read in every file).
    const stores = ["editor", "workspace"].map((name) => {
      const member = name === "editor" ? "parts" : "project";
      const call = `${modules[name].alias}\\s*\\.\\s*${member}\\(\\)`;
      const getters = codes.flatMap(([, code]) => keptIn(code, call).getters);
      return { name, member, call, getters, listed: modules[name][member] };
    });
    for (const [file, code] of codes) {
      // The modules it starts with, and what the module context offers.
      if (/\bdefineModule\(/.test(code)) {
        for (const m of code.matchAll(/uses:\s*\[([^\]]*)\]/g)) for (const name of m[1].match(/[\w-]+/g) ?? []) {
          if (!modules[name]) problems.push(`${file} uses the ${name} module, which the API does not list`);
        }
      }
      // ctx is the module context where the module is defined or used through it (elsewhere, often a canvas's).
      if (/\bdefineModule\(|ctx\s*\.\s*use\(/.test(code)) {
        const context = [...code.matchAll(after("ctx"))].map((m) => m[1]);
        for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*ctx\b(?!\s*\.)|start\s*\(\s*\{([^{}]*)\}\s*\)/g)) context.push(...destructured(m[1] ?? m[2]));
        for (const name of new Set(context)) if (!api.kernel.context.includes(name)) problems.push(`${file} uses ctx.${name}, which the API does not list`);
        if (brackets("ctx").test(code)) problems.push(`${file} reaches the module context by brackets, which the test cannot read`);
      }
      // Each module's API: by its alias, or any name bound to ctx.use("…"); used, or destructured.
      const names = Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, new Set([module.alias])]));
      for (const m of code.matchAll(/ctx\s*\.\s*use\(\s*["']([\w-]+)["']\s*\)/g)) {
        if (!modules[m[1]]) problems.push(`${file} uses the ${m[1]} module, which the API does not list`);
      }
      for (const m of code.matchAll(/(?:const|let|var|,)\s*(\w+)\s*=\s*ctx\s*\.\s*use\(\s*["']([\w-]+)["']\s*\)/g)) names[m[2]]?.add(m[1]);
      for (const [name, module] of Object.entries(modules)) {
        const members = [...code.matchAll(new RegExp(`ctx\\s*\\.\\s*use\\(\\s*["']${name}["']\\s*\\)\\s*\\??\\.\\s*(\\w+)`, "g"))].map((m) => m[1]);
        for (const m of code.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*ctx\\s*\\.\\s*use\\(\\s*["']${name}["']\\s*\\)`, "g"))) members.push(...destructured(m[1]));
        for (const alias of names[name]) {
          members.push(...[...code.matchAll(after(alias))].map((m) => m[1]));
          for (const m of code.matchAll(new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${alias}\\s*[;,)\\n]`, "g"))) members.push(...destructured(m[1]));
          if (brackets(alias).test(code)) problems.push(`${file} reaches ${alias} (${name}) by brackets, which the test cannot read`);
        }
        for (const member of new Set(members)) if (!module.members.includes(member)) problems.push(`${file} calls ${module.alias}.${member} (${name}), which the API does not list`);
      }
      // What editor.parts() and workspace.project() return: called at once, or kept.
      for (const { name, member, call, getters, listed } of stores) {
        const kept = keptIn(code, call);
        const uses = [...code.matchAll(new RegExp(`${call}\\s*\\??\\.\\s*(\\w+)`, "g"))].map((m) => m[1]);
        for (const keptName of kept.names) uses.push(...[...code.matchAll(after(keptName))].map((m) => m[1]));
        for (const keptName of getters) uses.push(...[...code.matchAll(new RegExp(`(?<![\\w$])${keptName}\\s*\\??\\.\\s*(\\w+)`, "g"))].map((m) => m[1]));
        for (const keptName of kept.functions) uses.push(...[...code.matchAll(new RegExp(`(?<![\\w$.])${keptName}\\(\\)\\s*\\??\\.\\s*(\\w+)`, "g"))].map((m) => m[1]));
        for (const used of new Set(uses)) if (!listed.includes(used)) problems.push(`${file} calls ${name}.${member}().${used}, which the API does not list`);
      }
    }
  }
  return problems;
}

test("extension API: an extension uses only the listed modules and members", () => {
  const problems = all.flatMap((extension) => memberProblems(extension.files.map((file) => [file, codeOf(file)])));
  assert.deepEqual(problems, []);
});

// The test reads every way of reaching what is not listed: made-up files, each a way.
test("extension API: the test reads every way of reaching what is not listed", () => {
  const probe = "extensions/probe/browser";
  const files = [
    [`${probe}/index.js`, `import { defineModule } from "../../../app/kernel/index.js";
      export default defineModule({ name: "probe", uses: ["workspace", "secrets"], start(ctx) {
        const ws = ctx.use("workspace"), shell = ctx.use("shell");
        ws.hidden(); shell
          .alsoHidden();
        const { previews, stash } = ctx.use("editor");
        ctx.peek();
        workspace["write"];
        const app = { get controller() { return workspace.project(); } };
        const store = () => workspace.project();
        store().hiddenToo();
        const parts = editor.parts();
        parts.secretPart();
      } });`],
    [`${probe}/adapters/tools.js`, `export function tools({ controller }) { controller.getProject(); controller.wipe(); }`],
    [`${probe}/adapters/start.js`, `import { defineModule } from "../../../../app/kernel/index.js";
      defineModule({ name: "two", start({ use, sneak }) { const { files } = workspace; } });`],
    [`${probe}/adapters/canvas.js`, `export function draw(canvas) { const ctx = canvas.getContext("2d"); ctx.fillRect(0, 0, 1, 1); }`]
  ];
  const found = memberProblems(files);
  for (const expected of [
    "index.js uses the secrets module", "index.js calls workspace.hidden (workspace)", "index.js calls shell.alsoHidden (shell)",
    "index.js calls editor.stash (editor)", "index.js uses ctx.peek", "index.js reaches workspace (workspace) by brackets",
    "index.js calls workspace.project().hiddenToo", "index.js calls editor.parts().secretPart",
    "tools.js calls workspace.project().wipe", "start.js uses ctx.sneak", "start.js calls workspace.files (workspace)"
  ]) assert.ok(found.some((problem) => problem.includes(expected)), `${expected}: not found in ${JSON.stringify(found, null, 1)}`);
  assert.ok(!found.some((problem) => /getProject|fillRect|previews|ctx\.(use|stash)/.test(problem)), `listed uses, and a canvas's ctx, pass: ${JSON.stringify(found)}`);
  const imported = importProblems(`${probe}/index.js`, `import * as all from "../../../app/modules/workspace/index.js";
    import { getPath, secretHelper } from "../../../app/modules/workspace/index.js";
    const later = await import("../../../app/modules/shell/index.js");
    import { mine } from "./model/mine.js";`);
  assert.equal(imported.length, 3, JSON.stringify(imported));
  assert.ok(imported[0].includes("imports secretHelper") && imported[1].includes("imports all of") && imported[2].includes("when it runs"), JSON.stringify(imported));
});

test("extension API: everything listed still exists", () => {
  const problems = [];
  const kernelExports = exportsOf("app/kernel/index.js");
  for (const name of api.kernel.static) if (!kernelExports.has(name)) problems.push(`the kernel no longer exports ${name}`);
  const kernelCode = readdirSync(join(ROOT, "app/kernel")).filter((f) => f.endsWith(".js")).map((f) => codeOf(`app/kernel/${f}`)).join("\n");
  for (const name of api.kernel.context) if (!new RegExp(`\\b${name}\\s*[(:]`).test(kernelCode)) problems.push(`the module context no longer offers ${name}`);
  const folderCode = (folder) => {
    const out = [];
    const walk = (dir) => {
      for (const entry of readdirSync(join(ROOT, dir))) {
        const path = `${dir}/${entry}`;
        if (statSync(join(ROOT, path)).isDirectory()) walk(path);
        else if (entry.endsWith(".js")) out.push(codeOf(path));
      }
    };
    walk(folder);
    return out.join("\n");
  };
  for (const [name, module] of Object.entries(modules)) {
    const index = `app/modules/${name}/index.js`;
    const exported = exportsOf(index);
    for (const member of module.static ?? []) if (!exported.has(member)) problems.push(`${index} no longer exports ${member}`);
    // A member is the API object's (its index.js, where the module returns it;
    // one that spreads an object made in another file, there); what
    // editor.parts() and workspace.project() return is made elsewhere in the module.
    const api = codeOf(index);
    const code = folderCode(`app/modules/${name}`);
    const spreads = /return\s*\{[^}]*\.\.\.\w+/.test(api);
    for (const member of module.members) {
      if (!new RegExp(`(?<![\\w$.])${member}\\s*[:(,}]`).test(spreads ? code : api)) problems.push(`${index} no longer offers ${member}`);
    }
    for (const member of [...(module.parts ?? []), ...(module.project ?? [])]) {
      if (!word(member).test(code)) problems.push(`app/modules/${name} no longer has ${member}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("extension API: docs/EXTENSIONS.md describes all of it", () => {
  const page = read("docs/EXTENSIONS.md");
  const named = [...api.manifest, ...api.contributes, ...api.kernel.static, ...api.kernel.context,
    ...Object.values(modules).flatMap((module) => [module.alias, ...module.members, ...(module.static ?? []), ...(module.parts ?? []), ...(module.project ?? [])])];
  const missing = [...new Set(named)].filter((name) => !word(name).test(page));
  assert.deepEqual(missing, [], "named in protocol/extension-api.json but not on the page");
  assert.match(page, new RegExp(`version ${api.version}\\b`), "the page names the version");
});
