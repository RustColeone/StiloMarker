// The desktop build's rules, apart from Electron so they are tested in Node
// (tests/desktop.test.mjs): what the window may load, what answers the
// server's addresses when there is no server, where a link goes, and whether
// a release is newer. (A file's type is Electron's to say: app.mjs.)
import { join, resolve, sep } from "node:path";

// One fixed origin, so this browser storage (IndexedDB, localStorage) is the
// same at every start: not file:// (no origin of its own), not a random port.
export const SCHEME = "app";
export const HOST = "stilo";
export const ORIGIN = `${SCHEME}://${HOST}`;

// The web app's own files: what the window may load, and what a desktop
// build carries (package.json's extraResources). Never the server's code.
export const WEB_ENTRIES = ["index.html", "manifest.webmanifest", "app", "assets", "extensions", "vendor", "Template"];

// The releases, and where a newer one is downloaded (only from there).
export const FEED = "https://api.github.com/repos/RustColeone/StiloMarker/releases/latest";
const DOWNLOADS = "https://github.com/RustColeone/StiloMarker/releases/";

// An address in the window -> what answers it: { file } (a path under root),
// { api: true } (the server's; there is none in the desktop build unless
// Settings → Collaboration names one), or { missing: true }.
export function route(address, root) {
  let url;
  try { url = new URL(address); } catch { return { missing: true, why: "not an address" }; }
  if (url.protocol !== `${SCHEME}:` || url.host !== HOST) return { missing: true, why: "another origin" };
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { return { missing: true, why: "a malformed path" }; }
  if (path === "/api" || path.startsWith("/api/")) return { api: true };
  const parts = (path === "/" ? "index.html" : path.slice(1)).split("/");
  const unsafe = parts.some((part) => part === "" || part === "." || part === ".." || part.startsWith(".") || part.includes("\\") || part.includes("\0"));
  if (unsafe || !WEB_ENTRIES.includes(parts[0])) return { missing: true, why: "not the app's" };
  if (parts[0] === "extensions" && parts.includes("server")) return { missing: true, why: "an extension's server code" };
  const base = resolve(root);
  const file = join(base, ...parts);
  return file.startsWith(base + sep) ? { file } : { missing: true, why: "outside the app" };
}

// The server's addresses with no server: what the web app gets offline from
// its service worker, so it says so the same way (and nothing waits).
export function noServer() {
  return { status: 503, headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "offline", message: "No server: the desktop app on its own. Settings → Collaboration → Server URL connects it to one." }) };
}

// A link or a new window: "app" (stays in the window), "external" (the
// system's browser or mail app), or "deny".
export function linkAction(address) {
  let url;
  try { url = new URL(address); } catch { return "deny"; }
  if (url.protocol === `${SCHEME}:`) return url.host === HOST ? "app" : "deny";
  return ["https:", "http:", "mailto:"].includes(url.protocol) ? "external" : "deny";
}

// "v1.2.3" or "1.2.3" -> [1, 2, 3]; anything else (a pre-release) -> null.
function parse(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewer(latest, current) {
  const [a, b] = [parse(latest), parse(current)];
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// The release feed's answer (GitHub's latest release) -> { available, version, url }.
export function updateFrom(release, current) {
  const version = String(release?.tag_name ?? "").replace(/^v/, "");
  const url = typeof release?.html_url === "string" && release.html_url.startsWith(DOWNLOADS) ? release.html_url : null;
  if (!release || release.draft || release.prerelease || !url || !isNewer(version, current)) return { available: false, version: version || null, url: null };
  return { available: true, version, url };
}
