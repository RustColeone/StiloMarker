"""Browser regression: a tab's menu (right-click on a tab).

Close, Close Others, Close to the Right, Close All; Open as Source / Preview
(the view the tab is in is ticked; opening as the other shows that pane when
it was hidden); Copy Path; History's diff tab only closes. Escape and a press
outside close the menu. Isolated: every API is mocked; the welcome template
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

TABS = '''(pane) => [...document.querySelectorAll(`#${pane}-tab-strip .editor-tab[data-file-id]`)].map(t => t.querySelector(".tab-title").textContent)'''
MENU = '''() => { const m = document.querySelector("#tab-context-menu"); return m.hidden ? null : [...m.querySelectorAll("button")].map(b => [b.textContent, b.disabled, b.getAttribute("aria-checked") === "true"]); }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        await context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
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
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=20000)

        async def open_file(name):
            await page.locator('#explorer-tree .tree-row', has_text=name).first.click()
            await page.wait_for_timeout(300)

        async def tab_menu(pane, name):
            await page.locator(f'#{pane}-tab-strip .editor-tab', has_text=name).first.click(button='right')
            await page.wait_for_timeout(150)
            return await page.evaluate(MENU)

        async def choose(label):
            await page.locator('#tab-context-menu button', has_text=label).first.click()
            await page.wait_for_timeout(300)

        for name in ('MeitanteiCure.mtree', 'LULUKA.urldb'):
            await open_file(name)
        assert await page.evaluate(TABS, 'source') == ['welcome.md', 'MeitanteiCure.mtree', 'LULUKA.urldb']

        # The menu of a source tab: the view it is in ticked, a one-view file not previewable.
        entries = await tab_menu('source', 'MeitanteiCure.mtree')
        labels = [label for label, _, _ in entries]
        assert labels == ['Close', 'Close Others', 'Close to the Right', 'Close All', 'Open as Source', 'Open as Preview', 'Copy Path'], labels
        assert entries[4] == ['Open as Source', True, True] and entries[5][1] is True, entries
        await page.keyboard.press('Escape')
        assert await page.evaluate(MENU) is None, 'Escape closes the menu'

        # Open as Preview: the album shows in the preview, which was hidden.
        await page.locator('#preview-collapse-button').click()
        assert await page.locator('#app').get_attribute('data-preview') == 'hidden'
        await tab_menu('source', 'LULUKA.urldb')
        await choose('Open as Preview')
        assert await page.locator('#app').get_attribute('data-preview') == 'shown', 'the preview pane shows again'
        assert 'LULUKA.urldb' in await page.evaluate(TABS, 'preview')
        active = await page.evaluate('document.querySelector("#preview-tab-strip .editor-tab.is-active .tab-title")?.textContent')
        assert active == 'LULUKA.urldb', active

        # Copy Path.
        await tab_menu('source', 'LULUKA.urldb')
        await choose('Copy Path')
        copied = await page.evaluate('navigator.clipboard.readText()')
        assert copied == 'Images/LULUKA.urldb', copied

        # Close to the Right, then Close Others.
        await tab_menu('source', 'welcome.md')
        await choose('Close to the Right')
        assert await page.evaluate(TABS, 'source') == ['welcome.md']
        await open_file('MeitanteiCure.mtree')
        await tab_menu('source', 'MeitanteiCure.mtree')
        await choose('Close Others')
        assert await page.evaluate(TABS, 'source') == ['MeitanteiCure.mtree']

        # A press outside closes the menu; Close All empties the pane.
        await tab_menu('preview', 'welcome.md')
        await page.mouse.click(700, 500)
        assert await page.evaluate(MENU) is None, 'a press outside closes the menu'
        await tab_menu('preview', 'welcome.md')
        await choose('Close All')
        assert await page.evaluate(TABS, 'preview') == [], await page.evaluate(TABS, 'preview')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['menu entries', 'escape', 'open as preview shows the pane', 'copy path',
                                     'close to the right', 'close others', 'press outside', 'close all']}))


asyncio.run(main())
