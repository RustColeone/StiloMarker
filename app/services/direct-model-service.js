// A character's reply generated straight from this browser: the request the
// server built (system prompt, transcript, read-only tools) is sent to the
// user's own OpenAI-compatible endpoint — their key, or a model on this
// computer such as Ollama or LM Studio. Tool calls (list_files / read_file) are
// answered from this browser's copy of the project.

const MAX_STEPS = 6;

/** Parse an OpenAI-style streamed response into { content, toolCalls }. */
async function readStream(response, onText) {
  const type = response.headers.get("content-type") || "";
  if (!response.body || !type.includes("event-stream")) {
    const data = await response.json();
    const message = data?.choices?.[0]?.message ?? {};
    const content = typeof message.content === "string" ? message.content : "";
    if (content) onText(content);
    return { content, toolCalls: message.tool_calls ?? [] };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "";
  const calls = new Map();
  const handle = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    const delta = chunk?.choices?.[0]?.delta ?? {};
    if (typeof delta.content === "string" && delta.content) { content += delta.content; onText(content); }
    for (const call of delta.tool_calls ?? []) {
      const slot = calls.get(call.index ?? 0) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.function.name = call.function.name;
      if (call.function?.arguments) slot.function.arguments += call.function.arguments;
      calls.set(call.index ?? 0, slot);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) { handle(buffer.slice(0, index).trim()); buffer = buffer.slice(index + 1); }
    }
    if (done) break;
  }
  handle(buffer.trim());
  return { content, toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call) };
}

export async function runDirectReply({ payload, apiUrl, apiKey, model, signal, onText, tools = {}, onTool }) {
  if (!apiUrl) throw new Error("Set the API URL in Settings → Agent to run replies from this browser.");
  const messages = [...payload.messages];
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const body = { ...payload, messages, stream: true, ...(model ? { model } : {}) };
    if (step === MAX_STEPS - 1 && body.tools) body.tool_choice = "none"; // last step: answer with what was read
    let response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`Could not reach ${new URL(apiUrl, location.href).host} from this browser (is it running, and does it allow this site?).`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      let message = detail;
      try { message = JSON.parse(detail)?.error?.message ?? detail; } catch { /* plain text */ }
      throw new Error(`The model endpoint answered ${response.status}${message ? `: ${String(message).slice(0, 200)}` : ""}`);
    }
    const { content, toolCalls } = await readStream(response, onText);
    if (!toolCalls.length) return content.trim();
    messages.push({ role: "assistant", content, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* keep {} */ }
      onTool?.(call.function.name, args);
      const run = tools[call.function.name];
      const result = run ? await run(args) : { error: "Characters can read workspace files but cannot change them." };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
    onText("");
  }
  return "";
}
