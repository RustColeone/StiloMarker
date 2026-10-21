"""Browser regression: this browser's windows on one of its workspaces are
linked live (O1 of the stability review, "Live in both").

Two windows on the in-browser workspace: typing in either shows in the other
(both ways; both typing in one file at once ends in the same text in both);
a file made in one appears in the other; only the window that opened the
workspace first keeps this browser's copy, which has the other window's
typing, and the other window's changed marks clear once it is saved; the
status bar says "2 windows". The first window closes: the other takes over
(its typing is saved from then on), and a third window joins it; a window
reloaded rejoins. The experiment that found it (E2): an edit in each
window, then a new window, which has both. Alone, a window starts nothing.
Isolated: every API mocked; no page errors.
"""
import asyncio, json, mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook
from helpers.browser_copy import STORED_COPIES

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
HOOK = app_hook('window.__w = { shell, controller, sync: modules.sync };')


def project():
    return {'id': 'linked', 'name': 'Linked', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'a', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Linked', 'children': ['a', 'b'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes\n\nStart.', 'dirty': False},
        'b': {'id': 'b', 'kind': 'file', 'parentId': 'root', 'name': 'other.md', 'content': '# Other', 'dirty': False}}}


TEXT = '(name) => Object.values(window.__w.controller.getProject().nodes).find((n) => n.name === name)?.content ?? null'
DIRTY = '() => Object.values(window.__w.controller.getProject().nodes).filter((n) => n.dirty).map((n) => n.name)'
STATE = '() => window.__w.sync.windows.state()'
STORED = '''async (name) => { const q = indexedDB.open("mdnotes-workspaces"); const db = await new Promise((r) => { q.onsuccess = () => r(q.result); });
  const nodes = await new Promise((r) => { const g = db.transaction("nodes").objectStore("nodes").getAll(IDBKeyRange.bound(["local:linked"], ["local:linked", []])); g.onsuccess = () => r(g.result); });
  db.close(); return nodes.find((n) => n.name === name)?.content ?? null; }'''


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1100, 'height': 760}, service_workers='block')
        errors = []
        # The in-browser workspace, kept by an older version (moved over on the first start).
        await context.add_init_script('if (!localStorage.getItem("mdnotes.copies.v1") && !localStorage.getItem("mdnotes.project.v1"))'
                                      ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');')

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

        async def window():
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('dialog', lambda dialog: asyncio.ensure_future(dialog.accept()))
            await page.goto(BASE, wait_until='domcontentloaded')
            await page.wait_for_function('Boolean(window.__w)', timeout=30000)
            return page

        async def type_at_end(page, text, file='notes.md'):
            await page.locator('#explorer-tree .tree-row', has_text=file).first.click()
            await page.wait_for_timeout(150)
            await page.click('#editor-content')
            await page.keyboard.press('Control+End')
            await page.keyboard.type(text)

        async def until(page, js, arg=None, timeout=10000):
            await page.wait_for_function(js, arg=arg, timeout=timeout)

        a = await window()
        await until(a, '() => window.__w.sync.windows.state().leading')
        await a.wait_for_timeout(300)
        state = await a.evaluate(STATE)
        assert state['leading'] and not state['linked'] and state['others'] == 0, f'alone, a window starts nothing: {state}'
        assert await a.evaluate('document.querySelector("#status-windows-item").hidden'), 'no windows item alone'

        b = await window()
        for page in (a, b):
            await until(page, '() => window.__w.sync.windows.state().linked')
        assert (await b.evaluate(STATE))['leading'] is False

        # Each one's typing in the other.
        await type_at_end(a, ' FROM-A')
        await until(b, f'() => ({TEXT})("notes.md").endsWith(" FROM-A")')
        await type_at_end(b, ' FROM-B')
        await until(a, f'() => ({TEXT})("notes.md").endsWith(" FROM-A FROM-B")')

        # Both in one file at once: the same text in both.
        await asyncio.gather(type_at_end(a, ' a1a2a3', 'other.md'), type_at_end(b, ' b1b2b3', 'other.md'))
        await a.wait_for_timeout(1500)
        text_a, text_b = await a.evaluate(TEXT, 'other.md'), await b.evaluate(TEXT, 'other.md')
        # The same text in both, with every letter each typed, in the order typed (typing at one spot interleaves).
        def holds(text, typed):
            rest = iter(text)
            return all(letter in rest for letter in typed)
        assert text_a == text_b and len(text_a) == len('# Other') + 14 and holds(text_a, ' a1a2a3') and holds(text_a, ' b1b2b3'), (text_a, text_b)

        # A file made in the follower appears in the other window.
        await b.evaluate('''() => { const c = window.__w.controller; c.createFile(c.getProject().rootId, "made-in-b.md", "# B made this");
            void window.__w.sync.publish({ type: "create-file", parentPath: "", name: "made-in-b.md", content: "# B made this" }); }''')
        await until(a, f'() => ({TEXT})("made-in-b.md") === "# B made this"')

        # Only the first window keeps this browser's copy; it has b's typing, and b's marks clear once saved.
        await until(a, f'async () => ((await ({STORED})("notes.md")) ?? "").endsWith(" FROM-A FROM-B")')
        await until(b, f'() => ({DIRTY})().length === 0', timeout=20000)
        for page in (a, b):
            assert not await page.evaluate('document.querySelector("#status-windows-item").hidden')
            assert '2 windows' in await page.locator('#status-windows-item').inner_text()

        # The first window closes: b takes over and saves from then on; a third window joins b.
        await a.close()
        await until(b, '() => { const s = window.__w.sync.windows.state(); return s.leading && s.linked; }')
        await type_at_end(b, ' AFTER')
        await until(b, f'async () => ((await ({STORED})("notes.md")) ?? "").endsWith(" AFTER")')
        c = await window()
        await until(c, '() => window.__w.sync.windows.state().linked')
        assert (await c.evaluate(TEXT, 'notes.md')).endswith(' FROM-A FROM-B AFTER')
        await type_at_end(c, ' FROM-C')
        await until(b, f'() => ({TEXT})("notes.md").endsWith(" AFTER FROM-C")')

        # A window reloaded rejoins.
        await c.reload(wait_until='domcontentloaded')
        await c.wait_for_function('Boolean(window.__w)', timeout=30000)
        await until(c, '() => window.__w.sync.windows.state().linked')
        await type_at_end(c, ' AGAIN')
        await until(b, f'() => ({TEXT})("notes.md").endsWith(" FROM-C AGAIN")')

        # E2: an edit in each window, then a new window has both.
        await type_at_end(b, ' E2-B', 'other.md')
        await type_at_end(c, ' E2-C', 'made-in-b.md')
        await b.wait_for_timeout(1500)
        d = await window()
        await d.wait_for_timeout(500)
        assert (await d.evaluate(TEXT, 'other.md')).endswith(' E2-B') and (await d.evaluate(TEXT, 'made-in-b.md')).endswith(' E2-C')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['alone, a window starts nothing', "each window's typing shows in the other", 'both typing in one file: the same text in both',
                                     'a file made in one appears in the other', "only the first keeps the copy, with the other's typing; the other's marks clear",
                                     'the status bar says 2 windows', 'the first closes: the other takes over and saves', 'a third window joins',
                                     'a reloaded window rejoins', 'E2: an edit in each, then a new window has both'], 'runtimeErrors': 0}))


asyncio.run(main())
