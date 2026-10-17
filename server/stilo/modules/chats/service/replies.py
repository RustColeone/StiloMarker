"""Characters' replies running on the server: one queue per conversation, so
they answer one after another (each seeing the replies before it); a few
conversations at once; a conversation's queue can be stopped."""
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor


class ReplyQueue:
    """Characters' replies, run in worker threads: one at a time per
    conversation (so each character sees the replies before theirs), never the
    same (message, character) twice, and stoppable per conversation."""

    def __init__(self, run, workers: int = 2):
        self.run = run  # run(job, cancelled: () -> bool) -> None
        self.lock = threading.Lock()
        self.pending: dict[str, deque] = {}
        self.active: set[str] = set()
        self.cancelled: set[str] = set()
        self.seen: set[tuple] = set()
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="chat-reply")

    def submit(self, conversation: str, jobs) -> list:
        accepted = []
        with self.lock:
            for job in jobs:
                key = (conversation, job["trigger"], job["character"])
                if key in self.seen:
                    continue
                self.seen.add(key)
                self.pending.setdefault(conversation, deque()).append(job)
                accepted.append(job)
            if accepted and conversation not in self.active:
                self.active.add(conversation)
                self.cancelled.discard(conversation)
                self.pool.submit(self._drain, conversation)
        return accepted

    def busy(self, conversation: str) -> bool:
        with self.lock:
            return conversation in self.active

    def cancel(self, conversation: str) -> bool:
        with self.lock:
            if conversation not in self.active:
                return False
            self.pending.pop(conversation, None)
            self.cancelled.add(conversation)
            return True

    def _drain(self, conversation: str) -> None:
        while True:
            with self.lock:
                queue = self.pending.get(conversation)
                if not queue or conversation in self.cancelled:
                    self.pending.pop(conversation, None)
                    self.active.discard(conversation)
                    self.cancelled.discard(conversation)
                    return
                job = queue.popleft()
            try:
                self.run(job, lambda: conversation in self.cancelled)
            except Exception:  # noqa: BLE001 — the runner reports its own failures
                pass

    def shutdown(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
