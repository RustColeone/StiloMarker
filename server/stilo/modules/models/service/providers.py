"""The model providers this server can call and the route of each request:
DeepSeek (or any OpenAI-compatible endpoint set in the environment), OpenAI's
chat models when its key is set, and a user's own key. A request first gets a
Route (which model, at which URL, with which key) and is then streamed along
it; nothing about a request is kept here between calls."""
import time
from dataclasses import dataclass

from ..model.catalog import DEEPSEEK_MODELS, request_options, uses_responses_api
from ..model.chat_stream import ChatStream
from ..model.responses import ResponsesStream, to_responses_request


def _truthy(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _bounded_int(env, name, default, minimum, maximum) -> int:
    try:
        return max(minimum, min(maximum, int(env.get(name, ""))))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class Route:
    model: str
    url: str
    key: str
    label: str
    responses_url: str = ""   # set when the model is called through the Responses API

    @property
    def ready(self) -> bool:
        return bool(self.key and self.url)


class Providers:
    def __init__(self, env, openai, http):
        """env: the settings (os.environ); openai: adapters/openai.py's
        OpenAIProvider; http: adapters/http.py (stream_events, post_json)."""
        self.api_key = (env.get("MDNOTES_CHAT_API_KEY", "") or env.get("DEEPSEEK_API_KEY", "")).strip()
        self.api_url = ((env.get("MDNOTES_CHAT_API_URL", "") or env.get("DEEPSEEK_API_URL", "")).strip()
                        or "https://api.deepseek.com/chat/completions")
        self.default_model = (env.get("MDNOTES_CHAT_MODEL", "") or env.get("DEEPSEEK_MODEL", "")).strip() or "deepseek-flash"
        # Models a client may pick (comma-separated), validated against this list
        # so an arbitrary model name can't be injected. The default comes first.
        extra = [name.strip() for name in env.get("MDNOTES_CHAT_MODELS", "").split(",") if name.strip()]
        self.models = list(dict.fromkeys(m for m in [self.default_model, *extra, *DEEPSEEK_MODELS] if m))
        self.organization = env.get("MDNOTES_CHAT_ORGANIZATION", "").strip()
        self.label = env.get("MDNOTES_CHAT_PROVIDER", "DeepSeek").strip() or "DeepSeek"
        self.timeout = _bounded_int(env, "MDNOTES_CHAT_TIMEOUT", 60, 5, 180)
        self.effort = env.get("DEEPSEEK_REASONING_EFFORT", "high").strip().lower() or "high"
        self.thinking = _truthy(env.get("DEEPSEEK_ENABLE_THINKING"))
        self.openai = openai
        self.http = http

    def configured(self) -> bool:
        return bool(self.api_key and self.default_model and self.api_url) or bool(self.openai.configured and self.openai.models)

    def start(self, log) -> None:
        """Begin reading the OpenAI model catalog (nothing without a key)."""
        self.openai.start(log)

    def all_models(self) -> list[str]:
        """DeepSeek's first (the default), then OpenAI's when configured."""
        extra = self.openai.models if self.openai.configured else []
        return list(dict.fromkeys([*self.models, *extra]))

    def provider_of(self, model: str) -> str:
        return self.openai.label if model in self.openai.models and model not in self.models else self.label

    def route(self, model=None, own_key: str = "", own_url: str = "", own_model: str = "") -> Route:
        """Where this request goes. A user's own key goes to their URL (or the
        default one) with the model they chose; otherwise the model must be
        offered here, and goes to its provider; anything else gets the default."""
        if own_key:
            url, chosen = own_url or self.api_url, own_model or model or self.default_model
            responses = self.openai.responses_url if url == self.openai.chat_url and uses_responses_api(chosen) else ""
            return Route(chosen, url, own_key, self.label, responses)
        if model and self.openai.configured and model in self.openai.models:
            responses = self.openai.responses_url if uses_responses_api(model) else ""
            return Route(model, self.openai.chat_url, self.openai.api_key, self.openai.label, responses)
        return Route(model if model in self.models else self.default_model, self.api_url, self.api_key, self.label)

    def options(self, payload: dict) -> dict:
        """The payload with the options its model needs (for a request a browser
        sends itself; stream and complete apply them anyway)."""
        return request_options(payload, self.thinking, self.effort)

    def _headers(self, route: Route) -> dict:
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {route.key}"}
        if self.organization:
            headers["OpenAI-Organization"] = self.organization
        return headers

    def stream(self, route: Route, payload: dict, emit=lambda event: None) -> dict:
        """Send a chat-completions payload along the route, streaming. `emit`
        gets {"type": "delta" | "reasoning", "text"} as text arrives and
        {"type": "writing", "name", "chars"} while a tool call's arguments
        stream in (at most every 0.4 s). Returns the whole response in
        chat-completions form, whichever API answered."""
        payload = {**request_options(payload, self.thinking, self.effort), "stream": True}
        url, parser = route.url, ChatStream()
        if route.responses_url:
            url, parser, payload = route.responses_url, ResponsesStream(), to_responses_request(payload)
        last_progress = 0.0
        for event in self.http.stream_events(url, payload, self._headers(route), self.timeout):
            shown = parser.feed(event)
            for piece in (shown if isinstance(shown, list) else [shown] if shown else []):
                kind = "delta" if "text" in piece else "reasoning"
                if piece.get("text") or piece.get("reasoning"):
                    emit({"type": kind, "text": piece.get("text") or piece.get("reasoning")})
            now = time.time()
            if parser.tools and now - last_progress > 0.4:
                last_progress = now
                for slot in parser.tools.values():
                    if slot["function"]["name"]:
                        emit({"type": "writing", "name": slot["function"]["name"], "chars": len(slot["function"]["arguments"])})
        return parser.result()

    def complete(self, route: Route, payload: dict) -> dict:
        """The same request without streaming."""
        return self.http.post_json(route.url, request_options(payload, self.thinking, self.effort),
                                   self._headers(route), self.timeout)
