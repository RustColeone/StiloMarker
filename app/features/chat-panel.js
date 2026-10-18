// The side panel's Agent page (one of Shell's pages): the agent's
// conversations and their sync, its turns and the edits it proposes (Keep /
// Drop), and the Agent status in Settings. It creates the Chats page
// (chats-page.js), which shares only the agent's server connection. Loaded the first time the panel (or Settings) is shown; the
// app passes in what it needs through deps.
import { undoSteps } from "./agent-undo.js";
import { createChatsPage } from "./chats-page.js";
import { editsHtml, editsLabel } from "../modules/assistant/index.js";
import { getNodeIdByPath, getPath, isImageFileName } from "../domain/project-model.js";
import { fetchChatStatus, fetchServerChatWorkspace, pushServerChatWorkspace, sendChatRequest } from "../services/chat-api-service.js";
import { createChatMessage, createChatThread, deriveChatTitle, loadChatWorkspace, saveChatWorkspace } from "../services/chat-storage-service.js";
import { createChatSynchronizer } from "../services/chat-sync-service.js";
import { contextChipsHtml, paintConversation, shouldSubmitChat } from "../services/chat-ui-service.js";
import { renderMarkdown } from "../modules/editor/index.js";
import { createMcpControls } from "../services/mcp-ui-service.js";
import { chosenModel, groupByProvider } from "../modules/models/index.js";
import { normalizeServerUrl } from "../modules/shell/index.js";
import { query } from "../ui/dom.js";

export function createChatPanel(deps) {
  // Who asked for an agent batch: this tab while it is open (not the sync client id,
  // which changes on every reconnect and locked the asker out of Keep and Drop).
  const TAB_ID = globalThis.crypto?.randomUUID?.() ?? `tab-${Math.random().toString(36).slice(2)}`;
  const isOwnBatch = (message) => !message.originatorId || message.originatorId === TAB_ID;
  const {
    cloudWorkspaceTarget,
    agentCheckpoints, agentPendingDecorations, buildTextDiffHunks, captureAgentCheckpoint,
    chatConnectionInfo, chatWorkspaceKey, clearAgentDecorations, collaboration, controller,
    createFileInFolder, elements, escapeHtmlAttribute, getSelectedParent, isMobileLayout,
    jumpToAgentChange, logDebug, notify, openFileFromExplorer, openSettingsDialog,
    personaAvatarSrc, promptForName, registerAgentDecorations, settings, workspace,
    showConfirmDialog, showToast, storedProject, updateEditorAgentBar, identity, pages
  } = deps;
  let mcpControls = null;

  const legacyChatProjectId = storedProject?.id ?? "server-project";
  const legacyChatScope = settings.syncedProjectId
    ? `cloud:${normalizeServerUrl(settings.serverUrl)}/${settings.syncedProjectId}` : null;
  let chatSynchronizer = null;
  let chatConnectionToken = null;
  const chatState = {
    projectId: null,
    syncBase: null,
    syncError: null,
    turn: null,
    renderedThreadId: null,
    activeThreadId: null,
    activeGroupThreadId: null,
    threads: [],
    configured: false,
    localOnly: true,
    provider: null,
    model: null,
    models: [],
    selectedModel: null,
    status: "idle",
    detail: "Checking chat backend...",
    sending: false,
    activity: [],
    activityExpanded: false,
    streamingText: "",
    reasoningText: "",
    turnStartedAt: 0,
    // Message ids whose persisted "Thought for…" section is expanded.
    expandedReasoning: new Set(),
    shouldScrollToBottom: false
  };

  function renderProposalDiff(op) {
    if (op.type === "create-file" && op.generatedImage) {
      const src = generatedImageUrl(op.generatedImage);
      const caption = `${op.generatedImage.size ?? ""} · ${op.generatedImage.model ?? "image model"}`;
      return `<figure class="proposal-image">${src ? `<img src="${escapeHtmlAttribute(src)}" alt="${escapeHtmlAttribute(op.generatedImage.prompt ?? op.name ?? "")}" loading="lazy">` : ""}
        <figcaption>${escapeHtmlAttribute(op.generatedImage.prompt ?? "")}<span>${escapeHtmlAttribute(caption)}</span></figcaption></figure>`;
    }
    if (op.type === "create-file") {
      const lines = (op.content ?? "").split("\n").slice(0, 20);
      const more = (op.content ?? "").split("\n").length > 20 ? `<span class="proposal-diff-more">…${(op.content ?? "").split("\n").length - 20} more lines</span>` : "";
      return `<pre class="proposal-diff-block proposal-diff-add">${lines.map((l) => escapeHtmlAttribute(l)).join("\n")}</pre>${more}`;
    }
    if (op.type === "delete-node") {
      return `<div class="proposal-diff-warning">⚠ This will permanently delete the file or folder.</div>`;
    }
    if (op.type === "rename-node") {
      return `<div class="proposal-diff-rename"><span class="proposal-diff-del">${escapeHtmlAttribute(op.preImage ?? op.path)}</span> → <span class="proposal-diff-add">${escapeHtmlAttribute(op.name ?? "")}</span></div>`;
    }
    if (op.type === "move-node") {
      return `<div class="proposal-diff-rename"><span class="proposal-diff-del">${escapeHtmlAttribute(op.path ?? "")}</span> → <span class="proposal-diff-add">${escapeHtmlAttribute(op.parentPath ?? "(root)")}/${escapeHtmlAttribute(op.path?.split("/").pop() ?? "")}</span></div>`;
    }
    if (op.type === "update-file" && typeof op.preImage === "string") {
      const hunks = buildTextDiffHunks(op.preImage, op.content ?? "");
      if (hunks.length === 0) {
        return `<div class="proposal-diff-warning">No content change detected.</div>`;
      }
      const lines = hunks.map((h) => {
        const cls = h.op === "-" ? "proposal-diff-del" : h.op === "+" ? "proposal-diff-add" : "proposal-diff-ctx";
        return `<div class="proposal-diff-line ${cls}">${escapeHtmlAttribute(h.op + " " + h.text)}</div>`;
      }).join("");
      return `<div class="proposal-diff-block">${lines}</div>`;
    }
    return "";
  }

  const OP_ICONS = {
    "create-file": "+",
    "update-file": "~",
    "rename-node": "r",
    "delete-node": "×",
    "create-folder": "+",
    "move-node": "→"
  };

  /** Render a proposal card for an assistant message that has proposedOperations. */
  function renderProposalCard(message, isOriginator) {
    const ops = message.proposedOperations ?? [];
    if (ops.length === 0) return "";
    const batchId = escapeHtmlAttribute(message.batchId ?? "");
    const state = message.proposalState ?? "pending";

    // Terminal states: read-only summary
    if (state === "kept") {
      return `<div class="proposal-card is-${state}" data-batch-id="${batchId}">
        <div class="proposal-card-header"><span class="proposal-card-title proposal-card-resolved">✓ Edits kept (${ops.length})</span></div>
      </div>`;
    }
    if (state === "stale") {
      return `<div class="proposal-card is-stale"><div class="proposal-card-header"><span class="proposal-card-title">Edits not applied — the workspace changed. Send a new request using the current notes.</span></div></div>`;
    }
    if (state === "dropped") {
      return `<div class="proposal-card is-${state}" data-batch-id="${batchId}">
        <div class="proposal-card-header"><span class="proposal-card-title proposal-card-resolved">↩ Edits dropped (${ops.length})</span></div>
      </div>`;
    }

    const originatorAttr = isOriginator ? "" : ' disabled title="Only the original requester can act on this proposal"';

    const opRows = ops.map((op) => {
      const opId = escapeHtmlAttribute(op.proposalId ?? "");
      const opType = String(op.type ?? "");
      const opPath = escapeHtmlAttribute(op.path ?? op.name ?? "");
      const icon = OP_ICONS[opType] ?? "?";
      const opState = op.proposalState ?? state;
      // An edit_file proposal shows each edit; a generated picture is shown outright; other changes fold away.
      const diffHtml = op.edits?.length ? editsHtml(op.edits) : renderProposalDiff(op);
      const diffSection = !diffHtml ? "" : op.generatedImage ? diffHtml
        : `<details class="proposal-op-diff"><summary>${op.edits?.length ? editsLabel(op.edits) : "diff"}</summary><div class="proposal-op-diff-body">${diffHtml}</div></details>`;

      if (opState === "stale") {
        return `<div class="proposal-op is-stale" data-proposal-id="${opId}">
          <span class="proposal-op-icon">${escapeHtmlAttribute(icon)}</span>
          <span class="proposal-op-path">${opPath}</span>
          <span class="proposal-op-badge">stale</span>
          ${diffSection}
        </div>`;
      }
      return `<div class="proposal-op is-${escapeHtmlAttribute(opState)}" data-proposal-id="${opId}">
        <span class="proposal-op-icon">${escapeHtmlAttribute(icon)}</span>
        <span class="proposal-op-path">${opPath}</span>
        ${diffSection}
      </div>`;
    }).join("");

    let batchButtons = "";
    {
      const hasDecorations = [...agentPendingDecorations.values()].some((d) => d.batchId === (message.batchId ?? ""));
      const jumpBtn = hasDecorations
        ? `<button class="proposal-btn proposal-btn-jump" type="button" data-batch-jump="${batchId}" title="Jump to change in editor">↕</button>`
        : "";
      batchButtons = `
        ${jumpBtn}
        <button class="proposal-btn proposal-btn-keep" type="button" data-batch-keep="${batchId}"${originatorAttr}>Keep</button>
        <button class="proposal-btn proposal-btn-drop-final" type="button" data-batch-drop-final="${batchId}"${originatorAttr}>Drop</button>`;
    }

    const title = `Applied edits (${ops.length}) — review:`;

    return `<div class="proposal-card is-${escapeHtmlAttribute(state)}" data-batch-id="${batchId}">
      <div class="proposal-card-header">
        <span class="proposal-card-title">${escapeHtmlAttribute(title)}</span>
        <div class="proposal-card-actions">${batchButtons}</div>
      </div>
      <div class="proposal-card-ops">${opRows}</div>
    </div>`;
  }

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
      chatSynchronizer?.dispose(); chatSynchronizer = null; chatConnectionToken = null;
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
    if (connection?.token !== chatConnectionToken) {
      chatSynchronizer?.dispose(); chatSynchronizer = null;
      chatConnectionToken = connection?.token ?? null;
      if (connection) {
        const token = connection.token;
        const active = () => chatState.projectId === key && chatConnectionToken === token;
        chatSynchronizer = createChatSynchronizer({
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
            renderChatPanel(controller.getProject());
          },
          fetchRemote: () => fetchServerChatWorkspace(connection.serverUrl, token),
          pushRemote: workspace => pushServerChatWorkspace(connection.serverUrl, token, workspace),
          onError(error) {
            if (!active()) return;
            chatState.syncError = error ? "Chat sync paused; conversation kept on this device." : null;
            renderChatPanel(controller.getProject());
          }
        });
        chatSynchronizer.schedule(0);
      }
    }
  }

  function persistChatWorkspaceState(project = controller.getProject()) {
    if (chatWorkspaceKey(project) !== chatState.projectId) return;
    sortChatThreads();
    cacheChatWorkspace();
    chatSynchronizer?.schedule();
  }

  const pageOpen = (id) => pages.active("side") === id; // which side-panel page is open (Shell's pages)

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

  function resolveChatContextFiles(project, thread) {
    return (thread?.contextPaths ?? []).map((path) => {
      const nodeId = getNodeIdByPath(project, path);
      const node = nodeId ? project.nodes[nodeId] : null;
      if (!node || node.kind !== "file") {
        return null;
      }
      if (isImageFileName(node.name)) {
        return {
          path,
          kind: "image",
          content: ""
        };
      }
      return {
        path,
        kind: "text",
        content: typeof node.content === "string" ? node.content : ""
      };
    }).filter(Boolean);
  }

  /** Human-readable line for one agent progress step. */
  function describeAgentActivity(event) {
    if (event.type === "mcp-status") return `${event.server}: ${event.message}`;
    if (event.type === "tool" && event.server) return `${event.server} · ${event.name}`;
    if (event.type === "status") {
      return event.iteration > 0 ? "Reviewing the workspace…" : "Reading your request…";
    }
    if (event.type === "writing") {
      const verbs = {
        create_file: "Drafting new file",
        update_file: "Editing file",
        rename_node: "Renaming",
        delete_node: "Deleting",
        create_folder: "Creating folder",
        move_node: "Moving",
        generate_image: "Describing image"
      };
      const verb = verbs[event.name] || "Working";
      const chars = Number(event.chars) || 0;
      return `${verb}… (${chars.toLocaleString()} chars)`;
    }
    if (event.type === "tool") {
      const target = event.target ? `: ${event.target}` : "";
      const verbs = {
        list_files: "Listing files",
        read_file: "Reading file",
        create_file: "Drafting new file",
        update_file: "Editing file",
        rename_node: "Renaming",
        delete_node: "Deleting",
        create_folder: "Creating folder",
        move_node: "Moving",
        generate_image: "Generating image (this can take a minute)"
      };
      const verb = verbs[event.name] || event.name || "Working";
      return `${verb}${target}`;
    }
    return "Working…";
  }

  function formatThinkingLabel(ms) {
    if (!ms || ms < 1500) return "Thought for a moment";
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `Thought for ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `Thought for ${minutes}m ${seconds % 60}s`;
  }

  /** Collapsible "Thought for…" section persisted on an assistant message. */
  function renderMessageReasoning(message) {
    if (message.role !== "assistant" || !message.reasoning) return "";
    const expanded = chatState.expandedReasoning.has(message.id);
    return `
      <div class="chat-thought${expanded ? " is-open" : ""}">
        <button type="button" class="chat-thought-toggle" data-chat-thought-toggle="${escapeHtmlAttribute(message.id)}" aria-expanded="${expanded ? "true" : "false"}">
          <span class="chat-thought-caret" aria-hidden="true">▸</span>
          <span class="chat-thought-label">${escapeHtmlAttribute(formatThinkingLabel(message.reasoningMs))}</span>
        </button>
        ${expanded ? `<div class="chat-thought-body">${escapeHtmlAttribute(message.reasoning)}</div>` : ""}
      </div>`;
  }

  /** Render the live agent activity log shown inside the thinking indicator. */
  function renderAgentActivity() {
    if (!chatState.activity.length) {
      return `<div class="chat-activity-line">Working…</div>`;
    }
    const total = chatState.activity.length;
    const COLLAPSED = 6;
    const expanded = chatState.activityExpanded || total <= COLLAPSED;
    const visible = expanded ? chatState.activity : chatState.activity.slice(-COLLAPSED);
    const lines = visible
      .map((line) => `<div class="chat-activity-line">${escapeHtmlAttribute(line)}</div>`)
      .join("");
    if (total <= COLLAPSED) {
      return lines;
    }
    const toggle = expanded
      ? `<button type="button" class="chat-activity-toggle" data-chat-activity-toggle>Show less</button>`
      : `<button type="button" class="chat-activity-toggle" data-chat-activity-toggle>Show all ${total} steps</button>`;
    return lines + toggle;
  }

  // Rendered markdown per chat message. The panel re-renders on many app events,
  // and re-running markdown over every reply in the thread each time made its
  // cost grow with the length of the conversation — the longer you used the
  // agent, the slower everything else got.
  const chatMarkdownCache = new Map(); // message id -> { content, html }

  function chatMessageMarkdown(message) {
    const content = message.content ?? "";
    const hit = chatMarkdownCache.get(message.id);
    if (hit && hit.content === content) return hit.html;
    const html = renderMarkdown(content);
    if (chatMarkdownCache.size > 2000) chatMarkdownCache.clear(); // bound memory across workspaces
    chatMarkdownCache.set(message.id, { content, html });
    return html;
  }

  // The side panel: whichever page is open draws itself; Chats' unread count
  // shows on its tab either way.
  function renderChatPanel(project) {
    ensureChatWorkspaceLoaded(project); // first: the Chats page moves old Roleplay threads out of it
    chatsPage.badge();
    if (pageOpen("chats")) chatsPage.render(project);
    else renderAgentPage(project);
  }

  // ---- The Chats page (features/chats-page.js), given the agent's connection ----
  const chatsPage = createChatsPage({
    ...deps,
    rerender: () => renderChatPanel(controller.getProject()),
    agent: {
      selectedModel: () => chatState.selectedModel ?? undefined,
      // The server's agent writes a character's reply: say why when it cannot.
      async ensureServerAgent() {
        if (!chatState.configured) await refreshChatStatus({ silent: true });
        if (!chatState.configured) throw new Error(chatState.detail);
      },
      projectSnapshot: (project) => buildAgentProjectSnapshot(project),
      contextFiles: (project, options) => resolveChatContextFiles(project, options),
      requestOverride: () => agentRequestOverride(),
      // Old Roleplay group threads (kind "group") move into Chats once, then leave the agent's list.
      oldGroupThreads: () => chatState.threads.filter((thread) => thread.kind === "group" && !thread.deleted && thread.messages?.length),
      movedGroupThreads(threads) {
        for (const thread of threads) { thread.deleted = true; thread.updatedAt = Date.now(); }
        if (threads.length) persistChatWorkspaceState();
      }
    }
  });

  // ---- The Agent page ------------------------------------------------------------
  function renderAgentPage(project) {
    mcpControls?.render();
    ensureChatWorkspaceLoaded(project);

    const activeThread = getActiveChatThread();
    if (elements.chatInput.placeholder !== "Ask the agent…") elements.chatInput.placeholder = "Ask the agent…";
    const messageList = elements.chatMessageList;
    // Scroll state is read (and later written) only when the conversation will
    // actually change. Reading scrollTop forces a layout of the whole page, and
    // this panel renders on many unrelated events — it was paying for laying out
    // a freshly rebuilt preview on every one of them, even while hidden.
    const renderedKey = activeThread?.id;
    const threadChanged = chatState.renderedThreadId !== renderedKey;
    if (threadChanged) elements.chatInput.value = activeThread?.draft ?? "";
    chatState.renderedThreadId = renderedKey;
    // Model picker — only meaningful when the server offers more than one model.
    const showPicker = chatState.configured && chatState.models.length > 1;
    renderChatStatus(showPicker);
    if (elements.chatModelSelect) {
      elements.chatModelSelect.hidden = !showPicker;
      if (showPicker) {
        const desired = chatState.selectedModel ?? chatState.models[0];
        const option = (name) => `<option value="${escapeHtmlAttribute(name)}"${name === desired ? " selected" : ""}>${escapeHtmlAttribute(name)}</option>`;
        // Grouped by provider when the server offers more than one (DeepSeek, OpenAI).
        const groups = groupByProvider(chatState.models, (name) => chatState.modelProviders?.get(name));
        const optionsHtml = groups.length > 1
          ? groups.map(([group, names]) => `<optgroup label="${escapeHtmlAttribute(group || "Other")}">${names.map(option).join("")}</optgroup>`).join("")
          : chatState.models.map(option).join("");
        if (elements.chatModelSelect.innerHTML !== optionsHtml) {
          elements.chatModelSelect.innerHTML = optionsHtml;
        }
        elements.chatModelSelect.value = desired;
        elements.chatModelSelect.disabled = chatState.sending;
      }
    }

    const allTabThreads = chatState.threads.filter(threadInActiveTab);
    const query = (elements.chatHistorySearch?.value ?? "").trim().toLowerCase();
    const tabThreads = query
      ? allTabThreads.filter((thread) => thread.title.toLowerCase().includes(query)
        || thread.messages.some((message) => String(message.content ?? "").toLowerCase().includes(query)))
      : allTabThreads;
    const threadListHtml = tabThreads.length
      ? tabThreads.map((thread) => {
        const meta = `${thread.messages.length} msg · ${formatChatTimestamp(thread.updatedAt)}`;
        const id = escapeHtmlAttribute(thread.id);
        return `
          <div class="chat-thread-row${thread.id === activeThread?.id ? " is-active" : ""}">
            <button class="chat-thread-button" type="button" data-chat-thread-id="${id}">
              <span class="chat-thread-title">${escapeHtmlAttribute(thread.title)}</span>
              <span class="chat-thread-meta">${escapeHtmlAttribute(meta)}</span>
            </button>
            <span class="chat-thread-actions">
              <button class="chat-thread-action" type="button" data-chat-thread-rename="${id}" title="Rename" aria-label="Rename ${escapeHtmlAttribute(thread.title)}">✎</button>
              <button class="chat-thread-action" type="button" data-chat-thread-delete="${id}" title="Delete" aria-label="Delete ${escapeHtmlAttribute(thread.title)}">×</button>
            </span>
          </div>
        `;
      }).join("")
      : query
        ? `<div class="chat-empty-state">No conversations match “${escapeHtmlAttribute(query)}”.</div>`
        : `<div class="chat-empty-state">No conversations yet.<br>Press <strong>+</strong> to start one.</div>`;
    if (elements.chatThreadList._renderedHtml !== threadListHtml) {
      elements.chatThreadList.innerHTML = threadListHtml;
      elements.chatThreadList._renderedHtml = threadListHtml;
    }

    // Context chips — empty string collapses the list via CSS :empty rule.
    elements.chatContextList.innerHTML = contextChipsHtml(activeThread?.contextPaths ?? [], escapeHtmlAttribute);

    // Messages: render assistant replies as markdown; plain text for user / system.
    const streamingHtml = chatState.streamingText
      ? `<div class="chat-stream-preview">${renderMarkdown(chatState.streamingText)}</div>`
      : "";
    // Reasoning-model chain-of-thought, shown live as muted "thinking" text above
    // the answer (like an IDE agent's greyed thought stream). Only present when the
    // model streams reasoning_content.
    const reasoningHtml = chatState.reasoningText
      ? `<div class="chat-reasoning" aria-label="Agent thinking">${escapeHtmlAttribute(chatState.reasoningText)}</div>`
      : "";
    const thinkingHtml = chatState.sending && chatState.turn?.threadId === activeThread?.id
      ? `<div class="chat-thinking" aria-label="Agent is working" aria-live="polite">
          ${reasoningHtml}
          ${streamingHtml}
          <div class="chat-thinking-foot">
            <div class="chat-thinking-dots">
              <span class="chat-thinking-dot"></span>
              <span class="chat-thinking-dot"></span>
              <span class="chat-thinking-dot"></span>
            </div>
            ${renderAgentActivity()}
          </div>
         </div>`
      : "";

    const historyHtml = activeThread?.messages?.length
      ? activeThread.messages.map((message) => {
        const roleLabel = message.role === "user" ? "You" : message.role === "assistant" ? "Agent" : "System";
        const contentHtml = message.role === "assistant"
          ? chatMessageMarkdown(message)
          : escapeHtmlAttribute(message.content);
        const contextBadgesHtml = message.contextPaths?.length
          ? `<div class="chat-message-context">${
              message.contextPaths.map((p) =>
                `<span class="chat-message-context-file">${escapeHtmlAttribute(p)}</span>`
              ).join("")
            }</div>`
          : "";
        const isOriginator = isOwnBatch(message);
        const proposalCardHtml = message.role === "assistant" && message.proposedOperations?.length
          ? renderProposalCard(message, isOriginator)
          : "";
        // Offer a retry on a failed turn so the user can re-send without retyping.
        const retryHtml = message.error && !chatState.sending
          ? `<button type="button" class="chat-message-retry" data-chat-retry>↻ Retry</button>`
          : "";
        return `
          <article class="chat-message${message.error ? " is-error" : ""}${message.interrupted ? " is-interrupted" : ""}" data-role="${escapeHtmlAttribute(message.role)}" data-msg-id="${escapeHtmlAttribute(message.id)}">
            <div class="chat-message-meta">
              <span class="chat-message-role">${escapeHtmlAttribute(roleLabel)}</span>
              <span class="chat-message-time">${escapeHtmlAttribute(formatChatTimestamp(message.createdAt))}</span>
            </div>
            ${renderMessageReasoning(message)}
            <div class="chat-message-content">${contentHtml}</div>
            ${contextBadgesHtml}
            ${proposalCardHtml}
            ${retryHtml}
          </article>
        `;
      }).join("")
      : agentEmptyStateHtml();

    // Update only the live reply while streaming; keep earlier DOM nodes intact
    // so selections and expanded message controls survive incoming tokens.
    paintConversation(messageList, historyHtml, thinkingHtml, { changed: threadChanged, toBottom: chatState.shouldScrollToBottom });

    // While a turn is in flight the send button becomes a Stop control — before
    // this there was no way to interrupt the agent once it started.
    const sending = chatState.sending;
    elements.chatSendButton.disabled = sending ? false : !elements.chatInput.value.trim();
    elements.chatSendButton.classList.toggle("is-stop", sending);
    elements.chatSendButton.textContent = sending ? "\u25a0" : "\u2191";
    elements.chatSendButton.title = sending ? "Stop the agent" : (isMobileLayout() ? "Send" : "Send (Enter)");
    elements.chatSendButton.setAttribute("aria-label", sending ? "Stop the agent" : "Send");
    elements.chatAddActiveFileButton.disabled = !project.activeFileId;
    elements.chatInput.disabled = false;
    chatState.shouldScrollToBottom = false;

    // Refresh in-editor agent bar whenever proposal state changes.
    updateEditorAgentBar();
  }

  // The compose footer's status: a coloured dot, a word only when something
  // needs attention (or the single model's name), and the detail in the tooltip.
  const STATUS_WORDS = { signin: "Sign in", offline: "Offline", unconfigured: "No key", restricted: "Not allowed", checking: "Checking…" };

  function renderChatStatus(showPicker) {
    const el = elements.chatStatusText;
    const provider = chatState.modelProviders?.get(chatState.selectedModel) ?? chatState.provider;
    const ready = chatState.status === "ready" && chatState.configured;
    const tone = chatState.syncError ? "warn"
      : ready ? "ok"
      : chatState.status === "checking" ? "busy"
      : chatState.status === "signin" ? "warn"
      : "error";
    const word = chatState.syncError ? "Sync paused"
      : ready ? (showPicker ? "" : (chatState.model ?? ""))
      : (STATUS_WORDS[chatState.status] ?? "Unavailable");
    const where = chatState.configured && provider
      ? `${provider}${chatState.selectedModel ?? chatState.model ? ` · ${chatState.selectedModel ?? chatState.model}` : ""}` : "";
    const detail = [chatState.syncError || chatState.detail, where].filter(Boolean).join(" — ");
    const title = `${detail}${ready ? " (click to re-check)" : " (click to fix)"}`;
    el.dataset.tone = tone;
    el.classList.toggle("is-error", tone === "error" || tone === "warn");
    const label = el.querySelector(".chat-status-label");
    if (label && label.textContent !== word) label.textContent = word;
    if (el.title !== title) { el.title = title; el.setAttribute("aria-label", title); }
  }

  /** First-run hints for the agent: what it can do, as prompts to start from. */
  function agentEmptyStateHtml() {
    const examples = [
      "Summarize the open file and suggest a better title",
      "Make a character file for the main character of my current chapter",
      ...(chatState.imageGeneration && identity.account() ? ["Draw the opening scene of my current chapter"] : []),
      "Find every note that mentions this file and link them together"
    ];
    return `<div class="chat-empty-state chat-empty-agent">
      <p>Ask about your workspace, or have the agent edit it — you review every change.</p>
      <div class="chat-examples">${examples.map((text) =>
        `<button type="button" class="chat-example" data-chat-example="${escapeHtmlAttribute(text)}">${escapeHtmlAttribute(text)}</button>`).join("")}</div>
      <p class="chat-empty-hint">Attach files with <strong>@ File</strong> or by dragging them onto the box below.</p>
    </div>`;
  }

  async function renameChatThread(threadId) {
    const thread = chatState.threads.find((entry) => entry.id === threadId);
    if (!thread) return;
    const title = await promptForName("Rename conversation", thread.title, { submitLabel: "Rename", label: "Title" });
    if (!title || title === thread.title) return;
    thread.title = title.trim().slice(0, 120);
    thread.updatedAt = Date.now();
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  async function deleteChatThread(threadId) {
    const thread = chatState.threads.find((entry) => entry.id === threadId);
    if (!thread) return;
    const ok = await showConfirmDialog({ title: "Delete conversation", message: `Delete “${thread.title}”? It is removed for everyone in this workspace.`, acceptLabel: "Delete" });
    if (!ok) return;
    thread.deleted = true;
    thread.updatedAt = Date.now();
    if (thread.id === chatState.activeThreadId) chatState.activeThreadId = chatState.threads.find((t) => !t.deleted && t.kind !== "group")?.id ?? null;
    if (thread.id === chatState.activeGroupThreadId) chatState.activeGroupThreadId = chatState.threads.find((t) => !t.deleted && t.kind === "group")?.id ?? null;
    chatState.shouldScrollToBottom = true;
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  function setActiveChatThread(threadId) {
    if (!chatState.threads.some((thread) => thread.id === threadId && threadInActiveTab(thread))) {
      return;
    }
    setActiveThreadForTab(threadId);
    chatState.shouldScrollToBottom = true;
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  function createNewChatConversation() {
    const thread = createThreadForActiveTab();
    chatState.threads.unshift(thread);
    setActiveThreadForTab(thread.id);
    chatState.shouldScrollToBottom = true;
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
    elements.chatInput.focus();
  }

  function addChatContextPath(path) {
    const thread = ensureActiveChatThread();
    if (!path || thread.contextPaths.includes(path)) {
      renderChatPanel(controller.getProject());
      return;
    }
    thread.contextPaths = [...thread.contextPaths, path];
    thread.updatedAt = Date.now();
    sortChatThreads();
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  function removeChatContextPath(path) {
    const thread = getActiveChatThread();
    if (!thread) {
      return;
    }
    thread.contextPaths = thread.contextPaths.filter((entry) => entry !== path);
    thread.updatedAt = Date.now();
    sortChatThreads();
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  function addActiveFileToChatContext() {
    const project = controller.getProject();
    if (!project.activeFileId) {
      notify("Open a file first to add it to the chat context.");
      return;
    }
    addChatContextPath(getPath(project, project.activeFileId));
  }

  mcpControls = createMcpControls({
    list: query("#mcp-connections"), status: query("#mcp-status"), loadButton: query("#mcp-load-button"), summary: query("#chat-mcp-summary"),
    getIdentity: () => identity.account() ? {
      serverUrl: settings.serverUrl, token: identity.token(),
      scope: JSON.stringify([normalizeServerUrl(settings.serverUrl), identity.account().username, chatWorkspaceKey()])
    } : null
  });

  // Own-key mode: the request override sent to the proxy (empty in server mode or
  // when no key is entered, so the server's own key is used instead).
  function agentRequestOverride() {
    if (settings.agentSource !== "own") return {};
    const apiKey = (settings.agentApiKey || "").trim();
    if (!apiKey) return {};
    const override = { apiKey };
    const url = (settings.agentApiUrl || "").trim();
    const model = (settings.agentModel || "").trim();
    if (url) override.apiUrl = url;
    if (model) override.apiModel = model;
    return override;
  }

  // True when own-key mode is selected and a key is entered — the agent is usable
  // through the proxy regardless of whether the server itself has a key.
  function agentOwnKeyReady() {
    return settings.agentSource === "own" && Boolean((settings.agentApiKey || "").trim());
  }

  // Reflect the live agent availability into the Agent tab's status line.
  function applyAgentSettingsStatus() {
    if (!elements.agentStatusLine) return;
    const el = elements.agentStatusLine;
    let text;
    let ok = false;
    if (agentOwnKeyReady()) {
      text = "Ready — using your own API key.";
      ok = true;
    } else if (settings.agentSource === "own") {
      text = "Enter your API key below to enable the agent.";
    } else if (chatState.configured) {
      text = `Ready — ${chatState.provider ?? "server"}${chatState.model ? " · " + chatState.model : ""}.`;
      ok = true;
    } else if (chatState.status === "signin") {
      text = "Sign in with your account (Settings → Collaboration) to use this server's agent, or switch to “My own API key”.";
    } else if (chatState.status === "offline") {
      text = "Server unreachable — can't check the agent.";
    } else {
      text = chatState.detail || "This server has no agent key. Switch to “My own API key”, or set one on the server.";
    }
    el.textContent = text;
    el.classList.toggle("is-success", ok);
    el.classList.toggle("is-error", !ok);
  }

  async function refreshChatStatus({ silent = false } = {}) {
    chatState.status = "checking";
    if (!silent) {
      chatState.detail = "Checking chat backend...";
      renderChatPanel(controller.getProject());
    }

    const ownReady = agentOwnKeyReady();
    try {
      const status = await fetchChatStatus(settings.serverUrl);
      // Own-key mode is "configured" whenever a key is entered (the proxy will use
      // it and bypass the server's localhost gate), independent of the server key.
      chatState.configured = ownReady || Boolean(status.configured);
      chatState.localOnly = ownReady ? false : status.localOnly !== false;
      if (ownReady) {
        chatState.provider = "Your key";
        chatState.model = (settings.agentModel || "").trim() || "custom";
        chatState.models = [chatState.model];
        chatState.selectedModel = chatState.model;
        chatState.status = "ready";
        chatState.detail = "Using your own API key.";
      } else {
        // A server with accounts only lets signed-in users spend its keys.
        const needsSignIn = Boolean(status.requiresAccount) && !identity.account();
        chatState.configured = Boolean(status.configured) && !needsSignIn;
        chatState.provider = status.provider ?? null;
        chatState.model = status.model ?? null;
        chatState.models = Array.isArray(status.models) && status.models.length
          ? status.models
          : (status.model ? [status.model] : []);
        chatState.modelProviders = new Map((Array.isArray(status.modelInfo) ? status.modelInfo : [])
          .map((row) => [row.id, row.provider]));
        chatState.imageGeneration = Boolean(status.imageGeneration);
        // Keep the user's saved choice if the server still offers it, else default.
        chatState.selectedModel = chosenModel(chatState.models, settings.chatModel, status.model);
        chatState.status = chatState.configured ? "ready" : (needsSignIn && status.configured ? "signin" : "unconfigured");
        chatState.detail = chatState.configured
          ? "Ready"
          : chatState.status === "signin"
            ? "Sign in to use the agent"
            : "Agent needs a key — click to open Settings → Agent and use your own, or set one on the server.";
      }
    } catch (error) {
      // The status check failed (server unreachable, etc). Own-key mode is still
      // "usable" optimistically — the actual send surfaces any real failure.
      chatState.configured = ownReady;
      chatState.provider = ownReady ? "Your key" : null;
      chatState.model = ownReady ? ((settings.agentModel || "").trim() || "custom") : null;
      chatState.models = ownReady ? [chatState.model] : [];
      chatState.selectedModel = ownReady ? chatState.model : null;
      chatState.status = ownReady ? "ready" : (error?.status === 403 ? "restricted" : "offline");
      chatState.detail = ownReady ? "Using your own API key." : (error instanceof Error ? error.message : String(error));
    }

    applyAgentSettingsStatus();
    renderChatPanel(controller.getProject());
  }

  /** Build a lean project snapshot for the agent: full tree + text content,
   *  but image file contents stripped (data-URLs are large and the agent can't
   *  edit images anyway). Lets the agent see the user's real files in local mode. */
  function buildAgentProjectSnapshot(project) {
    const nodes = {};
    for (const [id, node] of Object.entries(project.nodes ?? {})) {
      if (node.kind === "file" && isImageFileName(node.name)) {
        nodes[id] = { ...node, content: "" };
      } else {
        nodes[id] = { ...node };
      }
    }
    return { rootId: project.rootId, nodes };
  }

  async function handleChatSubmit() {
    const prompt = elements.chatInput.value.trim();
    if (!prompt || chatState.sending) {
      return;
    }
    const project = controller.getProject();
    const thread = ensureActiveChatThread();
    const contextPaths = (thread.contextPaths ?? []).slice();
    thread.contextPaths = [];
    thread.messages.push(createChatMessage("user", prompt, { contextPaths }));
    thread.title = thread.title === "New Chat" ? deriveChatTitle(prompt) : thread.title;
    thread.updatedAt = Date.now();
    sortChatThreads();
    setActiveThreadForTab(thread.id);
    elements.chatInput.value = "";
    thread.draft = "";
    await runAgentTurn(thread, project);
  }

  /** Re-send the most recent failed turn (clears the trailing error first). */
  async function retryLastChatTurn() {
    if (chatState.sending) return;
    const thread = getActiveChatThread();
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
    const contextFiles = resolveChatContextFiles(project, {
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
    persistChatWorkspaceState(project);
    renderChatPanel(controller.getProject());

    try {
      if (!chatState.configured) {
        await refreshChatStatus({ silent: true });
      }
      if (!current()) return;
      if (!chatState.configured) {
        throw new Error(chatState.detail);
      }

      const response = await sendChatRequest(settings.serverUrl, {
        projectName: project.name,
        model: chatState.selectedModel ?? undefined,
        messages: thread.messages
          .filter((message) => message.role === "user" || message.role === "assistant")
          .map((message) => ({ role: message.role, content: message.content })),
        contextFiles,
        project: buildAgentProjectSnapshot(project),
        ...mcpControls.getRequest(),
        accountToken: identity.token(),
        // Own-key mode: pass the user's key/url/model so the proxy uses them.
        ...agentRequestOverride()
      }, (event) => {
        if (!current() || turn.controller.signal.aborted) return;
        if (event.type === "delta") {
          chatState.streamingText += event.text || "";
          renderChatPanel(controller.getProject());
          return;
        }
        // Reasoning-model chain-of-thought (shown live as muted "thinking" text).
        if (event.type === "reasoning") {
          chatState.reasoningText += event.text || "";
          renderChatPanel(controller.getProject());
          return;
        }
        // A new model turn starts fresh: clear any streamed text from the prior turn.
        if (event.type === "status") {
          chatState.streamingText = "";
          chatState.reasoningText = "";
        }
        const line = describeAgentActivity(event);
        if (!line) {
          return;
        }
        const last = chatState.activity[chatState.activity.length - 1];
        // "writing" events repeat with a growing char count \u2014 update the last
        // line in place instead of flooding the log with near-duplicates.
        if (event.type === "writing" && typeof last === "string" && last.startsWith(line.split("\u2026")[0])) {
          chatState.activity[chatState.activity.length - 1] = line;
          renderChatPanel(controller.getProject());
          return;
        }
        if (line !== last) {
          chatState.activity.push(line);
          renderChatPanel(controller.getProject());
        }
      }, turn.controller.signal);
      if (!current()) return;
      if (turn.controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
      thread = chatState.threads.find(candidate => candidate.id === turn.threadId) ?? thread;

      chatState.provider = response.provider ?? chatState.provider;
      chatState.model = response.model ?? chatState.model;
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
      sortChatThreads();
      persistChatWorkspaceState(project);
      // Agent edits apply immediately so the user can read them in context and
      // then decide Keep or Drop (no separate Accept step — Accept and Keep/Drop
      // were redundant; the user couldn't preview a proposal without applying it).
      if (proposals.length > 0) {
        await autoApplyProposals(assistantMessage, {
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
        sortChatThreads();
        persistChatWorkspaceState(project);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        thread.messages.push(createChatMessage("system", message, { error: true }));
        thread.updatedAt = Date.now();
        sortChatThreads();
        persistChatWorkspaceState(project);
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
      renderChatPanel(controller.getProject());
    }
  }

  // ---------------------------------------------------------------------------
  // Proposal card click handlers (Phase 4 / Phase 3 transport)
  // ---------------------------------------------------------------------------

  /** Find the thread and message that own a given batchId. */
  function findBatchMessage(batchId) {
    for (const thread of chatState.threads) {
      const msg = thread.messages.find((m) => m.batchId === batchId);
      if (msg) return { thread, msg };
    }
    return null;
  }

  /** Apply an agent batch immediately on arrival, then surface Keep/Drop review.
   *  Deletes still get a one-time confirm (Phase 7 safety) since they're destructive,
   *  but everything is recoverable via Drop (the checkpoint captures pre-apply state). */
  async function autoApplyProposals(message, guard) {
    const ops = message.proposedOperations ?? [];
    if (!ops.length) return;
    if (ops.some(op => op.type === "delete-node")) {
      const confirmed = await showConfirmDialog({ title: "Delete included",
        message: "Some of these changes delete files or folders. Apply them now? You can still Drop to undo.", acceptLabel: "Apply" });
      if (!guard.current()) return;
      if (!confirmed) { message.proposalState = "dropped"; persistChatWorkspaceState(); return; }
    }
    if (!guard.current()) return;
    await acceptAgentOperations(ops, message, guard);
    if (!guard.current()) return;
    message.proposalState = ops.some(op => op.proposalState === "accepted") ? "accepted" : "stale";
    persistChatWorkspaceState();
    renderChatPanel(controller.getProject());
  }

  /** URL of an image the agent generated (kept on the server for 14 days). */
  function generatedImageUrl(image) {
    const token = identity.token();
    if (!token || !image?.id) return "";
    return `${normalizeServerUrl(settings.serverUrl)}/api/generated?token=${encodeURIComponent(token)}&id=${encodeURIComponent(image.id)}`;
  }

  /** Bytes of a generated image as a data: URL, the form image files take. */
  async function fetchGeneratedImage(image) {
    const url = generatedImageUrl(image);
    if (!url) throw new Error("Sign in to save generated images.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(response.status === 404 ? "The generated image has expired." : `Image download failed (${response.status}).`);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read the generated image."));
      reader.readAsDataURL(blob);
    });
  }

  // The agent is a collaborator: each text edit goes through the Workspace
  // write path and is placed into the file as it is now, so it merges with
  // whatever anyone typed meanwhile. An edit that no longer fits is marked
  // stale on its own; the rest still apply. Other changes (create, rename,
  // move, delete) are sent one at a time, and the server refuses any that no
  // longer make sense.
  async function acceptAgentOperations(ops, message, guard) {
    if (message.batchId) captureAgentCheckpoint(message.batchId, message.baseRevision);
    let unplaced = 0;
    for (const op of ops) {
      if (!guard.current()) return;
      const name = op.name ?? op.path?.split("/").pop() ?? "";
      // The agent cannot write image bytes itself; a generated image is fetched
      // from the server and saved like any image the user adds.
      const generated = op.type === "create-file" && op.generatedImage?.id && isImageFileName(name);
      if ((op.type === "update-file" || op.type === "create-file") && isImageFileName(name) && !generated) {
        op.proposalState = "stale"; continue;
      }
      if (op.type === "update-file") {
        try { await workspace.write(op.path, op.content, { base: op.preImage, source: "assistant" }); op.proposalState = "accepted"; }
        catch { op.proposalState = "stale"; unplaced += 1; }
        continue;
      }
      const { proposalId, preImage, proposalState, generatedImage, ...cleanOp } = op;
      try {
        if (generated) {
          cleanOp.content = await fetchGeneratedImage(generatedImage);
          if (!guard.current()) return;
        }
        await applyAgentStructure(cleanOp, Boolean(generated));
        op.proposalState = "accepted";
      } catch (error) {
        op.proposalState = "stale";
        for (const remaining of ops.slice(ops.indexOf(op) + 1)) remaining.proposalState = "stale";
        if (guard.current()) showToast(`Agent edit was not applied: ${error.message}`);
        break;
      }
    }
    if (unplaced && guard.current()) {
      showToast(`${unplaced} agent edit${unplaced === 1 ? "" : "s"} no longer fit the file${unplaced === 1 ? "" : "s"} and ${unplaced === 1 ? "was" : "were"} not applied.`);
    }
    if (guard.current() && message.batchId) registerAgentDecorations(ops, message.batchId);
  }

  // A create, rename, move or delete, sent for the server's confirmation (or
  // applied here in a workspace kept in this browser). Image bytes in a cloud
  // workspace upload first: they live on disk, not in the operation log.
  async function applyAgentStructure(op, binary = false) {
    if (collaboration.isConnected() && deps.workspaceMode === "synced") {
      let operation = op;
      if (binary && collaboration.isDirectoryBacked?.()) {
        await collaboration.uploadAsset([op.parentPath, op.name].filter(Boolean).join("/"), op.content);
        operation = { ...op, content: "" };
      }
      const result = await collaboration.publishOperation({ ...operation, baseRevision: collaboration.getRevision() }, { optimistic: false });
      if (!result) throw new Error("Workspace connection changed");
    } else {
      controller.applySyncOperation(op);
    }
  }

  // Drop after the edits were applied: undo the agent's own changes, newest
  // first. Text through the write path (lines others changed stay), the rest
  // by undoSteps(). Returns what could not be undone.
  async function undoAgentBatch(msg, checkpoint) {
    const failed = [];
    for (const op of [...(msg.proposedOperations ?? [])].reverse()) {
      if (op.proposalState !== "accepted") continue;
      try {
        if (op.type === "update-file") await workspace.write(op.path, op.preImage, { base: op.content, source: "assistant undo" });
        else for (const step of undoSteps(op, checkpoint?.project)) await applyAgentStructure(step, step.type === "create-file" && isImageFileName(step.name));
      } catch {
        failed.push(op.path ?? [op.parentPath, op.name].filter(Boolean).join("/"));
      }
    }
    return failed;
  }

  async function dropAgentBatch(batchId) {
    const found = findBatchMessage(batchId);
    if (!found) return;
    const { msg } = found;
    if (msg.proposalState === "accepted") {
      const failed = await undoAgentBatch(msg, agentCheckpoints.get(batchId));
      agentCheckpoints.delete(batchId);
      if (failed.length) notify(`Dropped. These could not be undone because they changed too much since: ${failed.join(", ")}.`);
    }
    msg.proposalState = "dropped";
    clearAgentDecorations(batchId);    // Phase 5: remove line tints on drop
    persistChatWorkspaceState(controller.getProject());
    renderChatPanel(controller.getProject());
  }

  document.addEventListener("click", (event) => {
    // Retry a failed agent turn.
    if (event.target.closest("[data-chat-retry]")) {
      void retryLastChatTurn();
      return;
    }

    // Expand / collapse the agent activity log.
    if (event.target.closest("[data-chat-activity-toggle]")) {
      chatState.activityExpanded = !chatState.activityExpanded;
      renderChatPanel(controller.getProject());
      return;
    }

    // Expand / collapse a persisted "Thought for…" section on an assistant message.
    const thoughtToggle = event.target.closest("[data-chat-thought-toggle]");
    if (thoughtToggle) {
      const id = thoughtToggle.getAttribute("data-chat-thought-toggle");
      if (chatState.expandedReasoning.has(id)) chatState.expandedReasoning.delete(id);
      else chatState.expandedReasoning.add(id);
      renderChatPanel(controller.getProject());
      return;
    }

    // Jump to first changed line in editor (Phase 5 / subtask 5.3)
    const jumpBtn = event.target.closest("[data-batch-jump]");
    if (jumpBtn) {
      jumpToAgentChange(jumpBtn.dataset.batchJump);
      return;
    }

    // Keep — finalise applied agent edits: clear decorations and mark kept.
    const keepBtn = event.target.closest("[data-batch-keep]");
    if (keepBtn) {
      const batchId = keepBtn.dataset.batchKeep;
      const found = findBatchMessage(batchId);
      if (!found) return;
      found.msg.proposalState = "kept";
      agentCheckpoints.delete(batchId);  // release checkpoint memory (subtask 6.5)
      clearAgentDecorations(batchId);    // Phase 5: remove line tints
      persistChatWorkspaceState(controller.getProject());
      renderChatPanel(controller.getProject());
      return;
    }

    // Drop all (pre-accept dismiss) or Drop post-accept (undo the agent's changes)
    const dropTarget = event.target.closest("[data-batch-drop-all]") ?? event.target.closest("[data-batch-drop-final]");
    if (dropTarget) {
      void dropAgentBatch(dropTarget.dataset.batchDropAll ?? dropTarget.dataset.batchDropFinal);
      return;
    }
  });

  function toggleChatHistoryPane() {
    if (!elements.chatHistoryPane) return;
    const willShow = elements.chatHistoryPane.hidden;
    elements.chatHistoryPane.hidden = !willShow;
    elements.chatHistoryToggleButton?.setAttribute("aria-pressed", String(willShow));
  }
  elements.chatNewThreadButton.addEventListener("click", createNewChatConversation);
  elements.chatHistoryToggleButton?.addEventListener("click", toggleChatHistoryPane);

  elements.chatModelSelect?.addEventListener("change", (event) => {
    chatState.selectedModel = event.target.value;
    settings.change({ chatModel: event.target.value });
    logDebug("action", "Agent model changed", settings.chatModel);
    renderChatPanel(controller.getProject()); // the badge names the model's provider
  });

  // The status badge doubles as a shortcut: open settings when the agent isn't
  // usable, otherwise just re-check the backend.
  elements.chatStatusText.addEventListener("click", () => {
    if (chatState.status === "signin") {
      openSettingsDialog("collaboration"); // the Account sign-in lives there
      return;
    }
    if (chatState.status !== "ready") {
      // The agent is separate from login — send them straight to the Agent tab.
      openSettingsDialog("agent");
      return;
    }
    void refreshChatStatus({ silent: true });
  });
  elements.chatAddActiveFileButton.addEventListener("click", addActiveFileToChatContext);
  elements.chatComposeForm.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("text/mdnotes-file-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    elements.chatComposeForm.classList.add("is-drag-over");
  });
  elements.chatComposeForm.addEventListener("dragleave", (event) => {
    if (!elements.chatComposeForm.contains(event.relatedTarget)) {
      elements.chatComposeForm.classList.remove("is-drag-over");
    }
  });
  elements.chatComposeForm.addEventListener("drop", (event) => {
    elements.chatComposeForm.classList.remove("is-drag-over");
    const nodeId = event.dataTransfer?.getData("text/mdnotes-file-id");
    if (!nodeId) return;
    event.preventDefault();
    const path = getPath(controller.getProject(), nodeId);
    if (path) addChatContextPath(path);
  });
  elements.chatThreadList.addEventListener("click", (event) => {
    const rename = event.target.closest("[data-chat-thread-rename]");
    if (rename) { void renameChatThread(rename.dataset.chatThreadRename); return; }
    const remove = event.target.closest("[data-chat-thread-delete]");
    if (remove) { void deleteChatThread(remove.dataset.chatThreadDelete); return; }
    const button = event.target.closest("[data-chat-thread-id]");
    if (!button) {
      return;
    }
    setActiveChatThread(button.dataset.chatThreadId);
  });
  elements.chatHistorySearch?.addEventListener("input", () => renderChatPanel(controller.getProject()));
  elements.chatMessageList.addEventListener("click", (event) => {
    const example = event.target.closest("[data-chat-example]");
    if (!example) return;
    elements.chatInput.value = example.dataset.chatExample;
    elements.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    elements.chatInput.focus();
  });
  elements.chatContextList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chat-remove-context]");
    if (!button) {
      return;
    }
    removeChatContextPath(button.dataset.chatRemoveContext);
  });
  elements.chatComposeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (chatState.sending) {
      stopAgentTurn(); // the send button is a Stop button mid-turn
      return;
    }
    void handleChatSubmit();
  });
  elements.chatInput.addEventListener("keydown", (event) => {
    if (!shouldSubmitChat(event, isMobileLayout()) || chatState.sending) return;
    event.preventDefault();
    void handleChatSubmit();
  });
  elements.chatInput.addEventListener("input", () => {
    const thread = ensureActiveChatThread();
    thread.draft = elements.chatInput.value;
    cacheChatWorkspace();
    // Typing a draft must not rebuild the conversation or disturb its selection.
    elements.chatSendButton.disabled = !chatState.sending && !elements.chatInput.value.trim();
  });

  // The two pages of the side panel (Shell's pages): each draws only while open.
  pages.add({
    host: "side", id: "agent", order: 1, label: "Agent", title: "The workspace agent: asks, edits and organizes files",
    body: query("#agent-page"), newItem: createNewChatConversation,
    shown(visible) {
      if (elements.chatHistoryToggleButton) elements.chatHistoryToggleButton.hidden = !visible;
      if (!visible) {
        const current = getActiveChatThread();
        if (current) current.draft = elements.chatInput.value;
        if (elements.chatHistoryPane) elements.chatHistoryPane.hidden = true;
        return;
      }
      chatState.renderedThreadId = null; // reload its draft
      chatState.shouldScrollToBottom = true;
      renderChatPanel(controller.getProject());
    }
  });

  /** A chat workspace pushed by the server (another participant changed it). */
  function receiveChatWorkspace(project, workspace) {
    ensureChatWorkspaceLoaded(project);
    if (workspace && Number.isInteger(workspace.revision)) chatSynchronizer?.receive(workspace);
  }

  /** A Chats event from the server (a message, a reply being written, a change). */
  function receiveChatEvent(event) {
    chatsPage.receive(event);
  }

  return {
    receiveChatEvent,
    receiveChatWorkspace, renderChatPanel, refreshChatStatus, findBatchMessage,
    remapPersonaPaths: chatsPage.remapPersonaPaths, applyAgentSettingsStatus, ensureChatWorkspaceLoaded, chatState,
    mcpControls, isOwnBatch
  };
}
