"""Browser regression: the editor's tab strips (v0.3.4).

The tab in use is the darker one in a light theme as in a dark one; the
group's label is set apart from its tabs by a border; a strip full of tabs
shows no scrollbar, so both panes' headers keep one height, and the wheel
scrolls it sideways. No page errors.

Isolated: every API is mocked; static files come from this checkout.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')
NAMES = [f'chapter-{n:02}.md' for n in range(1, 15)]


def project():
    nodes = {'root': {'id': 'root', 'kind': 'folder', 'name': 'Strips', 'children': [f'f{n}' for n in range(len(NAMES))], 'expanded': True}}
    for n, name in enumerate(NAMES):
        nodes[f'f{n}'] = {'id': f'f{n}', 'kind': 'file', 'parentId': 'root', 'name': name, 'content': f'# {name}\n', 'dirty': False}
    return {'id': 'strips', 'name': 'Strips', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'f0', 'nodes': nodes}


# A colour's lightness (0 dark .. 1 light), from a computed rgb() value.
LIGHTNESS = '''(color) => { const [r, g, b] = color.match(/\\d+(\\.\\d+)?/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1100, 'height': 800}, service_workers='block')
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
                    body += app_hook('window.__s = { controller, shell, parts: editorParts };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__s) && document.querySelector("#editor-content .editor-line")')
        checks = []

        # Every file open as a source tab: the left strip is full, the right has one tab.
        for n in range(len(NAMES)):
            await page.evaluate(f'__s.parts.openFileFromExplorer("f{n}")')
        await page.wait_for_timeout(500)
        state = await page.evaluate('''() => { const strip = document.querySelector("#source-tab-strip");
          const headers = [...document.querySelectorAll(".editor-group .pane-header")].map((h) => Math.round(h.getBoundingClientRect().height));
          return { overflows: strip.scrollWidth > strip.clientWidth, scrollbar: strip.offsetHeight - strip.clientHeight, headers,
            style: getComputedStyle(strip).scrollbarWidth }; }''')
        assert state['overflows'], state
        # (A headless browser hides scrollbars anyway: the style is what keeps a real one from showing.)
        assert state['scrollbar'] == 0 and state['style'] == 'none', f'no scrollbar: {state}'
        assert len(set(state['headers'])) == 1, f'both headers one height: {state}'
        checks.append(f"a full strip shows no scrollbar; both headers {state['headers'][0]} px")

        # The wheel scrolls a full strip sideways.
        await page.evaluate('document.querySelector("#source-tab-strip").scrollLeft = 0')
        box = await page.locator('#source-tab-strip').bounding_box()
        await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
        await page.mouse.wheel(0, 240)
        await page.wait_for_timeout(200)
        assert await page.evaluate('document.querySelector("#source-tab-strip").scrollLeft') > 0, 'the wheel scrolls it'
        checks.append('the wheel scrolls a full strip sideways')

        # The label set apart from the tabs by a border.
        border = await page.evaluate('getComputedStyle(document.querySelector("#source-pane-label")).borderRightWidth')
        assert border == '1px', border
        checks.append('the label set apart from the tabs by a border')

        # The tab in use is the darker one, light and dark alike.
        for theme in ('light', 'dark'):
            await page.evaluate(f'__s.shell.settings.change({{ theme: "{theme}" }})')
            await page.wait_for_function(f'document.documentElement.dataset.theme === "{theme}"')
            await page.wait_for_timeout(200)
            shades = await page.evaluate(f'''() => {{ const light = {LIGHTNESS};
              const tabs = [...document.querySelectorAll("#source-tab-strip .editor-tab[data-file-id]")];
              const active = tabs.find((t) => t.classList.contains("is-active")), other = tabs.find((t) => !t.classList.contains("is-active"));
              return [light(getComputedStyle(active).backgroundColor), light(getComputedStyle(other).backgroundColor)]; }}''')
            assert shades[0] < shades[1], f'{theme}: the active tab darker than the others: {shades}'
            checks.append(f'{theme}: the tab in use is the darker one')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
