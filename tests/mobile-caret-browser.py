"""Mobile Chromium regression for caret persistence across touch blur and reload.

Uses the public origin with this checkout's assets and mocked APIs; no local server
or user workspace is touched. STILO_BROWSER can select an installed Chromium.
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
    project = {'id': 'mobile-caret-test', 'name': 'Mobile caret test', 'sourceMode': 'memory',
               'rootId': 'root', 'activeFileId': 'first', 'nodes': {
                   'root': {'id': 'root', 'kind': 'folder', 'name': 'Mobile caret test',
                            'children': ['first', 'second'], 'expanded': True},
                   'first': {'id': 'first', 'kind': 'file', 'parentId': 'root', 'name': 'first.md',
                             'content': 'First line\nSecond line with many words.', 'dirty': False},
                   'second': {'id': 'second', 'kind': 'file', 'parentId': 'root', 'name': 'second.md',
                              'content': 'Another note.', 'dirty': False}}}
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 390, 'height': 844},
                                            is_mobile=True, has_touch=True, device_scale_factor=1,
                                            service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('''(() => {
          const project = __PROJECT__;
          if (!localStorage.getItem('mdnotes.project.v1'))
            localStorage.setItem('mdnotes.project.v1', JSON.stringify(project));
          // Emulate a phone that clears its selection as another control takes
          // focus, with selectionchange delivery delayed until after that point.
          document.addEventListener('selectionchange', event => event.stopImmediatePropagation(), true);
          document.addEventListener('pointerdown', event => {
            if (!event.target.closest('#editor-content')) getSelection().removeAllRanges();
          });
        })();'''.replace('__PROJECT__', json.dumps(project)))

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                payload = {'appVersion': '0.1.20', 'minSyncVersion': 114, 'accounts': False} if path == '/api/ping' else {'configured': False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__caretTest={controller,getEditorSelection:(...a)=>editorParts.getEditorSelection(...a),getViewState};\n'
                await route.fulfill(status=200,
                                    content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream',
                                    body=body)
            else: await route.continue_()

        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__caretTest)')
        editor = page.locator('#editor-content')
        await editor.locator('.editor-line').nth(1).tap(position={'x': 100, 'y': 8})
        placed = await page.evaluate('__caretTest.getEditorSelection().start')
        assert placed > len('First line\n'), placed
        assert await page.evaluate("__caretTest.getViewState('first')?.editorSelection") is None, 'test did not delay selectionchange'
        await page.locator('#mobile-explorer-button').tap()
        saved = await page.evaluate("__caretTest.getViewState('first')?.editorSelection?.start")
        assert saved == placed, f'touch blur lost caret: expected {placed}, saved {saved}'
        await page.locator('#explorer-tree [data-node-id="second"]').tap()
        await page.locator('#mobile-explorer-button').tap()
        await page.locator('#explorer-tree [data-node-id="first"]').tap()
        await editor.focus()
        assert await page.evaluate('__caretTest.getEditorSelection().start') == placed, 'file return lost caret'
        await page.reload(wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__caretTest)')
        await editor.focus()
        assert await page.evaluate('__caretTest.getEditorSelection().start') == placed, 'reload lost caret'
        assert not errors, errors
        print(json.dumps({'checks': ['touch blur capture', 'file return', 'reload'], 'runtimeErrors': len(errors)}))
        await browser.close()


asyncio.run(main())
