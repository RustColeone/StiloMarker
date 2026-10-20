#!/usr/bin/env node
// Writes the browser's copies of the shared protocol data, which plain
// browsers cannot import as JSON:
//   protocol/file-types.json (+ each extension's fileTypes) -> app/modules/file-types/model/builtin-types.js
//   extensions/*/extension.json -> app/extensions.js (the browser modules to start),
//                                  extensions/offline.js (their files, for the service worker)
//                                  app/modules/shell/model/contributed-settings.js (their settings)
//                                  and app/modules/shell/model/contributed-themes.js (their themes)
//   protocol/sync.contract.json -> app/modules/sync/model/contract.js (its version)
// Run after editing a protocol file; tests/structure fails while a copy is stale.
//   node tools/protocol-sync.mjs           write the copies
//   node tools/protocol-sync.mjs --check   exit 1 if a copy is stale
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every extension's manifest, by folder name.
export function extensions() {
  const base = join(ROOT, "extensions");
  if (!existsSync(base)) return [];
  return readdirSync(base).sort().filter((name) => existsSync(join(base, name, "extension.json")))
    .map((name) => ({ folder: name, ...JSON.parse(readFileSync(join(base, name, "extension.json"), "utf8")) }));
}

const extensionTypes = () => extensions().flatMap((extension) =>
  (extension.fileTypes ?? []).map((entry) => ({ ...entry, extension: extension.name })));

// The settings extensions contribute: { key, default, field?, extension }.
const contributedSettings = () => extensions().flatMap((extension) =>
  (extension.contributes?.settings ?? []).map((entry) => ({ ...entry, extension: extension.name })));

// The themes extensions contribute: { id, label, base, colors, extension }.
const contributedThemes = () => extensions().flatMap((extension) =>
  (extension.contributes?.themes ?? []).map((entry) => ({ ...entry, extension: extension.name })));

export const COPIES = [
  { from: "protocol/file-types.json", to: "app/modules/file-types/model/builtin-types.js", pick: (data) => [...data.types, ...extensionTypes()] },
  { from: "protocol/sync.contract.json", to: "app/modules/sync/model/contract.js", pick: (data) => ({ version: data.version }) },
  { from: "extensions/*/extension.json", to: "app/modules/shell/model/contributed-settings.js", text: () =>
    `export default Object.freeze(${JSON.stringify(contributedSettings(), null, 2)});\n` },
  { from: "extensions/*/extension.json", to: "app/modules/shell/model/contributed-themes.js", text: () =>
    `export default Object.freeze(${JSON.stringify(contributedThemes(), null, 2)});\n` },
  { from: "extensions/*/extension.json", to: "app/extensions.js", text: () => {
    const started = extensions().filter((extension) => extension.browser);
    return started.map((extension, index) => `import extension${index} from "../extensions/${extension.folder}/${extension.browser}";\n`).join("") +
      `\n// The extensions' browser modules, which main.js starts after the core's.\n` +
      `export default Object.freeze([${started.map((_, index) => `extension${index}`).join(", ")}]);\n`;
  } }
];

// Every file an extension serves (for the offline cache), from its folder.
function servedFiles(folder) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|css|svg|png)$/.test(entry.name)) out.push(`./${path}`);
    }
  };
  walk(`extensions/${folder}`);
  return out.sort();
}
COPIES.push({ from: "extensions/*/extension.json", to: "extensions/offline.js", text: () =>
  `self.EXTENSION_FILES = ${JSON.stringify(["./extensions/offline.js", ...extensions().flatMap((extension) => servedFiles(extension.folder))], null, 2)};\n` });

export function render(copy) {
  const head = `// Written by tools/protocol-sync.mjs from ${copy.from}. Do not edit:\n` +
    `// change ${copy.from} and run the tool.\n`;
  if (copy.text) return head + copy.text();
  const data = JSON.parse(readFileSync(join(ROOT, copy.from), "utf8"));
  return head + `export default Object.freeze(${JSON.stringify(copy.pick(data), null, 2)});\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const copy of COPIES) {
    const want = render(copy);
    let have = "";
    try { have = readFileSync(join(ROOT, copy.to), "utf8"); } catch { /* missing */ }
    if (have === want) continue;
    stale += 1;
    if (check) console.error(`${copy.to} is stale: run node tools/protocol-sync.mjs`);
    else { writeFileSync(join(ROOT, copy.to), want); console.log(`wrote ${copy.to}`); }
  }
  process.exit(check && stale ? 1 : 0);
}
