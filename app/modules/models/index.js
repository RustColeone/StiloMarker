// Models (browser): calling a model straight from this browser (a user's own
// key, or a local model such as Ollama), reading its stream, and how the
// model picker groups and chooses models. The server's half is
// server/stilo/modules/models.
//
// API (also as static exports, for code from before the restructure):
//   runDirectReply({ payload, apiUrl, apiKey, model, signal, onText, tools, onTool }) -> text
//   groupByProvider(models, providerOf) -> [[provider, models], ...]
//   chosenModel(models, saved, fallback) -> model
import { defineModule } from "../../kernel/index.js";
import { runDirectReply } from "./adapters/direct.js";
import { chosenModel, groupByProvider } from "./model/catalog.js";

export { runDirectReply } from "./adapters/direct.js";
export { chosenModel, groupByProvider } from "./model/catalog.js";
export { createChatStream } from "./model/stream.js";

export default defineModule({
  name: "models",
  level: 2,
  uses: [],
  owns: { rules: ["chat-completions stream", "models grouped by provider"] },
  start() {
    return { runDirectReply, groupByProvider, chosenModel };
  }
});
