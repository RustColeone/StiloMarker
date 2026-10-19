// The Chats tab: a small chat app for a project's people and its characters.
//
//   list          your conversations (unread first by recency), the project's
//                 people (online dot, your alias) and its characters
//   conversation  live messages, a character's reply as it is written (with
//                 Stop), and @mention suggestions in groups
//   details       a contact's card, your private alias and note, search in the
//                 chat, invite (a pair → a new group), rename / leave a group
//   picker        choose people and characters for a new chat or an invite
//
// Data comes from a store with one interface (adapters/api.js in a cloud
// workspace, service/local-chats.js in a browser-only one); live updates
// arrive through receive(event). Everything the view needs from the app comes
// in through `deps`. Loaded the first time the tab opens.

import { fileTypeExtension } from "../../workspace/index.js";
import { colorFor, findMentions, initialsFor, parsePersona, personaAvatarHtml } from "../../characters/index.js";

const MENTION_BEFORE_CARET = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}_-]*)$/u;
const GROUP_GAP = 5 * 60; // seconds: closer messages from one author share a header

export function createChatsView(deps) {
  const { elements, escapeHtml } = deps;
  const ui = {
    store: null, view: "list", conversationId: null, overview: null, error: "", loading: false,
    messages: new Map(), hasOlder: new Map(), typing: new Map(), drafts: new Map(), contextPaths: [],
    listQuery: "", search: { query: "", results: null }, picker: { mode: "new", selected: new Set(), title: "" },
    jumpTo: null, readTimer: null
  };
  const popover = document.createElement("div");
  popover.className = "rp-popover";
  popover.hidden = true;
  elements.chatPanel.append(popover);
  let menu = null;

  // ---- store & loading -------------------------------------------------------

  function setStore(store) {
    if (ui.store === store) return;
    Object.assign(ui, { store, view: "list", conversationId: null, overview: null, error: "" });
    ui.messages.clear(); ui.hasOlder.clear(); ui.typing.clear();
    if (store) void refresh();
  }

  async function guard(task) {
    try {
      ui.error = "";
      return await task();
    } catch (error) {
      ui.error = error?.message || String(error);
      deps.rerender();
      return null;
    }
  }

  async function refresh() {
    const store = ui.store;
    if (!store) return;
    ui.loading = !ui.overview;
    const overview = await guard(() => store.overview());
    ui.loading = false;
    // An answer without a list of conversations (a server that doesn't know Chats) counts as none.
    if (store !== ui.store || !Array.isArray(overview?.conversations)) { deps.rerender(); return; }
    ui.overview = overview;
    if (ui.conversationId != null && !overview.conversations.some((c) => c.id === ui.conversationId)) {
      Object.assign(ui, { view: "list", conversationId: null });
    }
    deps.rerender();
  }

  async function loadMessages(id, { older = false } = {}) {
    const store = ui.store;
    const loaded = ui.messages.get(id) ?? [];
    const result = await guard(() => store.messages(id, older && loaded.length ? { before: loaded[0].id } : {}));
    if (!result || store !== ui.store) return;
    const merged = older ? [...result.messages, ...loaded] : mergeById(loaded, result.messages);
    ui.messages.set(id, merged);
    ui.hasOlder.set(id, result.messages.length >= 50);
    upsertConversation(result.conversation);
    deps.rerender();
  }

  const mergeById = (a, b) => [...new Map([...a, ...b].map((m) => [m.id, m])).values()].sort((x, y) => x.id - y.id);

  function upsertConversation(conversation) {
    if (!ui.overview || !conversation) return;
    const list = ui.overview.conversations.filter((c) => c.id !== conversation.id);
    ui.overview.conversations = [conversation, ...list].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  const current = () => ui.overview?.conversations.find((c) => c.id === ui.conversationId) ?? null;

  // ---- names, avatars -----------------------------------------------------------

  function characterInfo(project, key) {
    const path = key.slice(5);
    const nodeId = deps.getNodeIdByPath(project, path);
    const node = nodeId ? project.nodes[nodeId] : null;
    const persona = parsePersona(node?.content ?? "", path);
    return { ...persona, nodeId, exists: Boolean(node), avatarSrc: node ? deps.avatarSrc(project, nodeId, persona.avatar) : "" };
  }

  function displayName(project, key) {
    if (key === ui.overview?.me) return "You";
    const alias = ui.overview?.notes?.[key]?.alias;
    if (alias) return alias;
    if (key.startsWith("char:")) return characterInfo(project, key).name;
    return key.slice(5);
  }

  function avatarHtml(project, key, className = "persona-avatar") {
    if (key.startsWith("char:")) {
      const info = characterInfo(project, key);
      return personaAvatarHtml(info, info.avatarSrc, className);
    }
    const name = key.slice(5);
    const online = ui.overview?.people?.find((p) => p.key === key)?.online;
    return `<span class="${escapeHtml(className)} cv-person${online ? " is-online" : ""}" style="--persona-color:${escapeHtml(colorFor(name))}" aria-hidden="true">${escapeHtml(initialsFor(name))}</span>`;
  }

  function titleOf(project, conversation) {
    if (conversation.title) return conversation.title;
    const others = conversation.members.filter((m) => m !== ui.overview?.me);
    return others.map((m) => displayName(project, m)).join(", ") || "Just you";
  }

  function others(conversation) {
    return conversation.members.filter((m) => m !== ui.overview?.me);
  }

  function timeLabel(seconds) {
    const date = new Date(seconds * 1000);
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  /** Message text with mentions of characters in the chat highlighted. */
  function textHtml(project, conversation, text) {
    const handles = new Set(conversation.members.filter((m) => m.startsWith("char:")).map((m) => characterInfo(project, m).handle));
    return escapeHtml(text).replace(/(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}_-]+)/gu, (match, lead, token) => {
      const handle = token.toLowerCase().replace(/-+$/, "");
      return handles.has(handle) || handle === "all" || handle === "everyone" ? `${lead}<span class="rp-mention">@${token}</span>` : match;
    });
  }

  // ---- rendering ------------------------------------------------------------------

  function headerHtml(project) {
    if (!ui.store) return "";
    const conversation = current();
    if ((ui.view === "conversation" || ui.view === "details") && conversation) {
      const peer = conversation.kind === "pair" ? others(conversation)[0] : null;
      const subtitle = peer
        ? (peer.startsWith("char:") ? "Character" : (ui.overview.people.find((p) => p.key === peer)?.online ? "Online" : "Offline"))
        : `${conversation.members.length} members`;
      const avatars = (peer ? [peer] : others(conversation).slice(0, 3)).map((m) => avatarHtml(project, m, "persona-avatar cv-head-avatar")).join("");
      return `<button type="button" class="cv-icon-btn" data-chats-back aria-label="Back">‹</button>
        <span class="cv-head-avatars">${avatars}</span>
        <span class="cv-head-text"><span class="cv-head-title">${escapeHtml(titleOf(project, conversation))}</span>
          <span class="cv-head-sub">${escapeHtml(subtitle)}</span></span>
        <button type="button" class="cv-icon-btn${ui.view === "details" ? " is-active" : ""}" data-chats-details aria-label="Details" title="Details, search and notes">ⓘ</button>`;
    }
    if (ui.view === "picker") {
      return `<button type="button" class="cv-icon-btn" data-chats-back aria-label="Back">‹</button>
        <span class="cv-head-text"><span class="cv-head-title">${ui.picker.mode === "invite" ? "Invite to this chat" : "New chat"}</span></span>`;
    }
    return `<input class="cv-search" type="search" data-chats-list-search placeholder="Search chats, people, characters" value="${escapeHtml(ui.listQuery)}" aria-label="Search chats">
      <button type="button" class="cv-text-btn" data-chats-new title="Start a chat or a group">New</button>`;
  }

  function contentHtml(project) {
    if (!ui.store) return `<div class="chat-empty-state">Chats are loading…</div>`;
    const error = ui.error ? `<div class="cv-error">${escapeHtml(ui.error)}</div>` : "";
    if (ui.loading && !ui.overview) return `${error}<div class="chat-empty-state">Loading chats…</div>`;
    if (!ui.overview) return error || `<div class="chat-empty-state">Chats are not available.</div>`;
    if (ui.view === "picker") return error + pickerHtml(project);
    const conversation = current();
    if (ui.view === "details" && conversation) return error + detailsHtml(project, conversation);
    if (ui.view === "conversation" && conversation) return error + conversationHtml(project, conversation);
    return error + listHtml(project);
  }

  function listHtml(project) {
    const q = ui.listQuery.trim().toLowerCase();
    const match = (text) => !q || String(text).toLowerCase().includes(q);
    const conversations = ui.overview.conversations.filter((c) => match(titleOf(project, c)) || match(c.last?.content ?? ""));
    const people = ui.overview.people.filter((p) => p.key !== ui.overview.me && (match(p.username) || match(displayName(project, p.key))));
    const characters = ui.overview.characters.filter((c) => match(c.name) || match(c.handle));
    const row = (inner, attrs) => `<button type="button" class="cv-row" ${attrs}>${inner}</button>`;
    const chatsHtml = conversations.map((c) => {
      const peer = c.kind === "pair" ? others(c)[0] : null;
      const avatar = peer ? avatarHtml(project, peer) : `<span class="cv-group-avatar">${others(c).slice(0, 2).map((m) => avatarHtml(project, m)).join("")}</span>`;
      const who = c.last ? (c.last.author === ui.overview.me ? "You: " : (c.kind === "group" ? `${displayName(project, c.last.author)}: ` : "")) : "";
      return row(`${avatar}<span class="cv-row-text"><span class="cv-row-title">${escapeHtml(titleOf(project, c))}</span>
          <span class="cv-row-sub">${escapeHtml(c.last ? who + c.last.content.replace(/\s+/g, " ").slice(0, 80) : "No messages yet")}</span></span>
        <span class="cv-row-meta">${c.last ? `<span class="cv-time">${escapeHtml(timeLabel(c.last.createdAt))}</span>` : ""}${c.unread ? `<span class="cv-badge">${c.unread}</span>` : ""}</span>`,
        `data-chats-open="${c.id}"${c.unread ? ' data-unread="true"' : ""}`);
    }).join("");
    const peopleHtml = people.map((p) => row(`${avatarHtml(project, p.key)}<span class="cv-row-text">
        <span class="cv-row-title">${escapeHtml(displayName(project, p.key))}</span>
        <span class="cv-row-sub">${escapeHtml(ui.overview.notes?.[p.key]?.alias ? p.username + " · " : "")}${p.online ? "Online" : "Offline"}</span></span>`,
      `data-chats-start="${escapeHtml(p.key)}"`)).join("");
    const charactersHtml = characters.map((c) => row(`${avatarHtml(project, c.key)}<span class="cv-row-text">
        <span class="cv-row-title">${escapeHtml(displayName(project, c.key))}</span><span class="cv-row-sub">@${escapeHtml(c.handle)}</span></span>`,
      `data-chats-start="${escapeHtml(c.key)}"`)).join("");
    const section = (label, html, empty) => `<div class="cv-section"><div class="cv-section-title">${label}</div>${html || `<div class="cv-empty">${empty}</div>`}</div>`;
    const localNote = ui.store.kind === "local"
      ? `<div class="cv-note">This workspace is only in this browser, so you can chat with its characters. Open a cloud workspace to chat live with people.</div>` : "";
    return `<div class="cv-list">${localNote}
      ${section("Chats", chatsHtml, q ? "No chats match." : "No chats yet. Start one with a person or a character below.")}
      ${ui.store.kind === "cloud" ? section("People", peopleHtml, q ? "Nobody matches." : "Nobody else has access to this project yet.") : ""}
      ${section("Characters", charactersHtml, q ? "No characters match." : `No characters yet: create a <strong>${fileTypeExtension("persona")}</strong> file (Create → New Character).`)}
    </div>`;
  }

  function conversationHtml(project, conversation) {
    const messages = ui.messages.get(conversation.id);
    if (!messages) return `<div class="chat-empty-state">Loading…</div>`;
    const older = ui.hasOlder.get(conversation.id) ? `<button type="button" class="cv-older" data-chats-older>Show earlier messages</button>` : "";
    if (!messages.length) {
      const peer = conversation.kind === "pair" ? others(conversation)[0] : null;
      const hint = peer?.startsWith("char:")
        ? `Say something to ${escapeHtml(displayName(project, peer))}; they answer every message.`
        : conversation.kind === "group" && conversation.members.some((m) => m.startsWith("char:"))
          ? "Write to the group. <strong>@mention</strong> a character to hear from them; without a mention, nobody replies."
          : "Say hello.";
      return `<div class="chat-empty-state">${hint}</div>`;
    }
    let previous = null;
    const rows = messages.map((m) => {
      const mine = m.author === ui.overview.me;
      const compact = previous && previous.author === m.author && m.createdAt - previous.createdAt < GROUP_GAP && previous.state === "done";
      previous = m;
      const isChar = m.author.startsWith("char:");
      const info = isChar ? characterInfo(project, m.author) : null;
      const name = info?.exists === false ? (m.authorName || "Character") : displayName(project, m.author);
      const color = isChar ? info.color : colorFor(m.author.slice(5));
      // Your own messages carry only the time, like any chat app.
      const head = compact ? "" : mine
        ? `<div class="chat-message-meta"><span class="chat-message-time">${escapeHtml(timeLabel(m.createdAt))}</span></div>`
        : `<div class="chat-message-meta">${avatarHtml(project, m.author, "persona-avatar rp-message-avatar")}
          <span class="chat-message-role${isChar ? " rp-speaker" : ""}">${escapeHtml(name)}</span>
          <span class="chat-message-time">${escapeHtml(timeLabel(m.createdAt))}</span></div>`;
      const body = isChar && m.state === "done" ? deps.renderMarkdown(m.content) : textHtml(project, conversation, m.content);
      const files = m.contextPaths?.length ? `<div class="chat-message-context">${m.contextPaths.map((p) => `<span class="chat-message-context-file">${escapeHtml(p)}</span>`).join("")}</div>` : "";
      const note = m.state === "interrupted" ? `<div class="cv-state">Stopped</div>` : "";
      return `<article class="chat-message cv-message${mine ? " is-mine" : ""}${compact ? " is-compact" : ""}${isChar ? " rp-message" : ""}${m.state === "error" ? " is-error" : ""}"
          data-role="${mine ? "user" : (m.state === "error" ? "system" : "assistant")}" data-msg-id="${m.id}" style="--persona-color:${escapeHtml(color)}">
        ${head}<div class="chat-message-content">${body}</div>${files}${note}</article>`;
    }).join("");
    return older + rows;
  }

  function streamHtml(project) {
    const conversation = current();
    if (ui.view !== "conversation" || !conversation) return "";
    return [...ui.typing.values()].filter((t) => t.conversationId === conversation.id).map((t) => {
      const info = characterInfo(project, t.character);
      const status = t.state === "queued" ? "will reply…" : t.state === "reading" ? "is reading the workspace…" : "is writing…";
      return `<article class="chat-message rp-message is-streaming" data-role="assistant" style="--persona-color:${escapeHtml(info.color)}">
        <div class="chat-message-meta">${avatarHtml(project, t.character, "persona-avatar rp-message-avatar")}
          <span class="chat-message-role rp-speaker">${escapeHtml(t.name || info.name)}</span><span class="rp-typing">${status}</span>
          <button type="button" class="cv-stop" data-chats-stop title="Stop the reply">Stop</button></div>
        ${t.text ? `<div class="chat-message-content">${deps.renderMarkdown(t.text)}</div>` : `<div class="chat-thinking-dots"><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span></div>`}
      </article>`;
    }).join("");
  }

  function detailsHtml(project, conversation) {
    const peer = conversation.kind === "pair" ? others(conversation)[0] : null;
    const results = ui.search.results;
    const resultsHtml = results == null ? ""
      : results.length ? `<div class="cv-results">${results.map((r) => `<button type="button" class="cv-result" data-chats-jump="${r.id}">
            <span class="cv-result-meta">${escapeHtml(r.author === ui.overview.me ? "You" : displayName(project, r.author))} · ${escapeHtml(timeLabel(r.createdAt))}</span>
            <span class="cv-result-text">${escapeHtml(r.snippet).replace(/\[([^\]]*)\]/g, "<mark>$1</mark>")}</span></button>`).join("")}</div>`
        : `<div class="cv-empty">Nothing found.</div>`;
    const search = `<div class="cv-section"><div class="cv-section-title">Search this chat</div>
        <input class="cv-search" type="search" data-chats-search value="${escapeHtml(ui.search.query)}" placeholder="Words from a message">${resultsHtml}</div>`;
    if (peer) {
      const note = ui.overview.notes?.[peer] ?? { alias: "", note: "" };
      const isChar = peer.startsWith("char:");
      const info = isChar ? characterInfo(project, peer) : null;
      const person = !isChar ? ui.overview.people.find((p) => p.key === peer) : null;
      return `<div class="cv-details">
        <div class="cv-card">${avatarHtml(project, peer, "persona-avatar cv-card-avatar")}
          <div><div class="cv-card-name">${escapeHtml(isChar ? info.name : peer.slice(5))}</div>
          <div class="cv-card-sub">${escapeHtml(isChar ? `@${info.handle} · Character` : (person?.online ? "Online now" : "Offline"))}</div></div>
          ${isChar && info.nodeId ? `<button type="button" class="cv-text-btn" data-chats-edit-character="${escapeHtml(info.nodeId)}">Edit character</button>` : ""}</div>
        <div class="cv-section"><div class="cv-section-title">Only you see this</div>
          <label class="cv-field"><span>Alias</span><input type="text" data-chats-alias value="${escapeHtml(note.alias)}" placeholder="What you call them" maxlength="80"></label>
          <label class="cv-field"><span>Note</span><textarea data-chats-note rows="3" placeholder="Anything you want to remember" maxlength="4000">${escapeHtml(note.note)}</textarea></label></div>
        ${search}
        <div class="cv-actions"><button type="button" class="cv-text-btn" data-chats-invite>Invite to a new group…</button></div>
      </div>`;
    }
    const members = conversation.members.map((m) => `<div class="cv-member">${avatarHtml(project, m)}<span>${escapeHtml(displayName(project, m))}</span></div>`).join("");
    return `<div class="cv-details">
      <div class="cv-section"><div class="cv-section-title">Group name</div>
        <input class="cv-search" type="text" data-chats-title value="${escapeHtml(conversation.title)}" placeholder="${escapeHtml(titleOf(project, { ...conversation, title: "" }))}" maxlength="120"></div>
      <div class="cv-section"><div class="cv-section-title">${conversation.members.length} members</div>${members}</div>
      ${search}
      <div class="cv-actions"><button type="button" class="cv-text-btn" data-chats-invite>Invite…</button>
        <button type="button" class="cv-text-btn is-danger" data-chats-leave>Leave group</button></div>
    </div>`;
  }

  function pickerHtml(project) {
    const conversation = ui.picker.mode === "invite" ? current() : null;
    const exclude = new Set(conversation?.members ?? [ui.overview.me]);
    const choices = [
      ...ui.overview.people.filter((p) => !exclude.has(p.key)).map((p) => p.key),
      ...ui.overview.characters.filter((c) => !exclude.has(c.key)).map((c) => c.key)
    ];
    const n = ui.picker.selected.size;
    const label = ui.picker.mode === "invite"
      ? (conversation?.kind === "pair" ? `Start a group with ${n} more` : `Invite ${n}`)
      : (n > 1 ? `Start a group of ${n + 1}` : "Start chat");
    const note = ui.picker.mode === "invite" && conversation?.kind === "pair"
      ? `<div class="cv-note">Your private chat stays as it is; this starts a new group with everyone.</div>` : "";
    return `<div class="cv-picker">${note}
      ${choices.length ? choices.map((key) => `<label class="cv-pick">
          <input type="checkbox" data-chats-pick="${escapeHtml(key)}"${ui.picker.selected.has(key) ? " checked" : ""}>
          ${avatarHtml(project, key)}<span>${escapeHtml(displayName(project, key))}</span>
          <span class="cv-row-sub">${key.startsWith("char:") ? "Character" : "Person"}</span></label>`).join("")
        : `<div class="cv-empty">There is nobody else to add.</div>`}
      <div class="cv-actions"><button type="button" class="cv-primary" data-chats-confirm${n ? "" : " disabled"}>${escapeHtml(label)}</button></div>
    </div>`;
  }

  // ---- actions ---------------------------------------------------------------------

  async function openConversation(id, view = "conversation") {
    closeMenu();
    Object.assign(ui, { view, conversationId: Number(id), search: { query: "", results: null } });
    deps.setDraft(ui.drafts.get(Number(id)) ?? "");
    deps.rerender();
    await loadMessages(Number(id));
    markRead();
  }

  async function startWith(keys) {
    const result = await guard(() => ui.store.start(keys));
    if (!result) return;
    upsertConversation(result.conversation);
    await openConversation(result.conversation.id);
  }

  function markRead() {
    const conversation = current();
    const list = conversation ? ui.messages.get(conversation.id) : null;
    if (!conversation || !list?.length || ui.view !== "conversation" || !conversation.unread) return;
    clearTimeout(ui.readTimer);
    ui.readTimer = setTimeout(async () => {
      const result = await guard(() => ui.store.read(conversation.id, list[list.length - 1].id));
      if (result) { upsertConversation(result.conversation); deps.rerender(); }
    }, 300);
  }

  async function submit(text) {
    const conversation = current();
    if (!conversation || ui.view !== "conversation") return false;
    closeMenu();
    const paths = [...ui.contextPaths];
    ui.contextPaths = [];
    ui.drafts.delete(conversation.id);
    const result = await guard(() => ui.store.send(conversation.id, text, paths, deps.sendOptions()));
    if (!result) { ui.contextPaths = paths; return false; }
    ui.messages.set(conversation.id, mergeById(ui.messages.get(conversation.id) ?? [], [result.message]));
    upsertConversation(result.conversation);
    deps.scrollToBottom();
    deps.rerender();
    void deps.afterSend?.(result, conversation); // replies this browser writes run on their own
    return true;
  }

  function receive(event) {
    const id = Number(event.conversationId);
    if (event.type === "chat-typing") {
      const key = `${id}|${event.character}`;
      if (event.state === "end") ui.typing.delete(key);
      else ui.typing.set(key, { conversationId: id, character: event.character, name: event.name, text: event.text ?? "", state: event.state });
      if (id === ui.conversationId) deps.rerender();
      return;
    }
    if (event.type === "chat-message" && event.message) {
      const list = ui.messages.get(id);
      if (list) ui.messages.set(id, mergeById(list, [event.message]));
      const conversation = ui.overview?.conversations.find((c) => c.id === id);
      if (!conversation) { void refresh(); return; }
      const viewing = id === ui.conversationId && ui.view === "conversation" && document.visibilityState !== "hidden";
      const mine = event.message.author === ui.overview.me;
      upsertConversation({ ...conversation, last: event.message, updatedAt: event.message.createdAt,
        unread: mine || viewing ? conversation.unread : conversation.unread + 1 });
      if (viewing) { deps.scrollToBottomIfNear(); markRead(); }
      deps.rerender();
      return;
    }
    if (event.type === "chat-update") {
      void refresh().then(() => { if (ui.conversationId != null && ui.view !== "list") void loadMessages(ui.conversationId); });
    }
  }

  async function confirmPicker() {
    const keys = [...ui.picker.selected];
    if (!keys.length) return;
    if (ui.picker.mode === "invite") {
      const result = await guard(() => ui.store.invite(ui.conversationId, keys));
      if (!result) return;
      upsertConversation(result.conversation);
      await openConversation(result.conversation.id);
      if (result.created) deps.toast("Started a new group; your private chat is kept.");
    } else {
      await startWith(keys);
    }
  }

  async function jumpTo(messageId) {
    const id = ui.conversationId;
    Object.assign(ui, { view: "conversation" });
    deps.rerender();
    for (let page = 0; page < 40 && !(ui.messages.get(id) ?? []).some((m) => m.id === messageId) && ui.hasOlder.get(id) !== false; page++) {
      await loadMessages(id, { older: true });
    }
    requestAnimationFrame(() => {
      const el = elements.chatMessageList.querySelector(`[data-msg-id="${messageId}"]`);
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("is-found");
      setTimeout(() => el.classList.remove("is-found"), 1600);
    });
  }

  let searchTimer = null;
  function onInput(event) {
    const target = event.target;
    if (target.matches("[data-chats-list-search]")) { ui.listQuery = target.value; rerenderKeepingFocus(target); return; }
    if (target.matches("[data-chats-search]")) {
      ui.search.query = target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const query = ui.search.query.trim();
        if (!query) { ui.search.results = null; rerenderKeepingFocus(target); return; }
        const result = await guard(() => ui.store.search(ui.conversationId, query));
        if (result && query === ui.search.query.trim()) { ui.search.results = result.results; rerenderKeepingFocus(target); }
      }, 250);
    }
  }

  /** Re-render without losing the caret in a search box the user is typing in. */
  function rerenderKeepingFocus(input) {
    const selector = ["data-chats-list-search", "data-chats-search"].find((a) => input.hasAttribute(a));
    const caret = input.selectionStart;
    deps.rerender();
    const again = selector && document.querySelector(`[${selector}]`);
    if (again && again !== input) { again.focus(); again.setSelectionRange(caret, caret); }
  }

  async function onChange(event) {
    const target = event.target;
    const conversation = current();
    if (target.matches("[data-chats-pick]")) {
      const key = target.dataset.chatsPick;
      if (target.checked) ui.picker.selected.add(key); else ui.picker.selected.delete(key);
      deps.rerender();
    } else if ((target.matches("[data-chats-alias]") || target.matches("[data-chats-note]")) && conversation) {
      const peer = others(conversation)[0];
      const root = target.closest(".cv-details");
      const alias = root.querySelector("[data-chats-alias]").value;
      const note = root.querySelector("[data-chats-note]").value;
      const saved = await guard(() => ui.store.note(peer, alias, note));
      if (saved) {
        ui.overview.notes = { ...ui.overview.notes };
        if (!saved.alias && !saved.note) delete ui.overview.notes[peer]; else ui.overview.notes[peer] = saved;
        deps.rerender();
      }
    } else if (target.matches("[data-chats-title]") && conversation) {
      const result = await guard(() => ui.store.rename(conversation.id, target.value));
      if (result) { upsertConversation(result.conversation); deps.rerender(); }
    }
  }

  async function onClick(event) {
    const t = event.target.closest("[data-chats-back],[data-chats-details],[data-chats-new],[data-chats-open],[data-chats-start],[data-chats-older],[data-chats-stop],[data-chats-invite],[data-chats-leave],[data-chats-confirm],[data-chats-jump],[data-chats-edit-character]");
    if (!t) return;
    if (t.matches("[data-chats-back]")) {
      if (ui.view === "details") ui.view = "conversation";
      else if (ui.view === "picker" && ui.picker.mode === "invite") ui.view = "details";
      else Object.assign(ui, { view: "list", conversationId: null });
      deps.rerender();
    } else if (t.matches("[data-chats-details]")) {
      ui.view = ui.view === "details" ? "conversation" : "details";
      deps.rerender();
    } else if (t.matches("[data-chats-new]")) newChat();
    else if (t.matches("[data-chats-open]")) await openConversation(t.dataset.chatsOpen);
    else if (t.matches("[data-chats-start]")) await startWith([t.dataset.chatsStart]);
    else if (t.matches("[data-chats-older]")) await loadMessages(ui.conversationId, { older: true });
    else if (t.matches("[data-chats-stop]")) {
      deps.onStop?.(ui.conversationId); // a reply this browser is writing
      await guard(() => ui.store.stop(ui.conversationId));
    }
    else if (t.matches("[data-chats-invite]")) {
      Object.assign(ui, { view: "picker", picker: { mode: "invite", selected: new Set(), title: "" } });
      deps.rerender();
    } else if (t.matches("[data-chats-leave]")) {
      if (!(await deps.confirm("Leave this group? You won't see its messages any more."))) return;
      if (await guard(() => ui.store.leave(ui.conversationId))) {
        Object.assign(ui, { view: "list", conversationId: null });
        await refresh();
      }
    } else if (t.matches("[data-chats-confirm]")) await confirmPicker();
    else if (t.matches("[data-chats-jump]")) await jumpTo(Number(t.dataset.chatsJump));
    else if (t.matches("[data-chats-edit-character]")) deps.openFile(t.dataset.chatsEditCharacter);
  }

  function newChat() {
    closeMenu();
    Object.assign(ui, { view: "picker", picker: { mode: "new", selected: new Set(), title: "" } });
    deps.rerender();
  }

  for (const root of [elements.chatCastBar, elements.chatMessageList]) {
    root.addEventListener("click", (event) => { void onClick(event); });
    root.addEventListener("input", onInput);
    root.addEventListener("change", (event) => { void onChange(event); });
  }

  // ---- @mention suggestions (groups with characters) ------------------------------------

  function closeMenu() {
    menu = null;
    popover.hidden = true;
    popover.replaceChildren();
  }

  function caretPoint(input, index) {
    const style = getComputedStyle(input);
    const mirror = document.createElement("div");
    for (const prop of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth",
      "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle",
      "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize"]) mirror.style[prop] = style[prop];
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
    mirror.textContent = input.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.append(marker);
    document.body.append(mirror);
    const rect = input.getBoundingClientRect();
    const point = { left: rect.left + marker.offsetLeft - input.scrollLeft, top: rect.top + marker.offsetTop - input.scrollTop };
    mirror.remove();
    return point;
  }

  function updateMentionMenu(project) {
    const conversation = current();
    const input = elements.chatInput;
    const caret = input.selectionStart ?? 0;
    const cast = conversation && conversation.kind === "group"
      ? conversation.members.filter((m) => m.startsWith("char:")).map((m) => ({ key: m, ...characterInfo(project, m) })) : [];
    const match = MENTION_BEFORE_CARET.exec(input.value.slice(0, caret));
    if (!match || !cast.length || input.selectionEnd !== caret) { closeMenu(); return; }
    const q = match[2].toLowerCase();
    const items = cast.filter((c) => c.handle.startsWith(q) || c.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
      .map((c) => ({ handle: c.handle, label: c.name, avatar: personaAvatarHtml(c, c.avatarSrc, "persona-avatar rp-item-avatar") }));
    if (cast.length > 1 && "all".startsWith(q)) items.push({ handle: "all", label: "Every character", avatar: `<span class="rp-item-icon">@</span>` });
    if (!items.length) { closeMenu(); return; }
    const previous = menu?.items?.[menu.active]?.handle;
    menu = { items, start: caret - match[2].length - 1, end: caret, active: Math.max(0, items.findIndex((i) => i.handle === previous)) };
    popover.innerHTML = items.map((item, index) => `<button type="button" class="rp-item${index === menu.active ? " is-active" : ""}" data-mention="${index}">${item.avatar}
      <span class="rp-item-label">${escapeHtml(item.label)}</span><span class="rp-item-detail">@${escapeHtml(item.handle)}</span></button>`).join("");
    popover.hidden = false;
    const point = caretPoint(input, menu.start);
    const panel = elements.chatPanel.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    popover.style.left = `${Math.max(4, Math.min(point.left - panel.left, panel.width - box.width - 4))}px`;
    popover.style.top = `${Math.max(4, point.top - panel.top - box.height - 4)}px`;
  }

  function acceptMention(index) {
    const item = menu?.items?.[index];
    if (!item) return;
    const { start, end } = menu;
    closeMenu();
    elements.chatInput.setRangeText(`@${item.handle} `, start, end, "end");
    elements.chatInput.dispatchEvent(new Event("input", { bubbles: true }));
    elements.chatInput.focus();
  }

  function handleComposerKeydown(event) {
    if (!menu || event.isComposing) return false;
    const count = menu.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      menu.active = (menu.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      popover.querySelectorAll(".rp-item").forEach((el, i) => el.classList.toggle("is-active", i === menu.active));
    } else if (event.key === "Enter" || event.key === "Tab") acceptMention(menu.active);
    else if (event.key === "Escape") closeMenu();
    else return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  popover.addEventListener("mousedown", (event) => event.preventDefault());
  popover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mention]");
    if (button) acceptMention(Number(button.dataset.mention));
  });
  elements.chatInput.addEventListener("blur", closeMenu);

  // ---- for the panel ----------------------------------------------------------------------

  return {
    setStore, refresh, receive, submit, newChat, closeMenu, handleComposerKeydown, updateMentionMenu,
    headerHtml, contentHtml, streamHtml,
    /** Who is connected right now (from the workspace's presence). */
    setOnline(usernames) {
      for (const person of ui.overview?.people ?? []) person.online = usernames.has(person.username);
    },
    composeVisible: () => ui.view === "conversation" && Boolean(current()),
    placeholder(project) {
      const conversation = current();
      if (!conversation) return "";
      if (conversation.kind === "pair") return `Message ${displayName(project, others(conversation)[0])}`;
      return conversation.members.some((m) => m.startsWith("char:")) ? "Message the group — @name to ask a character" : "Message the group";
    },
    unreadTotal: () => (ui.overview?.conversations ?? []).reduce((sum, c) => sum + (c.id === ui.conversationId && ui.view === "conversation" ? 0 : c.unread), 0),
    contextPaths: () => ui.contextPaths,
    addContext(path) { if (path && !ui.contextPaths.includes(path)) ui.contextPaths = [...ui.contextPaths, path]; },
    removeContext(path) { ui.contextPaths = ui.contextPaths.filter((p) => p !== path); },
    saveDraft(text) { if (ui.conversationId != null) ui.drafts.set(ui.conversationId, text); },
    viewKey: () => `${ui.view}:${ui.conversationId ?? ""}`,
    store: () => ui.store,
    currentConversation: current,
    mentionsIn: (text, cast) => findMentions(text, cast)
  };
}
