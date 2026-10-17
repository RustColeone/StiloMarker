// A model called straight from this browser: a request the server built
// (system prompt, transcript, read-only tools) sent to the user's own
// OpenAI-compatible endpoint, their key or a model on this computer such as
// Ollama or LM Studio. Tool calls are answered by the `tools` the caller
// passes (a character's list_files / read_file on this browser's copy).
import { createChatStream, wholeReply } from "../model/stream.js";

const MAX_STEPS = 6;

async function readStream(response, onText) {
  const type = response.headers.get("content-type") || "";
  if (!response.body || !type.includes("event-stream")) {
    const reply = wholeReply(await response.json());
    if (reply.content) onText(reply.content);
    return reply;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const stream = createChatStream();
  const take = (line) => { const text = stream.feed(line.trim()); if (text !== null) onText(text); };
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) { take(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    if (done) break;
  }
  take(buffer);
  return stream.result();
}

// `refusal` is what the model is told when it calls a tool not in `tools`.
export async function runDirectReply({ payload, apiUrl, apiKey, model, signal, onText, tools = {}, onTool, refusal = "That tool is not available here." }) {
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
      const result = run ? await run(args) : { error: refusal };
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
    onText("");
  }
  return "";
}
