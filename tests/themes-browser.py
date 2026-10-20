"""Browser regression for themes (Shell's, and the theme-pack extension's).

Checks: Change Theme… opens Settings at the theme cards; a card applies its
theme at once (its base on <html data-theme>, its colours on the page, the
browser bar's colour) and the editor's highlighting follows (Light's bold is
dark, not Dark's pale yellow); the theme is kept across a reload, and the
page shows it before the app's code runs (app/boot-theme.js, checked with
the app's code blocked); System follows the device's light or dark as it
changes. Isolated: every API is mocked; no page errors.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
HOOK = app_hook('window.__themeTest = { shell };')


def project():
    return {'id': 'theme-test', 'name': 'Themes', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'a', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Themes', 'children': ['a'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes\n\nSome **bold** words.', 'dirty': False}}}


async def open_page(browser, settings, block_app=False, **options):
    context = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                               ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                               ' localStorage.setItem("mdnotes.settings.v1", ' + json.dumps(json.dumps(settings)) + '); }')

    async def route(rt):
        parsed = urlparse(rt.request.url)
        if parsed.netloc != urlparse(BASE).netloc:
            await rt.continue_(); return
        path = parsed.path
        if path.startswith('/api/'):
            payload = {'appVersion': 'dev', 'minSyncVersion': 117} if path == '/api/ping' else {}
            await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
        if block_app and path == '/app/main.js':
            await rt.fulfill(status=404, body=''); return
        file = ROOT / (path.lstrip('/') or 'index.html')
        if not file.is_file():
            await rt.continue_(); return
        body = file.read_bytes() + (HOOK if path == '/app/main.js' else b'')
        await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
    await context.route('**/*', route)
    await page.goto(BASE, wait_until='networkidle')
    if not block_app:
        await page.wait_for_function('Boolean(window.__themeTest) && document.querySelector("#editor-content .token-strong")')
    return context, page, errors


STATE = '''() => { const root = document.documentElement, css = getComputedStyle(root);
  return { base: root.dataset.theme, id: root.dataset.themeId ?? null, bg: css.getPropertyValue("--bg").trim(),
    meta: document.querySelector('meta[name="theme-color"]').content,
    bold: getComputedStyle(document.querySelector("#editor-content .token-strong") ?? root).color }; }'''


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context, page, errors = await open_page(browser, {'theme': 'light'})

        # Light: the editor's bold is dark text, readable on white.
        state = await page.evaluate(STATE)
        assert (state['base'], state['id'], state['bg'], state['bold']) == ('light', 'light', '#f3f3f3', 'rgb(31, 31, 31)'), state

        # A toast is the theme turned over: its text colour behind its page colour.
        await page.evaluate('window.__themeTest.shell.toast("Saved", { duration: 4000 })')
        toast = await page.evaluate('(() => { const t = document.querySelector(".app-toast"), cs = getComputedStyle(t); return [cs.backgroundColor, cs.color]; })()')
        assert toast == ['rgb(31, 31, 31)', 'rgb(255, 255, 255)'], toast

        # Change Theme… opens the cards; a card applies its theme at once.
        await page.evaluate('window.__themeTest.shell.run("shell.pick-theme")')
        await page.wait_for_selector('#settings-dialog[open] #theme-picker')
        assert await page.evaluate('document.activeElement?.dataset.themeChoice') == 'light'
        await page.click('#theme-picker [data-theme-choice="midnight"]')
        state = await page.evaluate(STATE)
        assert state == {'base': 'dark', 'id': 'midnight', 'bg': '#0e1522', 'meta': '#0e1522', 'bold': 'rgb(255, 203, 107)'}, state
        assert await page.evaluate('getComputedStyle(document.querySelector("#preview-output")).backgroundColor') == 'rgb(14, 21, 34)'
        await page.keyboard.press('Escape')

        # Kept across a reload; the early script shows it before the app's code runs.
        await page.reload(wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__themeTest)')
        assert (await page.evaluate(STATE))['id'] == 'midnight'
        kept = await page.evaluate('localStorage.getItem("mdnotes.theme.v1")')
        assert not errors, errors
        await context.close()

        context, page, errors = await open_page(browser, {'theme': 'midnight'}, block_app=True)
        await page.evaluate('(kept) => localStorage.setItem("mdnotes.theme.v1", kept)', kept)
        await page.reload(wait_until='networkidle')
        early = await page.evaluate('''() => [document.documentElement.dataset.theme, getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
            getComputedStyle(document.body).backgroundColor, Boolean(window.__themeTest)]''')
        assert early == ['dark', '#0e1522', 'rgb(14, 21, 34)', False], early
        await context.close()

        # System follows the device, and its changes.
        context, page, errors = await open_page(browser, {'theme': 'system'}, color_scheme='dark')
        assert (await page.evaluate(STATE))['base'] == 'dark'
        await page.emulate_media(color_scheme='light')
        await page.wait_for_function('document.documentElement.dataset.theme === "light"')
        assert (await page.evaluate(STATE))['id'] == 'light'
        assert not errors, errors
        await context.close()
        await browser.close()
        print(json.dumps({'checks': ['Light bold readable', 'toasts readable', 'Change Theme… and a card applies its theme', 'kept across a reload',
                                     'shown before the app runs', 'System follows the device'], 'runtimeErrors': 0}))


asyncio.run(main())
