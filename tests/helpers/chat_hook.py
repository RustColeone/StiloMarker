"""Test access to the chat panel's internals for the browser regressions.

The Agent page (the Assistant module's) lives in
app/modules/assistant/adapters/panel.js and loads on demand, so its
state is not in main.js's scope. Browser tests that serve the app from this
checkout pass the module through `inject_chat_internals`, which exposes the
internals as `window.__chatInternals` once the module has loaded. `CHAT_HOOK`
is the matching set of getters to splice into a test's `window.__…Test` object.
"""

_MARKER = b"\n  // Test access (tests/helpers/chat_hook.py adds a line here).\n"
_EXPOSE = (b"\n  window.__chatInternals = { chatState, setActiveChatThread: app.setActiveChatThread, createNewChatConversation: app.createNewChatConversation,"
           b" getActiveChatThread: app.getActiveChatThread, setChatTab: (tab) => app.pages.show(\"side\", tab === \"chats\" ? \"chats\" : \"agent\"),"
           b" get chats() { return chatsPage.view(); }, get mcpControls() { return app.mcpControls; }, get agentStatus() { return app.agent.status(); },"
           b" receiveSync: (workspace) => app.chatSynchronizer?.receive(workspace) };")

CHAT_HOOK = ("get chatState() { return window.__chatInternals?.chatState; },"
             " get agentStatus() { return window.__chatInternals?.agentStatus; },"
             " setActiveChatThread: (...a) => window.__chatInternals.setActiveChatThread(...a),"
             " createNewChatConversation: (...a) => window.__chatInternals.createNewChatConversation(...a),"
             " getActiveChatThread: (...a) => window.__chatInternals?.getActiveChatThread(...a),"
             " setChatTab: (...a) => window.__chatInternals.setChatTab(...a),"
             " get chats() { return window.__chatInternals?.chats; },"
             " get mcpControls() { return window.__chatInternals?.mcpControls; },"
             " receiveChat: (workspace) => window.__chatInternals.receiveSync(workspace)")

WAIT_LOADED = "Boolean(window.__chatInternals)"


def inject_chat_internals(path: str, body: bytes) -> bytes:
    if path != "/app/modules/assistant/adapters/panel.js":
        return body
    assert _MARKER in body, "assistant/adapters/panel.js changed: update tests/helpers/chat_hook.py"
    return body.replace(_MARKER, _EXPOSE + _MARKER, 1)
