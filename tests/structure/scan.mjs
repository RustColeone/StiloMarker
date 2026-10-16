// Reads the source tree for the structure rules (see docs/ARCHITECTURE.md).
// Shared by structure.test.mjs and tools/structure-baseline.mjs, so the test
// and the baseline it compares against always measure the same way.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

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
  "file type .urldb": /\.urldb\b(?!-)/,
  "file type .mtree": /\.mtree\b(?!-)/,
  "file type .bmap": /\.bmap\b(?![-\w])/,
  "file type .persona.skill": /persona\\?\.skill/,
  "image extension list": /webp/,
  "operation update-file": /["']update-file["']/,
  "operation patch-file": /["']patch-file["']/,
  "operation replace-project": /["']replace-project["']/,
  "sync protocol number": /SYNC_PROTOCOL_VERSION|MIN_CLIENT_VERSION|minSyncVersion/,
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

// For each owned name, the files that spell it.
export function spellings(files = codeFiles()) {
  const out = {};
  for (const [name, pattern] of Object.entries(OWNED_NAMES)) {
    out[name] = files.filter((file) => pattern.test(read(file)));
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

// Modules: every folder under a modules root with a module.json.
export const MODULE_ROOTS = ["app/modules", "server/stilo/modules"];

export function modules() {
  const out = [];
  for (const root of MODULE_ROOTS) {
    const base = join(ROOT, root);
    if (!existsSync(base)) continue;
    const visit = (dir) => {
      const manifest = join(dir, "module.json");
      if (existsSync(manifest)) {
        out.push({ root, dir: rel(dir), ...JSON.parse(readFileSync(manifest, "utf8")) });
        return; // a module's own sub-folders are its layers, not modules
      }
      for (const name of readdirSync(dir)) {
        if (!SKIP.has(name) && statSync(join(dir, name)).isDirectory()) visit(join(dir, name));
      }
    };
    visit(base);
  }
  return out;
}

export function moduleOf(file, all = modules()) {
  return all.find((m) => file === m.dir || file.startsWith(`${m.dir}/`)) ?? null;
}
