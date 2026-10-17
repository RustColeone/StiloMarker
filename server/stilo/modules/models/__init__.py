"""Models (server): the providers the server calls (DeepSeek or another
OpenAI-compatible endpoint, OpenAI's chat and image models, a user's own
key), which models are offered, how each request must look, streaming in
either API, generated images awaiting Keep, and MCP connections. The
browser's half is app/modules/models.

Static, for code from before the restructure:
    open_providers(env=None) -> Providers     Providers, Route
    OpenAIProvider, GeneratedImages, MCPManager, MCPTurn, MCPClient, MCPError
    IMAGE_SIZES, is_openai_model, uses_fixed_temperature, uses_responses_api,
    to_responses_request, ResponsesStream, ChatStream, pick_chat_models, pick_image_model

A request: route = providers.route(model, own_key, own_url, own_model), then
providers.stream(route, payload, emit) or providers.complete(route, payload).
"""
import os
from types import SimpleNamespace

from stilo.kernel import define_module
from .adapters import http
from .adapters.images import GeneratedImages  # noqa: F401
from .adapters.mcp import MCPClient, MCPError, MCPManager, MCPTurn  # noqa: F401
from .adapters.openai import OpenAIProvider
from .model.catalog import (IMAGE_SIZES, is_openai_model, newest_gpt_ids, pick_chat_models, pick_image_model,  # noqa: F401
                            uses_fixed_temperature, uses_responses_api)
from .model.chat_stream import ChatStream  # noqa: F401
from .model.responses import ResponsesStream, to_responses_request  # noqa: F401
from .service.providers import Providers, Route  # noqa: F401


def open_providers(env=None, openai=None) -> Providers:
    env = os.environ if env is None else env
    return Providers(env, openai if openai is not None else OpenAIProvider(env), http)


def start(ctx):
    return SimpleNamespace(open_providers=open_providers)


MODULE = define_module(__file__, start)
