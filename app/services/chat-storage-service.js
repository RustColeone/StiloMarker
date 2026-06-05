const CHAT_STORAGE_KEY = "mdnotes.chat.v1";

function createChatThread(title = "New Chat") {
  const now = Date.now();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `thread-${Math.random().toString(36).slice(2, 10)}`,
    title,
    createdAt: now,
    updatedAt: now,
    contextPaths: [],
    messages: []
  };
}

function createChatMessage(role, content, extra = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `msg-${Math.random().toString(36).slice(2, 10)}`,
    role,
    content: String(content ?? ""),
    createdAt: Date.now(),
    ...extra
  };
}

function normalizeChatMessage(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const role = String(value.role ?? "").toLowerCase();
  if (!["user", "assistant", "system"].includes(role)) {
    return null;
  }
  const content = String(value.content ?? "");
  const msg = {
    id: String(value.id ?? globalThis.crypto?.randomUUID?.() ?? `msg-${Math.random().toString(36).slice(2, 10)}`),
    role,
    content,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now(),
    error: Boolean(value.error)
  };
  // Preserve optional fields so they survive save→load and collaboration sync
  // round-trips. Without this, proposals vanish on reload (R1 in risk register).
  if (Array.isArray(value.contextPaths) && value.contextPaths.length > 0) {
    msg.contextPaths = value.contextPaths.map((p) => String(p)).filter(Boolean);
  }
  if (Array.isArray(value.proposedOperations)) {
    msg.proposedOperations = value.proposedOperations;
  }
  if (typeof value.batchId === "string" && value.batchId) {
    msg.batchId = value.batchId;
  }
  if (typeof value.baseRevision === "number") {
    msg.baseRevision = value.baseRevision;
  }
  if (typeof value.proposalState === "string" && value.proposalState) {
    msg.proposalState = value.proposalState;
  }
  if (typeof value.originatorId === "string" && value.originatorId) {
    msg.originatorId = value.originatorId;
  }
  return msg;
}

function normalizeChatThread(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeChatMessage).filter(Boolean)
    : [];
  const contextPaths = Array.isArray(value.contextPaths)
    ? value.contextPaths.map((path) => String(path ?? "").trim()).filter(Boolean)
    : [];
  return {
    id: String(value.id ?? globalThis.crypto?.randomUUID?.() ?? `thread-${Math.random().toString(36).slice(2, 10)}`),
    title: String(value.title ?? "New Chat").trim() || "New Chat",
    createdAt: Number.isFinite(Number(value.createdAt)) ? Number(value.createdAt) : Date.now(),
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Number(value.updatedAt) : Date.now(),
    contextPaths: Array.from(new Set(contextPaths)),
    messages
  };
}

function createDefaultChatWorkspace() {
  return {
    activeThreadId: null,
    threads: []
  };
}

function normalizeChatWorkspace(value) {
  const threads = Array.isArray(value?.threads)
    ? value.threads.map(normalizeChatThread).filter(Boolean).sort((left, right) => right.updatedAt - left.updatedAt)
    : [];
  const activeThreadId = String(value?.activeThreadId ?? "").trim() || threads[0]?.id || null;
  return {
    activeThreadId: threads.some((thread) => thread.id === activeThreadId) ? activeThreadId : (threads[0]?.id ?? null),
    threads
  };
}

function loadAllChatData() {
  try {
    const raw = globalThis.localStorage?.getItem(CHAT_STORAGE_KEY);
    if (!raw) {
      return { projects: {} };
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { projects: {} };
  } catch {
    return { projects: {} };
  }
}

function saveAllChatData(value) {
  globalThis.localStorage?.setItem(CHAT_STORAGE_KEY, JSON.stringify(value));
}

function loadChatWorkspace(projectId) {
  const allData = loadAllChatData();
  const workspace = allData.projects?.[projectId];
  if (!workspace) {
    return createDefaultChatWorkspace();
  }
  return normalizeChatWorkspace(workspace);
}

function saveChatWorkspace(projectId, workspace) {
  const allData = loadAllChatData();
  allData.projects = allData.projects ?? {};
  allData.projects[projectId] = normalizeChatWorkspace(workspace);
  saveAllChatData(allData);
}

function deriveChatTitle(content) {
  const line = String(content ?? "").trim().split(/\r?\n/, 1)[0] ?? "";
  if (!line) {
    return "New Chat";
  }
  return line.length > 42 ? `${line.slice(0, 39)}...` : line;
}

export {
  createChatMessage,
  createChatThread,
  createDefaultChatWorkspace,
  deriveChatTitle,
  loadChatWorkspace,
  saveChatWorkspace
};