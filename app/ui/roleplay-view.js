// Roleplay tab of the chat panel: a group chat with characters defined by
// `*.persona.skill` files. Loaded on first use; everything it needs from the
// app comes in through `deps`, so the rest of the app never imports it.
//
// Rules: a message with no @mention is narration and gets no reply. Each
// mentioned character replies in turn (@all = everyone, in cast order), each
// seeing the replies before it. Characters never trigger one another.

import { MAX_GROUP_MEMBERS } from "../services/chat-storage-service.js";
import { findMentions, parsePersona, personaAvatarHtml, personaSummary } from "../services/persona-service.js";

const MENTION_BEFORE_CARET = /(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}_-]*)$/u;

export function createRoleplay(deps) {
  const { elements, chatState, escapeHtml } = deps;
  const popover = document.createElement("div");
  popover.className = "rp-popover";
  popover.hidden = true;
  popover.setAttribute("role", "listbox");
  elements.chatPanel.append(popover);
  // What the open popover is for: { kind: "mention" | "add" | "member", ... }.
  let menu = null;

  // ---------------------------------------------------------------------------
  // Cast
  // ---------------------------------------------------------------------------

  // The panel re-renders on many app events, and every reply in a long chat
  // looks up its speaker, so a sheet is parsed again only when it changes.
  const parsed = new Map(); // path -> { content, persona }

  function personaAt(project, path) {
    const nodeId = deps.getNodeIdByPath(project, path);
    const node = nodeId ? project.nodes[nodeId] : null;
    if (!node || node.kind !== "file" || !deps.isPersonaFileName(node.name)) return null;
    const content = String(node.content ?? "");
    let hit = parsed.get(path);
    if (!hit || hit.content !== content) {
      if (parsed.size > 200) parsed.clear();
      hit = { content, persona: parsePersona(content, path) };
      parsed.set(path, hit);
    }
    const { persona } = hit;
    return { ...persona, nodeId, content, avatarSrc: deps.avatarSrc(project, nodeId, persona.avatar) };
  }

  /** Every persona file in the workspace, by path. */
  function listPersonas(project) {
    return Object.values(project.nodes ?? {})
      .filter((node) => node?.kind === "file" && deps.isPersonaFileName(node.name))
      .map((node) => personaAt(project, deps.getPath(project, node.id)))
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  /** The thread's members, resolved against the current files. A member whose
   *  file is gone keeps its place, marked missing, until removed or replaced. */
  function castOf(project, thread) {
    return (thread?.members ?? []).map((path) => {
      const persona = personaAt(project, path);
      if (persona) return { path, persona, missing: false };
      const spoken = [...(thread.messages ?? [])].reverse().find((message) => message.speaker === path);
      const name = spoken?.speakerName || path.split("/").pop().replace(/\.persona\.skill$/i, "");
      return { path, persona: null, missing: true, name };
    });
  }

  function memberName(member) {
    return member.persona?.name ?? member.name;
  }

  /** Display name and avatar for a message's speaker, now or as last known. */
  function speakerOf(project, message) {
    const persona = message.speaker ? personaAt(project, message.speaker) : null;
    if (persona) return persona;
    const name = message.speakerName || "Character";
    return { ...parsePersona("", `${name}.persona.skill`), name, avatarSrc: "" };
  }

  function renderCast(project, thread) {
    const cast = castOf(project, thread);
    const chips = cast.map((member) => {
      const name = memberName(member);
      const avatar = member.persona
        ? personaAvatarHtml(member.persona, member.persona.avatarSrc, "persona-avatar rp-chip-avatar")
        : `<span class="persona-avatar rp-chip-avatar is-missing" aria-hidden="true">?</span>`;
      const title = member.missing ? `${name} — file missing` : `${name} — @${member.persona.handle}`;
      return `<button type="button" class="rp-member${member.missing ? " is-missing" : ""}" data-rp-member="${escapeHtml(member.path)}" title="${escapeHtml(title)}" aria-haspopup="menu">${avatar}<span class="rp-member-name">${escapeHtml(name)}</span></button>`;
    }).join("");
    const full = cast.length >= MAX_GROUP_MEMBERS;
    const add = `<button type="button" class="rp-add" data-rp-add aria-haspopup="listbox"${full ? ` disabled title="A group chat holds up to ${MAX_GROUP_MEMBERS} characters"` : ` title="Add a character"`}>+ Add</button>`;
    const html = chips + add;
    if (elements.chatCastBar._renderedHtml !== html) {
      elements.chatCastBar.innerHTML = html;
      elements.chatCastBar._renderedHtml = html;
    }
  }

  function addMember(path) {
    const thread = deps.ensureThread();
    if (thread.members.includes(path) || thread.members.length >= MAX_GROUP_MEMBERS) return;
    thread.members = [...thread.members, path];
    thread.updatedAt = Date.now();
    deps.persist();
    deps.rerender();
  }

  function replaceMember(oldPath, newPath) {
    const thread = deps.ensureThread();
    if (thread.members.includes(newPath)) {
      thread.members = thread.members.filter((path) => path !== oldPath);
    } else {
      thread.members = thread.members.map((path) => (path === oldPath ? newPath : path));
    }
    thread.updatedAt = Date.now();
    deps.persist();
    deps.rerender();
  }

  function removeMember(path) {
    const thread = deps.ensureThread();
    thread.members = thread.members.filter((entry) => entry !== path);
    thread.updatedAt = Date.now();
    deps.persist();
    deps.rerender();
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /** User text with the @mentions of cast members highlighted. */
  function narrationHtml(text, cast) {
    const handles = new Set(cast.filter((member) => member.persona).map((member) => member.persona.handle));
    return escapeHtml(text).replace(/(^|[^\p{L}\p{N}_@.])@([\p{L}\p{N}_-]+)/gu, (match, lead, token) => {
      const handle = token.toLowerCase().replace(/-+$/, "");
      return handles.has(handle) || handle === "all" || handle === "everyone"
        ? `${lead}<span class="rp-mention">@${token}</span>`
        : match;
    });
  }

  function messagesHtml(project, thread) {
    if (!thread?.messages?.length) {
      const hint = thread?.members?.length
        ? "Write a line or set the scene. <strong>@mention</strong> a character to hear from them; without a mention, nobody replies."
        : "Add characters with <strong>+ Add</strong>, then <strong>@mention</strong> them.<br>A message without a mention is narration: nobody replies.";
      return `<div class="chat-empty-state">${hint}</div>`;
    }
    const cast = castOf(project, thread);
    return thread.messages.map((message) => {
      const time = `<span class="chat-message-time">${escapeHtml(deps.formatTime(message.createdAt))}</span>`;
      const context = message.contextPaths?.length
        ? `<div class="chat-message-context">${message.contextPaths.map((path) => `<span class="chat-message-context-file">${escapeHtml(path)}</span>`).join("")}</div>`
        : "";
      if (message.role === "assistant") {
        const speaker = speakerOf(project, message);
        return `
          <article class="chat-message rp-message${message.interrupted ? " is-interrupted" : ""}" data-role="assistant" data-msg-id="${escapeHtml(message.id)}" style="--persona-color:${escapeHtml(speaker.color)}">
            <div class="chat-message-meta">
              ${personaAvatarHtml(speaker, speaker.avatarSrc, "persona-avatar rp-message-avatar")}
              <span class="chat-message-role rp-speaker">${escapeHtml(speaker.name)}</span>
              ${time}
            </div>
            <div class="chat-message-content">${deps.messageMarkdown(message)}</div>
          </article>`;
      }
      const label = message.role === "user" ? (message.authorName || "You") : "System";
      return `
        <article class="chat-message${message.error ? " is-error" : ""}" data-role="${escapeHtml(message.role)}" data-msg-id="${escapeHtml(message.id)}">
          <div class="chat-message-meta">
            <span class="chat-message-role">${escapeHtml(label)}</span>
            ${time}
          </div>
          <div class="chat-message-content">${message.role === "user" ? narrationHtml(message.content, cast) : escapeHtml(message.content)}</div>
          ${context}
        </article>`;
    }).join("");
  }

  /** The reply being written: who is speaking, their text so far, who is next. */
  function streamHtml(project, thread) {
    const turn = chatState.turn;
    if (!chatState.sending || !turn?.group || turn.threadId !== thread?.id || !turn.speaker) return "";
    const speaker = personaAt(project, turn.speaker.path) ?? { ...turn.speaker, avatarSrc: "" };
    const next = turn.queue.slice(turn.position + 1).map((member) => member.name);
    const text = chatState.streamingText
      ? `<div class="chat-message-content">${deps.renderMarkdown(chatState.streamingText)}</div>`
      : "";
    return `
      <article class="chat-message rp-message is-streaming" data-role="assistant" style="--persona-color:${escapeHtml(speaker.color)}" aria-live="polite">
        <div class="chat-message-meta">
          ${personaAvatarHtml(speaker, speaker.avatarSrc, "persona-avatar rp-message-avatar")}
          <span class="chat-message-role rp-speaker">${escapeHtml(speaker.name)}</span>
          <span class="rp-typing">${escapeHtml(chatState.activityLine || "is replying…")}</span>
        </div>
        ${text}
        <div class="chat-thinking-dots"><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span><span class="chat-thinking-dot"></span></div>
        ${next.length ? `<div class="rp-next">Next: ${escapeHtml(next.join(", "))}</div>` : ""}
      </article>`;
  }

  // ---------------------------------------------------------------------------
  // Replies
  // ---------------------------------------------------------------------------

  function transcriptFor(project, thread, member) {
    return thread.messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && !message.error && message.content.trim())
      .map((message) => ({
        name: message.role === "user" ? (message.authorName || "Author") : speakerOf(project, message).name,
        content: message.content,
        self: message.role === "assistant" && message.speaker === member.path
      }));
  }

  /** After the user's message is in the thread: reply as each mentioned
   *  character, in order. Returns once the queue is done or stopped. */
  async function respond(threadId, text) {
    const project = deps.getProject();
    const thread = deps.getThread(threadId);
    if (!thread) return;
    const cast = castOf(project, thread).filter((member) => member.persona);
    const handles = findMentions(text, cast.map((member) => member.persona));
    const queue = handles
      .map((handle) => cast.find((member) => member.persona.handle === handle))
      .filter(Boolean)
      .map((member) => ({ path: member.path, name: member.persona.name, color: member.persona.color }));
    if (!queue.length) return;

    const session = deps.session();
    const controller = new AbortController();
    const turn = { group: true, key: session.key, token: session.token, threadId, controller, queue, position: 0, speaker: null };
    const current = () => {
      const now = deps.session();
      return chatState.turn === turn && now.key === turn.key && now.token === turn.token;
    };
    Object.assign(chatState, {
      sending: true, stopped: false, abortController: controller, turn,
      streamingText: "", reasoningText: "", activity: [], activityLine: "", shouldScrollToBottom: true
    });
    deps.rerender();
    const contextPaths = [...thread.messages].reverse().find((message) => message.role === "user")?.contextPaths ?? [];
    const post = (message) => {
      const target = deps.getThread(threadId);
      if (!target) return;
      target.messages.push(message);
      target.updatedAt = Date.now();
      deps.persist();
    };

    try {
      const problem = await deps.ensureReady();
      if (!current()) return;
      if (problem) {
        post(deps.createChatMessage("system", problem, { error: true }));
        return;
      }
      for (let index = 0; index < queue.length; index += 1) {
        if (!current() || controller.signal.aborted) break;
        const target = deps.getThread(threadId);
        const latest = deps.getProject();
        const persona = target ? personaAt(latest, queue[index].path) : null;
        if (!persona) continue; // removed or deleted while the queue ran
        turn.position = index;
        turn.speaker = queue[index];
        chatState.streamingText = "";
        chatState.activityLine = "";
        chatState.shouldScrollToBottom = true;
        deps.rerender();
        const others = castOf(latest, target).filter((member) => member.persona);
        try {
          const response = await deps.sendChatRequest({
            ...deps.buildRequest(latest, contextPaths),
            mode: "persona",
            persona: { path: persona.path, name: persona.name, content: persona.content, temperature: persona.temperature },
            cast: others.map((member) => ({ name: member.persona.name, summary: personaSummary(member.persona.body) })),
            messages: transcriptFor(latest, target, persona)
          }, (event) => {
            if (!current() || controller.signal.aborted) return;
            if (event.type === "delta") chatState.streamingText += event.text || "";
            else if (event.type === "status") { chatState.streamingText = ""; chatState.activityLine = ""; }
            else if (event.type === "tool") chatState.activityLine = event.target ? `is reading ${event.target}…` : "is looking through the workspace…";
            else return;
            deps.rerender();
          }, controller.signal);
          if (!current()) return;
          if (controller.signal.aborted) throw new DOMException("Stopped", "AbortError");
          post(deps.createChatMessage("assistant", response.message, { speaker: persona.path, speakerName: persona.name }));
        } catch (error) {
          if (!current()) return;
          if (error?.name === "AbortError" || chatState.stopped) {
            const partial = chatState.streamingText.trim();
            post(partial
              ? deps.createChatMessage("assistant", partial, { speaker: persona.path, speakerName: persona.name, interrupted: true })
              : deps.createChatMessage("system", `Stopped before ${persona.name} replied.`));
            break;
          }
          const reason = error instanceof Error ? error.message : String(error);
          post(deps.createChatMessage("system", `${persona.name} could not reply. ${reason}`, { error: true }));
          break; // the same problem would stop everyone after them too
        }
        chatState.streamingText = "";
      }
    } finally {
      if (current()) {
        Object.assign(chatState, {
          turn: null, abortController: null, stopped: false, sending: false,
          streamingText: "", reasoningText: "", activity: [], activityLine: ""
        });
        deps.persist();
        deps.rerender();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Popover: @mention suggestions, the Add picker, and a member's menu
  // ---------------------------------------------------------------------------

  function closeMenu() {
    if (!menu) return;
    menu = null;
    popover.hidden = true;
    popover.replaceChildren();
  }

  /** Place the popover at a viewport point, kept inside the chat panel. */
  function place(left, top, { above = false } = {}) {
    popover.hidden = false;
    const panel = elements.chatPanel.getBoundingClientRect();
    const box = popover.getBoundingClientRect();
    const x = Math.max(4, Math.min(left - panel.left, panel.width - box.width - 4));
    const y = above ? top - panel.top - box.height - 4 : top - panel.top + 4;
    popover.style.left = `${x}px`;
    popover.style.top = `${Math.max(4, y)}px`;
  }

  function itemHtml(item, index) {
    const active = menu?.kind === "mention" && index === menu.active ? " is-active" : "";
    const avatar = item.persona ? personaAvatarHtml(item.persona, item.persona.avatarSrc, "persona-avatar rp-item-avatar") : `<span class="rp-item-icon" aria-hidden="true">${escapeHtml(item.icon ?? "")}</span>`;
    const detail = item.detail ? `<span class="rp-item-detail">${escapeHtml(item.detail)}</span>` : "";
    return `<button type="button" class="rp-item${active}" role="option" data-rp-item="${index}"${item.disabled ? " disabled" : ""}>${avatar}<span class="rp-item-label">${escapeHtml(item.label)}</span>${detail}</button>`;
  }

  function showItems(items, anchor) {
    menu.items = items;
    popover.innerHTML = items.length
      ? items.map(itemHtml).join("")
      : `<div class="rp-item-empty">${escapeHtml(menu.empty ?? "Nothing here.")}</div>`;
    anchor();
  }

  function openAddPicker(button, replacing = null) {
    const project = deps.getProject();
    const thread = deps.getActiveThread();
    const members = new Set(thread?.members ?? []);
    const items = listPersonas(project).map((persona) => ({
      persona,
      label: persona.name,
      detail: members.has(persona.path) ? "in chat" : persona.path,
      disabled: members.has(persona.path),
      run: () => (replacing ? replaceMember(replacing, persona.path) : addMember(persona.path))
    }));
    items.push({ icon: "+", label: "New character…", detail: "creates a .persona.skill file", run: () => createCharacter(replacing) });
    menu = { kind: "add", empty: "No characters yet." };
    const rect = button.getBoundingClientRect();
    showItems(items, () => place(rect.left, rect.bottom));
  }

  function openMemberMenu(button) {
    const project = deps.getProject();
    const path = button.dataset.rpMember;
    const member = castOf(project, deps.getActiveThread()).find((entry) => entry.path === path);
    if (!member) return;
    const items = member.persona
      ? [
          { icon: "@", label: `Mention @${member.persona.handle}`, run: () => insertMention(member.persona.handle) },
          { icon: "✎", label: "Edit character", run: () => deps.openFile(member.persona.nodeId) },
          { icon: "×", label: "Remove from chat", run: () => removeMember(path) }
        ]
      : [
          { icon: "⇄", label: "Replace with…", run: () => openAddPicker(button, path) },
          { icon: "×", label: "Remove from chat", run: () => removeMember(path) }
        ];
    menu = { kind: "member" };
    const rect = button.getBoundingClientRect();
    showItems(items, () => place(rect.left, rect.bottom));
  }

  async function createCharacter(replacing) {
    const name = await deps.promptForName("New Character", "", {
      message: "The character's name. You can change it, and the rest of the sheet, at any time.",
      submitLabel: "Create"
    });
    if (!name) return;
    const path = deps.createPersona(name);
    if (!path) return;
    if (replacing) replaceMember(replacing, path);
    else addMember(path);
    deps.showToast(`Fill in ${name}'s sheet; it is used from the next reply.`);
  }

  function insertMention(handle) {
    const input = elements.chatInput;
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const lead = caret > 0 && !/\s/.test(value[caret - 1]) ? " " : "";
    const text = `${lead}@${handle} `;
    input.setRangeText(text, caret, input.selectionEnd ?? caret, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  /** Caret position in the textarea, in viewport coordinates, via a mirror
   *  element that wraps text exactly like the textarea does. */
  function caretPoint(input, index) {
    const style = getComputedStyle(input);
    const mirror = document.createElement("div");
    for (const prop of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize",
      "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize"]) {
      mirror.style[prop] = style[prop];
    }
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
    mirror.textContent = input.value.slice(0, index);
    const marker = document.createElement("span");
    marker.textContent = "​";
    mirror.append(marker);
    document.body.append(mirror);
    const rect = input.getBoundingClientRect();
    const point = {
      left: rect.left + marker.offsetLeft - input.scrollLeft,
      top: rect.top + marker.offsetTop - input.scrollTop,
      height: parseFloat(style.lineHeight) || 16
    };
    mirror.remove();
    return point;
  }

  function updateMentionMenu() {
    const input = elements.chatInput;
    const caret = input.selectionStart ?? 0;
    if (input.selectionEnd !== caret) { if (menu?.kind === "mention") closeMenu(); return; }
    const match = MENTION_BEFORE_CARET.exec(input.value.slice(0, caret));
    const cast = castOf(deps.getProject(), deps.getActiveThread()).filter((member) => member.persona);
    if (!match || !cast.length) { if (menu?.kind === "mention") closeMenu(); return; }
    const query = match[2].toLowerCase();
    const items = cast
      .filter(({ persona }) => persona.handle.startsWith(query) || persona.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(query)))
      .map(({ persona }) => ({ persona, label: persona.name, detail: `@${persona.handle}`, handle: persona.handle }));
    if (cast.length > 1 && "all".startsWith(query)) items.push({ icon: "@", label: "Everyone", detail: "@all", handle: "all" });
    if (!items.length) { if (menu?.kind === "mention") closeMenu(); return; }
    const previous = menu?.kind === "mention" ? menu.items[menu.active]?.handle : null;
    const start = caret - match[2].length - 1;
    menu = { kind: "mention", start, end: caret, active: Math.max(0, items.findIndex((item) => item.handle === previous)) };
    const point = caretPoint(input, start);
    showItems(items, () => place(point.left, point.top, { above: true }));
  }

  function acceptMention(index) {
    const item = menu?.items?.[index];
    if (!item) return;
    const { start, end } = menu;
    closeMenu();
    const input = elements.chatInput;
    input.setRangeText(`@${item.handle} `, start, end, "end");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }

  /** Keys for the mention list while it is open. True when the key was used. */
  function handleComposerKeydown(event) {
    if (menu?.kind !== "mention" || event.isComposing) return false;
    const count = menu.items.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      menu.active = (menu.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
      popover.querySelectorAll(".rp-item").forEach((element, index) => element.classList.toggle("is-active", index === menu.active));
    } else if (event.key === "Enter" || event.key === "Tab") {
      acceptMention(menu.active);
    } else if (event.key === "Escape") {
      closeMenu();
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  popover.addEventListener("mousedown", (event) => event.preventDefault()); // keep the input focused
  popover.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rp-item]");
    if (!button || button.disabled || !menu) return;
    const index = Number(button.dataset.rpItem);
    if (menu.kind === "mention") { acceptMention(index); return; }
    const item = menu.items[index];
    closeMenu();
    void item?.run?.();
  });
  elements.chatCastBar.addEventListener("click", (event) => {
    const member = event.target.closest("[data-rp-member]");
    const add = event.target.closest("[data-rp-add]");
    const target = member ?? add;
    if (!target) return;
    const reopening = menu && menu.anchor === target;
    closeMenu();
    if (reopening) return; // a second click on the same chip closes its menu
    if (member) openMemberMenu(member);
    else openAddPicker(add);
    if (menu) menu.anchor = target;
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu || popover.contains(event.target)) return;
    if (menu.kind === "mention" && event.target === elements.chatInput) return;
    if (menu.anchor?.contains(event.target)) return;
    closeMenu();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu && menu.kind !== "mention") closeMenu();
  });
  elements.chatInput.addEventListener("blur", () => { if (menu?.kind === "mention") closeMenu(); });

  return {
    castOf,
    listPersonas,
    renderCast,
    messagesHtml,
    streamHtml,
    respond,
    closeMenu,
    updateMentionMenu,
    handleComposerKeydown
  };
}
