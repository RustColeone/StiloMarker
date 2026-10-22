// The desktop build's rules (desktop/policy.mjs), and that the build carries
// the files they allow, at the app's version. The app in Electron itself:
// desktop-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEED, ORIGIN, WEB_ENTRIES, isNewer, linkAction, noServer, route, updateFrom } from "../desktop/policy.mjs";
import { desktopBridge, watchReleases } from "../app/modules/shell/adapters/desktop.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const json = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

test("desktop: the window loads the app's own files, and nothing else", () => {
  const root = "/opt/stilo/web";
  assert.equal(ORIGIN, "app://stilo");
  assert.deepEqual(route("app://stilo/", root), { file: "/opt/stilo/web/index.html" });
  assert.deepEqual(route("app://stilo/app/main.js?v=2#x", root), { file: "/opt/stilo/web/app/main.js" });
  assert.deepEqual(route("app://stilo/assets/icons/icon%20512.png", root), { file: "/opt/stilo/web/assets/icons/icon 512.png" });
  assert.deepEqual(route("app://stilo/vendor/mermaid/11.17.2/mermaid.min.js", root), { file: "/opt/stilo/web/vendor/mermaid/11.17.2/mermaid.min.js" });
  assert.deepEqual(route("app://stilo/api/session/state?token=x", root), { api: true });
  assert.deepEqual(route("app://stilo/api", root), { api: true });
  for (const address of ["app://stilo/../etc/passwd", "app://stilo/app/%2e%2e/%2e%2e/etc/passwd", "app://stilo/server/whitelist.json",
    "app://stilo/.git/config", "app://stilo/app/.hidden", "app://stilo/tests/x.py", "app://stilo/docs/ISSUES.md", "app://stilo/apiary",
    "app://stilo/extensions/mermaid/server/routes.py", "app://stilo/app//main.js", "app://stilo/app/%5C..%5Cx", "app://stilo/app/%00",
    "app://stilo/%E0%A4%A", "app://other/index.html", "https://stilo/index.html", "file:///etc/passwd", "not an address"]) {
    assert.equal(route(address, root).missing, true, address);
  }
});

test("desktop: what answers the server's addresses when there is none", () => {
  const reply = noServer();
  assert.equal(reply.status, 503);
  assert.equal(reply.headers["content-type"], "application/json");
  assert.equal(JSON.parse(reply.body).error, "offline"); // as the service worker answers offline
});

test("desktop: links stay in the app, go to the system's browser, or nowhere", () => {
  assert.equal(linkAction("app://stilo/index.html"), "app");
  assert.equal(linkAction("https://example.com/a?b"), "external");
  assert.equal(linkAction("http://localhost:8000/"), "external");
  assert.equal(linkAction("mailto:a@example.com"), "external");
  for (const address of ["app://elsewhere/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "smb://host/share", "about:blank", ""]) {
    assert.equal(linkAction(address), "deny", address);
  }
});

test("desktop: a newer release, from the release feed", () => {
  assert.equal(isNewer("0.2.27", "0.2.26"), true);
  assert.equal(isNewer("v0.10.0", "0.9.9"), true);
  assert.equal(isNewer("1.0.0", "0.99.99"), true);
  assert.equal(isNewer("0.2.26", "0.2.26"), false);
  assert.equal(isNewer("0.2.25", "0.2.26"), false);
  assert.equal(isNewer("0.3.0-beta.1", "0.2.26"), false);
  assert.equal(isNewer("garbage", "0.2.26"), false);
  const page = "https://github.com/RustColeone/StiloMarker/releases/tag/v0.3.0";
  assert.deepEqual(updateFrom({ tag_name: "v0.3.0", html_url: page }, "0.2.26"), { available: true, version: "0.3.0", url: page });
  assert.equal(updateFrom({ tag_name: "v0.2.26", html_url: page }, "0.2.26").available, false);
  assert.equal(updateFrom({ tag_name: "v0.3.0", html_url: page, prerelease: true }, "0.2.26").available, false);
  assert.equal(updateFrom({ tag_name: "v0.3.0", html_url: page, draft: true }, "0.2.26").available, false);
  // Only a page of the app's own releases is ever opened.
  assert.equal(updateFrom({ tag_name: "v0.3.0", html_url: "https://evil.example/releases/" }, "0.2.26").available, false);
  assert.equal(updateFrom({ tag_name: "v0.3.0", html_url: "https://github.com/RustColeone/StiloMarker.evil/releases/x" }, "0.2.26").available, false);
  assert.equal(updateFrom(null, "0.2.26").available, false);
  assert.match(FEED, /^https:\/\/api\.github\.com\/repos\/RustColeone\/StiloMarker\/releases\/latest$/);
});

test("desktop: the build carries the app's files and the server's code, never its data, at the app's version", () => {
  const desktop = json("desktop/package.json");
  assert.equal(desktop.version, json("package.json").version);
  // One tree shaped like the repository (the server reads protocol/ and extensions/ beside it).
  const [tree, ...others] = desktop.build.extraResources;
  assert.equal(others.length, 0);
  assert.deepEqual([tree.from, tree.to], ["..", "stilo"]);
  const included = tree.filter.filter((pattern) => !pattern.startsWith("!"));
  for (const entry of WEB_ENTRIES) {
    assert.ok(included.some((pattern) => pattern === entry || pattern.startsWith(`${entry}/`)), `${entry} carried`);
    assert.ok(existsSync(join(ROOT, entry)), `${entry} exists`);
  }
  // Besides the window's files: only the shared protocol and the server's code.
  const others2 = included.filter((pattern) => !WEB_ENTRIES.some((entry) => pattern === entry || pattern.startsWith(`${entry}/`)));
  assert.deepEqual(others2.sort(), ["protocol/**/*", "server/**/*.py", "server/**/module.json", "server/MANUAL.md"]);
  for (const secret of ["server/whitelist.json", "server/session-state.json", "server/stilomarker.env", "server/data/team_x/a.md"]) {
    const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(?:.*/)?")}$`);
    assert.ok(!included.some((pattern) => glob(pattern).test(secret)), `never ${secret}`);
  }
  for (const file of desktop.build.files) assert.ok(existsSync(join(ROOT, "desktop", file)), `desktop/${file} exists`);
  assert.match(desktop.devDependencies.electron, /^\d+\.\d+\.\d+$/, "Electron pinned");
});

test("desktop: the page gets only the bridge's calls, in an isolated, sandboxed window", () => {
  const preload = readFileSync(join(ROOT, "desktop/preload.cjs"), "utf8");
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]),
    ["stilo:version", "stilo:check-update", "stilo:open-update", "stilo:server-state", "stilo:server-choose"]);
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.on\("([^"]+)"/g)].map((m) => m[1]), ["stilo:server-changed"]);
  const main = readFileSync(join(ROOT, "desktop/app.mjs"), "utf8");
  for (const setting of ["contextIsolation: true", "sandbox: true", "nodeIntegration: false"]) assert.ok(main.includes(setting), setting);
  assert.ok(main.includes('"will-prevent-unload"'), "the leave question is answered");
  assert.doesNotMatch(main, /file:\/\//, "never file://");
});

test("desktop: the app tells of a newer release once, and says when it could not look", async () => {
  assert.equal(desktopBridge({}), null, "in a browser: no bridge");
  const bridge = { checkForUpdate: async () => { const next = answers.shift(); if (next instanceof Error) throw next; return next; } };
  const answers = [{ available: false }, { available: true, version: "0.3.0", url: "u" }, { available: true, version: "0.3.0", url: "u" },
    new Error("offline"), { available: true, version: "0.3.1", url: "v" }];
  const told = [];
  const logged = [];
  let tick = null;
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (fn) => { tick = fn; return 1; };
  try {
    const stop = watchReleases({ bridge, onUpdate: (update) => told.push(update.version), log: (message, detail) => logged.push(`${message}: ${detail}`) });
    for (let i = 0; i < 5; i += 1) { await new Promise((resolve) => { setImmediate(resolve); }); if (i < 4) tick(); }
    stop();
  } finally {
    globalThis.setInterval = realSetInterval;
  }
  assert.deepEqual(told, ["0.3.0", "0.3.1"]);
  assert.deepEqual(logged, ["Looking for a newer release failed: offline"]);
});
