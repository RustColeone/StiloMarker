// The desktop build's rules, apart from Electron so they are tested in Node
// (tests/desktop.test.mjs): what the window may load, what answers the
// server's addresses when there is no server, where a link goes, the window's
// zoom and its title bar, and whether a release is newer. (A file's type is Electron's to say: app.mjs.)
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

// The window's zoom (how large the page draws; 1 is 100%): a browser's steps.
// Electron leaves its keys and Ctrl+wheel to the app (it has no View menu).
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

// A zoom kept between starts, read back: one of the steps, else 100%.
export const keptZoom = (factor) => (ZOOM_STEPS.includes(factor) ? factor : 1);

// The zoom after "in" or "out" (the next step that way; the last one stays)
// or "reset" (100%).
export function zoomStep(factor, direction) {
  const now = keptZoom(factor);
  if (direction === "in") return ZOOM_STEPS.find((step) => step > now) ?? now;
  if (direction === "out") return ZOOM_STEPS.findLast((step) => step < now) ?? now;
  return direction === "reset" ? 1 : now;
}

// A key pressed (Electron's input: { type, key, code, control, meta, alt })
// -> "in" (+ or =), "out" (-), "reset" (0), the number pad's too, with Ctrl
// (Cmd on a Mac); anything else -> null.
export function zoomKey(input, mac = false) {
  if (input?.type !== "keyDown" || input.alt || !(mac ? input.meta : input.control)) return null;
  const { key, code } = input;
  if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") return "in";
  if (key === "-" || key === "_" || code === "Minus" || code === "NumpadSubtract") return "out";
  if (key === "0" || code === "Digit0" || code === "Numpad0") return "reset";
  return null;
}

// The window has no title bar of the system's: the page's top bar is it, and
// the system's window buttons are drawn over it in the colours and height the
// page tells (CSS pixels). A look from the page -> { color, symbolColor,
// height } or null; at first, the Light theme's bar.
export const DEFAULT_FRAME = Object.freeze({ color: "#ffffff", symbolColor: "#1f1f1f", height: 42 });
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export function frameLook(look) {
  if (!look || typeof look !== "object") return null;
  const { color, symbolColor, height } = look;
  if (!HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor) || !Number.isInteger(height) || height < 24 || height > 120) return null;
  return { color: color.toLowerCase(), symbolColor: symbolColor.toLowerCase(), height };
}

// The buttons' overlay: the bar's height in the window's pixels (the zoom
// draws the page larger, the window's buttons stay as they are).
export const overlayOf = (look, zoom = 1) => ({ color: look.color, symbolColor: look.symbolColor, height: Math.round(look.height * zoom) });

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
