// Assistant: the workspace agent. Its page in the side panel (the
// conversations, a turn's progress, the edits it proposes with Keep / Drop,
// the Agent status in Settings), its tools, and how its proposals are shown
// and made. The server's half is server/stilo/modules/assistant, which
// resolves edit_file.
//
// API: attach(port): what main.js still provides (PORT in adapters/panel.js);
// the Agent page then loads by itself on first use (the side panel or its
// phone pane shown, or Settings open). load() -> Promise<panel>; panel() -> it, once loaded.
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
    // Joining or leaving a session can change whether the server's agent may be
    // used: ask it again (the agent's connection is Models').
    const models = ctx.use("models"), identity = ctx.use("identity");
    ctx.use("sync").events.on("status", ({ next, previous }) => {
      if ((next.status === "connected") !== (previous.status === "connected")) {
        void models.agent.refresh({ signedIn: Boolean(identity.account()), silent: true });
      }
    });
    // The Agent page loads the first time it is needed (the side panel or its
    // phone pane shown, or Settings open: its Agent section shows the page's
    // connected tools), so a session that never opens it never downloads it.
    const shell = ctx.use("shell");
    let port = null;
    function load() {
      if (!port) return Promise.resolve(null); // not attached yet
      loading ??= import("./adapters/panel.js").then(({ createAgentPanel }) => {
        panel = createAgentPanel({ port, shell, workspace: ctx.use("workspace"), identity: ctx.use("identity"),
          sync: ctx.use("sync"), editor: ctx.use("editor"), explorer: ctx.use("explorer"), models: ctx.use("models"),
          characters: ctx.use("characters") });
        panel.chatState.shouldScrollToBottom = true;
        panel.renderChatPanel(ctx.use("workspace").project().getProject());
        void panel.refreshChatStatus({ silent: true });
        return panel;
      }).catch((error) => {
        loading = null;
        ctx.log(`The Agent page failed to load: ${error.message}`);
        shell.toast("The chat panel could not load. Check your connection and try again.");
        return null;
      });
      return loading;
    }
    // Shown: loaded, or its status asked again and the conversation scrolled to the end.
    function showing() {
      if (!panel) { void load(); return; }
      void panel.refreshChatStatus({ silent: true });
      panel.chatState.shouldScrollToBottom = true;
      panel.renderChatPanel(ctx.use("workspace").project().getProject());
    }
    shell.events.on("area", ({ area, shown }) => { if (shown && (area === "right" || area === "chat")) showing(); });
    shell.settingsDialog.onOpen(() => { if (!panel) void load(); });
    shell.commands.add({ id: "assistant.toggle-chat", title: () => (shell.settings.chatPanel === "shown" ? "Hide Chat" : "Show Chat"),
      menu: { id: "view", group: 0, order: 4 }, run: () => shell.frame.toggle("right") });
    // On the phone the side panel is a pane of its own.
    shell.frame.phonePanes.add({ id: "chat", order: 30, element: () => document.getElementById("chat-panel"), caption: () => "CHAT", fileId: () => null });
    // attach(port): what main.js still provides; the page loads now if the side panel shows.
    function attach(given) {
      port = given;
      if (shell.settings.chatPanel === "shown" && !shell.frame.isPhone()) void load();
    }
    return { editsHtml, editsLabel, attach, load, panel: () => panel };
  }
});
