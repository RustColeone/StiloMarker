// The Chats page of the side panel (one of Shell's pages): a small chat app
// for a project's people and its characters (the view, adapters/view.js,
// loaded the first time the page opens), with its own conversation, input,
// attachments and drops. It shares nothing with the Agent page: the agent's
// server connection is the Models module's, what a request carries from the
// project is Characters'. The Agent page hands over its old Roleplay threads
// (through Workspace: giveAgentThreads), and they move into Chats once.
import { getNodeIdByPath, getPath, isImageFileName, isPersonaFileName } from "../../workspace/index.js";
import { escapeHtmlAttribute, renderMarkdown } from "../../editor/index.js";
import { charactersView, contextFiles, parsePersona, personaSummary, projectSnapshot } from "../../characters/index.js";
import { createCloudChats } from "./api.js";
import { createIdbRecordStore } from "./local-records.js";
import { createLocalChats as createLocalStore } from "../service/local-chats.js";
import { runDirectReply, sendChatRequest } from "../../models/index.js";
import { contextChipsHtml, isChatNearBottom, normalizeServerUrl, paintConversation, shouldSubmitChat } from "../../shell/index.js";
import { ignored } from "../../../kernel/index.js";

// `app`: what the Chats module gathered (surface in ../index.js).
export function createChatsPage(app) {
  const {
    models, cloudWorkspaceTarget, chatWorkspaceKey, controller, identity, isMobileLayout, logDebug, notify,
    openFileFromExplorer, pages, personaAvatarSrc, settings, showConfirmDialog, showToast
  } = app;
  // A cloud chat's presence: the live session's (Sync's).
  const collaboration = { getPresence: () => app.collaboration()?.getPresence?.() ?? [] };
  // The Agent page's old Roleplay threads, once it has loaded them (giveAgentThreads).
  let agentThreads = null;
  // Draw again: the unread count on the tab, and the page itself while it is open.
  const rerender = () => {
    pages.badge("side", "chats", chats?.unreadTotal() ?? 0);
    if (pages.active("side") === "chats") render(controller.getProject());
  };
  const createLocalChats = (options) => createLocalStore({ ...options, records: createIdbRecordStore() });
  const loadChatsView = () => import("./view.js");
  // The Chats page's own elements (its body in the side panel).
  const chatsEl = {
    page: document.querySelector("#chats-page"), castBar: document.querySelector("#chats-cast-bar"), messageList: document.querySelector("#chats-message-list"),
    form: document.querySelector("#chats-compose-form"), contextList: document.querySelector("#chats-context-list"), input: document.querySelector("#chats-input"),
    addFile: document.querySelector("#chats-add-file-button"), send: document.querySelector("#chats-send-button")
  };

  // The Chats tab's view, loaded the first time the tab is shown, and the store
  // it reads (the server's for a cloud workspace, this browser's otherwise).
  let chats = null;
  let chatsLoading = null;
  const chatsStores = new Map(); // store key -> store

  // ---- Chats tab ---------------------------------------------------------------

  /** The project's characters, as the local store and replies need them. */
  function projectCharacters(project) {
    return Object.values(project.nodes ?? {})
      .filter((node) => node?.kind === "file" && isPersonaFileName(node.name))
      .map((node) => {
        const path = getPath(project, node.id);
        const persona = parsePersona(node.content ?? "", path);
        return { key: `char:${path}`, path, name: persona.name, handle: persona.handle, temperature: persona.temperature,
          content: String(node.content ?? ""), body: persona.body, sheet: persona.sheet };
      });
  }

  // Characters' replies can be generated straight from this browser with the
  // user's own endpoint (Settings → Agent: own key, "directly from this browser").
  function directRunner() {
    return settings.agentSource === "own" && settings.agentRunner === "browser" && Boolean((settings.agentApiUrl || "").trim());
  }

  /** read_file / list_files for a reply written here, from this browser's copy. */
  function directTools() {
    return {
      // What characters may read: no Plans, nobody's author's notes (Characters module).
      list_files: () => { const view = charactersView(controller.getProject()); return { files: Object.values(view.nodes ?? {})
        .filter((node) => node.parentId != null).map((node) => ({ path: getPath(view, node.id), kind: node.kind })) }; },
      read_file: ({ path } = {}) => {
        const project = charactersView(controller.getProject());
        const id = getNodeIdByPath(project, String(path ?? ""));
        const node = id ? project.nodes[id] : null;
        if (!node || node.kind !== "file") return { error: `File not found: ${path}` };
        return isImageFileName(node.name) ? { content: "[image]" } : { content: String(node.content ?? "") };
      }
    };
  }

  function runDirect(payload, signal, onText, onTool) {
    return runDirectReply({ payload, apiUrl: settings.agentApiUrl.trim(), apiKey: (settings.agentApiKey || "").trim(),
      model: (settings.agentModel || "").trim(), signal, onText, onTool, tools: directTools(),
      refusal: "Characters can read workspace files but cannot change them." });
  }

  // Replies this browser claimed in a cloud chat: write each, streaming progress
  // to the server so every member sees it, then post it. Stop aborts them.
  const claimRuns = new Map(); // conversation id -> AbortController

  async function writeClaimedReplies(store, conversationId, claims) {
    const run = new AbortController();
    claimRuns.get(conversationId)?.abort();
    claimRuns.set(conversationId, run);
    try {
      for (const claim of claims) {
        let text = "", sent = 0, pending = null;
        const report = (state = "writing") => {
          const now = Date.now();
          if (state === "writing" && now - sent < 250) { pending ??= setTimeout(() => { pending = null; report(); }, 250); return; }
          sent = now;
          void store.typing(conversationId, claim.character, claim.trigger, text, state).catch(ignored("sending a character's typing state failed"));
        };
        if (run.signal.aborted) { await store.reply(conversationId, claim.character, claim.trigger, "", "interrupted").catch(ignored("saving an interrupted reply failed")); continue; }
        try {
          const { payload } = await store.prompt(conversationId, claim.character, claim.trigger);
          const reply = await runDirect(payload, run.signal, (next) => { text = next; report(); }, () => report("reading"));
          clearTimeout(pending);
          await store.reply(conversationId, claim.character, claim.trigger, reply || text, "done");
        } catch (error) {
          clearTimeout(pending);
          const stopped = run.signal.aborted || error?.name === "AbortError";
          await store.reply(conversationId, claim.character, claim.trigger,
            stopped ? text : `${claim.name || "The character"} could not reply: ${error.message || error}`, stopped ? "interrupted" : "error").catch(ignored("saving a stopped or failed reply failed"));
          if (!stopped) run.abort(); // the rest would fail the same way
        }
      }
    } finally {
      if (claimRuns.get(conversationId) === run) claimRuns.delete(conversationId);
    }
  }

  /** A character's reply run in this browser (a browser-only workspace). */
  async function runPersonaReply({ character, cast, transcript, trigger, signal, onText }) {
    const project = controller.getProject();
    if (directRunner()) {
      const response = await fetch(`${normalizeServerUrl(settings.serverUrl)}/api/chat/prompt`, {
        method: "POST", headers: { "content-type": "application/json" }, signal,
        body: JSON.stringify({ projectName: project.name, project: projectSnapshot(project), messages: transcript,
          contextFiles: contextFiles(project, { contextPaths: trigger?.contextPaths ?? [] }),
          persona: { path: character.path, name: character.name, content: character.content, temperature: character.temperature },
          cast: cast.map((member) => ({ name: member.name, summary: personaSummary(member.sheet ?? member.body) })) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || `Preparing the reply failed (${response.status}).`);
      return runDirect(data.payload, signal, onText);
    }
    await models.agent.ensureReady({ signedIn: Boolean(identity.account()) });
    let text = "";
    const response = await sendChatRequest(settings.serverUrl, {
      projectName: project.name,
      model: models.agent.status().selectedModel ?? undefined,
      contextFiles: contextFiles(project, { contextPaths: trigger?.contextPaths ?? [] }),
      project: projectSnapshot(project),
      accountToken: identity.token(),
      ...models.agent.requestOverride(),
      mode: "persona",
      persona: { path: character.path, name: character.name, content: character.content, temperature: character.temperature },
      cast: cast.map((member) => ({ name: member.name, summary: personaSummary(member.sheet ?? member.body) })),
      messages: transcript
    }, (event) => {
      if (event.type === "delta") { text += event.text || ""; onText(text); }
      else if (event.type === "status") { text = ""; onText(text); }
    }, signal);
    return response.message;
  }

  function chatsStoreFor(project) {
    const target = cloudWorkspaceTarget();
    const key = target ? `cloud:${target.serverUrl}|${target.team}/${target.path}|${target.token}` : `local:${chatWorkspaceKey(project)}`;
    let store = chatsStores.get(key);
    if (!store) {
      store = target
        ? createCloudChats(() => cloudWorkspaceTarget())
        : createLocalChats({ workspaceKey: chatWorkspaceKey(project), listCharacters: () => projectCharacters(controller.getProject()),
          runReply: runPersonaReply, onEvent: (event) => chats?.receive(event) });
      chatsStores.set(key, store);
    }
    return store;
  }

  /** A project's old Roleplay group threads move into Chats once, then leave the agent's list. */
  async function importRoleplayThreads(store, project) {
    const old = agentThreads?.oldGroupThreads(project) ?? [];
    const moved = [];
    for (const thread of old) {
      try {
        await store.importGroup(thread.title, thread.members ?? [], thread.messages);
        moved.push(thread);
      } catch (error) {
        logDebug("response", "Roleplay chat import failed", error.message);
        break;
      }
    }
    agentThreads?.movedGroupThreads(moved);
    if (moved.length === old.length && old.length) {
      showToast(`Moved ${old.length} Roleplay chat${old.length === 1 ? "" : "s"} into Chats`);
      await chats?.refresh();
    }
  }

  function ensureChats(project) {
    if (!chats) {
      chatsLoading ??= loadChatsView().then(({ createChatsView }) => {
        chats = createChatsView({
          elements: { chatPanel: chatsEl.page, chatCastBar: chatsEl.castBar, chatMessageList: chatsEl.messageList, chatInput: chatsEl.input },
          escapeHtml: escapeHtmlAttribute,
          getNodeIdByPath,
          avatarSrc: personaAvatarSrc,
          renderMarkdown: (text) => renderMarkdown(text),
          rerender: () => rerender(),
          setDraft: (text) => { chatsEl.input.value = text; },
          sendOptions: () => ({ model: models.agent.status().selectedModel ?? undefined, ...(directRunner() ? { runner: "client" } : {}) }),
          afterSend: async (result, conversation) => {
            if (result.claims?.length && chats?.store()?.kind === "cloud") {
              await writeClaimedReplies(chats.store(), conversation.id, result.claims);
            }
          },
          onStop: (conversationId) => claimRuns.get(Number(conversationId))?.abort(),
          scrollToBottom: () => { chatsToBottom = true; },
          scrollToBottomIfNear: () => { if (isChatNearBottom(chatsEl.messageList)) chatsToBottom = true; },
          toast: showToast,
          confirm: (message) => showConfirmDialog({ title: "Leave group", message, acceptLabel: "Leave" }),
          openFile: (nodeId) => openFileFromExplorer(nodeId)
        });
        rerender();
        return chats;
      }).catch((error) => {
        chatsLoading = null;
        logDebug("response", "Chats failed to load", error.message);
        showToast("Chats could not load. Check your connection and try again.");
      });
      return;
    }
    const store = chatsStoreFor(project);
    if (chats.store() !== store) {
      chats.setStore(store);
      void importRoleplayThreads(store, project);
    }
  }

  /** A character file (or a folder holding some) moved. The server follows it
   *  in cloud chats; this browser's own chats are updated here. */
  function remapPersonaPaths(oldPath, newPath) {
    if (!oldPath || oldPath === newPath) return;
    const store = chats?.store();
    if (store?.kind === "local") void store.renameCharacterPaths(oldPath, newPath).then(() => chats.refresh());
  }

  // ---- The Chats page ----------------------------------------------------------
  let chatsRenderedKey = null;
  let chatsToBottom = true;

  function render(project) {
    ensureChats(project);
    chatsEl.page.classList.toggle("is-browsing", !chats?.composeVisible());
    if (chats && chats.store()?.kind === "cloud") {
      chats.setOnline(new Set((collaboration.getPresence?.() ?? []).map((entry) => entry.user).filter(Boolean)));
    }
    const header = chats ? chats.headerHtml(project) : "";
    if (chatsEl.castBar._renderedHtml !== header) { chatsEl.castBar.innerHTML = header; chatsEl.castBar._renderedHtml = header; }
    const placeholder = chats?.placeholder(project) || "Message";
    if (chatsEl.input.placeholder !== placeholder) chatsEl.input.placeholder = placeholder;
    chatsEl.contextList.innerHTML = contextChipsHtml(chats?.contextPaths() ?? [], escapeHtmlAttribute);
    const key = `chats:${chats?.viewKey() ?? ""}`;
    const changed = chatsRenderedKey !== key;
    chatsRenderedKey = key;
    paintConversation(chatsEl.messageList,
      chats ? chats.contentHtml(project) : '<div class="chat-empty-state">Loading chats…</div>',
      chats?.streamHtml(project) ?? "", { changed, toBottom: chatsToBottom });
    chatsToBottom = false;
    // Each reply being written has its own Stop: this button always sends.
    chatsEl.send.disabled = !chatsEl.input.value.trim();
    chatsEl.addFile.disabled = !project.activeFileId;
  }

  // ---- The Chats page's own controls: sending, @mentions, attachments, drops.
  async function handleChatsSubmit() {
    const prompt = chatsEl.input.value.trim();
    if (!prompt || !chats?.composeVisible()) return;
    chatsEl.input.value = "";
    chats.saveDraft("");
    rerender();
    if (!(await chats.submit(prompt))) chatsEl.input.value = prompt; // keep the text if it failed
    rerender();
  }
  chatsEl.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void handleChatsSubmit();
  });
  chatsEl.input.addEventListener("keydown", (event) => {
    if (chats?.handleComposerKeydown(event)) return;
    if (!shouldSubmitChat(event, isMobileLayout())) return;
    event.preventDefault();
    void handleChatsSubmit();
  });
  chatsEl.input.addEventListener("input", () => {
    chats?.saveDraft(chatsEl.input.value);
    chats?.updateMentionMenu(controller.getProject());
    chatsEl.send.disabled = !chatsEl.input.value.trim();
  });
  chatsEl.input.addEventListener("click", () => chats?.updateMentionMenu(controller.getProject()));
  const addChatsContext = (path) => { if (path) { chats?.addContext(path); rerender(); } };
  chatsEl.addFile.addEventListener("click", () => {
    const project = controller.getProject();
    if (!project.activeFileId) { notify("Open a file first to add it to the chat context."); return; }
    addChatsContext(getPath(project, project.activeFileId));
  });
  chatsEl.contextList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chat-remove-context]");
    if (!button) return;
    chats?.removeContext(button.dataset.chatRemoveContext);
    rerender();
  });
  chatsEl.form.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes("text/mdnotes-file-id")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    chatsEl.form.classList.add("is-drag-over");
  });
  chatsEl.form.addEventListener("dragleave", (event) => {
    if (!chatsEl.form.contains(event.relatedTarget)) chatsEl.form.classList.remove("is-drag-over");
  });
  chatsEl.form.addEventListener("drop", (event) => {
    chatsEl.form.classList.remove("is-drag-over");
    const nodeId = event.dataTransfer?.getData("text/mdnotes-file-id");
    if (!nodeId) return;
    event.preventDefault();
    addChatsContext(getPath(controller.getProject(), nodeId));
  });

  pages.add({
    host: "side", id: "chats", order: 2, label: "Chats", title: "Chat live with the people in this project and with its characters",
    body: chatsEl.page, newItem: () => chats?.newChat(),
    shown(visible) {
      if (!visible) { chats?.closeMenu(); return; }
      chatsToBottom = true;
      rerender();
    }
  });

  return {
    render,
    badge: () => pages.badge("side", "chats", chats?.unreadTotal() ?? 0),
    receive: (event) => chats?.receive(event),
    // The Agent page's old Roleplay threads: they move into Chats once the store is known.
    giveAgentThreads(threads) {
      agentThreads = threads;
      const store = chats?.store();
      if (store) void importRoleplayThreads(store, controller.getProject());
    },
    view: () => chats, // the Chats view once loaded (tests read it)
    remapPersonaPaths
  };
}
