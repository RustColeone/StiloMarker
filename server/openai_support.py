"""OpenAI as a second chat provider, and image generation for the agent.

The chat models are OpenAI-compatible, so chat turns reuse the proxy's normal
streaming path with a different key and URL. Which models are offered is read
from the account's own model catalog at start-up (newest GPT flagship and its
mini, newest image model) rather than hard-coded, so new releases appear
without a code change. Env overrides pin them explicitly.

Generated images are kept server-side for a while (`GeneratedImages`) and the
agent's proposal only carries their id, so chat history and sync never carry
megabytes of image data; the browser fetches the bytes when it applies the edit.
"""
import base64
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

CHAT_MODEL = re.compile(r"^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|sol|luna))?$")
# Variants offered from the newest version, in picker order.
CHAT_VARIANTS = ("", "sol", "luna", "mini")
IMAGE_MODEL = re.compile(r"^gpt-image-(\d+(?:\.\d+)?)(?:-(mini))?$")
# Reasoning models accept only the default sampling temperature.
FIXED_TEMPERATURE_MODEL = re.compile(r"^(gpt-([5-9]|\d{2,})|o\d)")
IMAGE_SIZES = {"square": "1024x1024", "portrait": "1024x1536", "landscape": "1536x1024"}
IMAGE_FORMATS = {".png": ("png", "image/png"), ".jpg": ("jpeg", "image/jpeg"),
                 ".jpeg": ("jpeg", "image/jpeg"), ".webp": ("webp", "image/webp")}
IMAGE_QUALITIES = ("low", "medium", "high")
MAX_IMAGE_BYTES = 25 * 1024 * 1024
IMAGE_TIMEOUT_SECONDS = 240


def _version(text: str) -> tuple:
    return tuple(int(part) for part in text.split("."))


def pick_chat_models(ids) -> list[str]:
    """Every offered variant of the newest GPT version (flagship, Sol, Luna,
    mini). When that version has only a flagship, the newest mini is added."""
    found: dict[tuple, str] = {}
    for model_id in ids:
        match = CHAT_MODEL.match(model_id)
        if match and (match[2] or "") in CHAT_VARIANTS:
            found[(_version(match[1]), match[2] or "")] = model_id
    if not found:
        return []
    newest = max(version for version, _ in found)
    picks = [found[(newest, v)] for v in CHAT_VARIANTS if (newest, v) in found]
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


def is_openai_model(model: str) -> bool:
    return bool(CHAT_MODEL.match(model or "") or FIXED_TEMPERATURE_MODEL.match(model or "")
                or (model or "").startswith(("gpt-", "chatgpt-")))


def _api_error(error: HTTPError, fallback: str) -> str:
    try:
        payload = json.loads(error.read().decode("utf-8", errors="replace"))
        message = payload.get("error", {}).get("message") if isinstance(payload, dict) else None
    except (ValueError, OSError):
        message = None
    return message or f"{fallback} (HTTP {error.code})."


class OpenAIProvider:
    label = "OpenAI"

    def __init__(self, env=None, opener=urlopen):
        env = os.environ if env is None else env
        self.api_key = (env.get("OPENAI_API_KEY") or "").strip()
        base = (env.get("OPENAI_API_BASE") or "https://api.openai.com/v1").strip().rstrip("/")
        self.chat_url = f"{base}/chat/completions"
        self.images_url = f"{base}/images/generations"
        self.models_url = f"{base}/models"
        self.model_override = [m.strip() for m in (env.get("MDNOTES_OPENAI_MODELS") or "").split(",") if m.strip()]
        self.image_override = (env.get("MDNOTES_OPENAI_IMAGE_MODEL") or "").strip()
        quality = (env.get("MDNOTES_IMAGE_QUALITY") or "medium").strip().lower()
        self.image_quality = quality if quality in IMAGE_QUALITIES else "medium"
        try:
            self.max_images_per_turn = max(0, min(8, int(env.get("MDNOTES_MAX_IMAGES_PER_TURN") or 2)))
        except ValueError:
            self.max_images_per_turn = 2
        self.models: list[str] = []
        self.newest_ids: list[str] = []
        self.image_model: str | None = None
        self.catalog_error: str | None = None
        self._opener = opener

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _request(self, url, payload=None, timeout=30):
        request = Request(url, method="POST" if payload is not None else "GET",
                          data=json.dumps(payload).encode("utf-8") if payload is not None else None,
                          headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"})
        with self._opener(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def apply_catalog(self, ids) -> None:
        ids = [str(model_id) for model_id in ids]
        available = set(ids)
        self.models = ([m for m in self.model_override if m in available] if self.model_override
                       else pick_chat_models(ids))
        self.image_model = (self.image_override if self.image_override in available
                            else pick_image_model(ids))

    def load_catalog(self) -> None:
        """Read the account's model list. Raises on failure (caller retries)."""
        payload = self._request(self.models_url, timeout=20)
        ids = [str(row.get("id", "")) for row in payload.get("data", []) if isinstance(row, dict)]
        self.newest_ids = newest_gpt_ids(ids)
        self.apply_catalog(ids)
        self.catalog_error = None

    def start(self, log, retry_seconds: float = 600) -> None:
        """Load the catalog in the background, retrying until it succeeds."""
        if not self.configured:
            return

        def run():
            while True:
                try:
                    self.load_catalog()
                    log("OPENAI", "Models ready", chat=",".join(self.models) or "none",
                        image=self.image_model or "none", newest=",".join(self.newest_ids[:20]) or "none")
                    return
                except HTTPError as error:
                    self.catalog_error = _api_error(error, "Model list failed")
                except (URLError, OSError, ValueError) as error:
                    self.catalog_error = f"Model list failed: {getattr(error, 'reason', error)}"
                log("OPENAI", "Model list unavailable; retrying later", reason=self.catalog_error)
                time.sleep(retry_seconds)

        threading.Thread(target=run, daemon=True, name="openai-catalog").start()

    @property
    def images_ready(self) -> bool:
        return self.configured and bool(self.image_model) and self.max_images_per_turn > 0

    def generate_image(self, prompt: str, size: str, output_format: str) -> bytes:
        body = {"model": self.image_model, "prompt": prompt, "n": 1, "size": size,
                "quality": self.image_quality, "output_format": output_format}
        try:
            payload = self._request(self.images_url, body, timeout=IMAGE_TIMEOUT_SECONDS)
        except HTTPError as error:
            raise RuntimeError(_api_error(error, "Image generation failed")) from error
        except (URLError, OSError) as error:
            raise RuntimeError(f"Image generation failed: {getattr(error, 'reason', error)}") from error
        rows = payload.get("data") if isinstance(payload, dict) else None
        encoded = rows[0].get("b64_json") if rows and isinstance(rows[0], dict) else None
        if not encoded:
            raise RuntimeError("Image generation returned no image.")
        data = base64.b64decode(encoded)
        if len(data) > MAX_IMAGE_BYTES:
            raise RuntimeError("The generated image is too large to save.")
        return data


class GeneratedImages:
    """Generated images awaiting (or recently past) the user's Keep/Drop. Each
    belongs to the account that asked for it; old ones are removed."""

    ID = re.compile(r"^[0-9a-f]{32}$")

    def __init__(self, root: Path, ttl_seconds: float = 14 * 24 * 3600):
        self.root = Path(root)
        self.ttl = ttl_seconds
        self.lock = threading.Lock()

    def store(self, data: bytes, mime: str, extension: str, owner: str, prompt: str) -> str:
        image_id = uuid.uuid4().hex
        meta = {"owner": owner, "mime": mime, "extension": extension,
                "prompt": prompt[:2000], "created": time.time(), "bytes": len(data)}
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            self._purge()
            (self.root / f"{image_id}{extension}").write_bytes(data)
            (self.root / f"{image_id}.json").write_text(json.dumps(meta), encoding="utf-8")
        return image_id

    def load(self, image_id: str, owner: str):
        """(bytes, mime) for the owner, else None."""
        if not self.ID.match(str(image_id or "")):
            return None
        try:
            meta = json.loads((self.root / f"{image_id}.json").read_text(encoding="utf-8"))
            if meta.get("owner") != owner:
                return None
            return (self.root / f"{image_id}{meta['extension']}").read_bytes(), meta["mime"]
        except (OSError, ValueError, KeyError):
            return None

    def _purge(self) -> None:
        cutoff = time.time() - self.ttl
        for meta_path in self.root.glob("*.json"):
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if meta.get("created", 0) >= cutoff:
                    continue
                (self.root / f"{meta_path.stem}{meta.get('extension', '')}").unlink(missing_ok=True)
                meta_path.unlink(missing_ok=True)
            except (OSError, ValueError):
                continue
