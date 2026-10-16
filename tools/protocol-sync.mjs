#!/usr/bin/env node
// Writes the browser's copies of the shared protocol data, which plain
// browsers cannot import as JSON:
//   protocol/file-types.json -> app/modules/file-types/model/builtin-types.js
// Run after editing a protocol file; tests/structure fails while a copy is stale.
//   node tools/protocol-sync.mjs           write the copies
//   node tools/protocol-sync.mjs --check   exit 1 if a copy is stale
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const COPIES = [
  { from: "protocol/file-types.json", to: "app/modules/file-types/model/builtin-types.js", pick: (data) => data.types }
];

export function render(copy) {
  const data = JSON.parse(readFileSync(join(ROOT, copy.from), "utf8"));
  return `// Written by tools/protocol-sync.mjs from ${copy.from}. Do not edit:\n` +
    `// change ${copy.from} and run the tool.\n` +
    `export default Object.freeze(${JSON.stringify(copy.pick(data), null, 2)});\n`;
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
