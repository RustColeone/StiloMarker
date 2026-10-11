"""Browser regression: the first-run template must never replace a cloud workspace.

On a fresh browser the welcome template is fetched file by file. If the cloud
workspace restored itself first, the template's late arrival used to replace it
on screen inside the still-synced session — and the next reconnect's reconcile
uploaded the template files into that cloud workspace. Reproduced with a slow
connection; this pins the guard. Isolated: every API is mocked.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1200, 'height': 800}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        cloud = {'id': 'cloud', 'name': 'Novel', 'rootId': 'root', 'activeFileId': 'c1', 'sourceMode': 'memory', 'nodes': {
            'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['c1'], 'expanded': True},
            'c1': {'id': 'c1', 'kind': 'file', 'parentId': 'root', 'name': 'cloud.md', 'content': 'cloud text', 'dirty': False}}}
        settings = {'serverUrl': BASE, 'accountUsername': 'test-user', 'accountPassword': 'test-only',
                    'accountSuccess': {BASE: 'test-user'}, 'lastWorkspace': {'team': 'friends', 'path': 'Novel'},
                    'syncedProjectId': 'friends/Novel', 'syncedRevision': 1}
        # Deliberately NO stored project: this is the fresh-browser case.
        await page.add_init_script('localStorage.setItem("mdnotes.settings.v1",' + json.dumps(json.dumps(settings)) + ');')
        await page.add_init_script('window.EventSource=class{constructor(){}close(){}};')
        writes, template = [], {'requests': 0, 'done': 0}

        async def route(route):
            path = urlparse(route.request.url).path
            if path.startswith('/api/'):
                payload = {}
                if path == '/api/ping': payload = {'accounts': True, 'appVersion': '0.1.22', 'minSyncVersion': 115}
                elif path == '/api/auth/login': payload = {'token': 'account-1', 'username': 'test-user', 'teams': ['friends']}
                elif path == '/api/workspaces/open':
                    payload = {'token': 'session-1', 'clientId': 'c', 'workspace': 'friends/Novel', 'revision': 1,
                               'role': 'master', 'resume': {'openFiles': [], 'activeFile': None}}
                elif path == '/api/session/state': payload = {'project': cloud, 'revision': 1, 'presence': []}
                elif path == '/api/operations' or path == '/api/session/state' and route.request.method == 'POST':
                    writes.append(route.request.post_data_json); payload = {'revision': 1}
                elif path == '/api/chat/status': payload = {'configured': False}
                elif path == '/api/chat/workspace': payload = {'threads': [], 'revision': 0}
                elif 'snapshots' in path: payload = {'snapshots': [], 'paths': []}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            if '/Template/' in path:
                # A slow connection: the template finishes well after the workspace opened.
                template['requests'] += 1
                await asyncio.sleep(0.8)
                template['done'] += 1
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__race={controller,getMode:()=>workspaceMode};\n'
                await route.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('!!window.__race && window.__race.getMode() === "synced" && window.__race.controller.getProject().nodes?.c1')
        # Let every template request finish (they are slow and sequential).
        for _ in range(200):
            await page.wait_for_timeout(100)
            if template['requests'] and template['done'] == template['requests'] and template['requests'] >= 3: break
        await page.wait_for_timeout(1500)
        names = await page.evaluate('() => Object.values(window.__race.controller.getProject().nodes).filter(n => n.kind === "file").map(n => n.name)')
        rows = await page.evaluate("() => [...document.querySelectorAll('.tree-row')].map(r => r.title)")
        assert template['done'] >= 3, f'the template must actually have loaded late for this test to mean anything: {template}'
        assert names == ['cloud.md'], f'the template replaced the cloud workspace: {names}'
        assert 'cloud.md' in rows and not any(r.endswith('welcome.md') for r in rows), rows
        assert not writes, f'nothing should have been written to the server: {writes}'
        print(json.dumps({'checks': ['late template ignored', 'workspace tree kept', 'no writes to the server'],
                          'templateRequests': template['requests'], 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
