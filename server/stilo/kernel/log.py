"""One log line: a time, a tag and a message, then any fields. Stateless.

`ignore(error, why)` is for an except that means to carry on: it says why,
and the error still reaches the log with where it happened. A structure test
refuses an except whose body is only `pass`.

`best_effort(callback, why)` wraps a callback whose failure must not stop the
caller (progress sent down a stream): the first failure is logged, and later
calls do nothing, so a stream that is gone is reported once, not per event."""
import os
import sys
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


def log(tag: str, message: str, **fields):
    stamp = time.strftime("%H:%M:%S", time.localtime())
    extras = "  " + "  ".join(f"{key}={value!r}" for key, value in fields.items()) if fields else ""
    print(f"[{stamp}] [{tag}] {message}{extras}", flush=True)


def ignore(error: BaseException, why: str):
    caller = sys._getframe(1)
    where = f"{os.path.relpath(caller.f_code.co_filename, _ROOT)}:{caller.f_lineno}"
    log("ignored", why, error=f"{type(error).__name__}: {error}", at=where)


def best_effort(callback, why: str):
    failed = []

    def call(*args):
        if callback is None or failed:
            return
        try:
            callback(*args)
        except Exception as error:  # noqa: BLE001
            failed.append(error)
            log("ignored", why, error=f"{type(error).__name__}: {error}")
    return call
