"""The server's HTTP listener. A request goes to its route (adapters/http.py);
any other GET is one of the app's files from the static root (index.html
for anything unknown, as a single-page app), gzipped when the browser
accepts it. The server's own files are never handed out: its source, its
data, dotfiles, and the files modules name as private."""
import gzip
import mimetypes
import posixpath
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

DENIED_SEGMENTS = frozenset({"server", "data", "venv", ".git", "__pycache__"})
DENIED_SUFFIXES = (".env", ".py", ".pyc")
COMPRESSIBLE = ("text/", "application/javascript", "application/json", "application/manifest+json", "image/svg+xml")


class GzipCache:
    """Compressed files, keyed by path and dropped when the file changes on disk,
    so a release is never served stale. Bounded: it only ever holds the app's
    files (~1MB raw), but a stray tree of text files must not grow it."""

    def __init__(self, limit=256):
        self._entries, self._lock, self._limit = {}, threading.Lock(), limit

    def packed(self, path: Path, content: bytes) -> bytes:
        try:
            stat = path.stat()
            key, stamp = str(path), (stat.st_mtime_ns, stat.st_size)
        except OSError:
            return gzip.compress(content, compresslevel=6, mtime=0)
        with self._lock:
            hit = self._entries.get(key)
            if hit and hit[0] == stamp:
                return hit[1]
        # mtime=0: the same bytes for the same file, whichever worker compressed it.
        packed = gzip.compress(content, compresslevel=6, mtime=0)
        with self._lock:
            if len(self._entries) >= self._limit:
                self._entries.clear()
            self._entries[key] = (stamp, packed)
        return packed


def accepts_gzip(header: str) -> bool:
    """True when Accept-Encoding allows gzip (an explicit q=0 refuses it)."""
    for part in (header or "").split(","):
        name, _, params = part.strip().partition(";")
        if name.strip().lower() not in ("gzip", "*"):
            continue
        quality = 1.0
        for param in params.split(";"):
            key, _, value = param.strip().partition("=")
            if key.strip().lower() == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
        return quality > 0
    return False


def is_denied(safe_path: str, private_names) -> bool:
    if not safe_path:
        return False
    segments = safe_path.split("/")
    if segments[0] in DENIED_SEGMENTS or any(segment.startswith(".") for segment in segments):
        return True
    return segments[-1] in private_names or segments[-1].endswith(DENIED_SUFFIXES)


def make_listener(host, port, *, handle, send_cors, write_json, static_root, private_names, on_close):
    """A threading HTTP server: handle(handler, method, parsed) answers routes;
    on_close() runs before the listener closes (the modules stop)."""
    static_root = Path(static_root)
    cache = GzipCache()

    class Handler(BaseHTTPRequestHandler):
        server_version = "MDNotesServer/0.1"

        def log_message(self, format, *args):
            return

        def do_OPTIONS(self):
            self.send_response(HTTPStatus.NO_CONTENT)
            send_cors(self, urlparse(self.path).path)
            self.end_headers()

        def do_GET(self):
            parsed = urlparse(self.path)
            if not handle(self, "GET", parsed):
                self.serve_file(parsed.path)

        def do_POST(self):
            parsed = urlparse(self.path)
            if not handle(self, "POST", parsed):
                write_json(self, HTTPStatus.NOT_FOUND, {"message": "Not found"}, parsed.path)

        def serve_file(self, request_path: str):
            relative = request_path or "/"
            if relative == "/":
                relative = "/index.html"
            safe_path = posixpath.normpath(relative).lstrip("/")
            # A private file answers as index.html: its existence is never confirmed.
            if is_denied(safe_path, private_names):
                safe_path = "index.html"
            candidate = (static_root / safe_path).resolve()
            if not str(candidate).startswith(str(static_root.resolve())) or not candidate.exists() or candidate.is_dir():
                candidate = static_root / "index.html"
            content = candidate.read_bytes()
            content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
            # Text is sent gzipped when the browser accepts it (about a quarter of
            # the bytes); tiny files gain nothing, and images are compressed already.
            encoded = None
            if len(content) >= 1024 and content_type.startswith(COMPRESSIBLE) and accepts_gzip(self.headers.get("Accept-Encoding")):
                encoded = cache.packed(candidate, content)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Vary", "Accept-Encoding")  # caches must keep the variants apart
            if encoded is not None:
                content = encoded
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    class Listener(ThreadingHTTPServer):
        def handle_error(self, request, client_address):
            import sys
            if isinstance(sys.exc_info()[1], OSError):  # a browser that went away (reset, broken pipe, aborted)
                return
            super().handle_error(request, client_address)

        def server_close(self):
            on_close()
            super().server_close()

    return Listener((host, port), Handler)
