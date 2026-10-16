"""One log line: a time, a tag and a message, then any fields. Stateless."""
import time


def log(tag: str, message: str, **fields):
    stamp = time.strftime("%H:%M:%S", time.localtime())
    extras = "  " + "  ".join(f"{key}={value!r}" for key, value in fields.items()) if fields else ""
    print(f"[{stamp}] [{tag}] {message}{extras}", flush=True)
