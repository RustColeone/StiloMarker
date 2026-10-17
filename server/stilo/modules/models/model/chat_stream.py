"""A chat-completions stream put back together: text, reasoning and tool-call
fragments in, the events to show and the finished response out. Pure; the
Responses API has its twin in model/responses.py."""


class ChatStream:
    def __init__(self):
        self.text: list[str] = []
        self.tools: dict[int, dict] = {}
        self.finish_reason = None

    def feed(self, chunk: dict) -> list[dict]:
        """Take one streamed chunk; returns what to show, in order:
        [{"text": str}, {"reasoning": str}]."""
        shown = []
        choices = chunk.get("choices") or []
        if not choices:
            return shown
        choice = choices[0]
        delta = choice.get("delta") or {}
        if choice.get("finish_reason"):
            self.finish_reason = choice["finish_reason"]
        for call in delta.get("tool_calls") or []:
            slot = self.tools.setdefault(call.get("index", 0), {
                "id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            if call.get("id"):
                slot["id"] = call["id"]
            fn = call.get("function") or {}
            if fn.get("name"):
                slot["function"]["name"] = fn["name"]
            if fn.get("arguments"):
                slot["function"]["arguments"] += fn["arguments"]
        text = delta.get("content")
        if isinstance(text, str) and text:
            self.text.append(text)
            shown.append({"text": text})
        # A reasoning model's chain of thought comes separately, shown live but
        # never mixed into the answer.
        reasoning = delta.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning:
            shown.append({"reasoning": reasoning})
        return shown

    def result(self) -> dict:
        message: dict = {"role": "assistant", "content": "".join(self.text)}
        if self.tools:
            message["tool_calls"] = [self.tools[i] for i in sorted(self.tools)]
        return {"choices": [{"message": message, "finish_reason": self.finish_reason}]}
