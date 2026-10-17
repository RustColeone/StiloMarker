"""Calling a model endpoint over HTTP: a streamed request read as its JSON
events, or a plain one. A provider's refusal becomes a RuntimeError carrying
the provider's own message."""
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _request(url, payload, headers):
    return Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")


def _refusal(error: HTTPError) -> RuntimeError:
    detail = error.read().decode("utf-8", errors="replace")
    try:
        payload = json.loads(detail)
    except json.JSONDecodeError:
        payload = None
    message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
    return RuntimeError(message or detail or f"Chat provider returned HTTP {error.code}.")


def stream_events(url: str, payload: dict, headers: dict, timeout: float):
    """Each `data:` event of a server-sent stream, parsed, until [DONE]."""
    try:
        response = urlopen(_request(url, payload, headers), timeout=timeout)
    except HTTPError as error:
        raise _refusal(error) from error
    except URLError as error:
        raise RuntimeError(f"Chat provider is unreachable: {error.reason}.") from error
    with response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                break
            try:
                yield json.loads(data)
            except json.JSONDecodeError:
                continue


def post_json(url: str, payload: dict, headers: dict, timeout: float) -> dict:
    try:
        raw = urlopen(_request(url, payload, headers), timeout=timeout).read().decode("utf-8")
        return json.loads(raw)
    except HTTPError as error:
        raise _refusal(error) from error
    except URLError as error:
        raise RuntimeError(f"Chat provider is unreachable: {error.reason}.") from error
    except json.JSONDecodeError as error:
        raise RuntimeError("Chat provider returned invalid JSON.") from error
