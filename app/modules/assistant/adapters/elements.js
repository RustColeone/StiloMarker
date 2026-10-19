// The Agent page's elements (its conversation, input, threads and history),
// looked up once when it is created. A missing one stops the start: the page and
// the code disagree.
function query(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing DOM node: ${selector}`);
  return node;
}

export function findElements() {
  return {
    chatAddActiveFileButton: query("#chat-add-active-file-button"),
    chatComposeForm: query("#chat-compose-form"),
    chatContextList: query("#chat-context-list"),
    chatHistoryPane: query("#chat-history-pane"),
    chatHistorySearch: query("#chat-history-search"),
    chatHistoryToggleButton: query("#chat-history-toggle-button"),
    chatInput: query("#chat-input"),
    chatMessageList: query("#chat-message-list"),
    chatModelSelect: query("#chat-model-select"),
    chatSendButton: query("#chat-send-button"),
    chatStatusText: query("#chat-status-text"),
    chatThreadList: query("#chat-thread-list")
  };
}
