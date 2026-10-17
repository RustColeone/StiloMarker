"""Which models are offered and how a request to each must look. Pure rules;
the providers' HTTP lives in adapters/."""
import re

CHAT_MODEL = re.compile(r"^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|sol|luna))?$")
# Variants offered from the newest version, in picker order.
CHAT_VARIANTS = ("", "sol", "luna", "mini")
IMAGE_MODEL = re.compile(r"^gpt-image-(\d+(?:\.\d+)?)(?:-(mini))?$")
# Reasoning models accept only the default sampling temperature.
FIXED_TEMPERATURE_MODEL = re.compile(r"^(gpt-([5-9]|\d{2,})|o\d)")
# GPT 6+ refuses function tools on /v1/chat/completions while reasoning is on
# (and Sol cannot turn reasoning off), so those models go through
# /v1/responses. Requests are still built in chat-completions form and
# translated (model/responses.py), so the tool loop is the same everywhere.
RESPONSES_MODEL = re.compile(r"^gpt-([6-9]|\d{2,})")
IMAGE_SIZES = {"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}
IMAGE_QUALITIES = ("low", "medium", "high")
# The provider's DeepSeek models, verified against its API; it rejects anything else.
DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"]


def _version(text: str) -> tuple:
    return tuple(int(part) for part in text.split("."))


def pick_chat_models(ids) -> list[str]:
    """The newest flagship, Sol, Luna and mini of the newest GPT major version.
    When that leaves only a flagship, the newest mini is added."""
    found: dict[tuple, str] = {}
    for model_id in ids:
        match = CHAT_MODEL.match(model_id)
        if match and (match[2] or "") in CHAT_VARIANTS:
            found[(_version(match[1]), match[2] or "")] = model_id
    if not found:
        return []
    newest = max(version for version, _ in found)
    # The newest of each variant within the newest major version (6.1 Sol
    # next to 6 Luna when there is no 6.1 Luna yet).
    picks = []
    for variant in CHAT_VARIANTS:
        versions = [v for v, name in found if name == variant and v[0] == newest[0]]
        if versions:
            picks.append(found[(max(versions), variant)])
    if picks == [found.get((newest, ""))]:
        minis = [version for version, v in found if v == "mini"]
        if minis:
            picks.append(found[(max(minis), "mini")])
    return picks


def newest_gpt_ids(ids) -> list[str]:
    """The catalog's ids of the newest GPT major version (for the start-up log)."""
    majors = [int(m[1].split(".")[0]) for m in map(re.compile(r"^gpt-(\d+(?:\.\d+)?)").match, ids) if m]
    return sorted(i for i in ids if majors and i.startswith(f"gpt-{max(majors)}")) if majors else []


def pick_image_model(ids) -> str | None:
    """Newest full image model, else the newest mini one."""
    full, mini = {}, {}
    for model_id in ids:
        match = IMAGE_MODEL.match(model_id)
        if match:
            (mini if match[2] else full)[match[1]] = model_id
    pool = full or mini
    return pool[max(pool, key=_version)] if pool else None


def uses_fixed_temperature(model: str) -> bool:
    return bool(FIXED_TEMPERATURE_MODEL.match(model or ""))


def uses_responses_api(model: str) -> bool:
    return bool(RESPONSES_MODEL.match(model or ""))


def is_openai_model(model: str) -> bool:
    return bool(CHAT_MODEL.match(model or "") or FIXED_TEMPERATURE_MODEL.match(model or "")
                or (model or "").startswith(("gpt-", "chatgpt-")))


def request_options(payload: dict, thinking: bool, effort: str) -> dict:
    """The payload with the options its model needs: DeepSeek's thinking switch
    when it is on, and no temperature for models that accept only the default."""
    payload = dict(payload)
    model = payload.get("model", "")
    if thinking and not is_openai_model(model):
        payload["thinking"] = {"type": "enabled"}
        payload["reasoning_effort"] = effort
    if uses_fixed_temperature(model):
        payload.pop("temperature", None)
    return payload
