// Settings → Collaboration (a section of Shell's Settings dialog): the server's
// address, reconnecting by itself, the name collaborators see and a shared
// session's PIN. Its buttons (Ping, Log In, Join, Share) are wired where their
// work is done (accounts.js, and main.js's connection until Sync owns it).
const FIELDS = [
  ["#server-url-input", "serverUrl", (value) => value.trim()],
  ["#server-pin-input", "serverPin", (value) => value],
  ["#display-name-input", "displayName", (value) => value.trim()]
];

export function addCollaborationSettings({ dialog, settings, doc = globalThis.document }) {
  const body = doc?.querySelector("#settings-panel-collaboration");
  if (!body) return;
  const reconnect = body.querySelector("#auto-reconnect-input");

  function show() {
    for (const [selector, key] of FIELDS) {
      const input = body.querySelector(selector);
      if (doc.activeElement !== input) input.value = settings[key] ?? "";
    }
    reconnect.checked = settings.autoReconnect !== false;
  }

  for (const [selector, key, clean] of FIELDS) {
    const input = body.querySelector(selector);
    input.addEventListener("change", () => settings.change({ [key]: clean(input.value) }, `Settings: ${key}`));
  }
  reconnect.addEventListener("change", () => settings.change({ autoReconnect: reconnect.checked }, "Settings: Remember & reconnect"));
  // The sign-in form starts with the remembered username.
  const username = body.querySelector("#account-username-input");
  if (username) username.value = settings.accountUsername ?? "";

  dialog.addPage({ id: "collaboration", label: "Collaboration", order: 30, body });
  dialog.onOpen(show);
  settings.on((view, changed) => { if (changed.some((key) => ["serverUrl", "serverPin", "displayName", "autoReconnect"].includes(key))) show(); });
  show();
}
