// The conversation list's actions: rename, delete, open, start one; files
// attached to the next message.
// Part of the Assistant's Agent page: `app` is its shared context (panel.js).
import { getPath } from "../../workspace/index.js";

export function createThreads(app) {
  const { controller, elements, notify, promptForName, workspace, showConfirmDialog, chatState } = app;
  async function renameChatThread(threadId) {
    const thread = chatState.threads.find((entry) => entry.id === threadId);
    if (!thread) return;
    const title = await promptForName("Rename conversation", thread.title, { submitLabel: "Rename", label: "Title" });
    if (!title || title === thread.title) return;
    thread.title = title.trim().slice(0, 120);
    thread.updatedAt = Date.now();
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
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
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
  }

  function setActiveChatThread(threadId) {
    if (!chatState.threads.some((thread) => thread.id === threadId && app.threadInActiveTab(thread))) {
      return;
    }
    app.setActiveThreadForTab(threadId);
    chatState.shouldScrollToBottom = true;
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
  }

  function createNewChatConversation() {
    const thread = app.createThreadForActiveTab();
    chatState.threads.unshift(thread);
    app.setActiveThreadForTab(thread.id);
    chatState.shouldScrollToBottom = true;
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
    elements.chatInput.focus();
  }

  function addChatContextPath(path) {
    const thread = app.ensureActiveChatThread();
    if (!path || thread.contextPaths.includes(path)) {
      app.renderChatPanel(controller.getProject());
      return;
    }
    thread.contextPaths = [...thread.contextPaths, path];
    thread.updatedAt = Date.now();
    app.sortChatThreads();
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
  }

  function removeChatContextPath(path) {
    const thread = app.getActiveChatThread();
    if (!thread) {
      return;
    }
    thread.contextPaths = thread.contextPaths.filter((entry) => entry !== path);
    thread.updatedAt = Date.now();
    app.sortChatThreads();
    app.persistChatWorkspaceState();
    app.renderChatPanel(controller.getProject());
  }

  function addActiveFileToChatContext() {
    const project = controller.getProject();
    if (!project.activeFileId) {
      notify("Open a file first to add it to the chat context.");
      return;
    }
    addChatContextPath(getPath(project, project.activeFileId));
  }

  return { renameChatThread, deleteChatThread, setActiveChatThread, createNewChatConversation, addChatContextPath, removeChatContextPath, addActiveFileToChatContext };
}
