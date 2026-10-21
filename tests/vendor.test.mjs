// The libraries served with the app: each file is the one vendor/README.md
// lists (version folder, SHA-256, licence beside it), the code loads exactly
// those, and the service worker keeps exactly those for offline use.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const rows = read("vendor/README.md").toString().split("\n").filter((line) => /^\| (MathJax|Mermaid) \|/.test(line))
  .map((line) => line.split("|").map((cell) => cell.trim().replace(/`/g, "")))
  .map(([, name, version, file, , sha]) => ({ name, version, file, sha }));
const [mathjax, mermaid] = rows;

test("vendor: each library is the file its README lists", () => {
  assert.deepEqual(rows.map((row) => row.name), ["MathJax", "Mermaid"]);
  for (const { file, version, sha } of rows) {
    assert.ok(file.includes(`/${version}/`), `${file} sits in its version's folder`);
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} exists`);
    assert.equal(createHash("sha256").update(read(file)).digest("hex"), sha, `${file} is the listed file`);
    assert.ok(existsSync(new URL(`../${file.slice(0, file.lastIndexOf("/"))}/LICENSE`, import.meta.url)), "its licence is beside it");
  }
  assert.ok(mathjax.file.startsWith("vendor/"), "a core library in vendor/");
  assert.ok(mermaid.file.startsWith("extensions/mermaid/"), "an extension's library in its own folder");
});

test("vendor: the code loads exactly the listed files, from the app, never a CDN", () => {
  const preview = read("app/modules/editor/adapters/preview.js").toString();
  const library = read("extensions/mermaid/browser/adapters/library.js").toString();
  assert.ok(preview.includes(`"./${mathjax.file}"`));
  assert.ok(library.includes(`"../${mermaid.file.replace("extensions/mermaid/browser/", "")}"`));
  for (const source of [preview, library]) assert.doesNotMatch(source, /cdn\.jsdelivr\.net|unpkg\.com/);
});

test("vendor: the service worker keeps exactly the listed files for offline use", () => {
  const worker = read("service-worker.js").toString();
  const core = JSON.parse(worker.match(/const VENDOR_FILES = (\[[^\]]*\]);/)[1]);
  const offline = read("extensions/offline.js").toString();
  const extensions = JSON.parse(offline.match(/self\.EXTENSION_LIBRARIES = (\[[^\]]*\]);/)[1]);
  assert.deepEqual([...core, ...extensions], rows.map((row) => `./${row.file}`));
  const files = JSON.parse(offline.match(/self\.EXTENSION_FILES = (\[[^\]]*\]);/)[1]);
  assert.ok(!files.some((file) => file.includes("/vendor/")), "not also in each version's own cache");
});
