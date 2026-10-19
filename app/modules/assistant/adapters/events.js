// The Agent page's controls: the conversation list, the input, attachments,
// drops, the model picker, the proposal cards' buttons.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { getPath } from "../../workspace/index.js";
import { shouldSubmitChat } from "../../shell/index.js";

export function installEvents(app) {
  const { collaboration, controller, elements, isMobileLayout, logDebug, openSettingsDialog, settings, workspace, pages, chatState, agent, agentStatus } = app;
  function toggleChatHistoryPane() {
    if (!elements.chatHistoryPane) return;
    const willShow = elements.chatHistoryPane.hidden;
    elements.chatHistoryPane.hidden = !willShow;
    elements.chatHistoryToggleButton?.setAttribute("aria-pressed", String(willShow));
  }
  elements.chatHistoryToggleButton?.addEventListener("click", toggleChatHistoryPane);

  elements.chatModelSelect?.addEventListener("change", (event) => {
    agent.choose(event.target.value);
    logDebug("action", "Agent model changed", settings.chatModel);
    app.renderChatPanel(controller.getProject()); // the badge names the model's provider
  });

  // The status badge doubles as a shortcut: open settings when the agent isn't
  // usable, otherwise just re-check the backend.
  elements.chatStatusText.addEventListener("click", () => {
    if (agentStatus().status === "signin") {
      openSettingsDialog("collaboration"); // the Account sign-in lives there
      return;
    }
    if (agentStatus().status !== "ready") {
      // The agent is separate from login — send them straight to the Agent tab.
      openSettingsDialog("agent");
      return;
    }
    void app.refreshChatStatus({ silent: true });
  });
  elements.chatAddActiveFileButton.addEventListener("click", app.addActiveFileToChatContext);
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
    if (path) app.addChatContextPath(path);
  });
  elements.chatThreadList.addEventListener("click", (event) => {
    const rename = event.target.closest("[data-chat-thread-rename]");
    if (rename) { void app.renameChatThread(rename.dataset.chatThreadRename); return; }
    const remove = event.target.closest("[data-chat-thread-delete]");
    if (remove) { void app.deleteChatThread(remove.dataset.chatThreadDelete); return; }
    const button = event.target.closest("[data-chat-thread-id]");
    if (!button) {
      return;
    }
    app.setActiveChatThread(button.dataset.chatThreadId);
  });
  elements.chatHistorySearch?.addEventListener("input", () => app.renderChatPanel(controller.getProject()));
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
    app.removeChatContextPath(button.dataset.chatRemoveContext);
  });
  elements.chatComposeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (chatState.sending) {
      app.stopAgentTurn(); // the send button is a Stop button mid-turn
      return;
    }
    void app.handleChatSubmit();
  });
  elements.chatInput.addEventListener("keydown", (event) => {
    if (!shouldSubmitChat(event, isMobileLayout()) || chatState.sending) return;
    event.preventDefault();
    void app.handleChatSubmit();
  });
  elements.chatInput.addEventListener("input", () => {
    const thread = app.ensureActiveChatThread();
    thread.draft = elements.chatInput.value;
    app.cacheChatWorkspace();
    // Typing a draft must not rebuild the conversation or disturb its selection.
    elements.chatSendButton.disabled = !chatState.sending && !elements.chatInput.value.trim();
  });

  // The two pages of the side panel (Shell's pages): each draws only while open.
  pages.add({
    host: "side", id: "agent", order: 1, label: "Agent", title: "The workspace agent: asks, edits and organizes files",
    body: document.querySelector("#agent-page"), toolbar: elements.chatHistoryToggleButton, newItem: app.createNewChatConversation,
    shown(visible) {
      if (!visible) {
        const current = app.getActiveChatThread();
        if (current) current.draft = elements.chatInput.value;
        if (elements.chatHistoryPane) elements.chatHistoryPane.hidden = true;
        return;
      }
      chatState.renderedThreadId = null; // reload its draft
      chatState.shouldScrollToBottom = true;
      app.renderChatPanel(controller.getProject());
    }
  });

  return { toggleChatHistoryPane };
}
