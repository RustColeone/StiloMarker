// The agent's connection, as rules: whether the agent can be used and why
// not, which models are offered and which is chosen, and what a request sends
// when the user brings their own key. Pure: the adapter (adapters/agent.js)
// asks the server and keeps the state.
import { chosenModel } from "./catalog.js";

export const AGENT_STATUS = {
  status: "checking",       // checking | ready | signin | unconfigured | offline | restricted
  detail: "",
  configured: false,
  localOnly: true,
  provider: null,
  model: null,
  models: [],
  modelProviders: {},       // model -> provider, when the server names them
  imageGeneration: false,
  selectedModel: null
};

const trimmed = (value) => String(value ?? "").trim();

// The user's own key, entered in Settings → Agent ("My own API key").
export function ownKeyReady(settings) {
  return settings.agentSource === "own" && Boolean(trimmed(settings.agentApiKey));
}

// Replies run in this browser, no server needed ("Directly from this
// browser"): the user's own endpoint, called from here (the key may be empty
// for a model on this computer).
export function runsHere(settings) {
  return settings.agentSource === "own" && settings.agentRunner === "browser";
}

function hereStatus(settings) {
  const model = trimmed(settings.agentModel) || "custom";
  if (!trimmed(settings.agentApiUrl)) {
    return { configured: false, localOnly: false, provider: null, model: null, models: [], selectedModel: null,
      status: "unconfigured", detail: "Enter the API URL in Settings → Agent to run the agent from this browser." };
  }
  return { configured: true, localOnly: false, provider: "Your key", model, models: [model], selectedModel: model,
    status: "ready", detail: "Using your own endpoint, from this browser." };
}

// What a request carries for the server's proxy in own-key mode (nothing in
// server mode, or with no key entered: the server's key is used then).
export function ownKeyOverride(settings) {
  if (!ownKeyReady(settings)) return {};
  const override = { apiKey: trimmed(settings.agentApiKey) };
  if (trimmed(settings.agentApiUrl)) override.apiUrl = trimmed(settings.agentApiUrl);
  if (trimmed(settings.agentModel)) override.apiModel = trimmed(settings.agentModel);
  return override;
}

function ownKeyStatus(settings) {
  const model = trimmed(settings.agentModel) || "custom";
  return { configured: true, localOnly: false, provider: "Your key", model, models: [model], selectedModel: model,
    status: "ready", detail: "Using your own API key." };
}

// The status after the server answered. A server with accounts only lets
// signed-in users spend its keys; the user's saved model is kept if offered.
export function statusFromServer(answer, { settings, signedIn }) {
  if (runsHere(settings)) return hereStatus(settings);
  if (ownKeyReady(settings)) return ownKeyStatus(settings);
  const needsSignIn = Boolean(answer.requiresAccount) && !signedIn;
  const configured = Boolean(answer.configured) && !needsSignIn;
  const models = Array.isArray(answer.models) && answer.models.length ? answer.models : (answer.model ? [answer.model] : []);
  const status = configured ? "ready" : (needsSignIn && answer.configured ? "signin" : "unconfigured");
  return {
    configured,
    localOnly: answer.localOnly !== false,
    provider: answer.provider ?? null,
    model: answer.model ?? null,
    models,
    modelProviders: Object.fromEntries((Array.isArray(answer.modelInfo) ? answer.modelInfo : []).map((row) => [row.id, row.provider])),
    imageGeneration: Boolean(answer.imageGeneration),
    selectedModel: chosenModel(models, settings.chatModel, answer.model),
    status,
    detail: configured ? "Ready"
      : status === "signin" ? "Sign in to use the agent"
        : "Agent needs a key — click to open Settings → Agent and use your own, or set one on the server."
  };
}

// The status when the server could not be asked. Replies that run in this
// browser need none; the user's own key sent through the server does.
export function statusWithoutServer(error, { settings }) {
  if (runsHere(settings)) return hereStatus(settings);
  if (ownKeyReady(settings)) {
    return { configured: false, provider: null, model: null, models: [], selectedModel: null, status: "offline",
      detail: "Your key goes through the server, which can't be reached. To work without it, choose “Directly from this browser” in Settings → Agent." };
  }
  return { configured: false, provider: null, model: null, models: [], selectedModel: null,
    status: error?.status === 403 ? "restricted" : "offline", detail: error instanceof Error ? error.message : String(error) };
}

// The line in Settings → Agent: { text, ok } (ok null: neither, yet).
export function settingsLine(state, settings) {
  if (runsHere(settings)) {
    return trimmed(settings.agentApiUrl) ? { text: "Ready — your own endpoint, called from this browser.", ok: true }
      : { text: "Enter the API URL below to run the agent from this browser.", ok: false };
  }
  if (settings.agentSource === "own" && !ownKeyReady(settings)) return { text: "Enter your API key below to enable the agent.", ok: false };
  // Not "ready" before the server has answered.
  if (state.status === "checking") return { text: "Checking the server…", ok: null };
  if (ownKeyReady(settings) && state.status === "offline") return { text: "Server unreachable — your key goes through it. Choose “Directly from this browser” to work without it.", ok: false };
  if (ownKeyReady(settings)) return { text: "Ready — using your own API key, through this server.", ok: true };
  if (state.configured) return { text: `Ready — ${state.provider ?? "server"}${state.model ? " · " + state.model : ""}.`, ok: true };
  if (state.status === "signin") {
    return { text: "Sign in with your account (Settings → Collaboration) to use this server's agent, or switch to “My own API key”.", ok: false };
  }
  if (state.status === "offline") return { text: "Server unreachable — can't check the agent.", ok: false };
  return { text: state.detail || "This server has no agent key. Switch to “My own API key”, or set one on the server.", ok: false };
}
