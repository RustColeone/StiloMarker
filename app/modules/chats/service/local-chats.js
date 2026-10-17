// Chats in a browser-only workspace: conversations with the project's
// characters. Same methods as the cloud store (adapters/api.js), so the Chats
// view does not care which it has. There are no other people here;
// characters' replies run in this browser through `runReply`, and their
// progress is reported through `onEvent` exactly like the server's live events.
// `records` keeps the data (adapters/local-records.js).
import { findMentions } from "../../characters/index.js";

const MAX_MESSAGE = 16000;

export function createLocalChats({ workspaceKey, listCharacters, runReply, onEvent, records,
  me = "user:you", meName = "You", now = () => Date.now() }) {
  let state = null;
  const running = new Map(); // conversation id -> AbortController of its reply queue

  async function data() {
    state ??= (await records.load(workspaceKey)) ?? { key: workspaceKey, nextId: 1, conversations: [], messages: {}, notes: {}, imported: [] };
    return state;
  }
  const save = () => records.save(state);
  const find = (id) => {
    const conversation = state.conversations.find((c) => c.id === Number(id));
    if (!conversation) throw Object.assign(new Error("Conversation not found"), { status: 404 });
    return conversation;
  };
  const characterKeys = () => new Set(listCharacters().map((c) => c.key));
  const emit = (event) => { try { onEvent?.(event); } catch { /* a listener must not break storage */ } };

  function view(c) {
    const messages = state.messages[c.id] ?? [];
    const last = messages[messages.length - 1] ?? null;
    const unread = messages.filter((m) => m.id > (c.lastRead ?? 0) && m.author !== me).length;
    return { id: c.id, kind: c.kind, title: c.title, members: [...c.members], createdBy: me, createdAt: c.createdAt,
      updatedAt: c.updatedAt, unread, last };
  }

  function create(kind, members, title = "") {
    const time = now() / 1000;
    const conversation = { id: state.nextId++, kind, title, members, createdAt: time, updatedAt: time, lastRead: 0 };
    state.conversations.push(conversation);
    state.messages[conversation.id] = [];
    return conversation;
  }

  function insert(conversation, author, authorName, content, contextPaths = [], extra = {}) {
    const message = { id: state.nextId++, conversationId: conversation.id, author, authorName, content: String(content).slice(0, MAX_MESSAGE),
      contextPaths, createdAt: now() / 1000, state: "done", ...extra };
    state.messages[conversation.id].push(message);
    conversation.updatedAt = message.createdAt;
    if (author === me) conversation.lastRead = message.id;
    return message;
  }

  function responders(conversation, message) {
    const cast = listCharacters().filter((c) => conversation.members.includes(c.key));
    if (conversation.kind === "pair") return cast.map((c) => c.key);
    const handles = findMentions(message.content, cast);
    return handles.map((h) => cast.find((c) => c.handle === h)?.key).filter(Boolean);
  }

  async function replyAll(conversation, trigger, keys, options) {
    const controller = new AbortController();
    running.set(conversation.id, controller);
    try {
      for (const key of keys) {
        if (controller.signal.aborted) break;
        const characters = listCharacters();
        const character = characters.find((c) => c.key === key);
        if (!character || !conversation.members.includes(key)) continue;
        const names = Object.fromEntries(characters.map((c) => [c.key, c.name]));
        const transcript = (state.messages[conversation.id] ?? []).filter((m) => m.state === "done").map((m) => ({
          name: names[m.author] ?? (m.authorName || "Author"), content: m.content, self: m.author === key }));
        const cast = characters.filter((c) => conversation.members.includes(c.key));
        let text = "";
        emit({ type: "chat-typing", conversationId: conversation.id, character: key, name: character.name, state: "writing", text });
        let message;
        try {
          const reply = await runReply({ character, cast, transcript, trigger, options, signal: controller.signal,
            onText(next) {
              text = next;
              emit({ type: "chat-typing", conversationId: conversation.id, character: key, name: character.name, state: "writing", text });
            } });
          message = insert(conversation, key, character.name, reply);
        } catch (error) {
          const stopped = controller.signal.aborted || error?.name === "AbortError";
          message = insert(conversation, key, character.name,
            stopped ? (text.trim() || "(stopped before replying)") : `${character.name} could not reply: ${error.message || error}`,
            [], { state: stopped ? "interrupted" : "error" });
        }
        await save();
        emit({ type: "chat-typing", conversationId: conversation.id, character: key, name: character.name, state: "end", text: "" });
        emit({ type: "chat-message", conversationId: conversation.id, message });
        if (message.state !== "done") break;
      }
    } finally {
      if (running.get(conversation.id) === controller) running.delete(conversation.id);
    }
  }

  return {
    kind: "local",
    async overview() {
      await data();
      const characters = listCharacters().map(({ content, ...c }) => c);
      return { me, conversations: [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(view),
        people: [], characters, notes: structuredClone(state.notes), meName };
    },
    async messages(id, { before, after } = {}) {
      await data();
      const conversation = find(id);
      let rows = state.messages[conversation.id] ?? [];
      if (after != null) rows = rows.filter((m) => m.id > Number(after));
      else if (before != null) rows = rows.filter((m) => m.id < Number(before));
      return { conversation: view(conversation), messages: after != null ? rows.slice(0, 50) : rows.slice(-50) };
    },
    async search(id, q) {
      await data();
      const words = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return { results: [] };
      const rows = (state.messages[find(id).id] ?? []).filter((m) => words.every((w) => m.content.toLowerCase().includes(w)));
      return { results: rows.slice(-30).reverse().map((m) => ({ ...m, snippet: m.content.slice(0, 160) })) };
    },
    async start(members) {
      await data();
      const known = characterKeys();
      const list = [...new Set([me, ...members])];
      if (list.length < 2) throw new Error("Pick someone to chat with");
      if (list.some((key) => key !== me && !known.has(key))) throw new Error("In a browser-only workspace you can chat with its characters");
      if (list.length === 2) {
        const key = [...list].sort().join("\n");
        const existing = state.conversations.find((c) => c.kind === "pair" && [...c.members].sort().join("\n") === key);
        if (existing) return { conversation: view(existing), created: false };
      }
      const conversation = create(list.length === 2 ? "pair" : "group", list);
      await save();
      return { conversation: view(conversation), created: true };
    },
    async send(id, content, contextPaths = [], options = {}) {
      await data();
      const conversation = find(id);
      const text = String(content ?? "").trim();
      if (!text) throw new Error("Write something first");
      const message = insert(conversation, me, meName, text, contextPaths);
      await save();
      emit({ type: "chat-message", conversationId: conversation.id, message });
      const keys = responders(conversation, message);
      for (const key of keys) {
        emit({ type: "chat-typing", conversationId: conversation.id, character: key,
          name: listCharacters().find((c) => c.key === key)?.name ?? "", state: "queued", text: "" });
      }
      if (keys.length) void replyAll(conversation, message, keys, options);
      return { message, conversation: view(conversation), replies: keys };
    },
    async invite(id, members) {
      await data();
      const conversation = find(id);
      const known = characterKeys();
      const fresh = members.filter((key) => known.has(key) && !conversation.members.includes(key));
      if (!fresh.length) throw new Error("They are already in this chat");
      if (conversation.kind === "pair") return { ...(await this.start([...conversation.members, ...fresh].filter((k) => k !== me))), created: true };
      conversation.members.push(...fresh);
      conversation.updatedAt = now() / 1000;
      await save();
      return { conversation: view(conversation), created: false };
    },
    async leave(id) {
      await data();
      const conversation = find(id);
      if (conversation.kind === "pair") throw new Error("You can't leave a private chat");
      state.conversations = state.conversations.filter((c) => c !== conversation);
      delete state.messages[conversation.id];
      await save();
      return { left: true };
    },
    async rename(id, title) {
      await data();
      const conversation = find(id);
      if (conversation.kind === "pair") throw new Error("A private chat is named after the person in it");
      conversation.title = String(title ?? "").trim().slice(0, 120);
      await save();
      return { conversation: view(conversation) };
    },
    async read(id, messageId) {
      await data();
      const conversation = find(id);
      const top = (state.messages[conversation.id] ?? []).at(-1)?.id ?? 0;
      conversation.lastRead = Math.max(conversation.lastRead ?? 0, Math.min(Number(messageId) || 0, top));
      await save();
      return { conversation: view(conversation) };
    },
    async note(contact, alias, note) {
      await data();
      alias = String(alias ?? "").trim().slice(0, 80);
      note = String(note ?? "").trim().slice(0, 4000);
      if (!alias && !note) delete state.notes[contact];
      else state.notes[contact] = { alias, note, updatedAt: now() / 1000 };
      await save();
      return { alias, note };
    },
    async stop(id) {
      const controller = running.get(Number(id));
      controller?.abort();
      return { stopped: Boolean(controller) };
    },
    async importGroup(title, characters, messages) {
      await data();
      const members = [me, ...characters.map((path) => `char:${path}`).filter((key) => characterKeys().has(key))];
      const conversation = create("group", [...new Set(members)], String(title ?? "").slice(0, 120));
      for (const m of messages) {
        const author = m.role === "user" ? me : (m.role === "assistant" && members.includes(`char:${m.speaker}`) ? `char:${m.speaker}` : null);
        if (!author || !String(m.content ?? "").trim()) continue;
        const message = insert(conversation, author, author === me ? (m.authorName || meName) : (m.speakerName || ""), m.content, [],
          m.interrupted ? { state: "interrupted" } : {});
        if (Number.isFinite(m.createdAt)) message.createdAt = m.createdAt / 1000;
      }
      conversation.lastRead = (state.messages[conversation.id] ?? []).at(-1)?.id ?? 0;
      await save();
      return { conversation: view(conversation) };
    },
    /** Rename/move of a character file (or a folder holding some). */
    async renameCharacterPaths(oldPath, newPath) {
      await data();
      const move = (key) => key === `char:${oldPath}` ? `char:${newPath}`
        : key.startsWith(`char:${oldPath}/`) ? `char:${newPath}${key.slice(5 + oldPath.length)}` : key;
      for (const c of state.conversations) c.members = c.members.map(move);
      for (const list of Object.values(state.messages)) for (const m of list) m.author = move(m.author);
      state.notes = Object.fromEntries(Object.entries(state.notes).map(([k, v]) => [move(k), v]));
      await save();
    },
    isBusy: (id) => running.has(Number(id))
  };
}
