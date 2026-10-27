"""Browser regression: small things a first visit ran into (v0.3.17).

- The server answered the page's own ping, yet Session (and Settings, under
  Server) said "No server checked yet.".
- Create → New Markdown opened the file but left the keys with the page, so
  what was typed next was lost; the empty file's editor said "Select or
  create a file".
- Escape left the explorer's right-click menu open.
- Find in Files kept 40 characters before a match, more than its list
  shows, so a match far into its line was cut off.

Isolated: every API is mocked; the template is this checkout's Template folder.
"""
import asyncio
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

LINE = '- Python 3.10+ if you want to run the zanzibarqux backend'


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
        await page.wait_for_function('document.querySelector("#editor-content")?.innerText.includes("STILO MARKER")', timeout=20000)

        # The page's own ping found the server: Session and Settings say so.
        await page.wait_for_function('document.querySelector("#session-detail-text")?.textContent.includes("reachable")', timeout=10000)
        said = await page.evaluate('[document.querySelector("#session-detail-text").textContent, document.querySelector("#server-status-text").textContent]')
        assert all('No server checked yet' not in text for text in said), said

        # Create → New Markdown: the new file's editor has the keys.
        await page.locator('.menu-bar').get_by_text('Create', exact=True).click()
        await page.locator('#create-menu').get_by_text('New Markdown', exact=True).click()
        await page.wait_for_timeout(400)
        focused = await page.evaluate('''(() => { const el = document.activeElement;
          return { editor: el.classList.contains("editor-content"), placeholder: el.dataset.placeholder ?? null }; })()''')
        assert focused['editor'], f'the new file\'s editor has the focus: {focused}'
        assert focused['placeholder'] == 'Empty file — start typing', focused
        await page.keyboard.type(LINE)
        await page.wait_for_timeout(400)
        typed = await page.evaluate('document.activeElement.innerText.trim()')
        assert typed == LINE, typed

        # Escape closes the explorer's right-click menu.
        await page.locator('#explorer-panel').get_by_text('new markdown 1.md', exact=True).click(button='right')
        await page.wait_for_timeout(200)
        assert await page.locator('#explorer-context-menu').is_visible()
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        assert not await page.locator('#explorer-context-menu').is_visible(), 'Escape closes the explorer menu'

        # Find in Files: the match far into its line shows in the list.
        await page.keyboard.press('Control+Shift+F')
        await page.wait_for_timeout(300)
        await page.keyboard.type('zanzibarqux')
        await page.wait_for_selector('.search-files-match mark', timeout=5000)
        shown = await page.evaluate('''(() => { const mark = document.querySelector(".search-files-match mark");
          const row = mark.closest(".search-files-match").getBoundingClientRect(), hit = mark.getBoundingClientRect();
          return { inside: hit.left >= row.left && hit.right <= row.right, row: row.width, hit: [hit.left, hit.right], text: mark.parentElement.textContent }; })()''')
        assert shown['inside'], f'the match shows in its row: {shown}'

        assert not errors, errors
        await browser.close()
        print('small things: the server said reachable; a new file takes the keys; Escape closes the explorer menu; '
              'a match far into its line shows')


asyncio.run(main())
