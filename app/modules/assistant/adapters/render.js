// Drawing the Agent page: the conversation (messages, the agent's progress
// and reasoning, the edits it proposes), the model picker, the status.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { UPDATE_FILE } from "../../workspace/index.js";
import { editsHtml, editsLabel } from "../model/edits.js";
import { textDiffHunks } from "../model/review.js";
import { renderMarkdown } from "../../editor/index.js";
import { groupByProvider } from "../../models/index.js";
import { contextChipsHtml, paintConversation } from "../../shell/index.js";

export function createRender(app) {
  const { elements, escapeHtmlAttribute, isMobileLayout, workspace, identity, chatsPage, chatState, isOwnBatch, agent, agentStatus, chatMarkdownCache, pageOpen, OP_ICONS, STATUS_WORDS } = app;
  function renderProposalDiff(op) {
    if (op.type === "create-file" && op.generatedImage) {
      const src = app.generatedImageUrl(op.generatedImage);
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
    if (op.type === UPDATE_FILE && typeof op.preImage === "string") {
      const hunks = textDiffHunks(op.preImage, op.content ?? "");
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
      const hasDecorations = app.batchMarked(message.batchId ?? "");
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
    app.ensureChatWorkspaceLoaded(project); // first: the Chats page moves old Roleplay threads out of it
    chatsPage.badge();
    if (pageOpen("chats")) chatsPage.render(project);
    else renderAgentPage(project);
  }

  // ---- The Agent page ------------------------------------------------------------
  function renderAgentPage(project) {
    app.mcpControls?.render();
    app.ensureChatWorkspaceLoaded(project);

    const activeThread = app.getActiveChatThread();
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
    const showPicker = agentStatus().configured && agentStatus().models.length > 1;
    renderChatStatus(showPicker);
    if (elements.chatModelSelect) {
      elements.chatModelSelect.hidden = !showPicker;
      if (showPicker) {
        const desired = agentStatus().selectedModel ?? agentStatus().models[0];
        const option = (name) => `<option value="${escapeHtmlAttribute(name)}"${name === desired ? " selected" : ""}>${escapeHtmlAttribute(name)}</option>`;
        // Grouped by provider when the server offers more than one (DeepSeek, OpenAI).
        const groups = groupByProvider(agentStatus().models, (name) => agentStatus().modelProviders?.[name]);
        const optionsHtml = groups.length > 1
          ? groups.map(([group, names]) => `<optgroup label="${escapeHtmlAttribute(group || "Other")}">${names.map(option).join("")}</optgroup>`).join("")
          : agentStatus().models.map(option).join("");
        if (elements.chatModelSelect.innerHTML !== optionsHtml) {
          elements.chatModelSelect.innerHTML = optionsHtml;
        }
        elements.chatModelSelect.value = desired;
        elements.chatModelSelect.disabled = chatState.sending;
      }
    }

    const allTabThreads = chatState.threads.filter(app.threadInActiveTab);
    const query = (elements.chatHistorySearch?.value ?? "").trim().toLowerCase();
    const tabThreads = query
      ? allTabThreads.filter((thread) => thread.title.toLowerCase().includes(query)
        || thread.messages.some((message) => String(message.content ?? "").toLowerCase().includes(query)))
      : allTabThreads;
    const threadListHtml = tabThreads.length
      ? tabThreads.map((thread) => {
        const meta = `${thread.messages.length} msg · ${app.formatChatTimestamp(thread.updatedAt)}`;
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
              <span class="chat-message-time">${escapeHtmlAttribute(app.formatChatTimestamp(message.createdAt))}</span>
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

    // The Keep / Drop bar over a marked file follows the proposal's state.
    app.editorParts()?.drawMarkBar();
  }

  // The compose footer's status: a coloured dot, a word only when something
  // needs attention (or the single model's name), and the detail in the tooltip.

  function renderChatStatus(showPicker) {
    const el = elements.chatStatusText;
    const provider = agentStatus().modelProviders?.[agentStatus().selectedModel] ?? agentStatus().provider;
    const ready = agentStatus().status === "ready" && agentStatus().configured;
    const tone = chatState.syncError ? "warn"
      : ready ? "ok"
      : agentStatus().status === "checking" ? "busy"
      : agentStatus().status === "signin" ? "warn"
      : "error";
    const word = chatState.syncError ? "Sync paused"
      : ready ? (showPicker ? "" : (agentStatus().model ?? ""))
      : (STATUS_WORDS[agentStatus().status] ?? "Unavailable");
    const where = agentStatus().configured && provider
      ? `${provider}${agentStatus().selectedModel ?? agentStatus().model ? ` · ${agentStatus().selectedModel ?? agentStatus().model}` : ""}` : "";
    const detail = [chatState.syncError || agentStatus().detail, where].filter(Boolean).join(" — ");
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
      ...(agentStatus().imageGeneration && identity.account() ? ["Draw the opening scene of my current chapter"] : []),
      "Find every note that mentions this file and link them together"
    ];
    return `<div class="chat-empty-state chat-empty-agent">
      <p>Ask about your workspace, or have the agent edit it — you review every change.</p>
      <div class="chat-examples">${examples.map((text) =>
        `<button type="button" class="chat-example" data-chat-example="${escapeHtmlAttribute(text)}">${escapeHtmlAttribute(text)}</button>`).join("")}</div>
      <p class="chat-empty-hint">Attach files with <strong>@ File</strong> or by dragging them onto the box below.</p>
    </div>`;
  }

  return { renderProposalDiff, renderProposalCard, describeAgentActivity, formatThinkingLabel, renderMessageReasoning, renderAgentActivity, chatMessageMarkdown, renderChatPanel, renderAgentPage, renderChatStatus, agentEmptyStateHtml };
}
