// A chat-completions reply put back together from its server-sent lines:
// the text so far and each tool call's name and arguments; a reasoning
// model's chain of thought (reasoning_content) goes to onReasoning as it
// grows. Pure; the server's twin is server/stilo/modules/models/model/chat_stream.py.
export function createChatStream({ onReasoning } = {}) {
  let content = "";
  let reasoning = "";
  const calls = new Map();
  return {
    // One line of the stream; returns the whole text so far when it grew, else null.
    feed(line) {
      if (!line.startsWith("data:")) return null;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") return null;
      let chunk;
      try { chunk = JSON.parse(data); } catch { return null; }
      const delta = chunk?.choices?.[0]?.delta ?? {};
      for (const call of delta.tool_calls ?? []) {
        const slot = calls.get(call.index ?? 0) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.function.name = call.function.name;
        if (call.function?.arguments) slot.function.arguments += call.function.arguments;
        calls.set(call.index ?? 0, slot);
      }
      if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        onReasoning?.(reasoning);
      }
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        return content;
      }
      return null;
    },
    result: () => ({ content, toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call) })
  };
}

// A reply that came back whole (no stream): the same shape.
export function wholeReply(data) {
  const message = data?.choices?.[0]?.message ?? {};
  return { content: typeof message.content === "string" ? message.content : "", toolCalls: message.tool_calls ?? [] };
}
