"""Browser regression: on a first visit the welcome template's file shows in the
preview too, not only in the source editor.

A first visit opens a seed project, then the template arrives and replaces it.
The redraw that followed ran before the editor's view started over, and
nothing drew again, so the preview said "No preview file selected" (on the
phone: an empty Preview) until the first edit. Isolated: every API is mocked;
the template is this checkout's Template folder.
"""
import asyncio
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')


async def visit(browser, **options):
    context = await browser.new_context(service_workers='block', **options)  # nothing kept: a first visit
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
    # The template has arrived when the source editor shows its file.
    await page.wait_for_function('document.querySelector("#editor-content")?.innerText.includes("STILO MARKER")', timeout=20000)
    return context, page, errors


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)

        context, page, errors = await visit(browser, viewport={'width': 1400, 'height': 900})
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=5000)
        strip = await page.evaluate('document.querySelector("#preview-tab-strip").innerText')
        assert 'welcome.md' in strip and 'No preview file' not in strip, strip
        assert not errors, errors
        await context.close()

        context, page, errors = await visit(browser, viewport={'width': 400, 'height': 820}, has_touch=True, is_mobile=True)
        await page.locator('#mobile-view-toggle').click()
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=5000)
        assert not errors, errors
        await context.close()
        await browser.close()
        print('first visit: the template file shows in the preview (desktop and phone)')


asyncio.run(main())
