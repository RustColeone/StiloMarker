// A turn of the agent: sending the message with what it may read, its
// progress as it streams, stopping it, retrying, and the agent's status in Settings.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { createChatMessage, deriveChatTitle } from "./store.js";
import { sendChatRequest } from "../../models/index.js";
import { contextFiles, projectSnapshot } from "../../characters/index.js";

export function createTurns(app) {
  const { chatConnectionInfo, chatWorkspaceKey, collaboration, controller, elements, logDebug, settings, identity, chatState, TAB_ID, agent, agentStatus, signedIn } = app;
  // Reflect the live agent availability into Settings → Agent's status line.
  function applyAgentSettingsStatus() {
    if (!elements.agentStatusLine) return;
    const { text, ok } = agent.settingsLine();
    elements.agentStatusLine.textContent = text;
    elements.agentStatusLine.classList.toggle("is-success", ok);
    elements.agentStatusLine.classList.toggle("is-error", !ok);
  }

  async function refreshChatStatus({ silent = false } = {}) {
    const refreshing = agent.refresh({ signedIn: signedIn(), silent });
    if (!silent) app.renderChatPanel(controller.getProject());
    await refreshing;
    applyAgentSettingsStatus();
    app.renderChatPanel(controller.getProject());
  }

  async function handleChatSubmit() {
    const prompt = elements.chatInput.value.trim();
    if (!prompt || chatState.sending) {
      return;
    }
    const project = controller.getProject();
    const thread = app.ensureActiveChatThread();
    const contextPaths = (thread.contextPaths ?? []).slice();
    thread.contextPaths = [];
    thread.messages.push(createChatMessage("user", prompt, { contextPaths }));
    thread.title = thread.title === "New Chat" ? deriveChatTitle(prompt) : thread.title;
    thread.updatedAt = Date.now();
    app.sortChatThreads();
    app.setActiveThreadForTab(thread.id);
    elements.chatInput.value = "";
    thread.draft = "";
    await runAgentTurn(thread, project);
  }

  /** Re-send the most recent failed turn (clears the trailing error first). */
  async function retryLastChatTurn() {
    if (chatState.sending) return;
    const thread = app.getActiveChatThread();
    if (!thread) return;
    while (thread.messages.length && thread.messages[thread.messages.length - 1].role === "system") {
      thread.messages.pop();
    }
    if (!thread.messages.some((message) => message.role === "user")) return;
    thread.updatedAt = Date.now();
    await runAgentTurn(thread, controller.getProject());
  }

  /** Send the thread's current messages to the agent and fold the reply (or
   *  error) back in. Shared by the compose box and the retry affordance. */
  // Interrupt an in-flight agent turn. Aborting the request rejects the fetch and
  // its stream reader; runAgentTurn's catch keeps any text streamed so far.
  function stopAgentTurn() {
    if (!chatState.sending || !chatState.abortController) return;
    chatState.stopped = true;
    chatState.abortController.abort(); // aborting a settled request does nothing
    logDebug("action", "Agent turn stopped by user");
  }

  async function runAgentTurn(thread, project) {
    const attached = contextFiles(project, {
      contextPaths: [...thread.messages].reverse().find(message => message.role === "user")?.contextPaths ?? thread.contextPaths
    });
    chatState.sending = true;
    chatState.stopped = false;
    chatState.abortController = new AbortController();
    const turn = { key: chatWorkspaceKey(project), threadId: thread.id,
      token: chatConnectionInfo()?.token, controller: chatState.abortController,
      baseRevision: collaboration.getRevision() };
    chatState.turn = turn;
    const current = () => chatState.turn === turn && chatWorkspaceKey() === turn.key
      && chatConnectionInfo()?.token === turn.token;
    chatState.activity = [];
    chatState.activityExpanded = false;
    chatState.streamingText = "";
    chatState.reasoningText = "";
    chatState.turnStartedAt = Date.now();
    chatState.shouldScrollToBottom = true;
    app.persistChatWorkspaceState(project);
    app.renderChatPanel(controller.getProject());

    try {
      if (!agentStatus().configured) {
        await refreshChatStatus({ silent: true });
      }
      if (!current()) return;
      if (!agentStatus().configured) {
        throw new Error(agentStatus().detail);
      }

      const response = await sendChatRequest(settings.serverUrl, {
        projectName: project.name,
        model: agentStatus().selectedModel ?? undefined,
        messages: thread.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ role: message.role, content: message.content })),
        contextFiles: attached,
        project: projectSnapshot(project),
        ...app.mcpControls.getRequest(),
        accountToken: identity.token(),
        // Own-key mode: pass the user's key/url/model so the proxy uses them.
        ...agent.requestOverride()
      }, (event) => {
        if (!current() || turn.controller.signal.aborted) return;
        if (event.type === "delta") {
          chatState.streamingText += event.text || "";
          app.renderChatPanel(controller.getProject());
          return;
        }
        // Reasoning-model chain-of-thought (shown live as muted "thinking" text).
        if (event.type === "reasoning") {
          chatState.reasoningText += event.text || "";
          app.renderChatPanel(controller.getProject());
          return;
        }
        // A new model turn starts fresh: clear any streamed text from the prior turn.
        if (event.type === "status") {
          chatState.streamingText = "";
          chatState.reasoningText = "";
        }
        const line = app.describeAgentActivity(event);
        if (!line) {
          return;
        }
        const last = chatState.activity[chatState.activity.length - 1];
        // "writing" events repeat with a growing char count \u2014 update the last
        // line in place instead of flooding the log with near-duplicates.
        if (event.type === "writing" && typeof last === "string" && last.startsWith(line.split("\u2026")[0])) {
          chatState.activity[chatState.activity.length - 1] = line;
          app.renderChatPanel(controller.getProject());
          return;
        }
        if (line !== last) {
          chatState.activity.push(line);
          app.renderChatPanel(controller.getProject());
        }
      }, turn.controller.signal);
      if (!current()) return;
      if (turn.controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      thread = chatState.threads.find(candidate => candidate.id === turn.threadId) ?? thread;

      agent.served({ provider: response.provider, model: response.model });
      const proposals = Array.isArray(response.proposedOperations) ? response.proposedOperations : [];
      const msgExtra = {};
      // Persist the reasoning stream so the answer keeps a collapsible "Thought
      // for…" section (like an IDE agent), not just a live-only thought stream.
      if (chatState.reasoningText.trim()) {
        msgExtra.reasoning = chatState.reasoningText;
        msgExtra.reasoningMs = Math.max(0, Date.now() - (chatState.turnStartedAt || Date.now()));
      }
      if (proposals.length > 0) {
        msgExtra.proposedOperations = proposals;
        msgExtra.batchId = response.batchId ?? null;
        msgExtra.baseRevision = turn.baseRevision;
        msgExtra.proposalState = "pending";
        msgExtra.originatorId = TAB_ID;
      }
      const assistantMessage = createChatMessage("assistant", response.message, msgExtra);
      thread.messages.push(assistantMessage);
      thread.updatedAt = Date.now();
      app.sortChatThreads();
      app.persistChatWorkspaceState(project);
      // Agent edits apply immediately so the user can read them in context and
      // then decide Keep or Drop (no separate Accept step — Accept and Keep/Drop
      // were redundant; the user couldn't preview a proposal without applying it).
      if (proposals.length > 0) {
        await app.autoApplyProposals(assistantMessage, {
          current: () => current() && !turn.controller.signal.aborted, baseRevision: turn.baseRevision
        });
      }
    } catch (error) {
      if (!current()) return;
      thread = chatState.threads.find(candidate => candidate.id === turn.threadId) ?? thread;
      if (error?.name === "AbortError" || chatState.stopped) {
        // User interrupted the turn. Keep whatever the model produced rather than
        // throwing the partial answer away.
        const partial = String(chatState.streamingText || "").trim();
        if (partial) {
          thread.messages.push(createChatMessage("assistant", partial, { interrupted: true }));
        } else {
          thread.messages.push(createChatMessage("system", "Stopped before the agent replied.", {}));
        }
        thread.updatedAt = Date.now();
        app.sortChatThreads();
        app.persistChatWorkspaceState(project);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        thread.messages.push(createChatMessage("system", message, { error: true }));
        thread.updatedAt = Date.now();
        app.sortChatThreads();
        app.persistChatWorkspaceState(project);
      }
    } finally {
      if (!current()) return;
      chatState.turn = null;
      chatState.abortController = null;
      chatState.stopped = false;
      chatState.sending = false;
      chatState.activity = [];
      chatState.streamingText = "";
      chatState.reasoningText = "";
      app.renderChatPanel(controller.getProject());
    }
  }

  return { applyAgentSettingsStatus, refreshChatStatus, handleChatSubmit, retryLastChatTurn, stopAgentTurn, runAgentTurn };
}
