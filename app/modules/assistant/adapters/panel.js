// The side panel's Agent page (the Assistant module's, loaded the first time
// the panel or Settings is shown): the agent's conversations and their sync,
// its turns and the edits it proposes (Keep / Drop), and the Agent status in
// Settings.
//
// Its parts share one context, `app` (as the Editor's and the Explorer's do):
// the page's state, every part's functions, what the modules below offer, and
// its elements on the page (elements.js).
import { escapeHtmlAttribute } from "../../editor/index.js";
import { UPDATE_FILE } from "../../workspace/index.js";
import { normalizeServerUrl } from "../../shell/index.js";
import { createConversations } from "./conversations.js";
import { installEvents } from "./events.js";
import { createMcpControls } from "./mcp.js";
import { createProposals } from "./proposals.js";
import { createRender } from "./render.js";
import { createReview } from "./review.js";
import { createThreads } from "./threads.js";
import { createTurns } from "./turns.js";
import { findElements } from "./elements.js";

export function createAgentPanel({ shell, workspace, identity, sync, editor, explorer, models, characters }) {
  const { settings, pages } = shell;
  const app = {
    elements: findElements(),
    settings, pages, identity, models, workspace, escapeHtmlAttribute,
    controller: workspace.project(),
    collaboration: sync.session(),
    // The open cloud workspace, this tab's connection, the key its conversations are kept under (Sync's, Workspace's).
    cloudWorkspaceTarget: () => sync.cloudWorkspace(),
    chatConnectionInfo: () => sync.connectionInfo(),
    isMobileLayout: () => shell.frame.isPhone(),
    logDebug: (...args) => shell.log(...args),
    openSettingsDialog: (page) => shell.settingsDialog.open(page),
    chatWorkspaceKey: (project = workspace.project().getProject()) => workspace.location.key(project),
    personaAvatarSrc: (...args) => characters.avatarSrc(...args),
    workspaceMode: () => sync.mode.get().workspaceMode,
    notify: (message) => shell.notify(message),
    showToast: (message, options) => shell.toast(message, options),
    showConfirmDialog: (options) => shell.confirm(options),
    promptForName: (message, value = "", options = {}) => shell.input({ title: message, message, value, submitLabel: "Save", ...options }),
    openFileFromExplorer: (fileId) => editor.parts().openFileFromExplorer(fileId),
    editorParts: () => editor.parts(),
    createFileInFolder: (...args) => explorer.parts().createFileInFolder(...args),
    getSelectedParent: (...args) => explorer.parts().getSelectedParent(...args),
    // Who asked for an agent batch: this tab while it is open (not the sync client id,
    // which changes on every reconnect and locked the asker out of Keep and Drop).
    TAB_ID: globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random().toString(36).slice(2)}`,
    // The agent's connection is the Models module's: whether it is set up, the models, the one chosen.
    agent: models.agent,
    agentStatus: () => models.agent.status(),
    signedIn: () => Boolean(identity.account()),
    // Conversations from before they were kept per workspace: under the project this browser kept.
    legacyChatProjectId: workspace.restoredProject()?.id ?? "server-project",
    legacyChatScope: settings.syncedProjectId
      ? `cloud:${normalizeServerUrl(settings.serverUrl)}/${settings.syncedProjectId}` : null,
    // Changed by more than one part: always read and written as app.x.
    mcpControls: null,
    chatSynchronizer: null,
    chatConnectionToken: null,
    chatState: {
      projectId: null,
      syncBase: null,
      syncError: null,
      turn: null,
      renderedThreadId: null,
      activeThreadId: null,
      activeGroupThreadId: null,
      threads: [],
      sending: false,
      activity: [],
      activityExpanded: false,
      streamingText: "",
      reasoningText: "",
      turnStartedAt: 0,
      // Message ids whose persisted "Thought for…" section is expanded.
      expandedReasoning: new Set(),
      shouldScrollToBottom: false
    }
  };
  app.isOwnBatch = (message) => !message.originatorId || message.originatorId === app.TAB_ID;
  app.OP_ICONS = {
  "create-file": "+",
  [UPDATE_FILE]: "~",
  "rename-node": "r",
  "delete-node": "×",
  "create-folder": "+",
  "move-node": "→"
};
  app.STATUS_WORDS = { signin: "Sign in", offline: "Offline", unconfigured: "No key", restricted: "Not allowed", checking: "Checking…" };
  app.chatMarkdownCache = new Map(); // message id -> { content, html }
  app.pageOpen = (id) => pages.active("side") === id; // which side-panel page is open (Shell's pages)

  const add = (part) => {
    for (const [name, fn] of Object.entries(part)) {
      if (name in app) throw new Error(`assistant: "${name}" is defined twice`);
      app[name] = fn;
    }
  };
  add(createReview(app, editor));
  add(createConversations(app));
  add(createThreads(app));
  add(createRender(app));
  add(createTurns(app));
  add(createProposals(app));
  installEvents(app);
  const { chatState, identity: who, chatWorkspaceKey } = app;

  // The agent's old Roleplay threads, handed to Chats (on this level) through
  // Workspace: they move into Chats once.
  app.workspace.handover.offer("agent-group-threads", {
    // Old Roleplay group threads (kind "group") of a project move into Chats once, then leave the agent's list.
    oldGroupThreads(project) {
      app.ensureChatWorkspaceLoaded(project);
      return chatState.threads.filter((thread) => thread.kind === "group" && !thread.deleted && thread.messages?.length);
    },
    movedGroupThreads(threads) {
      for (const thread of threads) { thread.deleted = true; thread.updatedAt = Date.now(); }
      if (threads.length) app.persistChatWorkspaceState();
    }
  });

  // MCP connections (Settings → Agent), for this account and workspace.
  app.mcpControls = createMcpControls({
    list: document.querySelector("#mcp-connections"), status: document.querySelector("#mcp-status"),
    loadButton: document.querySelector("#mcp-load-button"), summary: document.querySelector("#chat-mcp-summary"),
    getIdentity: () => who.account() ? {
      serverUrl: settings.serverUrl, token: who.token(),
      scope: JSON.stringify([normalizeServerUrl(settings.serverUrl), who.account().username, chatWorkspaceKey()])
    } : null
  });

  // Another tab changed the agent's conversations: they arrive on Sync's stream.
  sync.events.on("event", ({ event, ownClientId }) => {
    if (event.type === "chat-workspace-update" && event.clientId !== ownClientId) receiveChatWorkspace(app.controller.getProject(), event.workspace);
  });
  // Drawn on each redraw (Shell's), once loaded.
  shell.events.on("render", ({ project }) => { if (project) app.renderChatPanel(project); });
  // The page follows the agent's status (Models'), whoever asked the server.
  models.agent.on(() => app.renderChatPanel(app.controller.getProject()));
  // Settings → Agent's connected tools are this page's: drawn when Settings opens.
  shell.settingsDialog.onOpen(() => app.mcpControls.render());
  if (shell.settingsDialog.isOpen()) app.mcpControls.render();

  /** A chat workspace pushed by the server (another participant changed it). */
  function receiveChatWorkspace(project, workspace) {
    app.ensureChatWorkspaceLoaded(project);
    if (workspace && Number.isInteger(workspace.revision)) app.chatSynchronizer?.receive(workspace);
  }

  // Test access (tests/helpers/chat_hook.py adds a line here).
  return {
    receiveChatWorkspace, renderChatPanel: app.renderChatPanel, refreshChatStatus: app.refreshChatStatus,
    findBatchMessage: app.findBatchMessage,
    ensureChatWorkspaceLoaded: app.ensureChatWorkspaceLoaded,
    chatState, get mcpControls() { return app.mcpControls; }, isOwnBatch: app.isOwnBatch
  };
}
