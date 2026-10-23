"""Browser regression: a shaky connection is said (v0.2.36, v0.2.41).

A tab in a PIN session whose stream drops once rejoins quietly; when it
drops again soon after, the tab says the connection keeps dropping and that
words typed just before a drop may not reach the others (docs/ISSUES.md,
A3). Only a session lost while the page is in view counts: leaving on
purpose does not, nor a drop while the tab is hidden. Coming back to the
tab leaves the session's stream open (closing it would end the session for
the server: its presence, and a host's session for its guests) and renews
its lease; a lease the server refuses (the stream gone on its side) is a
drop, rejoined. No page errors.

Isolated: APIs are mocked (the event stream is a stand-in the test breaks),
and static files come from this checkout.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')
PROJECT = {'id': 'shared', 'name': 'Shared', 'rootId': 'root', 'activeFileId': 'notes', 'sourceMode': 'memory', 'nodes': {
    'root': {'id': 'root', 'kind': 'folder', 'name': 'Shared', 'children': ['notes'], 'expanded': True},
    'notes': {'id': 'notes', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': 'Shared text.', 'dirty': False}}}
STREAMS = 'window.__streams = []; window.EventSource = class { constructor(url) { this.url = url; window.__streams.push(this); } close() { this.closed = true; } };'
# The page's visibility, set by the test (hidden, then shown again).
VISIBILITY = 'window.__shown = true; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__shown ? "visible" : "hidden") });'


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1280, 'height': 860}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        settings = {'serverUrl': BASE, 'serverPin': '4826', 'displayName': 'Ben', 'autoReconnect': True}
        await page.add_init_script(STREAMS + VISIBILITY + 'localStorage.setItem("mdnotes.settings.v1", ' + json.dumps(json.dumps(settings)) + ');')
        server = {'joins': 0, 'leases': 0, 'refuse_lease': False}

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                status = 200
                if path == '/api/ping':
                    body = {'message': 'pong', 'appVersion': '0.2.36', 'minSyncVersion': 117, 'accounts': False}
                elif path == '/api/session/connect':
                    server['joins'] += 1
                    body = {'token': f'pin-{server["joins"]}', 'clientId': 'ben', 'sessionId': 'default', 'role': 'client', 'revision': 3}
                elif path == '/api/session/state' and route.request.method == 'GET':
                    body = {'project': PROJECT, 'revision': 3, 'presence': []}
                elif path == '/api/session/lease':
                    server['leases'] += 1
                    if server['refuse_lease']:
                        server['refuse_lease'] = False
                        status, body = 403, {'message': "This session's stream has ended"}
                    else:
                        body = {'message': 'session active'}
                else:
                    body = {'revision': 3, 'message': 'ok'}
                await route.fulfill(status=status, content_type='application/json', body=json.dumps(body)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__t = { sync: modules.sync, controller };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__t)')
        await page.evaluate('window.__t.sync.connectSaved({ auto: false })')
        connected = 'window.__t.sync.status.status === "connected" && window.__t.controller.getActiveFile()?.content === "Shared text."'
        await page.wait_for_function(connected)
        toasts = lambda: page.evaluate('[...document.querySelectorAll(".toast, .app-toast, [role=status]")].map((t) => t.textContent).join(" | ")')
        checks = []

        async def joined_again(before):
            for _ in range(150):
                if server['joins'] > before: break
                await page.wait_for_timeout(100)
            assert server['joins'] > before, server
            await page.wait_for_function(connected, timeout=15000)

        # Left on purpose, twice (the app joins again by itself): not a shaky connection.
        for _ in range(2):
            before = server['joins']
            await page.evaluate('window.__t.sync.session().disconnect()')
            await joined_again(before)
        assert 'keeps dropping' not in await toasts(), await toasts()
        checks.append('left on purpose, twice: nothing said')

        # Back to the tab: the stream stays open (no second join), and the lease is renewed at once.
        streams, joins, leases = await page.evaluate('window.__streams.length'), server['joins'], server['leases']
        await page.evaluate('window.__shown = false; document.dispatchEvent(new Event("visibilitychange"))')
        await page.evaluate('window.__shown = true; document.dispatchEvent(new Event("visibilitychange"))')
        for _ in range(50):
            if server['leases'] > leases: break
            await page.wait_for_timeout(100)
        assert server['leases'] == leases + 1, (leases, server)
        state = await page.evaluate('({ streams: window.__streams.length, closed: Boolean(window.__streams.at(-1).closed), status: window.__t.sync.status.status })')
        assert state == {'streams': streams, 'closed': False, 'status': 'connected'} and server['joins'] == joins, (state, server)
        checks.append('back to the tab: the stream left open, its lease renewed, no second join')

        # A drop while the tab is hidden (it let its lease go): not counted.
        await page.evaluate('window.__shown = false; document.dispatchEvent(new Event("visibilitychange"))')
        before = server['joins']
        await page.evaluate('window.__streams.at(-1).onerror(new Event("error"))')
        await page.evaluate('window.__shown = true; document.dispatchEvent(new Event("visibilitychange"))')
        await joined_again(before)
        assert 'keeps dropping' not in await toasts(), await toasts()
        checks.append('a drop while hidden: not counted')

        # A lease refused (the stream gone on the server's side): a drop, rejoined quietly (the first).
        server['refuse_lease'] = True
        before = server['joins']
        await page.evaluate('window.__shown = false; document.dispatchEvent(new Event("visibilitychange"))')
        await page.evaluate('window.__shown = true; document.dispatchEvent(new Event("visibilitychange"))')
        await joined_again(before)
        assert 'keeps dropping' not in await toasts(), await toasts()
        checks.append('a lease refused: a drop, rejoined; one drop says nothing')

        # Another soon after: said.
        await page.evaluate('window.__streams.at(-1).onerror(new Event("error"))')
        await page.wait_for_function('[...document.querySelectorAll(".toast, .app-toast, [role=status]")].some((t) => t.textContent.includes("keeps dropping"))', timeout=10000)
        said = await toasts()
        assert 'may not reach the others' in said, said
        await page.wait_for_function(connected, timeout=15000)
        checks.append('a second drop soon after: the connection keeps dropping, said; rejoined')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
