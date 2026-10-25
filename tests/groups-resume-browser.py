"""Browser regression: the editor's groups are kept with a cloud workspace's
open tabs (step 5i).

Opening the workspace on a new device restores the groups the server kept
(by path; a file that is gone is dropped), each group showing its own
source editor or the preview, the active editor the one showing the active
file (v0.3.11). A change to the groups is saved again,
with the source tabs and the active file as before, and kept in this
browser, so a reload brings the groups back. Isolated: a mocked account and workspace; no
real account or writing project is used.
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

GROUPS = '''() => Object.fromEntries([...document.querySelectorAll(".editor-group")].map((g) => {
  const active = g.querySelector(".editor-tab.is-active[data-file-id]");
  return [g.dataset.group, {
    tabs: [...g.querySelectorAll(".editor-tab[data-file-id]")].map((t) => [t.querySelector(".tab-title").textContent, t.dataset.view]),
    active: active ? [active.querySelector(".tab-title").textContent, active.dataset.view] : null,
    bodies: [...g.querySelectorAll(":scope > .source-body, :scope > .preview-body")].filter((b) => b.dataset.shown !== "false")
      .map((b) => b.id || (b.classList.contains("source-body") ? "right-source-body" : "")),
    activeEditor: g.querySelector(":scope > .source-body")?.dataset.active === "true"
  }];
}))'''


# The active file in a source editor (whichever group's).
SHOWN = '[...document.querySelectorAll(".source-body .editor-content")].some((e) => e.innerText.includes("Session notes"))'


async def main():
    project = {'id': 'groups', 'name': 'Campaign', 'rootId': 'root', 'activeFileId': None, 'sourceMode': 'memory', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Campaign', 'children': ['a', 'docs'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'session.md', 'content': '# Session notes', 'dirty': False},
        'docs': {'id': 'docs', 'kind': 'folder', 'parentId': 'root', 'name': 'docs', 'children': ['b'], 'expanded': True},
        'b': {'id': 'b', 'kind': 'file', 'parentId': 'docs', 'name': 'plan.md', 'content': '# The plan', 'dirty': False}}}
    resume = {'openFiles': ['session.md'], 'activeFile': 'session.md', 'groups': [
        {'id': 'left', 'tabs': [{'path': 'session.md', 'view': 'source'}, {'path': 'docs/plan.md', 'view': 'preview'}, {'path': 'gone.md', 'view': 'source'}],
         'active': {'path': 'docs/plan.md', 'view': 'preview'}},
        {'id': 'right', 'tabs': [{'path': 'session.md', 'view': 'source'}], 'active': {'path': 'session.md', 'view': 'source'}}]}
    saved = []
    # Opened on this device before only for another workspace: the server's resume is used.
    settings = {'serverUrl': BASE, 'accountUsername': 'test-user', 'accountPassword': 'test-only', 'accountSuccess': {BASE: 'test-user'},
                'lastWorkspace': {'team': 'friends', 'path': ''}, 'syncedProjectId': 'friends/other', 'syncedRevision': 1}
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("mdnotes.settings.v1",' + json.dumps(json.dumps(settings)) + '); }')
        await page.add_init_script('window.EventSource = class { constructor() {} close() {} };')

        async def route(rt):
            path = urlparse(rt.request.url).path
            if path.startswith('/api/'):
                payload = {}
                if path == '/api/ping':
                    payload = {'accounts': True, 'appVersion': 'dev', 'minSyncVersion': 114}
                elif path == '/api/chat/status':
                    payload = {'configured': False}
                elif path == '/api/auth/login':
                    payload = {'token': 'account-1', 'username': 'test-user', 'teams': ['friends']}
                elif path == '/api/workspaces/open':
                    payload = {'token': 'session-1', 'clientId': 'desk', 'workspace': 'friends/', 'revision': 1, 'role': 'master', 'resume': resume}
                elif path == '/api/session/state':
                    payload = {'project': project, 'revision': 1, 'presence': []}
                elif path == '/api/chat/workspace':
                    payload = {'threads': [], 'revision': 0}
                elif path == '/api/workspaces/user-state':
                    saved.append(rt.request.post_data_json)
                    payload = {'ok': True}
                elif 'snapshots' in path:
                    payload = {'snapshots': []}
                await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
                return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function(SHOWN, timeout=20000)
        await page.wait_for_timeout(600)

        # The kept groups come back; the file that is gone is dropped.
        now = await page.evaluate(GROUPS)
        assert now['left']['tabs'] == [['session.md', 'source'], ['plan.md', 'preview']], now['left']
        assert now['left']['active'] == ['plan.md', 'preview'] and now['left']['bodies'] == ['preview-body'], now['left']
        assert now['right']['tabs'] == [['session.md', 'source']], now['right']
        assert now['right']['active'] == ['session.md', 'source'] and now['right']['bodies'] == ['right-source-body'], now['right']
        assert now['right']['activeEditor'] and not now['left']['activeEditor'], 'the editor showing the active file is the active one'
        assert 'The plan' in await page.locator('#preview-output').inner_text()

        # A change is saved with the groups (after the save's short wait).
        await page.locator('#source-tab-strip .editor-tab[data-view="preview"]', has_text='plan.md').click(button='right')
        await page.locator('#tab-context-menu button', has_text='Move to Other Group').click()
        for _ in range(60):
            if saved and any(group['tabs'] == [{'path': 'session.md', 'view': 'source'}, {'path': 'docs/plan.md', 'view': 'preview'}]
                             for group in saved[-1].get('groups', []) if group['id'] == 'right'):
                break
            await page.wait_for_timeout(100)
        last = saved[-1]
        assert (last['team'], last['path'], last['activeFile']) == ('friends', '', 'session.md'), last
        assert last['groups'] == [
            {'id': 'left', 'tabs': [{'path': 'session.md', 'view': 'source'}], 'active': {'path': 'session.md', 'view': 'source'}},
            {'id': 'right', 'tabs': [{'path': 'session.md', 'view': 'source'}, {'path': 'docs/plan.md', 'view': 'preview'}],
             'active': {'path': 'docs/plan.md', 'view': 'preview'}}], last['groups']
        cached = await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.workspaceView.v1"))')
        assert cached['groups'] == last['groups'], cached

        # A reload: the groups this browser kept come back (the server's resume is older).
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function(SHOWN, timeout=20000)
        for _ in range(40):
            now = await page.evaluate(GROUPS)
            if now['right']['active'] == ['plan.md', 'preview']:
                break
            await page.wait_for_timeout(100)
        assert now['left']['tabs'] == [['session.md', 'source']] and now['left']['bodies'] == ['source-body'], now['left']
        assert now['right']['tabs'] == [['session.md', 'source'], ['plan.md', 'preview']], now['right']
        assert now['right']['active'] == ['plan.md', 'preview'] and now['right']['bodies'] == ['preview-body'], now['right']

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['groups restored by path', 'a gone file dropped', 'bodies in the groups showing them',
                                     'a change saved with the groups', 'the local cache too', 'a reload brings them back']}))


asyncio.run(main())
