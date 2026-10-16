"""Browser regression for the Shell module (app/modules/shell): the menu bar
is drawn from registered commands, shortcuts run commands, dialogs work.

Checks: five menus in order with their items; a menu item runs its command;
live titles ("Show Chat" / "Hide Chat"); Ctrl+S runs Save from anywhere;
the rename dialog keeps the file extension out of the field; a module added
after start-up appears in the menus; the phone's menu panel shows the same
groups; no page errors. Static responses come from this checkout.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
HOOK = b'\nwindow.__shellTest = { shell, renameFileById, get log() { return debugState.entries.map((e) => e.message); } };\n'


def project():
    return {'id': 'shell-test', 'name': 'Shell', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'a', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Shell', 'children': ['a'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes', 'dirty': False}}}


async def open_page(browser, viewport, **options):
    context = await browser.new_context(viewport=viewport, service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                               ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                               ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "hidden"})); }')

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
    await page.wait_for_function('Boolean(window.__shellTest)')
    return context, page, errors


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context, page, errors = await open_page(browser, {'width': 1280, 'height': 800})

        # Five menus, in order, each with its items.
        labels = await page.locator('.menu-bar .menu-trigger').all_inner_texts()
        assert labels == ['File', 'Edit', 'Create', 'View', 'Settings'], labels
        counts = await page.evaluate('[...document.querySelectorAll(".menu-bar .menu-popover")].map((p) => p.children.length)')
        assert counts == [9, 5, 6, 5, 5], counts
        assert await page.locator('#file-menu').is_hidden()

        # Opening one closes the others; a click outside closes it.
        await page.click('#file-menu-button')
        assert await page.locator('#file-menu').is_visible()
        await page.click('#view-menu-button')
        assert await page.locator('#file-menu').is_hidden() and await page.locator('#view-menu').is_visible()
        await page.mouse.click(640, 500)
        assert await page.locator('#view-menu').is_hidden()

        # A live title, and a menu item running its command.
        await page.click('#view-menu-button')
        assert await page.locator('[data-command="assistant.toggle-chat"]').inner_text() == 'Show Chat'
        await page.click('[data-command="assistant.toggle-chat"]')
        await page.wait_for_function('document.querySelector(".app-shell")?.dataset.chat === "shown"')
        await page.click('#view-menu-button')
        assert await page.locator('[data-command="assistant.toggle-chat"]').inner_text() == 'Hide Chat'
        await page.keyboard.press('Escape')
        await page.mouse.click(640, 500)

        # Ctrl+S runs Save, even while typing in the editor.
        await page.click('#editor-content')
        await page.keyboard.press('Control+s')
        await page.wait_for_function('window.__shellTest.log.includes("shell: command workspace.save")')

        # The rename dialog keeps ".md" out of the field and puts it back.
        await page.evaluate('() => { void window.__shellTest.renameFileById("a"); }')
        await page.wait_for_selector('#input-dialog[open]')
        assert await page.locator('#input-dialog-input').input_value() == 'notes'
        await page.locator('#input-dialog-input').fill('ideas')
        await page.locator('#input-dialog-input').press('Enter')
        await page.wait_for_selector('.tree-row[title="ideas.md"]', timeout=10000)

        # Something added after start-up (as a module or an extension would) appears.
        await page.evaluate('''() => {
            window.__shellTest.shell.menus.add({ id: "extra", label: "Extra", order: 9 });
            window.__shellTest.shell.commands.add({ id: "extra.hello", title: "Hello", menu: { id: "extra" },
                run: () => window.__shellTest.shell.toast("hello") });
        }''')
        await page.wait_for_selector('#extra-menu-button')
        await page.click('#extra-menu-button')
        await page.click('[data-command="extra.hello"]')
        await page.wait_for_selector('.app-toast:has-text("hello")')
        assert not errors, errors
        await context.close()

        # Phone: the ⋮ panel shows the same groups.
        context, phone, errors = await open_page(browser, {'width': 390, 'height': 760}, is_mobile=True, has_touch=True)
        await phone.locator('#mobile-menu-button').click()
        await phone.wait_for_function('document.querySelector(".app-shell")?.dataset.mobileMenu === "open"')
        assert await phone.locator('.menu-bar .menu-trigger').count() == 5
        await phone.locator('#edit-menu-button').click()
        assert await phone.locator('[data-command="editor.find-replace"]').is_visible()
        widths = await phone.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        assert widths[0] <= widths[1], widths
        assert not errors, errors
        await context.close()
        await browser.close()
        print(json.dumps({'checks': ['five menus with their items', 'one menu open at a time', 'live titles',
                                     'menu item runs its command', 'Ctrl+S runs Save', 'rename keeps the extension',
                                     'late menus and commands appear', 'phone menu panel'], 'runtimeErrors': 0}))


asyncio.run(main())
