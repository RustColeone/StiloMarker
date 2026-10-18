// The agent's connection: asks the server whether its agent is set up (and
// which models it offers), keeps the answer as state others read, and keeps
// the chosen model. Every change lands in the trace with what changed.
import { AGENT_STATUS, ownKeyOverride, ownKeyReady, settingsLine, statusFromServer, statusWithoutServer } from "../model/agent-status.js";

export { AGENT_STATUS };

// state: ctx.state(AGENT_STATUS); server: Shell's; settings: Shell's.
export function createAgentConnection({ state, server, settings }) {
  // signedIn: whether someone is signed in (Identity's to say, told by the
  // caller); without it, as the last caller said.
  let lastSignedIn = false;
  async function refresh({ signedIn = lastSignedIn, silent = false } = {}) {
    lastSignedIn = signedIn;
    state.set("checking the agent", { status: "checking", ...(silent ? {} : { detail: "Checking chat backend..." }) });
    try {
      const answer = await server.request("/api/chat/status", { failure: "Chat status failed." });
      state.set("the server answered", statusFromServer(answer ?? {}, { settings, signedIn }));
    } catch (error) {
      state.set("the server did not answer", statusWithoutServer(error, { settings }));
    }
    return state.get();
  }

  function choose(model) {
    state.set("choose a model", { selectedModel: model });
    settings.change({ chatModel: model }, "choose a model");
  }

  // A turn's answer names the provider and model that wrote it.
  function served({ provider, model } = {}) {
    state.set("the agent answered", { provider: provider ?? state.get().provider, model: model ?? state.get().model });
  }

  // Before a request that needs the agent: set up, or an error saying why not.
  async function ensureReady({ signedIn = false } = {}) {
    if (!state.get().configured) await refresh({ signedIn, silent: true });
    if (!state.get().configured) throw new Error(state.get().detail);
  }

  return Object.freeze({
    status: () => state.get(),
    on: state.on,
    refresh,
    choose,
    served,
    ensureReady,
    ownKeyReady: () => ownKeyReady(settings),
    requestOverride: () => ownKeyOverride(settings),
    settingsLine: () => settingsLine(state.get(), settings)
  });
}
