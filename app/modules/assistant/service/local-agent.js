// One turn of the workspace agent run in this browser with the user's own
// key, no server needed: the same instructions, tools and limits as the
// server's agent (protocol/agent.json), the user manual as its reference,
// its tools run on the project as this turn sees it (model/agent-tools.js),
// and what it proposes returned for the user to keep or drop, as the
// server's turn returns it. Connected tools and images are the server's.
//
// complete(body, { onText, onReasoning }) -> { content, toolCalls } is one
// model call (Models' streamCompletion, given by the caller); manual is the
// user manual, the agent's reference (adapters/manual.js); onProgress
// hears what the server's agent says as it goes ("status", "delta",
// "reasoning", "tool"). No input or output of its own.
import contract from "../model/agent-contract.js";
import { runTool, toolArguments } from "../model/agent-tools.js";
import { projectTree, serializeContext } from "../../characters/index.js";

const { limits, instructions } = contract;

// The conversation as the model is given it: the last turns, user and
// assistant only, each within its length.
function conversation(messages) {
  const kept = [];
  for (const message of (messages ?? []).slice(-limits.maxMessages)) {
    if (!message || typeof message !== "object") continue;
    const role = String(message.role ?? "").trim().toLowerCase();
    if (!["user", "assistant", "system"].includes(role)) continue;
    const content = String(message.content ?? "").trim();
    if (content) kept.push({ role, content: content.slice(0, limits.maxMessageChars) });
  }
  if (!kept.some((message) => message.role === "user")) throw new Error("A user message is required.");
  return kept;
}

// The system prompt, section by section, as the server's agent writes it.
export function systemPrompt({ projectName, project, contextText, manual = "" }) {
  const sections = [instructions.opening];
  if (manual) sections.push(`${instructions.manualHeading}\n\n${manual}`);
  sections.push(projectName ? `Project: ${projectName}` : "Project: Workspace", ...instructions.rules, instructions.guide);
  const tree = project ? projectTree(project) : "";
  if (tree) sections.push(`${instructions.treeHeading}\n${tree}`);
  if (contextText) sections.push(`${instructions.contextHeading}\n${contextText}`);
  return sections.join("\n\n");
}

const describe = (call) => {
  const args = toolArguments(call?.function?.arguments);
  const target = String(args?.path || args?.name || args?.parentPath || "").trim();
  return { name: String(call?.function?.name ?? ""), target };
};

export async function runTurnHere({ messages, contextFiles = [], projectName = "", project = null, model, complete, manual = "",
  onProgress = () => {}, cancelled = () => false, newId = () => Math.random().toString(16).slice(2, 10) }) {
  const kept = conversation(messages);
  const context = serializeContext(contextFiles, limits.maxContextChars);
  const payload = {
    ...(model ? { model } : {}),
    temperature: limits.temperature,
    messages: [{ role: "system", content: systemPrompt({ projectName, project, contextText: context.text, manual }) }, ...kept]
  };
  if (project) {
    payload.tools = structuredClone(contract.tools);
    payload.tool_choice = "auto";
  }
  const proposals = [];
  const proposalId = () => `op-${newId()}`;
  const run = (call) => runTool(String(call?.function?.name ?? ""), toolArguments(call?.function?.arguments), project, proposals, { newId: proposalId });
  let reply = "";
  for (let iteration = 0; iteration <= limits.maxToolIterations; iteration += 1) {
    if (cancelled()) throw new Error("Chat stopped.");
    onProgress({ type: "status", stage: "thinking", iteration });
    // The text as it grows, said in pieces (as the server streams it).
    let shown = "", thought = "";
    const { content, toolCalls } = await complete(payload, {
      onText(text) { if (text.length > shown.length) { onProgress({ type: "delta", text: text.slice(shown.length) }); shown = text; } },
      onReasoning(text) { if (text.length > thought.length) { onProgress({ type: "reasoning", text: text.slice(thought.length) }); thought = text; } }
    });
    if (!toolCalls?.length) {
      reply = String(content ?? "").trim();
      break;
    }
    if (iteration >= limits.maxToolIterations) {
      // The step limit: the last calls' writes still count, so a turn that
      // explored first and wrote last is not lost.
      for (const call of toolCalls) {
        if (proposals.length >= limits.maxOpsPerTurn) continue;
        onProgress({ type: "tool", ...describe(call) });
        run(call);
      }
      reply = String(content ?? "").trim();
      if (!reply && proposals.length) {
        reply = "I've prepared the changes below. (Reached the tool step limit, so review and re-run if anything is missing.)";
      }
      break;
    }
    payload.messages.push({ role: "assistant", content: String(content ?? ""), tool_calls: toolCalls });
    for (const call of toolCalls) {
      onProgress({ type: "tool", ...describe(call) });
      const result = proposals.length >= limits.maxOpsPerTurn ? { status: "rejected", reason: "max_ops_per_turn exceeded" } : run(call);
      payload.messages.push({ role: "tool", tool_call_id: call.id ?? "", content: JSON.stringify(result) });
    }
  }
  if (!reply) throw new Error("Chat provider returned an empty response.");
  return {
    message: reply,
    model: model ?? null,
    provider: "Your key",
    contextPaths: context.paths,
    proposedOperations: proposals,
    batchId: proposals.length ? `batch-${newId()}` : null
  };
}
