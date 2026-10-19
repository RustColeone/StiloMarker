"""Browser regression: on the phone, Source and Preview are one file's two views.

The top bar names the file on screen; its name opens the list of the open
files (with Rename first), and one switch shows the same file in its other
view, hidden when the file has only one. A file picked in the explorer shows
in the view on screen. The chat is a drawer over the file, not a view: the
file and its view stay, and the file list closes it. Isolated: every API is mocked; the welcome template
is this checkout's Template folder.
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

STATE = '''({
  view: document.querySelector("#app").dataset.mobileView,
  file: document.querySelector("#mobile-pane-caption").textContent,
  switchHidden: document.querySelector("#mobile-view-toggle").hidden,
  switchTo: document.querySelector("#mobile-view-toggle").dataset.target,
  listOpen: !document.querySelector("#mobile-file-list").hidden,
  right: document.querySelector("#app").dataset.mobileRight,
  source: document.querySelector("#editor-content").innerText.slice(0, 40),
  preview: document.querySelector("#preview-output").innerText.slice(0, 40)
})'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 400, 'height': 820}, has_touch=True, is_mobile=True)
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def route(rt):
            path = urlparse(rt.request.url).path
            if path.startswith('/api/'):
                await rt.fulfill(status=200, content_type='application/json', body='{"appVersion":"dev","minSyncVersion":117}')
                return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#editor-content")?.innerText.includes("STILO MARKER")', timeout=20000)

        async def state():
            await page.wait_for_timeout(400)
            return await page.evaluate(STATE)

        async def explorer_open(name):
            await page.locator('#mobile-explorer-button').click()
            await page.locator('#explorer-tree .tree-row', has_text=name).first.click()

        start = await state()
        assert (start['view'], start['file'], start['switchHidden'], start['switchTo']) == ('source', 'welcome.md', False, 'preview'), start

        # The switch shows the same file previewed, and back.
        await page.locator('#mobile-view-toggle').click()
        now = await state()
        assert (now['view'], now['file'], now['switchTo']) == ('preview', 'welcome.md', 'source'), now
        assert 'STILO MARKER' in now['preview'], now

        # Picked in the explorer while previewing: its preview shows.
        await explorer_open('LULUKA.urldb')
        now = await state()
        assert (now['view'], now['file']) == ('preview', 'LULUKA.urldb'), now
        await page.locator('#mobile-view-toggle').click()
        now = await state()
        assert (now['view'], now['file']) == ('source', 'LULUKA.urldb'), 'the switch keeps the file'

        # A file with one view (a module tree has no preview): the switch hides.
        await explorer_open('MeitanteiCure.mtree')
        now = await state()
        assert (now['view'], now['file'], now['switchHidden']) == ('source', 'MeitanteiCure.mtree', True), now

        # The file name lists the open files, Rename first, the one on screen marked.
        await page.locator('#mobile-file-button').click()
        items = await page.evaluate('[...document.querySelectorAll("#mobile-file-list .mobile-file-item")].map(b => [b.textContent, b.getAttribute("aria-checked")])')
        assert items[0] == ['Rename…', None], items
        names = [name for name, _ in items[1:]]
        assert names == ['welcome.md', 'LULUKA.urldb', 'MeitanteiCure.mtree'], names
        assert ['MeitanteiCure.mtree', 'true'] in items, items
        await page.keyboard.press('Escape')
        assert not (await state())['listOpen'], 'Escape closes the list'
        await page.locator('#mobile-file-button').click()
        await page.locator('#editor-content').click(position={'x': 200, 'y': 300})
        assert not (await state())['listOpen'], 'a tap outside closes the list'

        # Picking one shows it in the view on screen, and the switch comes back.
        await page.locator('#mobile-file-button').click()
        await page.locator('#mobile-file-list .mobile-file-item', has_text='welcome.md').click()
        now = await state()
        assert (now['view'], now['file'], now['switchHidden'], now['listOpen']) == ('source', 'welcome.md', False, False), now
        assert now['source'].startswith('# STILO MARKER'), now

        # The chat opens as a drawer over the file: the file and its view stay.
        await page.locator('#mobile-chat-toggle').click()
        now = await state()
        assert (now['right'], now['view'], now['file'], now['switchHidden']) == ('open', 'source', 'welcome.md', False), now
        # The file list closes it (one flyout at a time).
        await page.locator('#mobile-file-button').click()
        now = await state()
        assert (now['right'], now['listOpen']) == ('closed', True), now
        await page.keyboard.press('Escape')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['switch keeps the file', 'explorer follows the view', 'one-view file hides the switch',
                                     'open files listed', 'list closes', 'list picks', 'chat drawer over the file']}))


asyncio.run(main())
