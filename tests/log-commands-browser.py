"""Browser regression for the Log's command line and Reload Window (Shell's).

Checks: F1 (Run Command…) opens the Log and focuses its command line, which
lists every command with Reload Window first; typing narrows the suggestions
(a keyword finds one, a command needing arguments is never offered); Enter
runs the chosen one and the log says so; arrows choose, Tab completes, Escape
closes then clears; "help" lists the commands in the log; an unknown command
says so. Reload Window keeps the work and reloads without the browser's
"Leave site?" (which a plain reload of a page with unsaved changes asks):
the edit, the open file and the caret come back. A step that can't keep its
work asks first, and staying reloads nothing. On the phone the line works in
the Log's sheet. Isolated: every API is mocked; no page errors.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
HOOK = app_hook('window.__logTest = { shell, controller, getEditorText, selection: () => editorParts.getEditorSelection(), get log() { return shell.logLines().map((e) => [e.kind, e.message, e.detail]); } };')


def project():
    return {'id': 'log-test', 'name': 'Log', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'b', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Log', 'children': ['a', 'b'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'first.md', 'content': '# First', 'dirty': False},
        'b': {'id': 'b', 'kind': 'file', 'parentId': 'root', 'name': 'second.md', 'content': '# Second\n\nSome text.', 'dirty': False}}}


async def open_page(browser, viewport, settings, **options):
    context = await browser.new_context(viewport=viewport, service_workers='block', **options)
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
        file = ROOT / (path.lstrip('/') or 'index.html')
        if not file.is_file():
            await rt.continue_(); return
        body = file.read_bytes() + (HOOK if path == '/app/main.js' else b'')
        await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
    await context.route('**/*', route)
    await page.goto(BASE, wait_until='networkidle')
    await page.wait_for_function('Boolean(window.__logTest)')
    return context, page, errors


SUGGESTIONS = '[...document.querySelectorAll("#log-suggestions .log-suggestion")].map((r) => [r.querySelector(".log-suggestion-title")?.textContent ?? r.textContent, r.classList.contains("is-chosen")])'


async def suggestions(page):
    if await page.locator('#log-suggestions').is_hidden():
        return None
    return await page.evaluate(SUGGESTIONS)


async def logged(page, kind, message):
    await page.wait_for_function('([kind, message]) => window.__logTest.log.some(([k, m]) => k === kind && m === message)', arg=[kind, message])


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context, page, errors = await open_page(browser, {'width': 1280, 'height': 800}, {'chatPanel': 'hidden', 'autoSave': False})
        dialogs = []
        page.on('dialog', lambda dialog: (dialogs.append(dialog.type), asyncio.ensure_future(dialog.dismiss())))

        # F1 (Run Command…): the Log shows, its line has the focus, every command listed, Reload Window first.
        assert await page.locator('#debug-panel').is_hidden()
        await page.click('#editor-content')
        await page.keyboard.press('F1')
        await page.wait_for_function('document.activeElement?.id === "log-command-input"')
        assert await page.locator('#debug-panel').is_visible()
        shown = await suggestions(page)
        titles = [title for title, _ in shown]
        assert titles[0] == 'Reload Window' and shown[0][1], shown
        assert len(titles) > 20 and 'Toggle Preview' in titles and 'Save' in titles, titles
        assert 'Rename File' not in titles, 'a command needing its caller\'s arguments is not offered'

        # Typing narrows the list; a keyword finds one; Enter runs the chosen one.
        await page.keyboard.type('stuck')
        assert (await suggestions(page))[0] == ['Reload Window', True]
        await page.fill('#log-command-input', '')
        await page.keyboard.type('toggle prev')
        assert (await suggestions(page))[0] == ['Toggle Preview', True], await suggestions(page)
        assert await page.locator('#preview-pane').is_visible()
        await page.keyboard.press('Enter')
        await page.wait_for_selector('#preview-pane', state='hidden')
        await logged(page, 'action', '> Toggle Preview')
        assert await page.input_value('#log-command-input') == '' and await page.locator('#log-suggestions').is_hidden()
        assert await page.evaluate('document.activeElement?.id') == 'log-command-input', 'the line keeps the focus'

        # Arrows choose, Tab completes, Escape closes the list and then clears the line.
        await page.keyboard.type('save')
        assert [t for t, _ in await suggestions(page)][:2] == ['Save', 'Save as PDF'], await suggestions(page)
        await page.keyboard.press('ArrowDown')
        assert (await suggestions(page))[1] == ['Save as PDF', True]
        await page.keyboard.press('Tab')
        assert await page.input_value('#log-command-input') == 'Save as PDF'
        await page.keyboard.press('Escape')
        assert await page.locator('#log-suggestions').is_hidden()
        await page.keyboard.press('Escape')
        assert await page.input_value('#log-command-input') == ''

        # A recent command comes before the rest; a click runs a suggestion.
        await page.keyboard.press('ArrowDown')
        assert [t for t, _ in await suggestions(page)][:3] == ['Reload Window', 'Help: List Commands', 'Toggle Preview'], await suggestions(page)
        await page.click('#log-suggestions .log-suggestion:has-text("Toggle Preview")')
        await page.wait_for_selector('#preview-pane', state='visible')

        # help lists the commands in the log; an unknown command says so.
        await page.fill('#log-command-input', 'help')
        assert (await suggestions(page))[0][0] == 'Help: List Commands'
        await page.keyboard.press('Enter')
        await page.wait_for_function('window.__logTest.log.some(([k, m, d]) => m === "Reload Window" && d.startsWith("shell.reload-window"))')
        await page.fill('#log-command-input', 'zzz')
        assert (await suggestions(page)) == [['No command matches “zzz”. Type help to list them all.', False]]
        await page.keyboard.press('Enter')
        await logged(page, 'failed', 'No command matches “zzz”')
        assert await page.input_value('#log-command-input') == 'zzz', 'kept, to be put right'

        # A plain reload of a page with unsaved changes asks "Leave site?" (the browser's).
        await page.click('#editor-content')
        await page.keyboard.press('Control+End')
        await page.keyboard.type(' Kept.')
        await page.wait_for_function('window.__logTest.controller.getActiveFile().dirty')
        caret = await page.evaluate('window.__logTest.selection()')
        assert caret == {'start': 26, 'end': 26}, caret
        await page.evaluate('location.reload()')
        await page.wait_for_timeout(500)
        assert dialogs == ['beforeunload'], dialogs
        assert await page.evaluate('Boolean(window.__logTest)'), 'staying: the page did not reload'

        # A step that can't keep its work asks first; staying reloads nothing.
        await page.evaluate('''() => { window.__stuck = true; window.__logTest.shell.beforeReload.add({ id: "test.stuck", label: "A test", order: 99,
            keep: () => (window.__stuck ? "it is stuck." : "") }); }''')
        await page.fill('#log-command-input', 'reload window')
        await page.keyboard.press('Enter')
        await page.wait_for_selector('#confirm-dialog[open]')
        message = await page.locator('#confirm-dialog-message').inner_text()
        assert 'A test: it is stuck.' in message and 'Reload anyway?' in message, message
        await page.click('#confirm-dialog button[value="cancel"]')
        await logged(page, 'response', 'Reload Window cancelled: nothing was reloaded')
        assert await page.evaluate('Boolean(window.__logTest)')

        # Reload Window: the work kept, no "Leave site?", the edit, the file and the caret back.
        await page.evaluate('window.__stuck = false')
        await page.fill('#log-command-input', 'reload')
        async with page.expect_navigation():
            await page.keyboard.press('Enter')
        await page.wait_for_function('Boolean(window.__logTest)')
        assert dialogs == ['beforeunload'], dialogs
        await page.wait_for_function('window.__logTest.getEditorText().includes("Some text. Kept.")')
        await page.locator('#editor-content').focus()  # the caret comes back as the editor takes the focus
        back = await page.evaluate('''() => ({ active: window.__logTest.controller.getProject().activeFileId,
            caret: window.__logTest.selection(), text: window.__logTest.controller.getActiveFile().content })''')
        assert back == {'active': 'b', 'caret': caret, 'text': '# Second\n\nSome text. Kept.'}, back
        assert not errors, errors
        await context.close()

        # The phone: the line works in the Log's sheet.
        context, page, errors = await open_page(browser, {'width': 400, 'height': 820}, {'chatPanel': 'hidden'}, has_touch=True, is_mobile=True)
        await page.evaluate('window.__logTest.shell.run("shell.run-command")')
        await page.wait_for_function('document.querySelector("#app").dataset.mobileBottom === "open"')
        await page.wait_for_function('document.activeElement?.id === "log-command-input"')
        await page.keyboard.type('toggle prev')
        assert (await suggestions(page))[0] == ['Toggle Preview', True]
        box = await page.locator('#log-suggestions').bounding_box()
        line = await page.locator('#log-command-input').bounding_box()
        assert box and line and box['y'] + box['height'] <= line['y'] + 1 and line['y'] + line['height'] <= 820, (box, line)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        assert await page.evaluate('document.querySelector("#app").dataset.mobileBottom') == 'open', 'Escape belongs to the line'
        assert not errors, errors
        await context.close()
        await browser.close()
        print(json.dumps({'checks': ['F1 opens the command line', 'suggestions: all, narrowed, keywords, no args commands', 'Enter runs; arrows, Tab, Escape',
                                     'recent first; a click runs', 'help lists commands; unknown said', 'a plain reload asks Leave site?',
                                     'a problem asks; staying reloads nothing', 'Reload Window keeps the edit, file and caret', 'the phone sheet'],
                          'runtimeErrors': 0}))


asyncio.run(main())
