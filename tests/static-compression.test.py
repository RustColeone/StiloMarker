"""Static files are gzip-compressed when the browser accepts it — and only then.

Before v0.1.23 every asset went out raw (~930KB of JavaScript on a first load or
after each release; ~4x smaller compressed). These pin the rules: honour
Accept-Encoding including q=0, leave small and already-compressed files alone,
send Vary, and never serve stale compressed bytes after a file changes."""
import gzip
import importlib.util
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('mdnotes_server', ROOT / 'server/mdnotes_server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class StaticCompressionTests(unittest.TestCase):
    def setUp(self):
        self.logs = patch.object(server, '_log'); self.logs.start(); self.addCleanup(self.logs.stop)
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'index.html').write_text('<!doctype html><title>t</title>' + 'x' * 4000, encoding='utf-8')
        (self.root / 'app.js').write_text('const answer = 42;\n' * 400, encoding='utf-8')
        (self.root / 'tiny.css').write_text('a{b:c}', encoding='utf-8')
        (self.root / 'pic.png').write_bytes(b'\x89PNG\r\n\x1a\n' + bytes(4000))
        self.httpd = server.build_server('127.0.0.1', 0, '2468', self.root, self.root / 'state.json')
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.addCleanup(self.httpd.server_close); self.addCleanup(self.httpd.shutdown)
        self.base = 'http://%s:%d' % self.httpd.server_address

    def get(self, path, encoding=None):
        headers = {'Accept-Encoding': encoding} if encoding is not None else {}
        with urlopen(Request(self.base + path, headers=headers), timeout=10) as response:
            return response.headers, response.read()

    def test_text_assets_are_gzipped_when_accepted(self):
        headers, body = self.get('/app.js', 'gzip, deflate, br')
        self.assertEqual(headers['Content-Encoding'], 'gzip')
        self.assertEqual(int(headers['Content-Length']), len(body))
        self.assertEqual(gzip.decompress(body), (self.root / 'app.js').read_bytes())
        self.assertLess(len(body), (self.root / 'app.js').stat().st_size / 4)
        self.assertIn('Accept-Encoding', headers['Vary'])

    def test_raw_without_accept_encoding_or_when_refused(self):
        for encoding in (None, 'identity', 'gzip;q=0', 'br'):
            with self.subTest(encoding=encoding):
                headers, body = self.get('/app.js', encoding)
                self.assertIsNone(headers['Content-Encoding'])
                self.assertEqual(body, (self.root / 'app.js').read_bytes())
                self.assertIn('Accept-Encoding', headers['Vary'])

    def test_small_and_binary_files_are_left_alone(self):
        for path in ('/tiny.css', '/pic.png'):
            with self.subTest(path=path):
                headers, body = self.get(path, 'gzip')
                self.assertIsNone(headers['Content-Encoding'])
                self.assertEqual(body, (self.root / path.lstrip('/')).read_bytes())

    def test_a_changed_file_is_never_served_stale(self):
        _, first = self.get('/app.js', 'gzip')
        time.sleep(0.01)
        (self.root / 'app.js').write_text('const answer = 43;\n' * 500, encoding='utf-8')
        _, second = self.get('/app.js', 'gzip')
        self.assertEqual(gzip.decompress(second), (self.root / 'app.js').read_bytes())
        self.assertNotEqual(first, second)

    def test_spa_fallback_and_index_compress_too(self):
        headers, body = self.get('/no/such/route', 'gzip')
        self.assertEqual(headers['Content-Encoding'], 'gzip')
        self.assertTrue(gzip.decompress(body).startswith(b'<!doctype html>'))


if __name__ == '__main__':
    unittest.main()
