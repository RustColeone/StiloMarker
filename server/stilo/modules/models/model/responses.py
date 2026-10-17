"""The OpenAI Responses API spoken in chat-completions form: a chat request
translated into a /v1/responses request, and its stream events turned back
into the pieces a chat-completions stream gives. Pure."""


def _input_content(content):
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            parts.append({"type": "input_text", "text": str(part.get("text", ""))})
        elif part.get("type") == "image_url":
            url = part.get("image_url")
            parts.append({"type": "input_image", "image_url": url.get("url", "") if isinstance(url, dict) else str(url or "")})
    return parts


def to_responses_request(payload: dict) -> dict:
    """A chat-completions payload as a streaming /v1/responses request."""
    items = []
    for message in payload.get("messages") or []:
        role = message.get("role")
        if role == "tool":
            items.append({"type": "function_call_output", "call_id": str(message.get("tool_call_id", "")),
                          "output": str(message.get("content") or "")})
            continue
        if role == "assistant":
            if message.get("content"):
                items.append({"role": "assistant", "content": str(message["content"])})
            for call in message.get("tool_calls") or []:
                fn = call.get("function") or {}
                items.append({"type": "function_call", "call_id": str(call.get("id", "")),
                              "name": str(fn.get("name", "")), "arguments": str(fn.get("arguments") or "{}")})
            continue
        items.append({"role": "developer" if role == "system" else "user", "content": _input_content(message.get("content"))})
    request = {"model": payload.get("model"), "input": items, "stream": True, "store": False}
    tools = [{"type": "function", "name": t["function"].get("name"), "description": t["function"].get("description", ""),
              "parameters": t["function"].get("parameters") or {"type": "object", "properties": {}}}
             for t in payload.get("tools") or [] if isinstance(t, dict) and isinstance(t.get("function"), dict)]
    if tools:
        request["tools"] = tools
        choice = payload.get("tool_choice")
        if isinstance(choice, str):
            request["tool_choice"] = choice
        elif isinstance(choice, dict) and isinstance(choice.get("function"), dict):
            request["tool_choice"] = {"type": "function", "name": choice["function"].get("name")}
    if payload.get("max_tokens"):
        request["max_output_tokens"] = payload["max_tokens"]
    return request


class ResponsesStream:
    """Turns /v1/responses stream events into the pieces the chat-completions
    parser produces: text deltas, reasoning, tool-call slots, finish reason."""

    def __init__(self):
        self.text: list[str] = []
        self.tools: dict[int, dict] = {}
        self.finish_reason = None

    def feed(self, event: dict) -> dict | None:
        """Process one event; returns {"text"| "reasoning": str} to show, if any."""
        kind = event.get("type", "")
        if kind == "response.output_text.delta":
            delta = str(event.get("delta", ""))
            self.text.append(delta)
            return {"text": delta}
        if kind in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
            return {"reasoning": str(event.get("delta", ""))}
        if kind == "response.output_item.added" and (event.get("item") or {}).get("type") == "function_call":
            item = event["item"]
            self.tools[int(event.get("output_index", len(self.tools)))] = {
                "id": str(item.get("call_id", "")), "type": "function",
                "function": {"name": str(item.get("name", "")), "arguments": str(item.get("arguments") or "")}}
        elif kind == "response.function_call_arguments.delta":
            slot = self.tools.get(int(event.get("output_index", -1)))
            if slot is not None:
                slot["function"]["arguments"] += str(event.get("delta", ""))
        elif kind == "response.function_call_arguments.done":
            slot = self.tools.get(int(event.get("output_index", -1)))
            if slot is not None and event.get("arguments") is not None:
                slot["function"]["arguments"] = str(event["arguments"])
        elif kind == "response.completed":
            self.finish_reason = "tool_calls" if self.tools else "stop"
        elif kind == "response.incomplete":
            self.finish_reason = "length"
        elif kind in ("response.failed", "error"):
            error = (event.get("response") or {}).get("error") or event.get("error") or event
            raise RuntimeError(str((error or {}).get("message") or "The model request failed."))
        return None

    def result(self) -> dict:
        message: dict = {"role": "assistant", "content": "".join(self.text)}
        if self.tools:
            message["tool_calls"] = [self.tools[i] for i in sorted(self.tools)]
        return {"choices": [{"message": message, "finish_reason": self.finish_reason}]}
