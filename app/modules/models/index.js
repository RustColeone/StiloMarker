// Models (browser): calling a model straight from this browser (a user's own
// key, or a local model such as Ollama), reading its stream, and how the
// model picker groups and chooses models. The server's half is
// server/stilo/modules/models.
//
// API (also as static exports, for code from before the restructure):
//   sendChatRequest(serverUrl, payload, onProgress, signal) -> the server agent's answer
//   runDirectReply({ payload, apiUrl, apiKey, model, signal, onText, tools, onTool }) -> text
//   streamCompletion({ apiUrl, apiKey, body, signal, onText, onReasoning }) -> { content, toolCalls }:
//     one streamed request to the user's endpoint (the workspace agent's loop runs over it)
//   groupByProvider(models, providerOf) -> [[provider, models], ...]
//   chosenModel(models, saved, fallback) -> model
// API only: agent, the agent's connection (adapters/agent.js): status() ->
//   { status, detail, configured, models, modelProviders, selectedModel... },
//   refresh({ signedIn?, silent }) (signedIn as last told when left out), choose(model), served({ provider, model }), ensureReady({ signedIn }),
//   ownKeyReady(), requestOverride() (what a request carries with the user's
//   own key), settingsLine() -> { text, ok }, on(listener).
import { defineModule } from "../../kernel/index.js";
import { runDirectReply } from "./adapters/direct.js";
import { chosenModel, groupByProvider } from "./model/catalog.js";
import { AGENT_STATUS, createAgentConnection } from "./adapters/agent.js";
import { addAgentSettings } from "./adapters/settings-section.js";

export { runDirectReply, streamCompletion } from "./adapters/direct.js";
export { chosenModel, groupByProvider } from "./model/catalog.js";
export { createChatStream } from "./model/stream.js";
export { sendChatRequest } from "./adapters/server-agent.js";

export default defineModule({
  name: "models",
  level: 2,
  uses: ["shell"],
  owns: { rules: ["chat-completions stream", "models grouped by provider"], state: ["the agent's connection"], elements: ["Settings → Agent"] },
  start(ctx) {
    const shell = ctx.use("shell");
    const agent = createAgentConnection({ state: ctx.state(AGENT_STATUS), server: shell.server, settings: shell.settings });
    // Settings → Agent: where the key comes from, and the agent's status.
    addAgentSettings({ dialog: shell.settingsDialog, settings: shell.settings, agent });
    return { runDirectReply, groupByProvider, chosenModel, agent };
  }
});
