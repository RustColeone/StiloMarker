// The extension API (protocol/extension-api.json, described in
// docs/EXTENSIONS.md): every extension declares the version and uses only
// what the list names (its static imports, the modules it uses, their
// members, and what editor.parts() and workspace.project() return); all of
// it still exists in the modules, and the page describes all of it.
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
const all = extensions().map((extension) => ({ ...extension, files: extensionFiles(`extensions/${extension.folder}`) }));

// The names an import statement brings in ({ a, b as c } -> a, b; default -> "default").
function imports(file) {
  const out = [];
  for (const m of codeOf(file).matchAll(/import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.[^"']+)["']/g)) {
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

test("extension API: an extension imports only what is listed", () => {
  const problems = [];
  for (const extension of all) {
    for (const file of extension.files) {
      for (const { target, names } of imports(file)) {
        const module = target.match(/^app\/modules\/([\w-]+)\/index\.js$/)?.[1];
        const allowed = target === "app/kernel/index.js" ? api.kernel.static : module ? modules[module]?.static ?? [] : null;
        if (allowed === null) continue; // its own files (anything else of the app is refused by the structure test)
        for (const name of names) if (!allowed.includes(name)) problems.push(`${file} imports ${name} from ${target}, which the API does not list`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("extension API: an extension uses only the listed modules and members", () => {
  const problems = [];
  for (const extension of all) {
    for (const file of extension.files) {
      const code = codeOf(file);
      // The modules it starts with, and what the module context offers.
      if (/\bdefineModule\(/.test(code)) {
        for (const m of code.matchAll(/uses:\s*\[([^\]]*)\]/g)) for (const name of m[1].match(/[\w-]+/g) ?? []) {
          if (!modules[name]) problems.push(`${file} uses the ${name} module, which the API does not list`);
        }
        for (const m of code.matchAll(/(?<![\w$.])ctx\.(\w+)/g)) {
          if (!api.kernel.context.includes(m[1])) problems.push(`${file} calls ctx.${m[1]}, which the API does not list`);
        }
      }
      for (const m of code.matchAll(/ctx\.use\(\s*["']([\w-]+)["']\s*\)(?:\??\.(\w+))?/g)) {
        if (!modules[m[1]]) problems.push(`${file} uses the ${m[1]} module, which the API does not list`);
        else if (m[2] && !modules[m[1]].members.includes(m[2])) problems.push(`${file} calls ${m[1]}.${m[2]}, which the API does not list`);
      }
      // Each module's API by its alias (a property of something else, x.types, is not it).
      for (const [name, module] of Object.entries(modules)) {
        for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${module.alias}\\??\\.(\\w+)`, "g"))) {
          if (!module.members.includes(m[1])) problems.push(`${file} calls ${module.alias}.${m[1]} (${name}), which the API does not list`);
        }
      }
      // What editor.parts() and workspace.project() return, called at once or kept in a variable.
      for (const [name, member, listed] of [["editor", "parts", modules.editor.parts], ["workspace", "project", modules.workspace.project]]) {
        const call = `${modules[name].alias}\\.${member}\\(\\)`;
        // Kept in a variable: the store itself (`const store = workspace.project();`), not what a longer chain gives.
        const names = [...code.matchAll(new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*${call}\\s*[;,)\\n]`, "g"))].map((m) => m[1]);
        const uses = [...code.matchAll(new RegExp(`${call}\\??\\.(\\w+)`, "g"))].map((m) => m[1]);
        for (const alias of names) uses.push(...[...code.matchAll(new RegExp(`(?<![\\w$.])${alias}\\??\\.(\\w+)`, "g"))].map((m) => m[1]));
        for (const used of uses) if (!listed.includes(used)) problems.push(`${file} calls ${name}.${member}().${used}, which the API does not list`);
      }
    }
  }
  assert.deepEqual(problems, []);
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
    const code = folderCode(`app/modules/${name}`);
    for (const member of [...module.members, ...(module.parts ?? []), ...(module.project ?? [])]) {
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
