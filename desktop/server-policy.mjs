// The desktop app's server, apart from Electron so it is tested in Node
// (tests/desktop.test.mjs): what the app connects to (nothing, the server it
// runs on this computer, or another one), how that server is started, which
// Python can run it, and where a request to the app's /api/ goes.

// The choice, as kept in the desktop app's own settings (desktop-settings.json).
//   connect: "none" | "local" (the server this app runs) | "remote" (another one)
//   remoteUrl: the other server's address (http or https)
//   local: the server this app runs: its port, whether other devices on the
//          network reach it (lan), and its PINs (made once, at random)
export const LOCAL_PORT = 8765;
const PIN_DIGITS = 6;

const makePin = (random) => Array.from({ length: PIN_DIGITS }, () => Math.floor(random() * 10)).join("");

// A server address the app may forward to: http or https, a host, no
// credentials; its path kept (a server behind a proxy at /stilo/), its query
// and fragment dropped. Anything else: null.
export function serverAddress(raw) {
  let url;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const validPort = (value) => Number.isInteger(value) && value >= 1024 && value <= 65535;
const validPin = (value) => typeof value === "string" && /^\d{4,12}$/.test(value);

// The kept choice made whole: what is missing or wrong gets its default
// (PINs made with `random` when there are none).
export function serverChoice(raw = {}, random = Math.random) {
  const local = raw?.local ?? {};
  const remoteUrl = serverAddress(raw?.remoteUrl) ?? "";
  let connect = ["none", "local", "remote"].includes(raw?.connect) ? raw.connect : "none";
  if (connect === "remote" && !remoteUrl) connect = "none";
  return {
    connect,
    remoteUrl,
    local: {
      port: validPort(local.port) ? local.port : LOCAL_PORT,
      lan: local.lan === true,
      pin: validPin(local.pin) ? local.pin : makePin(random),
      masterPin: validPin(local.masterPin) ? local.masterPin : makePin(random)
    }
  };
}

// Where the app's requests to /api/ go for this choice (and port the local server listens on): an address, or null.
export function forwardTarget(choice, localPort = choice.local.port) {
  if (choice.connect === "local") return `http://127.0.0.1:${localPort}`;
  if (choice.connect === "remote") return serverAddress(choice.remoteUrl);
  return null;
}

// A request to app://stilo/api/… sent on to the server: its path and query under the server's address.
export function forwardUrl(target, address) {
  const url = new URL(address);
  return `${target}${url.pathname}${url.search}`;
}

// The headers a forwarded request keeps (the browser's own, like Origin and Cookie, stay behind).
const KEPT_HEADERS = new Set(["accept", "accept-language", "cache-control", "content-type", "last-event-id", "authorization"]);
export function forwardHeaders(headers) {
  const out = {};
  for (const [name, value] of headers) if (KEPT_HEADERS.has(name.toLowerCase())) out[name] = value;
  return out;
}

// The server's command line: its files (static: the app's own; state,
// accounts and data: this app's folder: accounts.json, if one is put there),
// where it listens and its PINs.
// It ends with the app (parentPid), even when the app does not quit cleanly.
// The account file of the server this app runs, beside its other data.
export const ACCOUNTS_FILE = "accounts.json";

export function serverArgs({ script, port, lan, pin, masterPin, staticDir, dataDir, join, parentPid = null }) {
  return [script, "--host", lan ? "0.0.0.0" : "127.0.0.1", "--port", String(port), "--pin", pin, "--master-pin", masterPin,
    "--static-dir", staticDir, "--state-file", join(dataDir, "session-state.json"), "--whitelist", join(dataDir, ACCOUNTS_FILE),
    "--data-dir", join(dataDir, "data"), ...(parentPid ? ["--parent-pid", String(parentPid)] : [])];
}

// The server's own tool (server/accounts.py: its rules and its hashing)
// making the first admin of that file: the password goes on standard input,
// and the name after "--", so no name is taken for an option.
export function firstAdminArgs({ script, dataDir, username, join }) {
  return [script, "--file", join(dataDir, ACCOUNTS_FILE), "--password-stdin", "add", "--admin", "--", username];
}

// How many accounts an account file's text holds (0 for none, or for one that does not read).
export function accountCount(text) {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data?.users) ? data.users.length : 0;
  } catch (error) {
    if (error instanceof SyntaxError) return 0; // not an account file: no accounts to speak of
    throw error;
  }
}

// The Pythons to try, in order: the one named in STILO_PYTHON, then the usual names.
export function pythonCandidates(platform, env = {}) {
  const named = env.STILO_PYTHON ? [[env.STILO_PYTHON, []]] : [];
  const usual = platform === "win32" ? [["py", ["-3"]], ["python", []], ["python3", []]] : [["python3", []], ["python", []]];
  return [...named, ...usual];
}

// "3.11" (what `python -c "import sys; print(…)"` prints) -> usable for the server (3.10 or later)?
export function pythonUsable(printed) {
  const match = /^(\d+)\.(\d+)/.exec(String(printed ?? "").trim());
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 3 || (major === 3 && minor >= 10);
}

// This computer's addresses other devices on the network use (IPv4, not internal).
export function lanAddresses(interfaces) {
  const out = [];
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      if ((entry.family === "IPv4" || entry.family === 4) && !entry.internal) out.push(entry.address);
    }
  }
  return out;
}
