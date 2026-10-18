"""Browser regression for URL albums in the page, end to end in a local
workspace: entries listed under their album, an entry opened and edited on its
own, the table and entry previews, highlighting and the toolbar's Entry
snippet, adding, renaming, deleting, copying and dragging entries between
albums, and an entry dropped into Markdown as an image. Static files from this
checkout; the album's text is read back from the browser's saved copy."""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
REFS = "[Castle]\nurl = https://img.example/castle.jpg\ndescription = Old keep\n\n[River]\nurl = https://img.example/river.jpg\n"
MORE = "[Forest]\nurl = https://img.example/forest.jpg\n"


def project():
    return {'id': 'album', 'name': 'Novel', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'n', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['r', 'm', 'n'], 'expanded': True},
        'r': {'id': 'r', 'kind': 'file', 'parentId': 'root', 'name': 'refs.urldb', 'content': REFS, 'dirty': False, 'expanded': True},
        'm': {'id': 'm', 'kind': 'file', 'parentId': 'root', 'name': 'more.urldb', 'content': MORE, 'dirty': False, 'expanded': True},
        'n': {'id': 'n', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes\n', 'dirty': False}}}


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
        page = await context.new_page(); errors = []; checks = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if os.environ.get('STILO_CPU_SLOWDOWN'):  # e.g. 6: reproduces docs/ISSUES.md open item 3
            await (await context.new_cdp_session(page)).send('Emulation.setCPUThrottlingRate', {'rate': float(os.environ['STILO_CPU_SLOWDOWN'])})
        await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                   ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                                   ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "hidden", showFormatToolbar: true})); }')

        async def route(rt):
            parsed = urlparse(rt.request.url)
            if parsed.netloc == 'img.example':
                await rt.fulfill(status=404, body=''); return
            if parsed.netloc != urlparse(BASE).netloc:
                await rt.continue_(); return
            if parsed.path.startswith('/api/'):
                await rt.fulfill(status=200, content_type='application/json', body='{}'); return
            file = ROOT / (parsed.path.lstrip('/') or 'index.html')
            if not file.is_file():
                await rt.continue_(); return
            await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=file.read_bytes())
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='networkidle')

        async def saved(name):
            return await page.evaluate('''(name) => { window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
              const project = JSON.parse(localStorage.getItem("mdnotes.project.v1"));
              return Object.values(project.nodes).find((node) => node.name === name)?.content ?? null; }''', name)

        def entry_row(album, name):
            return page.locator(f'.tree-row-derived[data-node-id="{album}"]:has(.tree-label:text-is("{name}"))')

        async def entry_names(album):
            return await page.locator(f'.tree-row-derived[data-node-id="{album}"] .tree-label').all_inner_texts()

        async def menu(locator, label):
            await locator.click(button='right')
            await page.locator('#explorer-context-menu').get_by_text(label, exact=True).click()

        editor = page.locator('#editor-content')
        preview = page.locator('#preview-output')

        # Entries are listed under their album.
        await page.wait_for_selector('.tree-row-derived', timeout=15000)
        assert await entry_names('r') == ['Castle', 'River'], await entry_names('r')
        assert await entry_names('m') == ['Forest']
        checks.append('entries listed under their album')

        # An entry opens on its own: its fields in the source, its image in the preview.
        await entry_row('r', 'Castle').click()
        await page.wait_for_function('document.querySelector("#editor-content").innerText.includes("description = Old keep")')
        assert 'castle.jpg' in await editor.inner_text() and '[River]' not in await editor.inner_text()
        await page.wait_for_selector('#preview-output .remote-asset-preview', timeout=5000)
        assert 'Castle' in await preview.inner_text()
        assert await page.locator('#editor-content .token-urldb-key').count() >= 1, 'the entry is highlighted'
        checks.append('entry opens on its own, with its preview')

        # Editing the entry writes it back into the album, the other entries kept.
        await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' tower')
        await page.wait_for_timeout(600)
        refs = await saved('refs.urldb')
        assert 'description = Old keep tower' in refs and '[River]' in refs and refs.count('[Castle]') == 1, refs
        checks.append('editing an entry writes the album')

        # The album opens whole: its text, a table preview and the Entry snippet.
        await page.dblclick('.tree-row[title="refs.urldb"]')
        await page.wait_for_function('document.querySelector("#editor-content").innerText.includes("[River]")')
        await page.locator('.tree-row[title="refs.urldb"]').click(button='right')
        await page.locator('#explorer-context-menu').get_by_text('Open Preview', exact=True).click()
        await page.wait_for_selector('#preview-output .urldb-table', timeout=5000)
        table = await page.locator('#preview-output .urldb-table').inner_text()
        assert 'Castle' in table and 'River' in table and 'river.jpg' in table, table
        assert await page.locator('#editor-content .token-urldb-name').count() == 2
        await editor.click(); await page.keyboard.press('Control+End')
        await page.locator('[data-toolbar-button-id="urldb-entry"]').dispatch_event('mousedown')
        await page.wait_for_function('document.querySelector("#editor-content").innerText.includes("[Entry Name]")')
        await page.keyboard.press('Control+z')
        await page.wait_for_function('!document.querySelector("#editor-content").innerText.includes("[Entry Name]")')
        checks.append('album text, table preview, Entry snippet')

        # Add an entry through the album's menu.
        await menu(page.locator('.tree-row[title="refs.urldb"]'), 'Add Album Entry')
        await page.wait_for_selector('#form-dialog[open]')
        await page.fill('#form-dialog-field-name', 'Tower')
        await page.fill('#form-dialog-field-url', 'https://img.example/tower.jpg')
        await page.fill('#form-dialog-field-description', 'Tall')
        await page.click('#form-dialog-submit-button')
        await page.wait_for_function('[...document.querySelectorAll(\'.tree-row-derived[data-node-id="r"] .tree-label\')].some((e) => e.textContent === "Tower")')
        assert await entry_names('r') == ['Castle', 'River', 'Tower']
        assert '[Tower]\nurl = https://img.example/tower.jpg\ndescription = Tall' in await saved('refs.urldb')
        checks.append('add an entry')

        # Rename and delete an entry.
        await menu(entry_row('r', 'River'), 'Rename')
        await page.wait_for_selector('#input-dialog[open]')
        await page.fill('#input-dialog-input', 'Stream')
        await page.click('#input-dialog-submit-button')
        await page.wait_for_function('[...document.querySelectorAll(\'.tree-row-derived[data-node-id="r"] .tree-label\')].some((e) => e.textContent === "Stream")')
        refs = await saved('refs.urldb')
        assert '[Stream]\nurl = https://img.example/river.jpg' in refs and '[River]' not in refs, refs
        await menu(entry_row('r', 'Tower'), 'Delete')
        await page.wait_for_selector('#confirm-dialog[open]')
        assert 'Tower' in await page.locator('#confirm-dialog-message').inner_text()
        await page.click('#confirm-dialog-accept-button')
        await page.wait_for_function('![...document.querySelectorAll(\'.tree-row-derived[data-node-id="r"] .tree-label\')].some((e) => e.textContent === "Tower")')
        assert '[Tower]' not in await saved('refs.urldb')
        checks.append('rename and delete an entry')

        # Copy an entry and paste it into the other album.
        await menu(entry_row('r', 'Castle'), 'Copy')
        await menu(page.locator('.tree-row[title="more.urldb"]'), 'Paste')
        await page.wait_for_function('[...document.querySelectorAll(\'.tree-row-derived[data-node-id="m"] .tree-label\')].some((e) => e.textContent === "Castle")')
        more = await saved('more.urldb')
        assert '[Forest]' in more and '[Castle]\nurl = https://img.example/castle.jpg' in more, more
        assert '[Castle]' in await saved('refs.urldb'), 'copying keeps the original'
        checks.append('copy and paste an entry between albums')

        # Drag an entry from one album onto an entry of the other: it moves.
        await entry_row('r', 'Stream').drag_to(entry_row('m', 'Forest'))
        await page.wait_for_function('[...document.querySelectorAll(\'.tree-row-derived[data-node-id="m"] .tree-label\')].some((e) => e.textContent === "Stream")')
        assert 'Stream' not in await entry_names('r'), await entry_names('r')
        assert '[Stream]' in await saved('more.urldb') and '[Stream]' not in await saved('refs.urldb')
        checks.append('drag an entry to the other album')

        # Drop an entry into a Markdown file: an image reference.
        await page.dblclick('.tree-row[title="notes.md"]')
        await page.wait_for_function('document.querySelector("#editor-content").innerText.includes("# Notes")')
        await entry_row('m', 'Forest').drag_to(editor)
        await page.wait_for_function('document.querySelector("#editor-content").innerText.includes("forest.jpg")')
        notes = await editor.inner_text()
        assert '![Forest](https://img.example/forest.jpg)' in notes, notes
        checks.append('entry dropped into Markdown as an image')

        assert not errors, errors

        # Without the extension (its module not started) the app still runs:
        # an album is an ordinary text file, with no entries and no album menu.
        bare = await browser.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
        async def bare_route(rt):
            if urlparse(rt.request.url).path == '/app/extensions.js':
                await rt.fulfill(status=200, content_type='text/javascript', body='export default Object.freeze([]);'); return
            await route(rt)
        await bare.route('**/*', bare_route)
        page2 = await bare.new_page(); bare_errors = []
        page2.on('pageerror', lambda e: bare_errors.append(str(e)))
        await page2.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                    ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                                    ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "hidden"})); }')
        await page2.goto(BASE, wait_until='networkidle')
        await page2.dblclick('.tree-row[title="refs.urldb"]')
        await page2.wait_for_function('document.querySelector("#editor-content").innerText.includes("[River]")')
        assert await page2.locator('.tree-row-derived').count() == 0
        await page2.locator('.tree-row[title="refs.urldb"]').click(button='right')
        assert await page2.locator('#explorer-context-menu').get_by_text('Add Album Entry').count() == 0
        assert not bare_errors, bare_errors
        checks.append('the app runs without the extension')
        await browser.close()
        print(json.dumps({'checks': checks, 'runtimeErrors': 0}))


asyncio.run(main())
