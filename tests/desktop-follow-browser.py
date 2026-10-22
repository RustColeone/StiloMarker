"""Browser regression: the desktop app's Server page leaves a live session
alone when its server's state changes (v0.2.32).

In the desktop app (a stand-in for its bridge, window.stiloDesktop), the tab
is in a PIN session; the server then reports a change of state (as it does
while it starts, or after Share This Workspace). The app used to join again
with the PIN it had saved, dropping the live session (and, right after
sharing, taking the server's copy over typing not yet sent): it now joins
only when it is not in a session. No page errors.

Isolated: APIs are mocked and static files come from this checkout.
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
BRIDGE = '''
window.__serverState = { connect: "local", local: { status: "running", port: 8765, addresses: [] }, pin: "4826", masterPin: "7391" };
window.__listeners = [];
window.EventSource = class { constructor(url) { this.url = url; } close() { this.closed = true; } };
window.stiloDesktop = Object.freeze({
  version: async () => "0.2.32", checkForUpdate: async () => ({ available: false }), openUpdate: async () => {},
  server: Object.freeze({
    state: async () => window.__serverState,
    choose: async () => window.__serverState,
    onChange(listener) { window.__listeners.push(listener); return () => {}; }
  })
});
window.__fireServer = (local) => { window.__serverState = { ...window.__serverState, local: { ...window.__serverState.local, ...local } };
  for (const listener of window.__listeners) listener(window.__serverState); };
'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1280, 'height': 860}, service_workers='block')
        page = await context.new_page()
        errors, connects = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        settings = {'serverUrl': '', 'serverPin': '4826', 'displayName': 'Desk', 'autoReconnect': True}
        await page.add_init_script(BRIDGE + 'localStorage.setItem("mdnotes.settings.v1", ' + json.dumps(json.dumps(settings)) + ');')

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                if path == '/api/ping':
                    body = {'message': 'pong', 'appVersion': '0.2.32', 'minSyncVersion': 117, 'accounts': False}
                elif path == '/api/session/connect':
                    connects.append(path)
                    body = {'token': f'pin-{len(connects)}', 'clientId': f'desk-{len(connects)}', 'sessionId': 'default', 'role': 'client', 'revision': 3}
                elif path == '/api/session/state' and route.request.method == 'GET':
                    body = {'project': PROJECT, 'revision': 3, 'presence': []}
                else:
                    body = {'revision': 3, 'message': 'ok'}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(body)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__d = { sync: modules.sync, controller };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__d)')
        await page.evaluate('window.__d.sync.connectSaved({ auto: false })')
        await page.wait_for_function('window.__d.sync.status.status === "connected" && window.__d.controller.getActiveFile()?.content === "Shared text."')
        assert len(connects) == 1, connects
        # The server's state changes while the tab is in its session (starting, then running again).
        await page.evaluate('window.__fireServer({ status: "starting" })')
        await page.evaluate('window.__fireServer({ status: "running" })')
        await page.wait_for_timeout(1500)
        state = await page.evaluate('({ status: window.__d.sync.status.status, client: window.__d.sync.status.clientId })')
        assert len(connects) == 1 and state == {'status': 'connected', 'client': 'desk-1'}, (connects, state)
        print(json.dumps({'checks': ['in a session, a change of the server\'s state leaves it as it is (no second join)'], 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
