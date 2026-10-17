// The server this app talks to: its address and requests to it. Every
// module's network adapter goes through here, so the address rule and the
// error shape are spelled once.

// "" means the same origin and the app's base path, so the app works when it
// is served under a subpath (for example "/stilomarker/") behind a proxy.
export function normalizeServerUrl(serverUrl) {
  const value = (serverUrl ?? "").trim();
  if (!value) {
    if (typeof window === "undefined") return "";
    const pathname = window.location.pathname || "/";
    const basePath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, "");
    return `${window.location.origin}${basePath}`;
  }
  return value.replace(/\/+$/, "");
}

export async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

// An Error whose message starts with `prefix`, carrying the status and payload.
export async function throwForResponse(prefix, response) {
  const payload = await parseResponse(response);
  const message = typeof payload === "string" ? payload : payload?.message;
  const error = new Error(message ? `${prefix} ${message}` : `${prefix} Status ${response.status}.`);
  error.status = response.status;
  error.payload = payload;
  throw error;
}

export function createServer() {
  let address = () => "";
  const url = () => normalizeServerUrl(address());

  // request(path, { method, query, body, failure, timeout }) -> the parsed reply.
  // A failed reply throws an Error whose message starts with `failure`.
  async function request(path, { method = "GET", query = {}, body, failure = "Request failed.", timeout } = {}) {
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined && value !== null));
    const search = params.toString();
    const response = await fetch(`${url()}${path}${search ? `?${search}` : ""}`, {
      method,
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
      headers: { accept: "application/json, text/plain;q=0.9", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (!response.ok) await throwForResponse(failure, response);
    return parseResponse(response);
  }

  return {
    configure(options) { if (options.address) address = options.address; },
    url,
    request
  };
}
