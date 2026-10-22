"""The server ends with the program that runs it (stilo/kernel/parent.py,
--parent-pid: the desktop app passes its own): alive() tells a running process
from an ended one; watch() calls stop once the process is gone; and the
server itself, given a process that then ends, stops (its port closes)."""
import json
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from stilo.kernel.parent import alive, watch  # noqa: E402


def short_lived(seconds):
    return subprocess.Popen([sys.executable, "-c", f"import time; time.sleep({seconds})"])


def answers(port):
    try:
        return json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=2).read())["message"] == "pong"
    except Exception:
        return False


class ParentWatchTests(unittest.TestCase):
    def test_alive_tells_running_from_ended(self):
        child = short_lived(0.2)
        self.assertTrue(alive(child.pid))
        child.wait()
        self.assertFalse(alive(child.pid))

    def test_watch_calls_stop_once_the_process_is_gone(self):
        child = short_lived(0.5)
        stopped = threading.Event()
        watch(child.pid, stopped.set, every=0.1)
        self.assertFalse(stopped.wait(0.2), "not while it runs")
        child.wait()
        self.assertTrue(stopped.wait(3), "once it ended")

    def test_the_server_stops_when_its_parent_ends(self):
        parent = short_lived(4)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        with tempfile.TemporaryDirectory() as data:
            server = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(port),
                                       "--pin", "1357", "--master-pin", "2468", "--static-dir", str(ROOT), "--state-file", f"{data}/state.json",
                                       "--whitelist", f"{data}/none.json", "--data-dir", f"{data}/data", "--parent-pid", str(parent.pid)],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for _ in range(100):
                    if answers(port): break
                    time.sleep(0.1)
                self.assertTrue(answers(port), "up while its parent runs")
                parent.wait()
                self.assertEqual(server.wait(timeout=10), 0, "it stopped, as on Ctrl+C")
                self.assertFalse(answers(port))
            finally:
                if server.poll() is None:
                    server.kill()


if __name__ == "__main__":
    unittest.main()
