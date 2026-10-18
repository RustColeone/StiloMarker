// Assistant: the workspace agent. Its page in the side panel (the
// conversations, a turn's progress, the edits it proposes with Keep / Drop,
// the Agent status in Settings), its tools, and how its proposals are shown
// and made. The server's half is server/stilo/modules/assistant, which
// resolves edit_file.
//
// API: load(port) -> Promise<panel>: the Agent page, loaded on first use (the
// panel or Settings shown), given what main.js still provides (PORT in
// adapters/panel.js); panel() -> it, once loaded.
// Static, for code from before the restructure: editsHtml(edits),
// editsLabel(edits), undoSteps(op, project), sendGenerationRequest (a diagram's notes).
import { defineModule } from "../../kernel/index.js";
import { editsHtml, editsLabel } from "./model/edits.js";

export { editsHtml, editsLabel } from "./model/edits.js";
export { undoSteps } from "./model/undo.js";
export { sendGenerationRequest } from "./adapters/api.js";

export default defineModule({
  name: "assistant",
  level: 5,
  uses: ["shell", "workspace", "identity", "sync", "editor", "explorer", "characters", "models"],
  owns: { tools: ["edit_file review"], elements: ["the Agent page"], data: ["the agent's conversations in this browser"] },
  start(ctx) {
    let panel = null, loading = null;
    function load(port) {
      loading ??= import("./adapters/panel.js").then(({ createAgentPanel }) => {
        panel = createAgentPanel({ port, shell: ctx.use("shell"), workspace: ctx.use("workspace"), identity: ctx.use("identity"),
          sync: ctx.use("sync"), editor: ctx.use("editor"), explorer: ctx.use("explorer"), models: ctx.use("models") });
        return panel;
      }).catch((error) => { loading = null; throw error; });
      return loading;
    }
    return { editsHtml, editsLabel, load, panel: () => panel };
  }
});
