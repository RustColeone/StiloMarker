// Self-test entry point.
//
// The actual assertions now live as modular unit tests under `tests/`. This
// script runs the built-in Node test runner over that folder and preserves the
// historical "Self-test passed." success line that other tooling greps for.
//
//   node tools/selftest.mjs   # this script
//   npm run selftest          # same, via package.json
//   node --test tests/        # run the raw suite directly

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const testsDir = resolve(root, "tests");

const child = spawn(process.execPath, ["--test", testsDir], {
  cwd: root,
  stdio: "inherit"
});

child.on("exit", (code) => {
  if (code === 0) {
    console.log("Self-test passed.");
    process.exit(0);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
