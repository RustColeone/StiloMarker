// Assistant: the agent's tools and how its proposals are shown and made. Step 6
// brings edit_file's review here; the rest of the agent (app/features/chat-panel.js)
// moves in later (docs/ARCHITECTURE.md). The server's half is
// server/stilo/modules/assistant, which resolves edit_file.
//
// Static, for code from before the restructure: editsHtml(edits), editsLabel(edits).
import { defineModule } from "../../kernel/index.js";
import { editsHtml, editsLabel } from "./model/edits.js";

export { editsHtml, editsLabel } from "./model/edits.js";

export default defineModule({
  name: "assistant",
  level: 5,
  uses: ["workspace", "characters"],
  owns: { tools: ["edit_file review"] },
  start() {
    return { editsHtml, editsLabel };
  }
});
