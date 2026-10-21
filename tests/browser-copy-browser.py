"""Browser regression for this browser's copies of workspaces (Workspace's, in IndexedDB).

Checks: the copy v0.2.19 kept (IndexedDB "mdnotes-workspace", with its
journal) is moved over once, as this browser's own workspace, and the old
database removed; so is one kept in localStorage before that; a workspace
past localStorage's ~5 MB is saved and survives a reload, nothing left
unsaved; a write that fails says so (a notice and a red status item), and
saving again says so too; while the copy can't be written, what changed is
journaled as the page goes (a change to the project's own fields too, like
the file it shows) and is there on the next load, and a page that changed
nothing since it opened journals nothing; a new project is a
copy of its own (the earlier one stays, the next load opens the new one);
Reset to Default Workspace and Empty Everything leave no old copy behind,
and another open window follows them (it reloads, writing nothing back).
Isolated: every API is mocked; no page errors.
"""
import asyncio, json, mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook
from helpers.browser_copy import POINTER, STORED_COPIES, STORED_NAMES

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
JOURNAL = 'mdnotes.journal.v2:local:copy-test'

# What v0.2.19 kept: one copy in IndexedDB "mdnotes-workspace" (store "copy"), and its journal.
SEED_V0219 = '''async (project) => {
  const db = await new Promise((resolve, reject) => { const q = indexedDB.open("mdnotes-workspace", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("copy"); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
  const tx = db.transaction("copy", "readwrite"); const store = tx.objectStore("copy");
  const { nodes, ...rest } = project;
  store.put({ ...rest, nodeIds: Object.keys(nodes), savedAt: Date.now() }, "project");
  for (const [id, node] of Object.entries(nodes)) store.put(node, "node:" + id);
  await new Promise((resolve) => { tx.oncomplete = resolve; });
  db.close();
  const journaled = { ...nodes.b, content: "# Other, journaled" };
  localStorage.setItem("mdnotes.journal.v1", JSON.stringify({ meta: { ...rest, nodeIds: Object.keys(nodes) }, whole: false, nodes: { b: journaled }, removed: [] }));
}'''
DATABASES = '() => indexedDB.databases().then((all) => all.map((db) => db.name))'


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        errors = []

        def watch(target):
            target.on('pageerror', lambda error: errors.append(str(error)))
            target.on('dialog', lambda dialog: asyncio.ensure_future(dialog.accept()))
            return target

        async def route(rt):
            parsed = urlparse(rt.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await rt.continue_(); return
            path = parsed.path
            if path == '/blank':
                await rt.fulfill(status=200, content_type='text/html', body='<!doctype html><title>blank</title>'); return
            if path.startswith('/api/'):
                payload = {'appVersion': 'dev', 'minSyncVersion': 117} if path == '/api/ping' else {}
                await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if not file.is_file():
                await rt.continue_(); return
            body = file.read_bytes() + (HOOK if path == '/app/main.js' else b'')
            await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
        await context.route('**/*', route)

        async def load(target):
            await target.wait_for_function('Boolean(window.__copyTest)', timeout=30000)
            await target.wait_for_timeout(300)

        # v0.2.19's copy (and its journal), seeded on a blank page of the same origin.
        page = watch(await context.new_page())
        await page.goto(BASE + '/blank')
        # (It names a file it doesn't have as shown, and a child it lacks: it still opens.)
        broken = project()
        broken['activeFileId'] = 'gone'
        broken['nodes']['root']['children'].append('ghost')
        await page.evaluate(SEED_V0219, broken)
        await page.goto(BASE, wait_until='domcontentloaded')
        await load(page)

        # Moved over once, journal and all, as this browser's own workspace; the old database removed.
        assert await page.evaluate(STORED_NAMES) == ['notes.md', 'other.md']
        assert await page.evaluate(POINTER) == {'open': 'local:copy-test', 'own': 'local:copy-test'}, await page.evaluate(POINTER)
        assert [content for name, content, _ in await page.evaluate(FILES) if name == 'other.md'] == ['r, journaled']
        assert await page.evaluate('[window.__copyTest.controller.getProject().activeFileId, window.__copyTest.controller.getProject().nodes.root.children]') == [None, ['a', 'b']]
        assert await page.evaluate('localStorage.getItem("mdnotes.journal.v1")') is None, 'the old journal is removed once moved'
        await page.wait_for_function('async () => !(await indexedDB.databases()).some((db) => db.name === "mdnotes-workspace")', timeout=5000)

        # Before v0.2.19 (localStorage), in a browser with nothing newer: moved over too.
        await page.goto(BASE + '/blank')
        await page.evaluate('() => new Promise((resolve) => { const q = indexedDB.deleteDatabase("mdnotes-workspaces"); q.onsuccess = q.onerror = q.onblocked = resolve; })')
        assert 'mdnotes-workspaces' not in await page.evaluate(DATABASES)
        await page.evaluate('(raw) => { localStorage.removeItem("mdnotes.copies.v1"); localStorage.setItem("mdnotes.project.v1", raw); }', json.dumps(project()))
        await page.goto(BASE, wait_until='domcontentloaded')
        await load(page)
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
        await load(page)
        files = await page.evaluate(FILES)
        assert [name for name, _, _ in files] == ['big.md', 'notes.md', 'other.md'], files
        assert files[1][1].endswith(' typed') and not any(dirty for _, _, dirty in files), files
        assert await page.evaluate('document.querySelector("#status-storage-item").hidden')
        # Nothing changed since it opened: the page journals nothing (not the whole project, past 5 MB).
        await page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))')
        assert await page.evaluate(f'localStorage.getItem("{JOURNAL}")') is None, 'nothing to journal'

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

        # As the page goes, what changed is journaled (localStorage): the next load has it,
        # a change to the project's own fields too (the file it shows).
        await page.evaluate('() => window.__copyTest.controller.setActiveFile("b")')
        await page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }))')
        assert await page.evaluate(f'Boolean(localStorage.getItem("{JOURNAL}"))'), 'journaled'
        second = watch(await context.new_page())
        await second.goto(BASE, wait_until='domcontentloaded')
        await load(second)
        notes = [content for name, content, _ in await second.evaluate(FILES) if name == 'notes.md'][0]
        assert notes.endswith(' broken'), notes
        assert await second.evaluate('window.__copyTest.controller.getProject().activeFileId') == 'b', 'the file shown, journaled'
        await second.evaluate('() => window.__copyTest.controller.setActiveFile("a")')
        assert await second.evaluate(f'localStorage.getItem("{JOURNAL}")') is None, 'the journal is gone once written'
        await second.close()

        # Writing works again: said with a toast, the item gone.
        await page.evaluate(MEND_WRITES)
        await page.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " mended"); }')
        await page.wait_for_selector('.app-toast:has-text("Saved in this browser again")', timeout=15000)
        assert await page.evaluate('document.querySelector("#status-storage-item").hidden')

        # A journal goes once a later save lands (left, a crash would bring its older text back).
        await page.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " hidden"); }')
        assert await page.evaluate(f"() => {{ window.dispatchEvent(new PageTransitionEvent('pagehide', {{ persisted: true }})); "
                                   f"return Boolean(localStorage.getItem('{JOURNAL}')); }}"), 'journaled as the page hides'
        await page.wait_for_function(f'!localStorage.getItem("{JOURNAL}")', timeout=5000)
        await page.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " later"); }')
        await page.wait_for_function('!Object.values(window.__copyTest.controller.getProject().nodes).some((n) => n.dirty)', timeout=15000)
        later = watch(await context.new_page())
        await later.goto(BASE, wait_until='domcontentloaded')
        await load(later)
        assert (await later.evaluate(FILES))[1][1].endswith('hidden later'), await later.evaluate(FILES)
        await later.close()

        # A new project is a copy of its own: the earlier one stays; the next load opens the new one.
        await page.evaluate('''() => { const c = window.__copyTest.controller, p = c.getProject();
            c.replaceProject({ ...p, id: "second", name: "Second", activeFileId: "a", nodes: { root: { ...p.nodes.root, children: ["a"] }, a: p.nodes.a } }); }''')
        for _ in range(100):
            if (await page.evaluate(POINTER)).get('open') == 'local:second':
                break
            await page.wait_for_timeout(100)
        assert await page.evaluate(POINTER) == {'open': 'local:second', 'own': 'local:second'}, await page.evaluate(POINTER)
        copies = await page.evaluate(STORED_COPIES)
        assert copies['local:copy-test'] == ['big.md', 'notes.md', 'other.md'] and copies['local:second'] == ['notes.md'], copies
        await page.reload(wait_until='domcontentloaded')
        await load(page)
        assert await page.evaluate('window.__copyTest.controller.getProject().id') == 'second'

        # Reset to Default Workspace: no old copy is opened again, and another
        # window (with an edit waiting) follows, writing nothing back.
        other = watch(await context.new_page())
        await other.goto(BASE, wait_until='domcontentloaded')
        await load(other)
        await other.evaluate('() => { const c = window.__copyTest.controller; c.updateContent("a", c.getProject().nodes.a.content + " late"); }')
        await page.evaluate('() => { void window.__copyTest.shell.run("workspace.reset"); }')
        await page.wait_for_selector('#confirm-dialog[open]')
        async with other.expect_navigation(), page.expect_navigation():
            await page.click('#confirm-dialog-accept-button')
        await load(page)
        await load(other)
        for target in (page, other):
            files = await target.evaluate(FILES)
            assert not {'big.md', 'other.md'} & {name for name, _, _ in files} and not any(content.endswith(' late') for _, content, _ in files), files
        await other.close()

        # Empty Everything: an empty workspace, after a reload too; no other copy kept.
        await page.evaluate('() => { void window.__copyTest.shell.run("workspace.empty-everything"); }')
        await page.wait_for_selector('#confirm-dialog[open]')
        async with page.expect_navigation():
            await page.click('#confirm-dialog-accept-button')
        await load(page)
        assert await page.evaluate(FILES) == [], await page.evaluate(FILES)
        await page.reload(wait_until='domcontentloaded')
        await load(page)
        assert await page.evaluate(FILES) == []
        copies = await page.evaluate(STORED_COPIES)
        assert list(copies.values()) == [[]], copies

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ["v0.2.19's copy and journal moved over once, the old database removed; one naming nodes it lacks still opens", 'an older localStorage copy moved over once',
                                     'a workspace past 5 MB saved and reloaded', 'a failing write said (notice, red item), unsaved kept marked',
                                     "journaled as the page goes (the file shown too), there on the next load; nothing journaled when nothing changed", 'saving again said',
                                     'a journal goes once a later save lands',
                                     'a new project is a copy of its own; the next load opens it',
                                     'Reset and Empty Everything leave no old copy; another window follows, writing nothing back'], 'runtimeErrors': 0}))


asyncio.run(main())
