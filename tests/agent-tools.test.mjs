// The browser's half of spec/assistant/tools.cases.json (the server's is
// assistant-edits.test.py): the workspace agent's tools, as the agent this
// browser runs with the user's own key calls them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyEdits, runTool, toolArguments } from "../app/modules/assistant/model/agent-tools.js";

const table = JSON.parse(readFileSync(new URL("../spec/assistant/tools.cases.json", import.meta.url), "utf8"));

for (const entry of table.edits) {
  test(`edit_file passages: ${entry.name}`, () => {
    if ("error" in entry) assert.throws(() => applyEdits(entry.text, entry.edits), (error) => error.message === entry.error);
    else assert.equal(applyEdits(entry.text, entry.edits), entry.expect);
  });
}

for (const turn of table.turns) {
  test(`agent tools: ${turn.name}`, () => {
    const proposals = [];
    let next = 0;
    const results = turn.calls.map((call) => runTool(call.tool, toolArguments(call.arguments), structuredClone(table.project), proposals,
      { readOnly: turn.readOnly, newId: () => `op-${++next}` }));
    // Ids numbered in the order they first appear, as the table does.
    const names = new Map();
    const norm = (value) => (Array.isArray(value) ? value.map(norm) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, key === "proposalId" ? (names.get(v) ?? names.set(v, `op-${names.size + 1}`).get(v)) : norm(v)]))
      : value);
    assert.deepEqual(norm(results), turn.calls.map((call) => call.result));
    assert.deepEqual(norm(proposals), turn.proposals);
  });
}

// The browser's half of spec/assistant/request.cases.json (the server's is
// assistant-edits.test.py): the first request a turn sends, as the server's agent sends it.
const { runTurnHere: runAgentTurn } = await import("../app/modules/assistant/service/local-agent.js");
const { default: manual } = await import("../app/modules/assistant/adapters/manual.js");
const { default: contract } = await import("../app/modules/assistant/model/agent-contract.js");
const requests = JSON.parse(readFileSync(new URL("../spec/assistant/request.cases.json", import.meta.url), "utf8"));

for (const entry of requests.cases) {
  test(`the agent's first request, as the server sends it: ${entry.name}`, async () => {
    const bodies = [];
    const result = await runAgentTurn({ messages: entry.messages, contextFiles: entry.contextFiles, projectName: entry.projectName,
      project: entry.project, model: entry.model, manual, complete: async (body) => { bodies.push(structuredClone(body)); return { content: "Done.", toolCalls: [] }; } });
    const body = bodies[0];
    body.messages[0].content = body.messages[0].content.replace(manual, "<manual>");
    if (body.tools) {
      assert.deepEqual(body.tools, contract.tools);
      body.tools = "<contract tools>";
    }
    assert.deepEqual(body, entry.body);
    assert.deepEqual(result.contextPaths, entry.contextPaths);
  });
}

test("the agent in this browser: a turn reads, proposes an edit, says so, and returns the proposal", async () => {
  const project = structuredClone(table.project);
  const replies = [
    { content: "", toolCalls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: "notes.md" }) } }] },
    { content: "", toolCalls: [{ id: "c2", type: "function", function: { name: "edit_file", arguments: JSON.stringify({ path: "notes.md", edits: [{ find: "two", replace: "2" }] }) } }] },
    { content: "Changed two to 2.", toolCalls: [] }
  ];
  const seen = [], events = [];
  let ids = 0;
  const result = await runAgentTurn({ messages: [{ role: "user", content: "Use digits" }], projectName: "P", project, model: "m",
    newId: () => String(++ids),
    complete: async (body, { onText }) => { seen.push(structuredClone(body)); const reply = replies.shift(); if (reply.content) onText(reply.content); return reply; },
    onProgress: (event) => events.push(event) });
  assert.equal(result.message, "Changed two to 2.");
  assert.equal(result.proposedOperations.length, 1);
  assert.equal(result.proposedOperations[0].type, "update-file");
  assert.match(result.proposedOperations[0].content, /One 2 three/);
  assert.match(result.batchId, /^batch-/);
  // The model saw what it read, then the proposal's answer.
  assert.deepEqual(JSON.parse(seen[1].messages.at(-1).content), { content: project.nodes.n.content });
  assert.equal(JSON.parse(seen[2].messages.at(-1).content).status, "proposed");
  assert.deepEqual(events.map((event) => event.type), ["status", "tool", "status", "tool", "status", "delta"]);
  assert.deepEqual(events.filter((event) => event.type === "tool").map(({ name, target }) => [name, target]), [["read_file", "notes.md"], ["edit_file", "notes.md"]]);
});

test("the agent in this browser: attached files within the context budget; stopped; an empty answer", async () => {
  const bodies = [];
  const big = Array.from({ length: 4 }, (_, index) => ({ path: `f${index}.md`, content: "y".repeat(25000) }));
  const result = await runAgentTurn({ messages: [{ role: "user", content: "Use these" }], contextFiles: big, project: null,
    complete: async (body) => { bodies.push(body); return { content: "ok", toolCalls: [] }; } });
  assert.deepEqual(result.contextPaths, ["f0.md", "f1.md", "f2.md"]);
  assert.ok(bodies[0].messages[0].content.length < 60000 + 50000, "the attached text stays within the budget");
  assert.equal(bodies[0].tools, undefined, "no project: no tools");
  await assert.rejects(runAgentTurn({ messages: [{ role: "user", content: "x" }], cancelled: () => true, complete: async () => ({ content: "", toolCalls: [] }) }), /Chat stopped/);
  await assert.rejects(runAgentTurn({ messages: [{ role: "user", content: "x" }], complete: async () => ({ content: "  ", toolCalls: [] }) }), /empty response/);
  await assert.rejects(runAgentTurn({ messages: [{ role: "assistant", content: "x" }], complete: async () => ({ content: "a", toolCalls: [] }) }), /A user message is required/);
});
