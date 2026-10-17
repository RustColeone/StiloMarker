"""OpenAI: its model catalog (read at start-up, so new releases appear without
a code change; env overrides pin them) and image generation. Its chat
models are called through the same stream as every provider
(service/providers.py)."""
import base64
import json
import os
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..model.catalog import IMAGE_QUALITIES, newest_gpt_ids, pick_chat_models, pick_image_model

MAX_IMAGE_BYTES = 25 * 1024 * 1024
IMAGE_TIMEOUT_SECONDS = 240


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
        self.responses_url = f"{base}/responses"
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
