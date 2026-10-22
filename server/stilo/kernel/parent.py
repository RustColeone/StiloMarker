"""Ending with the process that started this one: a program that runs the
server as its own part (the desktop app) passes its process id, and when that
process is gone (quit, crashed, killed), the server stops as on Ctrl+C."""
import os
import sys
import threading
import time


def alive(pid: int) -> bool:
    """Whether the process `pid` is still running."""
    if sys.platform == "win32":
        import ctypes
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) != 0  # 0: it has ended
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # it exists, owned by someone else
    return True


def watch(pid: int, stop, every: float = 1.0) -> threading.Thread:
    """Calls stop() once `pid` is gone (checked every `every` seconds)."""
    def run():
        while alive(pid):
            time.sleep(every)
        stop()
    thread = threading.Thread(target=run, name="parent-watch", daemon=True)
    thread.start()
    return thread
