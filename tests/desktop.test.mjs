// The desktop build's rules (desktop/policy.mjs), its right-click menu
// (desktop/context-menu.mjs), and that the build carries the files they
// allow (and every module its main process imports), at the app's version. The app in Electron itself:
// desktop-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_FRAME, FEED, ORIGIN, WEB_ENTRIES, ZOOM_STEPS, frameLook, isNewer, keptZoom, linkAction, noServer, overlayOf, route, updateFrom, zoomKey,
  zoomStep } from "../desktop/policy.mjs";
import { addZoom, desktopBridge, hexColor, watchReleases } from "../app/modules/shell/adapters/desktop.js";
import { contextMenuTemplate } from "../desktop/context-menu.mjs";

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
    ["stilo:version", "stilo:check-update", "stilo:open-update", "stilo:zoom", "stilo:zoom-step", "stilo:frame", "stilo:server-state", "stilo:server-choose",
      "stilo:server-first-admin"]);
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.on\("([^"]+)"/g)].map((m) => m[1]), ["stilo:zoom-changed", "stilo:server-changed"]);
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

test("desktop: the window's zoom: a browser's steps, its keys, kept between starts", () => {
  assert.equal(zoomStep(1, "in"), 1.1);
  assert.equal(zoomStep(1.1, "out"), 1);
  assert.equal(zoomStep(1, "out"), 0.9);
  assert.equal(zoomStep(3, "in"), 3, "the largest stays");
  assert.equal(zoomStep(0.5, "out"), 0.5, "the smallest stays");
  assert.equal(zoomStep(2, "reset"), 1);
  assert.equal(zoomStep(1.3, "in"), 1.1, "a zoom that is no step counts as 100%");
  let factor = 1;
  for (let i = 0; i < 20; i += 1) factor = zoomStep(factor, "in");
  assert.equal(factor, ZOOM_STEPS.at(-1));
  assert.deepEqual([1.25, 7, "2", null, undefined].map(keptZoom), [1.25, 1, 1, 1, 1]);
  const key = (key, more = {}) => ({ type: "keyDown", key, code: "", control: true, meta: false, alt: false, ...more });
  assert.deepEqual(["=", "+", "-", "_", "0"].map((k) => zoomKey(key(k))), ["in", "in", "out", "out", "reset"]);
  assert.deepEqual(["NumpadAdd", "NumpadSubtract", "Numpad0", "Equal", "Minus", "Digit0"].map((code) => zoomKey(key("x", { code }))),
    ["in", "out", "reset", "in", "out", "reset"]);
  assert.equal(zoomKey(key("=", { control: false })), null, "without Ctrl");
  assert.equal(zoomKey(key("=", { alt: true })), null, "with Alt");
  assert.equal(zoomKey(key("=", { type: "keyUp" })), null, "only as it goes down");
  assert.equal(zoomKey(key("s")), null);
  assert.equal(zoomKey(key("=", { control: false, meta: true }), true), "in", "Cmd on a Mac");
  assert.equal(zoomKey(key("=", { control: true, meta: false }), true), null, "not Ctrl on a Mac");
});

test("desktop: the page's zoom: View's three commands, and the status bar while it is not 100%", async () => {
  let factor = 1;
  let told = null;
  const zoom = { get: async () => factor, step: async (direction) => (factor = zoomStep(factor, direction)), onChange: (listener) => { told = listener; } };
  const added = [];
  const commands = { add: (command) => added.push(command) };
  let item = null;
  const statusBar = { add: (spec) => (item = { spec, state: { hidden: spec.hidden }, set(next) { Object.assign(this.state, next); } }) };
  addZoom({ zoom, commands, statusBar });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(added.map((c) => [c.id, c.title, c.keys[0], c.menu.id]), [["shell.zoom-in", "Zoom In", "Mod+=", "view"],
    ["shell.zoom-out", "Zoom Out", "Mod+-", "view"], ["shell.zoom-reset", "Reset Zoom", "Mod+0", "view"]]);
  assert.equal(item.state.hidden, true, "100%: nothing said");
  added[0].run();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual([item.state.text, item.state.hidden], ["110%", false]);
  told(1.5); // Ctrl+wheel, or the keys: the desktop app tells
  assert.equal(item.state.text, "150%");
  item.spec.action();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.equal(item.state.hidden, true, "a click: 100% again");
  assert.equal(factor, 1);
});

test("desktop: the title bar is the page's: the buttons drawn in the colours and height it tells", () => {
  assert.deepEqual(frameLook({ color: "#252526", symbolColor: "#CCCCCC", height: 42 }), { color: "#252526", symbolColor: "#cccccc", height: 42 });
  for (const look of [null, "dark", {}, { color: "red", symbolColor: "#cccccc", height: 42 }, { color: "#252526", symbolColor: "#ccc", height: 42 },
    { color: "#252526", symbolColor: "#cccccc", height: 10 }, { color: "#252526", symbolColor: "#cccccc", height: 42.5 },
    { color: "#252526;x", symbolColor: "#cccccc", height: 42 }]) {
    assert.equal(frameLook(look), null, JSON.stringify(look));
  }
  assert.deepEqual(frameLook(DEFAULT_FRAME), { ...DEFAULT_FRAME });
  assert.deepEqual(overlayOf({ color: "#ffffff", symbolColor: "#1f1f1f", height: 42 }, 1.25), { color: "#ffffff", symbolColor: "#1f1f1f", height: 53 },
    "the zoom draws the bar taller in the window's pixels");
  assert.deepEqual(["rgb(37, 37, 38)", "rgba(255, 255, 255, 0.5)", "rgb(0,0,0)", "#fff", "", null].map(hexColor),
    ["#252526", "#ffffff", "#000000", null, null, null]);
});

test("desktop: the right-click menu: a misspelled word's suggestions, then cut, copy and paste", () => {
  const calls = [];
  const tools = { replace: (word) => calls.push(["replace", word]), learn: (word) => calls.push(["learn", word]), selectAll: () => calls.push(["select all"]) };
  const editFlags = { canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
  const menu = contextMenuTemplate({ isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the", "tech", "ten", "tea", "eh", "toe"], editFlags }, tools);
  assert.deepEqual(menu.map((item) => item.label ?? item.type),
    ["the", "tech", "ten", "tea", "eh", "Add to Dictionary", "separator", "Cut", "Copy", "Paste", "separator", "Select All"], "five suggestions at most");
  menu[0].click();
  menu[5].click();
  menu[11].click();
  assert.deepEqual(calls, [["replace", "the"], ["learn", "teh"], ["select all"]]);
  assert.equal(menu[11].role, undefined, "the page's own Select All (Ctrl+A), not the browser's: a long file shows only the lines in view");
  assert.match(readFileSync(join(ROOT, "desktop/app.mjs"), "utf8"), /sendInputEvent\(\{ type, keyCode: "A", modifiers \}\)/, "pressed as keys");
  const none = contextMenuTemplate({ isEditable: true, misspelledWord: "zzqx", dictionarySuggestions: [], editFlags }, tools);
  assert.deepEqual([none[0].label, none[0].enabled], ["No Suggestions", false]);
  const plain = contextMenuTemplate({ isEditable: true, editFlags: { canPaste: true } }, tools);
  assert.deepEqual(plain.map((item) => [item.label ?? item.type, item.enabled]),
    [["Cut", false], ["Copy", false], ["Paste", true], ["separator", undefined], ["Select All", true]], "what the place allows");
  assert.deepEqual(contextMenuTemplate({ isEditable: false, selectionText: "words", editFlags: { canCopy: true } }, tools).map((item) => item.label), ["Copy"]);
  assert.deepEqual(contextMenuTemplate({ isEditable: false, selectionText: "", editFlags: {} }, tools), [], "nowhere to type, nothing selected: no menu");
});

test("desktop: every module the main process imports is in the build", () => {
  const files = new Set(json("desktop/package.json").build.files);
  const seen = new Set(["main.mjs"]);
  const queue = ["main.mjs"];
  while (queue.length) {
    const file = queue.shift();
    assert.ok(files.has(file), `desktop/${file} is in the build's files`);
    for (const [, target] of readFileSync(join(ROOT, "desktop", file), "utf8").matchAll(/from "\.\/([\w.-]+\.(?:mjs|cjs))"/g)) {
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }
  assert.ok(seen.has("context-menu.mjs") && seen.has("server-policy.mjs"), [...seen].join(", "));
});
