// Reads the source tree for the structure rules (see docs/ARCHITECTURE.md).
// Shared by structure.test.mjs and tools/structure-baseline.mjs, so the test
// and the baseline it compares against always measure the same way.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), "../.."));

// The shipped code. Tests, tools and docs may spell anything.
const SCOPE = ["app", "server", "index.html", "service-worker.js"];
const SKIP = new Set(["node_modules", "__pycache__", "data", "vendor"]);
const CODE = /\.(m?js|py|html|css)$/;

export const MAX_LINES = 800;
export const KERNEL_MAX_LINES = 300;

// Names that belong to exactly one owner (rule 4). Until a module owns one,
// the files that spell it today are recorded in baseline.json and may only
// shrink. The patterns skip look-alikes such as the CSS class ".bmap-node".
export const OWNED_NAMES = {
  // (?<!…): a property such as `state.bmap` or `view?.mtree` is not the extension.
  "file type .urldb": /(?<![\w$?)\]])\.urldb\b(?!-)/,
  "file type .mtree": /(?<![\w$?)\]])\.mtree\b(?!-)/,
  "file type .bmap": /(?<![\w$?)\]])\.bmap\b(?![-\w])/,
  "file type .persona.skill": /persona\\?\.skill/,
  "image extension list": /webp/,
  "operation update-file": /["']update-file["']/,
  "operation patch-file": /["']patch-file["']/,
  "operation replace-project": /["']replace-project["']/,
  "sync protocol number": /SYNC_PROTOCOL_VERSION|MIN_CLIENT_VERSION|minSyncVersion/,
  "account file": /whitelist\.json/,
  "access file": /access\.json/,
  "account prefs file": /user-prefs\.json/,
  "comments file": /comments\.json/,
  "chat database": /conversations\.sqlite/,
};

// Words the kernel may never contain: it knows no domain (Module design, rule 8).
export const DOMAIN_WORDS = /\b(file|folder|project|workspace|chat|persona|character|agent|comment|snapshot|backup|account|team)s?\b/i;

export function rel(path) {
  return relative(ROOT, path).split("\\").join("/");
}

export function codeFiles() {
  const out = [];
  const walk = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) if (!SKIP.has(name)) walk(join(path, name));
    } else if (CODE.test(path)) {
      out.push(rel(path));
    }
  };
  for (const entry of SCOPE) {
    const path = join(ROOT, entry);
    if (existsSync(path)) walk(path);
  }
  return out.sort();
}

export function read(file) {
  return readFileSync(join(ROOT, file), "utf8");
}

export function lineCount(file) {
  const text = read(file);
  return text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// Files over the size budget, with their line counts (rule 8).
export function oversized(files = codeFiles()) {
  const out = {};
  for (const file of files) {
    if (file.endsWith(".css") || file.endsWith(".html")) continue; // flat by nature
    const lines = lineCount(file);
    if (lines > MAX_LINES) out[file] = lines;
  }
  return out;
}

// A file's code without its comments: a comment that explains "the .bmap
// format" is not knowledge of the format, a string like "Select a .mtree
// file" is. Approximate on purpose (a "//" inside a string survives only when
// it follows a ":" as in a URL), which errs towards counting.
export function codeOf(file) {
  const text = read(file);
  if (file.endsWith(".py")) return text.replace(/^\s*#.*$/gm, "").replace(/\s#\s.*$/gm, "");
  if (file.endsWith(".html")) return text.replace(/<!--[\s\S]*?-->/g, "");
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// For each owned name, the files whose code spells it.
export function spellings(files = codeFiles()) {
  const out = {};
  for (const [name, pattern] of Object.entries(OWNED_NAMES)) {
    out[name] = files.filter((file) => pattern.test(codeOf(file)));
  }
  return out;
}

// Relative imports of a JavaScript file, resolved to repo paths.
export function jsImports(file) {
  const text = read(file);
  const out = [];
  for (const m of text.matchAll(/(?:^|\s)(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)|^import\s+["'](\.[^"']+)["']/gm)) {
    const spec = m[1] ?? m[2] ?? m[3];
    out.push(rel(join(ROOT, dirname(file), spec)));
  }
  return out;
}

// Imports of a Python file inside the server package, as dotted names.
export function pyImports(file) {
  const out = [];
  for (const m of read(file).matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

// Modules. A browser module is a folder under app/modules whose index.js
// exports defineModule({...}) as its default: the definition is its only
// manifest. A server module is a folder under server/stilo/modules with a
// module.json, which its __init__.py also reads. Importing a browser
// module's index.js must not touch the page, so this can run in Node.
export const MODULE_ROOTS = ["app/modules", "server/stilo/modules"];

function moduleDirs(root) {
  const base = join(ROOT, root);
  if (!existsSync(base)) return [];
  const out = [];
  const visit = (dir, depth) => {
    const has = (name) => existsSync(join(dir, name));
    if (depth > 0 && (has("module.json") || (root === "app/modules" && has("index.js")))) {
      out.push(dir);
      return; // a module's own sub-folders are its layers, not modules
    }
    for (const name of readdirSync(dir)) {
      if (!SKIP.has(name) && statSync(join(dir, name)).isDirectory()) visit(join(dir, name), depth + 1);
    }
  };
  visit(base, 0);
  return out;
}

export async function loadModules() {
  const out = [];
  for (const dir of moduleDirs("app/modules")) {
    const definition = (await import(pathToFileURL(join(dir, "index.js")).href)).default;
    if (!definition?.name) throw new Error(`${rel(dir)}/index.js must export defineModule({...}) as its default`);
    const { name, level, uses, owns } = definition;
    out.push({ root: "app/modules", dir: rel(dir), name, level, uses: [...uses], owns: owns ?? {} });
  }
  for (const dir of moduleDirs("server/stilo/modules")) {
    out.push({ root: "server/stilo/modules", dir: rel(dir), ...JSON.parse(readFileSync(join(dir, "module.json"), "utf8")) });
  }
  return out;
}

export function moduleOf(file, all) {
  return all.find((m) => file === m.dir || file.startsWith(`${m.dir}/`)) ?? null;
}
