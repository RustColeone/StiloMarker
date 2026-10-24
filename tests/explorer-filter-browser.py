"""Browser regression: the explorer's name search (v0.3.6).

A box under the explorer's header, above the tree: typed, the tree keeps the
files and folders whose name holds it (any case) and the folders holding
them, open; nothing found says so; Enter opens the first file found; Escape
clears it and the tree is as it was (its folders' own state kept). No page
errors.

Isolated: every API is mocked; static files come from this checkout.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')


def project():
    nodes = {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Book', 'children': ['ch', 'notes'], 'expanded': True},
        'ch': {'id': 'ch', 'kind': 'folder', 'name': 'Chapters', 'parentId': 'root', 'children': ['c1', 'c2'], 'expanded': False},
        'c1': {'id': 'c1', 'kind': 'file', 'name': 'Lantern.md', 'parentId': 'ch', 'content': '# Lantern', 'dirty': False},
        'c2': {'id': 'c2', 'kind': 'file', 'name': 'River.md', 'parentId': 'ch', 'content': '# River', 'dirty': False},
        'notes': {'id': 'notes', 'kind': 'file', 'name': 'notes.md', 'parentId': 'root', 'content': '# Notes', 'dirty': False}}
    return {'id': 'book', 'name': 'Book', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'notes', 'nodes': nodes}


ROWS = '[...document.querySelectorAll("#explorer-tree .tree-row:not(.is-project-root)")].map((r) => r.querySelector(".tree-label")?.textContent ?? r.textContent.trim())'


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1200, 'height': 800}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');')

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                payload = {'appVersion': 'dev', 'minSyncVersion': 117, 'accounts': False} if path == '/api/ping' else {'configured': False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__s = { controller };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__s) && document.querySelector("#explorer-tree .tree-row")')
        checks = []
        rows = lambda: page.evaluate(ROWS)
        before = await rows()
        assert 'Lantern.md' not in before, f'the folder starts closed: {before}'

        # Typed: the matching names, in any case, their folder open.
        box = await page.locator('#explorer-name-filter').bounding_box()
        tree = await page.locator('#explorer-tree').bounding_box()
        assert box['y'] < tree['y'], 'the box is above the tree'
        assert tree['height'] > 200, f'the tree keeps the window\'s height: {tree}'
        await page.fill('#explorer-name-filter', 'LANT')
        await page.wait_for_timeout(200)
        assert await rows() == ['Chapters', 'Lantern.md'], await rows()
        checks.append('typed: the matching names, their folder open, above the tree')

        await page.fill('#explorer-name-filter', 'zzz')
        await page.wait_for_timeout(200)
        assert 'No file names match.' in await page.inner_text('#explorer-tree')
        checks.append('nothing found: said')

        # Enter opens the first file found.
        await page.fill('#explorer-name-filter', 'river')
        await page.press('#explorer-name-filter', 'Enter')
        await page.wait_for_function('window.__s.controller.getActiveFile()?.name === "River.md"', timeout=5000)
        checks.append('Enter opens the first file found')

        # Escape clears it: the tree as it was.
        await page.press('#explorer-name-filter', 'Escape')
        await page.wait_for_timeout(200)
        assert await page.input_value('#explorer-name-filter') == ''
        assert await rows() == before, (before, await rows())
        assert await page.evaluate('window.__s.controller.getProject().nodes.ch.expanded') is False
        checks.append("Escape clears it: the tree as it was, the folder's own state kept")

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
