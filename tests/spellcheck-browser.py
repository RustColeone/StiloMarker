"""Browser regression: the spelling check setting (v0.2.33).

The source editor checks no spelling at first; Settings → Appearance →
"Check spelling" turns the browser's check on in the editor (and off
again), and the choice is kept over a reload. No page errors.

Isolated: APIs are mocked and static files come from this checkout.
"""
import asyncio, json, mimetypes, os
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
        context = await browser.new_context(viewport={'width': 1280, 'height': 860}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                await route.fulfill(status=200, content_type='application/json', body=json.dumps({'appVersion': '0.2.33', 'minSyncVersion': 117})); return
            if path.startswith('/Template/'):
                await route.fulfill(status=404, body='not found'); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        checks = []
        spelling = lambda: page.evaluate('document.querySelector("#editor-content").spellcheck')
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_selector('#editor-content')
        assert await spelling() is False
        checks.append('no spelling check at first')

        await page.click('#settings-button')
        await page.click('#settings-tab-strip [data-page="appearance"]')
        await page.check('#spellcheck-input')
        await page.wait_for_timeout(200)
        assert await spelling() is True
        checks.append('Check spelling turns it on in the editor')

        await page.reload(wait_until='networkidle')
        await page.wait_for_selector('#editor-content')
        assert await spelling() is True, 'kept over a reload'
        await page.click('#settings-button')
        await page.click('#settings-tab-strip [data-page="appearance"]')
        assert await page.is_checked('#spellcheck-input')
        await page.uncheck('#spellcheck-input')
        await page.wait_for_timeout(200)
        assert await spelling() is False
        checks.append('kept over a reload; off again')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
