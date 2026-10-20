"""Browser regression: Source and Preview share the editor half and half.

Until the splitter is dragged, the two groups split the editor evenly,
whatever else opens: the side panel no longer squeezes the source (ISSUES 6,
fixed in v0.2.0), nor does a narrower window. A dragged width stays; a
double-click on the splitter gives the even split back. Isolated: every API
is mocked; the welcome template is this checkout's Template folder.
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

WIDTHS = '''() => ["#source-pane", "#preview-pane"].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().width))'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
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

        async def widths():
            await page.wait_for_timeout(300)
            return await page.evaluate(WIDTHS)

        def even(pair):
            return abs(pair[0] - pair[1]) <= 1

        start = await widths()
        assert even(start) and start[0] > 450, f'half and half: {start}'

        # The side panel opens: both get narrower, evenly (it squeezed the source to ~108px).
        await page.locator('#view-menu-button').click()
        await page.locator('[data-command="assistant.toggle-chat"]').click()
        now = await widths()
        assert even(now) and now[0] > 250, f'the side panel shares the loss: {now}'

        # A narrower window: still even.
        await page.set_viewport_size({'width': 1200, 'height': 900})
        now = await widths()
        assert even(now), now

        # Dragged (the side panel closed, the window wide again): the preview keeps the width it was given.
        await page.locator('#chat-collapse-button').click()
        await page.set_viewport_size({'width': 1400, 'height': 900})
        await page.wait_for_timeout(300)
        box = await page.locator('#editor-splitter').bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + 200
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.mouse.move(x - 120, y, steps=6)
        await page.mouse.up()
        dragged = await widths()
        assert dragged[1] - dragged[0] > 200, f'the preview is wider: {dragged}'
        await page.set_viewport_size({'width': 1300, 'height': 900})
        kept = await widths()
        assert abs(kept[1] - dragged[1]) <= 1, f'a dragged width stays: {dragged} {kept}'

        # A double-click on the splitter: even again.
        await page.locator('#editor-splitter').dblclick()
        now = await widths()
        assert even(now), f'even again: {now}'
        assert await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.settings.v1")).previewWidthCustomized') is False

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['half and half', 'side panel shares the loss', 'narrower window', 'a dragged width stays',
                                     'double-click: even again']}))


asyncio.run(main())
