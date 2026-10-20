// Assistant: the workspace agent. Its page in the side panel (the
// conversations, a turn's progress, the edits it proposes with Keep / Drop,
// the Agent status in Settings), its tools, and how its proposals are shown
// and made. The server's half is server/stilo/modules/assistant, which
// resolves edit_file.
//
// API: once the app has started, the Agent page loads by itself on first use
// (the side panel or its phone pane shown, or Settings open). load() -> Promise<panel>; panel() -> it, once loaded.
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
    let started = false;
    function load() {
      if (!started) return Promise.resolve(null); // the app is still starting
      loading ??= import("./adapters/panel.js").then(({ createAgentPanel }) => {
        panel = createAgentPanel({ shell, workspace: ctx.use("workspace"), identity: ctx.use("identity"),
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
    // Shown: loaded, or its status asked again and the conversation drawn, scrolled to the end.
    function showing() {
      if (!panel) { void load(); return; }
      void panel.refreshChatStatus({ silent: true });
      panel.pageShown(true);
    }
    // The Agent page (Shell's pages): in the side panel unless moved; told when
    // it shows (its tab opened, or its area shown), wherever it is.
    if (globalThis.document) {
      shell.pages.add({
        host: "side", id: "agent", order: 1, label: "Agent", title: "The workspace agent: asks, edits and organizes files",
        body: document.querySelector("#agent-page"), toolbar: document.querySelector("#chat-history-toggle-button"),
        newItem: () => void load().then((loaded) => loaded?.createNewChatConversation()),
        shown(visible) {
          if (visible) showing();
          else panel?.pageShown(false);
        }
      });
    }
    shell.settingsDialog.onOpen(() => { if (!panel) void load(); });
    // Reload Window (Shell): an answer still on its way would be cut off.
    shell.beforeReload.add({ id: "assistant.answer", label: "The Agent", order: 40,
      keep: () => (panel?.chatState.sending ? "it is still answering; reloading now may lose its answer." : "") });
    shell.commands.add({ id: "assistant.toggle-chat", title: () => (shell.frame.shown("right") ? "Hide Chat" : "Show Chat"),
      menu: { id: "view", group: 0, order: 4 }, run: () => shell.frame.toggle("right") });
    // It loads when the area holding it shows, even on another of its tabs
    // (its status and Settings → Agent are its), and at once if that area shows.
    shell.events.on("area", ({ area, shown }) => { if (shown && area === shell.pages.areaOf("agent")) void load(); });
    ctx.whenStarted(() => {
      started = true;
      const area = shell.pages.areaOf("agent");
      if (globalThis.document && area && shell.frame.shown(area) && !shell.frame.isPhone()) void load();
    });
    return { editsHtml, editsLabel, load, panel: () => panel };
  }
});
