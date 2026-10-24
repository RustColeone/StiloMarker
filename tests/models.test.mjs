import test from "node:test";
import assert from "node:assert/strict";

import { chosenModel, createChatStream, groupByProvider, runDirectReply } from "../app/modules/models/index.js";

test("a streamed reply is put back together: text so far, and each tool call's pieces", () => {
  const stream = createChatStream();
  assert.equal(stream.feed('data: {"choices":[{"delta":{"content":"Aye, "}}]}'), "Aye, ");
  assert.equal(stream.feed(": keep-alive"), null);
  assert.equal(stream.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}'), null);
  stream.feed('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.md\\"}"}}]}}]}');
  assert.equal(stream.feed('data: {"choices":[{"delta":{"content":"captain."}}]}'), "Aye, captain.");
  assert.equal(stream.feed("data: [DONE]"), null);
  assert.equal(stream.feed("data: {broken"), null);
  assert.deepEqual(stream.result(), { content: "Aye, captain.", toolCalls: [
    { id: "c1", type: "function", function: { name: "read_file", arguments: '{"path":"a.md"}' } }] });
});

test("the picker groups models by provider and keeps a saved choice only while offered", () => {
  const providers = { "deepseek-flash": "DeepSeek", "gpt-6.1": "OpenAI", "deepseek-v4-pro": "DeepSeek" };
  assert.deepEqual(groupByProvider(["deepseek-flash", "gpt-6.1", "deepseek-v4-pro"], (m) => providers[m]),
    [["DeepSeek", ["deepseek-flash", "deepseek-v4-pro"]], ["OpenAI", ["gpt-6.1"]]]);
  assert.deepEqual(groupByProvider(["x"], () => undefined), [["", ["x"]]]);
  assert.equal(chosenModel(["a", "b"], "b", "a"), "b");
  assert.equal(chosenModel(["a", "b"], "gone", "a"), "a");
  assert.equal(chosenModel(["a", "b"], "gone", undefined), "a");
  assert.equal(chosenModel([], "gone", undefined), null);
});

function sse(lines) {
  return new Response(lines.map((line) => `data: ${line}\n`).join(""), { headers: { "content-type": "text/event-stream" } });
}

test("a reply from the user's own endpoint answers tool calls from this browser and streams the text", async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  const replies = [
    sse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "read_file", arguments: '{"path":"a.md"}' } }] } }] })]),
    sse([JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t2", function: { name: "edit_file", arguments: "{}" } }] } }] })]),
    sse([JSON.stringify({ choices: [{ delta: { content: "She " } }] }), JSON.stringify({ choices: [{ delta: { content: "nods." } }] }), "[DONE]"])
  ];
  globalThis.fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return replies.shift(); };
  try {
    const texts = [], tools = [];
    const reply = await runDirectReply({
      payload: { messages: [{ role: "system", content: "be Mara" }], tools: [{}] }, apiUrl: "http://localhost:11434/v1/chat/completions",
      apiKey: "mine", model: "llama", onText: (text) => texts.push(text), onTool: (name) => tools.push(name),
      tools: { read_file: async ({ path }) => ({ content: `text of ${path}` }) }, refusal: "read only"
    });
    assert.equal(reply, "She nods.");
    assert.deepEqual(tools, ["read_file", "edit_file"]);
    assert.equal(sent[0].init.headers.authorization, "Bearer mine");
    assert.deepEqual([sent[0].body.model, sent[0].body.stream], ["llama", true]);
    assert.deepEqual(sent[1].body.messages.at(-1), { role: "tool", tool_call_id: "t1", content: '{"content":"text of a.md"}' });
    assert.deepEqual(sent[2].body.messages.at(-1), { role: "tool", tool_call_id: "t2", content: '{"error":"read only"}' });
    assert.equal(texts.at(-1), "She nods.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a refusal or an unreachable endpoint says what happened", async () => {
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "model not found" } }), { status: 404 });
    await assert.rejects(runDirectReply({ payload: { messages: [] }, apiUrl: "http://localhost:1/v1", onText() {} }),
      /The model endpoint answered 404: model not found/);
    globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
    globalThis.location ??= { href: "http://localhost/" };
    await assert.rejects(runDirectReply({ payload: { messages: [] }, apiUrl: "http://localhost:1/v1", onText() {} }),
      /Could not reach localhost:1 from this browser/);
    await assert.rejects(runDirectReply({ payload: { messages: [] }, apiUrl: "", onText() {} }), /Set the API URL/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the agent's connection: the server's answer, the user's own key, sign-in and no answer", async () => {
  const { AGENT_STATUS, ownKeyOverride, settingsLine, statusFromServer, statusWithoutServer } = await import("../app/modules/models/model/agent-status.js");
  const server = { agentSource: "server", chatModel: "b" };
  const answer = { configured: true, model: "a", models: ["a", "b"], modelInfo: [{ id: "a", provider: "DeepSeek" }], provider: "DeepSeek" };
  const ready = statusFromServer(answer, { settings: server, signedIn: true });
  assert.equal(ready.status, "ready");
  assert.equal(ready.selectedModel, "b", "the saved choice is kept when offered");
  assert.deepEqual(ready.modelProviders, { a: "DeepSeek" });
  assert.equal(settingsLine({ ...AGENT_STATUS, ...ready }, server).ok, true);
  const signin = statusFromServer({ ...answer, requiresAccount: true }, { settings: server, signedIn: false });
  assert.deepEqual([signin.status, signin.configured], ["signin", false]);
  assert.equal(statusFromServer({ configured: false }, { settings: server, signedIn: true }).status, "unconfigured");
  const own = { agentSource: "own", agentApiKey: " sk-1 ", agentApiUrl: "", agentModel: "m" };
  assert.deepEqual(ownKeyOverride(own), { apiKey: "sk-1", apiModel: "m" });
  assert.deepEqual(ownKeyOverride(server), {});
  assert.equal(statusFromServer(answer, { settings: own, signedIn: false }).provider, "Your key");
  assert.equal(statusWithoutServer(new Error("down"), { settings: server }).status, "offline");
  assert.equal(statusWithoutServer(Object.assign(new Error("no"), { status: 403 }), { settings: server }).status, "restricted");
  // The user's own key goes through the server: without it, that is said (not "ready").
  const through = statusWithoutServer(new Error("down"), { settings: own });
  assert.equal(through.status, "offline");
  assert.match(through.detail, /Directly from this browser/);
  assert.equal(settingsLine({ ...AGENT_STATUS, ...through }, own).ok, false);
  // Run in this browser: no server needed; the URL is.
  const here = { ...own, agentRunner: "browser", agentApiUrl: "http://localhost:11434/v1/chat/completions", agentApiKey: "" };
  for (const status of [statusWithoutServer(new Error("down"), { settings: here }), statusFromServer(answer, { settings: here, signedIn: false })]) {
    assert.deepEqual([status.status, status.configured, status.provider], ["ready", true, "Your key"]);
  }
  assert.deepEqual(settingsLine(AGENT_STATUS, here), { text: "Ready — your own endpoint, called from this browser.", ok: true });
  const noUrl = statusWithoutServer(null, { settings: { ...here, agentApiUrl: " " } });
  assert.deepEqual([noUrl.status, noUrl.configured], ["unconfigured", false]);
  // While the server is asked: not "ready" yet (v0.3.10), neither success nor error; no key is said at once.
  const checking = { ...AGENT_STATUS, status: "checking" };
  assert.deepEqual(settingsLine(checking, own), { text: "Checking the server…", ok: null });
  assert.deepEqual(settingsLine({ ...checking, ...ready, status: "checking" }, server), { text: "Checking the server…", ok: null });
  assert.equal(settingsLine(checking, { ...own, agentApiKey: "" }).text, "Enter your API key below to enable the agent.");
});

test("the agent's connection: only the latest asking counts (an earlier answer arriving late is dropped)", async () => {
  const { createAgentConnection } = await import("../app/modules/models/adapters/agent.js");
  const { AGENT_STATUS, settingsLine } = await import("../app/modules/models/model/agent-status.js");
  let value = { ...AGENT_STATUS };
  const state = { get: () => value, set: (why, patch) => { value = { ...value, ...patch }; }, on: () => () => {} };
  const settings = { agentSource: "own", agentApiKey: "sk-1", agentRunner: "server", chatModel: "" };
  const answers = [];
  const server = { request: () => new Promise((resolve, reject) => { answers.push({ resolve, reject }); }) };
  const agent = createAgentConnection({ state, server, settings });
  const first = agent.refresh({ silent: true });
  const second = agent.refresh({ silent: true });
  answers[1].reject(new Error("down")); // the latest: the server can't be reached
  await second;
  assert.equal(value.status, "offline");
  answers[0].resolve({}); // the earlier one, late: dropped
  await first;
  assert.equal(value.status, "offline", "the late answer did not undo the latest");
  assert.equal(settingsLine(value, settings).ok, false);
});
