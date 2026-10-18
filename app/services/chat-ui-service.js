export function shouldSubmitChat(event, mobile = false) {
  return event.key === "Enter" && !event.isComposing && event.keyCode !== 229
    && !event.shiftKey && Boolean(!mobile || event.ctrlKey || event.metaKey);
}
export function isChatNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 64;
}
export function installMobileViewport(window, element, maxWidth = 900) {
  const update = () => {
    const viewport = window.visualViewport;
    if (!window.matchMedia(`(max-width: ${maxWidth}px)`).matches || !viewport || viewport.scale !== 1) {
      element.style.removeProperty('--mobile-viewport-height');
      return;
    }
    element.style.setProperty('--mobile-viewport-height', `${viewport.height}px`);
  };
  window.visualViewport?.addEventListener('resize', update);
  window.addEventListener('resize', update);
  update();
  return update;
}

// A conversation's list of messages, repainted only where it changed: the
// earlier messages, and the live part (a reply being written). Keeps the
// reader's place unless they were following the bottom.
export function paintConversation(messageList, historyHtml, liveHtml, { changed, toBottom }) {
  let history = messageList.querySelector(".chat-history-content");
  let stream = messageList.querySelector(".chat-stream-content");
  const conversationChanged = changed || toBottom || !history || !stream
    || history._renderedHtml !== historyHtml || stream._renderedHtml !== liveHtml;
  // Measured BEFORE the content changes: were we following the bottom?
  const oldScroll = conversationChanged ? messageList.scrollTop : 0;
  const follow = conversationChanged && (toBottom || changed || isChatNearBottom(messageList));
  if (!history || !stream) {
    history = document.createElement("div"); history.className = "chat-history-content";
    stream = document.createElement("div"); stream.className = "chat-stream-content";
    messageList.replaceChildren(history, stream);
  }
  if (history._renderedHtml !== historyHtml) { history.innerHTML = historyHtml; history._renderedHtml = historyHtml; }
  if (stream._renderedHtml !== liveHtml) { stream.innerHTML = liveHtml; stream._renderedHtml = liveHtml; }
  if (conversationChanged) messageList.scrollTop = follow ? messageList.scrollHeight : oldScroll;
}

// Attached files, as chips with a remove button.
export const contextChipsHtml = (paths, escapeHtmlAttribute) => paths.map((path) => `
        <span class="chat-context-chip">
          <span class="chat-context-chip-label">${escapeHtmlAttribute(path)}</span>
          <button type="button" data-chat-remove-context="${escapeHtmlAttribute(path)}" aria-label="Remove ${escapeHtmlAttribute(path)}">×</button>
        </span>
      `).join("");
