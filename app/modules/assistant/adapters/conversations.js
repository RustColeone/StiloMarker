// The agent's conversations: kept in this browser per workspace, synced with
// the server's copy, sorted, and which one is open.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { fetchServerChatWorkspace, pushServerChatWorkspace } from "./api.js";
import { createChatMessage, createChatThread, loadChatWorkspace, saveChatWorkspace } from "./store.js";
import { createChatSynchronizer } from "./workspace-sync.js";

export function createConversations(app) {
  const { chatConnectionInfo, chatWorkspaceKey, controller, elements, logDebug, workspace, chatState, agent, legacyChatProjectId, legacyChatScope } = app;
  function formatChatTimestamp(value) {
    if (!Number.isFinite(Number(value))) {
      return "Now";
    }
    return new Date(Number(value)).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function sortChatThreads() {
    chatState.threads.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function chatWorkspaceSnapshot() {
    return { threads: chatState.threads, activeThreadId: chatState.activeThreadId,
      activeGroupThreadId: chatState.activeGroupThreadId, syncBase: chatState.syncBase };
  }

  function cacheChatWorkspace() {
    if (!chatState.projectId) return;
    try { saveChatWorkspace(chatState.projectId, chatWorkspaceSnapshot()); }
    catch (error) { chatState.syncError = "Browser storage is full; keep this tab open."; logDebug("response", "Chat cache failed", error.message); }
  }

  function cancelChatForWorkspaceChange() {
    const turn = chatState.turn;
    if (!turn) return;
    const thread = chatState.threads.find(thread => thread.id === turn.threadId);
    if (thread) {
      const partial = chatState.streamingText.trim();
      // A Roleplay reply keeps its speaker, so the partial text stays theirs.
      const speaker = turn.group && turn.speaker && partial ? { speaker: turn.speaker.path, speakerName: turn.speaker.name } : {};
      thread.messages.push(createChatMessage(partial ? "assistant" : "system",
        partial || "Stopped because the workspace changed.", { interrupted: true, ...speaker }));
      thread.updatedAt = Date.now();
    }
    turn.controller.abort();
    chatState.turn = null;
    chatState.sending = false;
    chatState.abortController = null;
    chatState.streamingText = "";
    chatState.reasoningText = "";
    chatState.activity = [];
    cacheChatWorkspace();
  }

  function ensureChatWorkspaceLoaded(project) {
    const key = chatWorkspaceKey(project);
    const connection = chatConnectionInfo();
    if (chatState.turn && (chatState.turn.key !== key || chatState.turn.token !== connection?.token)) {
      cancelChatForWorkspaceChange();
    }
    if (chatState.projectId !== key) {
      cacheChatWorkspace();
      app.chatSynchronizer?.dispose(); app.chatSynchronizer = null; app.chatConnectionToken = null;
      let workspace = loadChatWorkspace(key);
      // Migrate only the workspace that was selected when this page loaded. Keep
      // the original cache intact; never copy shared legacy history into every project.
      if (!workspace.threads.length && key === legacyChatScope) workspace = loadChatWorkspace(legacyChatProjectId);
      chatState.projectId = key;
      chatState.threads = workspace.threads;
      chatState.activeThreadId = workspace.activeThreadId;
      chatState.activeGroupThreadId = workspace.activeGroupThreadId ?? null;
      chatState.syncBase = workspace.syncBase ?? null;
      chatState.syncError = null;
      chatState.renderedThreadId = null;
      elements.chatInput.value = getActiveChatThread()?.draft ?? "";
      sortChatThreads();
      chatState.shouldScrollToBottom = true;
    }
    if (connection?.token !== app.chatConnectionToken) {
      app.chatSynchronizer?.dispose(); app.chatSynchronizer = null;
      app.chatConnectionToken = connection?.token ?? null;
      if (connection) {
        const token = connection.token;
        const active = () => chatState.projectId === key && app.chatConnectionToken === token;
        app.chatSynchronizer = createChatSynchronizer({
          base: chatState.syncBase,
          getLocal: chatWorkspaceSnapshot,
          setLocal(workspace, base) {
            if (!active()) return;
            const oldThreads = new Map(chatState.threads.map(thread => [thread.id, thread]));
            chatState.threads = workspace.threads.map(next => {
              const thread = oldThreads.get(next.id);
              if (!thread) return next;
              const oldMessages = new Map(thread.messages.map(message => [message.id, message]));
              const messages = next.messages.map(message => {
                const old = oldMessages.get(message.id);
                return old ? Object.assign(old, message) : message;
              });
              return Object.assign(thread, next, { messages });
            });
            chatState.syncBase = base;
            chatState.activeThreadId = workspace.activeThreadId
              ?? workspace.threads.find(thread => thread.kind !== "group")?.id ?? null;
            cacheChatWorkspace();
            app.renderChatPanel(controller.getProject());
          },
          fetchRemote: () => fetchServerChatWorkspace(connection.serverUrl, token),
          pushRemote: workspace => pushServerChatWorkspace(connection.serverUrl, token, workspace),
          onError(error) {
            if (!active()) return;
            chatState.syncError = error ? "Chat sync paused; conversation kept on this device." : null;
            app.renderChatPanel(controller.getProject());
          }
        });
        app.chatSynchronizer.schedule(0);
      }
    }
  }

  function persistChatWorkspaceState(project = controller.getProject()) {
    if (chatWorkspaceKey(project) !== chatState.projectId) return;
    sortChatThreads();
    cacheChatWorkspace();
    app.chatSynchronizer?.schedule();
  }


  // The agent's threads. (Old Roleplay group threads, kind "group", are moved
  // into Chats once and then hidden.)
  function threadInActiveTab(thread) {
    return Boolean(thread) && !thread.deleted && thread.kind !== "group";
  }

  function setActiveThreadForTab(threadId) {
    chatState.activeThreadId = threadId;
  }

  function getActiveChatThread() {
    return chatState.threads.find((thread) => thread.id === chatState.activeThreadId && threadInActiveTab(thread)) ?? null;
  }

  function createThreadForActiveTab() {
    return createChatThread();
  }

  function ensureActiveChatThread() {
    let thread = getActiveChatThread();
    if (thread) {
      return thread;
    }
    thread = createThreadForActiveTab();
    chatState.threads.unshift(thread);
    setActiveThreadForTab(thread.id);
    persistChatWorkspaceState();
    return thread;
  }

  return { formatChatTimestamp, sortChatThreads, chatWorkspaceSnapshot, cacheChatWorkspace, cancelChatForWorkspaceChange, ensureChatWorkspaceLoaded, persistChatWorkspaceState, threadInActiveTab, setActiveThreadForTab, getActiveChatThread, createThreadForActiveTab, ensureActiveChatThread };
}
