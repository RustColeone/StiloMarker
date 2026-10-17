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
