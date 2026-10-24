// Settings → Agent (a section of Shell's Settings dialog): where the agent's
// key comes from (this server's, or the user's own with its URL and model),
// how characters' replies run, and the agent's status line. Changing where the
// key comes from asks the server again.
const KEY_FIELDS = [["#agent-api-key-input", "agentApiKey"], ["#agent-api-url-input", "agentApiUrl"], ["#agent-model-input", "agentModel"]];

export function addAgentSettings({ dialog, settings, agent, doc = globalThis.document }) {
  const body = doc?.querySelector("#settings-panel-agent");
  if (!body) return;
  const $ = (selector) => body.querySelector(selector);
  const source = $("#agent-source-select");
  const runner = $("#agent-runner-select");
  const statusLine = $("#agent-status-line");

  function drawStatus() {
    const { text, ok } = agent.settingsLine();
    statusLine.textContent = text;
    statusLine.classList.toggle("is-success", ok === true);
    statusLine.classList.toggle("is-error", ok === false);
  }

  function show() {
    const own = settings.agentSource === "own";
    source.value = own ? "own" : "server";
    $("#agent-own-fields").hidden = !own;
    runner.value = settings.agentRunner === "browser" ? "browser" : "server";
    $("#agent-runner-note").textContent = settings.agentRunner === "browser"
      ? "The Agent and characters' replies call the API URL above straight from this browser, with no server needed, so it can be a model on this computer (e.g. Ollama at http://localhost:11434/v1/chat/completions; allow this site in OLLAMA_ORIGINS). The key may be left empty for a local model; the endpoint must allow this site. Connected tools and pictures need the server."
      : "Your key is sent over HTTPS to this server's proxy for each request and is never stored server-side. It stays in this browser.";
    for (const [selector, key] of KEY_FIELDS) {
      const input = $(selector);
      if (doc.activeElement !== input) input.value = settings[key] || "";
    }
    $("#agent-source-note").textContent = own
      ? "The agent uses your key, sent to this server's proxy per request. Works from anywhere; billed to you."
      : "Uses the key configured on the server you're connected to. Requires the server to have a key and to allow your session.";
    drawStatus();
  }

  source.addEventListener("change", () => {
    settings.change({ agentSource: source.value === "own" ? "own" : "server" }, "Settings: Agent source");
    void agent.refresh({ silent: true });
  });
  runner.addEventListener("change", () => {
    settings.change({ agentRunner: runner.value === "browser" ? "browser" : "server" }, "Settings: where replies run");
    void agent.refresh({ silent: true });
  });
  for (const [selector, key] of KEY_FIELDS) {
    const input = $(selector);
    input.addEventListener("input", () => settings.change({ [key]: input.value }, `Settings: ${key}`));
    // Trimmed, and the server asked again, only when the field is left: not on
    // every keystroke of a pasted key.
    input.addEventListener("change", () => {
      settings.change({ [key]: input.value.trim() }, `Settings: ${key}`);
      input.value = settings[key];
      void agent.refresh({ silent: true });
    });
  }

  dialog.addPage({ id: "agent", label: "Agent", order: 20, body });
  dialog.onOpen(() => { show(); void agent.refresh({ silent: true }); });
  agent.on(drawStatus);
  settings.on((view, changed) => {
    if (changed.some((key) => key.startsWith("agent"))) show();
    // Another server may have another agent.
    if (changed.includes("serverUrl")) void agent.refresh({ silent: true });
  });
  show();
}
