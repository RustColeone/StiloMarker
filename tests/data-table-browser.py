"""Browser regression: tables, and the plain-text types (v0.2.31).

A .csv opens with its table editor in the preview (extensions/data-table):
20,000 rows, only those in view drawn; the first row a header (kept in view,
found by itself); a cell's column summed up below it (sum, mean, min, max).
Typed over, a cell's record alone changes in the file (quoted where it has
to be); Enter and Tab move on; F2 keeps the value, Escape drops the edit;
typing into the blank row at the end adds it; text an input method sends
goes in too. A block copies as tab-separated text and pastes back; a right
click inserts and deletes rows and columns; Ctrl+Z undoes, Ctrl+Shift+Z
redoes. Someone else's edit shows at once, and an edit begun before a row
came in above still lands on its own row (the same row changed meanwhile:
nothing written, and said), and its undo puts back only what the grid did
(the row that came in stays); an undo that no longer fits stays to undo. A
cell over lines in a CRLF file, opened and left, changes nothing (edited,
it keeps its \r\n). A semicolon table stays one when its first line gains a
comma; renamed .tsv, it reads by tabs. With rows selected, the menu says
how many it inserts, and does. A .tsv reads by tabs. The source colours each
column.

.txt and .log are plain text (no Markdown colours, no toolbar, a plain
preview); .json is coloured, and its preview says it is valid (formatted)
or where it is not. No page errors.

Isolated: APIs are mocked and static files come from this checkout.
"""
import asyncio, json, mimetypes, os, statistics
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

SIM = 'step,t,x,energy,phase\n' + ''.join(f'{i},{i * 0.01:.2f},{(i % 97) - 48},{(i * 7919) % 1000 / 10:.1f},p{i % 3}\n' for i in range(20000))
SMALL = 'name,note,n\n"Smith, J","said ""hi""",3\nLee,plain,4\n'
FILES = {
    'sim': ('sim.csv', SIM),
    'small': ('small.csv', SMALL),
    'tsv': ('data.tsv', 'a\tb\n1,5\t2\n'),
    'crlf': ('lines.csv', 'a,b\r\n"one\r\ntwo",x\r\n'),
    'semi': ('semi.csv', 'a;b\n1;2\n'),
    'txt': ('notes.txt', '# not a heading\n**not bold**\n'),
    'log': ('run.log', 'INFO start\nWARN slow\n'),
    'json': ('config.json', '{"name": "sim", "steps": 20000, "ok": true, "tags": ["a", null]}'),
    'bad': ('broken.json', '{\n  "a": 1,\n  "b": \n}\n'),
}


def project():
    nodes = {'root': {'id': 'root', 'kind': 'folder', 'name': 'Tables', 'children': list(FILES), 'expanded': True}}
    for node_id, (name, content) in FILES.items():
        nodes[node_id] = {'id': node_id, 'kind': 'file', 'name': name, 'parentId': 'root', 'content': content, 'dirty': False}
    return {'id': 'tables', 'name': 'Tables', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'txt', 'nodes': nodes}


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1400, 'height': 900}, service_workers='block')
        await context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
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
                payload = {'appVersion': '0.2.31', 'minSyncVersion': 117, 'accounts': False} if path == '/api/ping' else {'configured': False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__s = { controller, shell, parts: editorParts, types: modules["file-types"], editor: modules.editor, table: modules["data-table"] };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__s) && document.querySelector("#editor-content .editor-line")')
        checks = []
        content = lambda node_id: page.evaluate(f'__s.controller.getProject().nodes["{node_id}"].content')

        async def open_file(node_id):
            await page.evaluate(f'__s.parts.openFileFromExplorer("{node_id}")')
            await page.wait_for_timeout(500)

        async def show_preview(node_id):
            await page.evaluate(f'() => {{ if (!__s.shell.frame.shown("preview")) __s.shell.frame.toggle("preview"); __s.editor.view.showPreview("{node_id}"); __s.shell.render(__s.controller.getProject()); }}')
            await page.wait_for_timeout(400)

        # Plain text: no Markdown colours, no toolbar, a plain preview.
        await open_file('txt')
        state = await page.evaluate('''() => ({ marks: document.querySelectorAll("#editor-content [class^='token-']").length,
          toolbar: document.querySelector("#editor-format-toolbar")?.hidden ?? true,
          types: ["notes.txt", "run.log", "config.json", "sim.csv", "data.TSV"].map((n) => __s.types.typeOf(n)?.id ?? null),
          creatable: __s.types.creatable().map((t) => t.create.label) })''')
        assert state['marks'] == 0 and state['toolbar'] is True, state
        assert state['types'] == ['text', 'text', 'json', 'datatable', 'datatable'], state['types']
        assert 'New Text File' in state['creatable'] and 'New Table' in state['creatable'], state['creatable']
        await show_preview('txt')
        plain = await page.evaluate('document.querySelector("#preview-output pre.preview-plain")?.textContent')
        assert plain == FILES['txt'][1], plain
        checks.append('.txt and .log are plain text: no Markdown colours, no toolbar')

        # JSON: coloured; the preview says valid (formatted) or where it is not.
        await open_file('json')
        assert await page.evaluate('document.querySelectorAll("#editor-content .token-json-key").length') == 4
        await show_preview('json')
        check = await page.evaluate('document.querySelector("#preview-output").innerText')
        assert 'Valid JSON' in check and '"steps": 20000' in check, check
        await open_file('bad')
        await show_preview('bad')
        check = await page.evaluate('document.querySelector("#preview-output").innerText')
        assert 'Not valid JSON' in check and 'line 4' in check, check
        checks.append('.json coloured; its preview: valid and formatted, or where it is not')

        # A .csv: the table editor in the preview, 20,000 rows, a few drawn; the header found.
        await open_file('sim')
        await page.wait_for_selector('.datatable .datatable-cell')
        grid = await page.evaluate('''() => ({ size: document.querySelector(".datatable-size").textContent,
          cells: document.querySelectorAll(".datatable-cell").length, header: document.querySelector(".datatable-header-toggle").checked,
          first: [...document.querySelectorAll(".datatable-cell")].slice(0, 5).map((c) => c.textContent) })''')
        assert grid['size'] == '20,001 rows × 5 columns' and grid['header'], grid
        assert grid['cells'] < 1500, f"only the rows in view are drawn ({grid['cells']} cells)"
        checks.append('a .csv opens in the table editor: 20,000 rows, only those in view drawn, its header found')

        async def click_cell(row, col):
            box = await page.evaluate(f'''() => {{ const s = document.querySelector(".datatable-scroll"); const b = s.getBoundingClientRect();
              const cells = [...document.querySelectorAll(".datatable-cell")].filter((c) => c.style.top === "{row * 24}px" && !c.classList.contains("is-pinned"));
              const c = cells.sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left))[{col}].getBoundingClientRect();
              return {{ x: c.left + c.width / 2, y: c.top + c.height / 2 }}; }}''')
            await page.mouse.click(box['x'], box['y'])
            await page.wait_for_timeout(150)

        # A cell's column summed up below it.
        await click_cell(2, 3)
        await page.wait_for_timeout(200)
        stats = await page.text_content('.datatable-stats')
        energy = [(i * 7919) % 1000 / 10 for i in range(20000)]
        said = dict(part.split(' ', 1) for part in stats.split(' · ')[1:5])
        assert stats.startswith('Column D (energy) · ') and stats.endswith('20,000 numbers'), stats
        for word, want in (('Sum', sum(energy)), ('Mean', statistics.fmean(energy)), ('Min', min(energy)), ('Max', max(energy))):
            assert abs(float(said[word]) - want) <= 1e-9 * max(1, abs(want)), (word, said[word], want)
        checks.append('a cell\'s column summed up: sum, mean, min, max')

        # Scrolled to row 15,000: drawn there, the header kept in view; quickly.
        took = await page.evaluate('''() => { const s = document.querySelector(".datatable-scroll"); const t = performance.now();
          s.scrollTop = 15000 * 24; s.dispatchEvent(new Event("scroll")); return performance.now() - t; }''')
        await page.wait_for_timeout(200)
        far = await page.evaluate('''() => ({ rows: [...document.querySelectorAll(".datatable-rownum")].map((r) => r.textContent),
          pinned: [...document.querySelectorAll(".datatable-cell.is-pinned")].map((c) => c.textContent).slice(0, 2) })''')
        assert '15001' in far['rows'] and far['pinned'] == ['step', 't'], far
        assert took < 200, f'drawing the rows in view took {took:.1f} ms'
        await page.evaluate('() => { const s = document.querySelector(".datatable-scroll"); s.scrollTop = 0; s.dispatchEvent(new Event("scroll")); }')
        checks.append(f'scrolled to row 15,001: drawn in {took:.1f} ms, the header kept in view')

        # Typed over: that record alone changes; Enter moves down; Tab right.
        before = await content('sim')
        await click_cell(1, 2)
        await page.keyboard.type('42')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        after = await content('sim')
        lines_before, lines_after = before.split('\n'), after.split('\n')
        assert lines_after[1] == '0,0.00,42,0.0,p0' and lines_after[2:] == lines_before[2:] and lines_after[0] == lines_before[0], lines_after[:3]
        sel = await page.evaluate('document.querySelector(".datatable-input").getAttribute("aria-label")')
        assert sel == 'Cell C3', sel
        await page.keyboard.press('Tab')
        await page.keyboard.type('x,y')
        await page.keyboard.press('Tab')
        await page.wait_for_timeout(300)
        assert (await content('sim')).split('\n')[2] == '1,0.01,-47,"x,y",p1', (await content('sim')).split('\n')[2]
        checks.append('typed over: that record alone changes (quoted as it must be); Enter and Tab move on')

        # F2 keeps the value; Escape drops the edit.
        await click_cell(3, 0)
        await page.keyboard.press('F2')
        await page.keyboard.type('5')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert (await content('sim')).split('\n')[3] == '25,0.02,-46,83.8,p2', (await content('sim')).split('\n')[3]
        await click_cell(3, 0)
        await page.keyboard.type('999')
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(200)
        assert (await content('sim')).split('\n')[3].startswith('25,'), 'Escape drops the edit'
        checks.append('F2 keeps the value; Escape drops the edit')

        # Undo and redo the grid's own edits.
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(300)
        assert (await content('sim')).split('\n')[3].startswith('2,0.02'), (await content('sim')).split('\n')[3]
        await page.keyboard.press('Control+Shift+z')
        await page.wait_for_timeout(300)
        assert (await content('sim')).split('\n')[3].startswith('25,'), 'redone'
        checks.append('Ctrl+Z undoes, Ctrl+Shift+Z redoes')

        # Small table: quoted values shown as they read; an input method's text goes in.
        await open_file('small')
        await page.wait_for_selector('.datatable-cell')
        shown = await page.evaluate('[...document.querySelectorAll(".datatable-cell")].map((c) => c.textContent).slice(0, 8)')
        assert shown[4] == 'Smith, J' and shown[5] == 'said "hi"', shown
        await click_cell(2, 1)
        await page.keyboard.insert_text('灯笼')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert await content('small') == 'name,note,n\n"Smith, J","said ""hi""",3\nLee,灯笼,4\n', await content('small')
        checks.append('quoted values read as written; text from an input method goes in')

        # The blank row at the end: typed into, it is added.
        await click_cell(3, 0)
        await page.keyboard.type('Kim')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert (await content('small')).endswith('Lee,灯笼,4\nKim,,\n'), await content('small')
        checks.append('typed into the blank row at the end: a row added')

        # A block copied as tab-separated text, pasted elsewhere.
        await click_cell(1, 0)
        await page.keyboard.down('Shift'); await click_cell(2, 1); await page.keyboard.up('Shift')
        await page.keyboard.press('Control+c')
        await page.wait_for_timeout(200)
        assert await page.evaluate('navigator.clipboard.readText()') == 'Smith, J\tsaid "hi"\nLee\t灯笼\n', await page.evaluate('navigator.clipboard.readText()')
        await click_cell(4, 1)
        await page.keyboard.press('Control+v')
        await page.wait_for_timeout(300)
        assert (await content('small')).endswith('Kim,,\n,"Smith, J","said ""hi"""\n,Lee,灯笼\n'), await content('small')
        checks.append('a block copies as tab-separated text and pastes back')

        # A right click: rows and columns inserted and deleted.
        await page.locator('.datatable-rownum', has_text='2').first.click(button='right')
        await page.locator('.datatable-menu button', has_text='Insert Row Above').click()
        await page.wait_for_timeout(300)
        assert (await content('small')).split('\n')[1] == ',,', (await content('small')).split('\n')[:3]
        await page.locator('.datatable-rownum', has_text='2').first.click(button='right')
        await page.locator('.datatable-menu button', has_text='Delete Row').click()
        await page.wait_for_timeout(300)
        assert (await content('small')).split('\n')[1] == '"Smith, J","said ""hi""",3'
        await page.locator('.datatable-col', has_text='B').first.click(button='right')
        await page.locator('.datatable-menu button', has_text='Delete Column').click()
        await page.wait_for_timeout(300)
        assert (await content('small')).split('\n')[:2] == ['name,n', '"Smith, J",3'], (await content('small')).split('\n')[:2]
        checks.append('a right click inserts and deletes rows and columns')

        # Someone else's edit shows at once; an edit begun before rows came in above lands on its own row.
        await page.evaluate('__s.controller.updateContent("small", "name,n\\nAda,1\\nBob,2\\nCy,3\\nDee,4\\n")')
        await page.wait_for_timeout(300)
        assert 'Dee' in await page.evaluate('[...document.querySelectorAll(".datatable-cell")].map((c) => c.textContent).join("|")')
        await click_cell(4, 1)
        await page.keyboard.press('F2')
        await page.keyboard.type('0')
        await page.evaluate('__s.controller.updateContent("small", "name,n\\nZed,9\\nAda,1\\nBob,2\\nCy,3\\nDee,4\\n")')
        await page.wait_for_timeout(200)
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(400)
        assert await content('small') == 'name,n\nZed,9\nAda,1\nBob,2\nCy,3\nDee,40\n', await content('small')
        # The same row changed meanwhile: nothing written, and said.
        await click_cell(2, 1)
        await page.keyboard.press('F2')
        await page.keyboard.type('5')
        await page.evaluate('__s.controller.updateContent("small", "name,n\\nZed,9\\nAda,7\\nBob,2\\nCy,3\\nDee,40\\n")')
        await page.wait_for_timeout(200)
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(400)
        assert await content('small') == 'name,n\nZed,9\nAda,7\nBob,2\nCy,3\nDee,40\n', await content('small')
        toast = await page.evaluate('[...document.querySelectorAll(".toast, .app-toast, [role=status]")].map((t) => t.textContent).join(" | ")')
        assert 'changed meanwhile' in toast, toast
        checks.append("someone else's edit shows at once; an edit begun before stays on its own row, or (the same row changed) is said")

        # Undo puts back only what the grid did: the row that came in meanwhile stays.
        steps = lambda: page.evaluate('__s.table.grids().find((g) => g.root.isConnected).steps()')
        await click_cell(1, 0)
        await page.keyboard.press('Escape')
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(400)
        assert await content('small') == 'name,n\nZed,9\nAda,7\nBob,2\nCy,3\nDee,4\n', await content('small')
        # The next step (the column deleted, before the file was replaced) no longer fits: it stays to undo.
        kept = (await steps())['undo']
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(400)
        assert await content('small') == 'name,n\nZed,9\nAda,7\nBob,2\nCy,3\nDee,4\n', await content('small')
        assert (await steps())['undo'] == kept, (kept, await steps())
        checks.append('undo puts back only what the grid did; a step that no longer fits stays')

        # With rows selected, the menu says how many it inserts, and does.
        await page.locator('.datatable-rownum', has_text='2').first.click()
        await page.locator('.datatable-rownum', has_text='3').first.click(modifiers=['Shift'])
        await page.locator('.datatable-rownum', has_text='2').first.click(button='right')
        labels = await page.evaluate('[...document.querySelectorAll(".datatable-menu button")].map((b) => b.textContent)')
        assert labels[:3] == ['Insert 2 Rows Above', 'Insert 2 Rows Below', 'Delete 2 Rows'], labels
        await page.locator('.datatable-menu button', has_text='Insert 2 Rows Above').click()
        await page.wait_for_timeout(300)
        assert (await content('small')).split('\n')[:4] == ['name,n', ',', ',', 'Zed,9'], (await content('small')).split('\n')[:4]
        checks.append('with rows selected, the menu says how many it inserts, and does')

        # A cell over lines in a CRLF file: opened and left, nothing changes; edited, it keeps its \r\n.
        await open_file('crlf')
        await page.wait_for_selector('.datatable-cell')
        await click_cell(1, 0)
        await page.keyboard.press('F2')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert await content('crlf') == 'a,b\r\n"one\r\ntwo",x\r\n', repr(await content('crlf'))
        await click_cell(1, 0)
        await page.keyboard.press('F2')
        await page.keyboard.type('!')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert await content('crlf') == 'a,b\r\n"one\r\ntwo!",x\r\n', repr(await content('crlf'))
        checks.append('a cell over lines in a CRLF file: left as it was, or edited with its \\r\\n')

        # A semicolon table stays one when its first line gains a comma; renamed .tsv, it reads by tabs.
        await open_file('semi')
        await page.wait_for_selector('.datatable-cell')
        await click_cell(0, 0)
        await page.keyboard.type('x,y')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(300)
        assert await content('semi') == 'x,y;b\n1;2\n', await content('semi')
        first = await page.evaluate('[...document.querySelectorAll(".datatable-cell")].map((c) => c.textContent).slice(0, 2)')
        assert first == ['x,y', 'b'], first
        await page.evaluate('__s.controller.rename("semi", "semi.tsv")')
        await page.wait_for_timeout(500)
        first = await page.evaluate('[...document.querySelectorAll(".datatable-cell")].map((c) => c.textContent).slice(0, 2)')
        assert first[0] == 'x,y;b', first
        checks.append('a semicolon table stays one as it gains a comma; renamed .tsv, it reads by tabs')

        # A .tsv by tabs; the source colours each column.
        await open_file('tsv')
        await page.wait_for_selector('.datatable-cell')
        shown = await page.evaluate('[...document.querySelectorAll(".datatable-cell")].map((c) => c.textContent).slice(0, 6)')
        assert shown[:2] == ['a', 'b'] and shown[3:5] == ['1,5', '2'], shown
        colours = await page.evaluate('[...document.querySelectorAll("#editor-content .token-table-col1")].map((s) => s.textContent)')
        assert colours == ['b', '2'], colours
        checks.append('a .tsv reads by tabs; the source colours each column')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}, ensure_ascii=False))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
