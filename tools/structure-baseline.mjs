#!/usr/bin/env node
// Records today's structure violations in tests/structure/baseline.json, so
// tests/structure/structure.test.mjs can insist they only shrink.
//
//   node tools/structure-baseline.mjs           lower the baseline after a cleanup
//   node tools/structure-baseline.mjs --init    write it from scratch (first time only)
//
// Without --init it refuses to add a file or raise a count: growing the
// baseline means a new violation, which should be fixed, not recorded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, codeFiles, loadModules, moduleOf, oversized, spellings } from "../tests/structure/scan.mjs";

const path = join(ROOT, "tests/structure/baseline.json");
const init = process.argv.includes("--init");
const files = codeFiles();
const twins = JSON.parse(readFileSync(join(ROOT, "spec/twins.json"), "utf8"));
// A name spelled inside the module that owns it is not a violation.
const modules = await loadModules();
const ownedBy = (file, name) => {
  const m = moduleOf(file, modules);
  return Boolean(m && (m.owns.names ?? []).includes(name));
};
const legacy = Object.fromEntries(Object.entries(spellings(files)).map(([name, list]) => [name, list.filter((file) => !ownedBy(file, name))]));
const now = { oversized: oversized(files), spellings: legacy, uncoveredTwins: twins.uncovered.length };

if (!init) {
  if (!existsSync(path)) {
    console.error("No baseline yet: run with --init once.");
    process.exit(1);
  }
  const old = JSON.parse(readFileSync(path, "utf8"));
  const grew = [];
  for (const [file, lines] of Object.entries(now.oversized)) {
    if (!(file in old.oversized)) grew.push(`${file} is newly over the size budget (${lines} lines)`);
    else if (lines > old.oversized[file]) grew.push(`${file} grew from ${old.oversized[file]} to ${lines} lines`);
  }
  for (const [name, list] of Object.entries(now.spellings)) {
    for (const file of list) if (!(old.spellings[name] ?? []).includes(file)) grew.push(`${file} newly spells ${name}`);
  }
  if (now.uncoveredTwins > old.uncoveredTwins) grew.push("more twins without a case table");
  if (grew.length) {
    console.error("The baseline may only shrink. Fix these instead of recording them:\n  " + grew.join("\n  "));
    process.exit(1);
  }
}

const sorted = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(path, JSON.stringify({
  about: "Structure violations that existed when the rules were introduced (2026-10-16). They may only shrink; see tools/structure-baseline.mjs.",
  oversized: sorted(now.oversized),
  spellings: sorted(now.spellings),
  uncoveredTwins: now.uncoveredTwins
}, null, 2) + "\n");
console.log(`Baseline written: ${Object.keys(now.oversized).length} oversized files, ` +
  `${Object.values(now.spellings).reduce((n, l) => n + l.length, 0)} legacy spellings, ${now.uncoveredTwins} uncovered twins.`);
