// Every test, as a release is checked: the release labels and the generated
// copies, the Node tests, every Python test, and with --browser the browser
// tests too (tests/*-browser.py: Playwright for Python and a Chromium; the
// desktop test also wants Electron, STILO_ELECTRON). Each test gets one line;
// what it printed is kept in a log folder, and a failure shows its end. A new
// test is found by its name, so no list here goes out of date.
//
// A browser test drives a real browser, so on a small or busy machine one can
// fail by timing alone. One that fails is run again by itself at the end: the
// report says so, and the run passes only if it then passes.
//
//   node tools/run-tests.mjs             # also npm run test:all, tests/run-tests.sh, tests\run-tests.bat
//   node tools/run-tests.mjs --browser   # with the browser tests
//
// PYTHON names the Python to use (python3, or python on Windows); for the
// browser tests it needs Playwright, a virtual environment's for instance.
import { spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const python = process.env.PYTHON || (windows ? "python" : "python3");
const withBrowser = process.argv.includes("--browser");
const LIMIT = 10 * 60 * 1000;  // one test's time; a browser test that hangs is stopped
const logs = await mkdtemp(join(tmpdir(), "stilo-tests-"));
let running = null;

// A test's own process group, so that stopping it also stops the browser it started.
function stop(child) {
  try {
    if (windows) child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    // it had already ended
  }
}

// Runs one command from the repository's root and keeps what it printed.
function run(name, command, args) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: root, detached: !windows });
    running = child;
    let output = "";
    const keep = (chunk) => { output += chunk; };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => { output += `\n(stopped after ${LIMIT / 60000} minutes)\n`; stop(child); }, LIMIT);
    let ended = false;
    const end = async (code) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      running = null;
      await writeFile(join(logs, `${name}.txt`), output);
      done({ passed: code === 0, output });
    };
    child.on("error", (error) => { output += `\n${error.message}\n`; void end(1); });
    child.on("close", (code) => void end(code));
  });
}

function tail(output, lines = 25) {
  return output.trimEnd().split("\n").slice(-lines).map((line) => `      ${line}`).join("\n");
}

async function testsNamed(pattern) {
  return (await readdir(join(root, "tests"))).filter((name) => pattern.test(name)).sort();
}

// Each in turn, one line each; the names of those that failed.
async function runEach(names, kind) {
  const failed = [];
  for (const name of names) {
    const { passed, output } = await run(name, python, ["-B", `tests/${name}`]);
    const skipped = /"skipped":\s*"([^"]*)"/.exec(output);
    if (!passed) failed.push(name);
    console.log(`  ${passed ? (skipped ? "skip" : "ok  ") : "FAIL"}  ${name}${skipped ? ` (${skipped[1]})` : ""}`);
    if (!passed) console.log(tail(output));
  }
  console.log(`${kind}: ${names.length - failed.length}/${names.length} passed`);
  return failed;
}

// Stopped (Ctrl+C), the run stops the test it is in, which is in a group of its own.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (running) stop(running);
    process.exit(130);
  });
}

let ok = true;
for (const [name, args] of [["release-labels", ["tools/release-version.mjs", "--check"]],
                            ["generated-copies", ["tools/protocol-sync.mjs", "--check"]]]) {
  const { passed, output } = await run(name, process.execPath, args);
  console.log(`${passed ? "ok  " : "FAIL"}  ${output.trim().split("\n").at(-1) || name.replace("-", " ")}`);  // a check that passes may say nothing
  ok &&= passed;
}

const node = await run("node", process.execPath, ["--test", "tests/"]);
const count = (word) => node.output.match(new RegExp(`^# ${word} (\\d+)$`, "m"))?.[1] ?? "?";
console.log(`node: ${count("pass")} passed, ${count("fail")} failed`);
if (!node.passed) console.log(node.output.split("\n").filter((line) => /^not ok/.test(line)).map((line) => `  ${line}`).join("\n"));
ok &&= node.passed;

ok = (await runEach([...await testsNamed(/\.test\.py$/), "backend-selftest.py"], "python")).length === 0 && ok;

if (withBrowser) {
  const failed = await runEach(await testsNamed(/-browser\.py$/), "browser");
  if (failed.length) console.log(`again, each by itself: ${failed.join(", ")}`);
  for (const name of failed) {
    const { passed, output } = await run(`${name}.again`, python, ["-B", `tests/${name}`]);
    console.log(`  ${passed ? "ok  " : "FAIL"}  ${name}${passed ? " (failed in the run, passed by itself)" : ""}`);
    if (!passed) console.log(tail(output));
    ok &&= passed;
  }
} else {
  console.log("browser: not run (add --browser)");
}

console.log(`\n${ok ? "All passed." : "FAILED."} What each test printed: ${logs}`);
process.exit(ok ? 0 : 1);
