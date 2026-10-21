"""Browser regression for this browser's copy of the workspace (Workspace's, in IndexedDB).

Checks: a copy kept in localStorage before v0.2.19 is moved over once (and the
old key removed); a workspace past localStorage's ~5 MB is saved and survives
a reload, nothing left unsaved; a write that fails says so (a notice and a red
status item), and saving again says so too; while the copy can't be written,
what changed is journaled as the page goes and is there on the next load;
Reset to Default Workspace and Empty Everything leave no old copy behind.
Isolated: every API is mocked; no page errors.
"""
import asyncio, json, mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook
from helpers.browser_copy import STORED_NAMES

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
HOOK = app_hook('window.__copyTest = { shell, controller };')


def project():
    return {'id': 'copy-test', 'name': 'Copy', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'a', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Copy', 'children': ['a', 'b'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes\n\nText.', 'dirty': False},
        'b': {'id': 'b', 'kind': 'file', 'parentId': 'root', 'name': 'other.md', 'content': '# Other', 'dirty': False}}}


# Writes to the copy fail as on a full disk (or succeed again).
BREAK_WRITES = '''() => { window.__realPut ??= IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); }; }'''
MEND_WRITES = '() => { if (window.__realPut) IDBObjectStore.prototype.put = window.__realPut; }'
FILES = '() => Object.values(window.__copyTest.controller.getProject().nodes).filter((n) => n.kind === "file").map((n) => [n.name, n.content.slice(-12), Boolean(n.dirty)]).sort()'


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('dialog', lambda dialog: asyncio.ensure_future(dialog.accept()))
        # A copy from before v0.2.19, in localStorage.
        await context.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                      ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + '); }')

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

        async def load(target=page):
            await target.wait_for_function('Boolean(window.__copyTest)', timeout=30000)
            await target.wait_for_timeout(300)

        await page.goto(BASE, wait_until='domcontentloaded')
        await load()

        # Moved over once: in IndexedDB now, the old key gone.
        assert await page.evaluate(STORED_NAMES) == ['notes.md', 'other.md']
        assert await page.evaluate('localStorage.getItem("mdnotes.project.v1")') is None, 'the old copy is removed once moved'

        # A workspace past localStorage's ~5 MB: saved, and there after a reload.
        await page.evaluate('''() => { const c = window.__copyTest.controller;
            c.createFile(c.getProject().rootId, "big.md", "# Big\\n\\n" + "lorem ipsum dolor sit amet ".repeat(240000)); }''')
        await page.click('#editor-content')
        await page.keyboard.press('Control+End')
        await page.keyboard.type(' typed')
        await page.wait_for_function('!Object.values(window.__copyTest.controller.getProject().nodes).some((n) => n.dirty)', timeout=15000)
        await page.reload(wait_until='domcontentloaded')
        await load()
        files = await page.evaluate(FILES)
        assert [name for name, _, _ in files] == ['big.md', 'notes.md', 'other.md'], files
        assert files[1][1].endswith(' typed') and not any(dirty for _, _, dirty in files), files
        assert await page.evaluate('document.querySelector("#status-storage-item").hidden')

        # A write that fails says so: a notice once, and a red item while it lasts.
        # (The edit goes through the app: a save already waiting may fail first and open the notice.)
        await page.evaluate(BREAK_WRITES)
        await page.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " broken"); }')
        await page.wait_for_selector('#notice-dialog[open]', timeout=15000)
        title = await page.locator('#notice-dialog-title').inner_text()
        assert title == 'Not saved in this browser', title
        assert 'QuotaExceededError' in await page.locator('#notice-dialog-message').inner_text() or 'quota' in (await page.locator('#notice-dialog-message').inner_text()).lower()
        await page.keyboard.press('Escape')
        assert not await page.evaluate('document.querySelector("#status-storage-item").hidden'), 'the red item shows'
        assert await page.evaluate('document.querySelector("#status-storage-item .status-dot").classList.contains("is-danger")')
        dirty = await page.evaluate('Object.values(window.__copyTest.controller.getProject().nodes).filter((n) => n.dirty).map((n) => n.name)')
        assert dirty == ['notes.md'], f'unsaved stays marked: {dirty}'

        # As the page goes, what changed is journaled (localStorage): the next load has it.
        await page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))')
        assert await page.evaluate('Boolean(localStorage.getItem("mdnotes.journal.v1"))'), 'journaled'
        second = await context.new_page()
        await second.goto(BASE, wait_until='domcontentloaded')
        await load(second)
        notes = [content for name, content, _ in await second.evaluate(FILES) if name == 'notes.md'][0]
        assert notes.endswith(' broken'), notes
        assert await second.evaluate('localStorage.getItem("mdnotes.journal.v1")') is None, 'the journal is gone once written'
        await second.close()

        # Writing works again: said with a toast, the item gone.
        await page.evaluate(MEND_WRITES)
        await page.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " mended"); }')
        await page.wait_for_selector('.app-toast:has-text("Saved in this browser again")', timeout=15000)
        assert await page.evaluate('document.querySelector("#status-storage-item").hidden')

        # Reset to Default Workspace: the old copy is not opened again.
        await page.evaluate('() => { void window.__copyTest.shell.run("workspace.reset"); }')
        await page.wait_for_selector('#confirm-dialog[open]')
        async with page.expect_navigation():
            await page.click('#confirm-dialog-accept-button')
        await load()
        names = [name for name, _, _ in await page.evaluate(FILES)]
        assert 'big.md' not in names and 'other.md' not in names, names

        # Empty Everything: an empty workspace, after a reload too.
        await page.evaluate('() => { void window.__copyTest.shell.run("workspace.empty-everything"); }')
        await page.wait_for_selector('#confirm-dialog[open]')
        async with page.expect_navigation():
            await page.click('#confirm-dialog-accept-button')
        await load()
        assert await page.evaluate(FILES) == [], await page.evaluate(FILES)
        await page.reload(wait_until='domcontentloaded')
        await load()
        assert await page.evaluate(FILES) == []

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['an old localStorage copy moved over once', 'a workspace past 5 MB saved and reloaded',
                                     'a failing write said (notice, red item), unsaved kept marked', 'journaled as the page goes, there on the next load',
                                     'saving again said', 'Reset and Empty Everything leave no old copy'], 'runtimeErrors': 0}))


asyncio.run(main())
