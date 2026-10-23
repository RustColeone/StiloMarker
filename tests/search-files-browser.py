"""Browser regression: Find in Files (v0.2.30, editor/adapters/search-files.js).

Ctrl+Shift+F shows the Search section and its query (and not the open
file's find bar); a word selected in the editor becomes the query. Typed, it
searches every text file (images aside): grouped by file in path order, each
match's line and the words around it, the totals said; Chinese text too.
Match case, whole word and regular expressions narrow it; a pattern that
isn't one is said. A click opens the file at the match, in a 20,000-line file
too (the match selected and in view). Editing a file searches again. Replace
All asks, then replaces in every file (Workspace's write path); Undo puts it
back; where a file changed since, Undo leaves it and says so. A file of parts
(an album) is left out of Replace, and said. More than 20,000 results: the
first shown, said, and Replace asks with the true count. Typing just before
Replace is kept: it replaces in the file as it is then. No page errors.

Isolated: APIs are mocked and static files come from this checkout.
"""
import asyncio, json, mimetypes, os, re
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

FILES = {
    'c1': ('chapters/chapter1.md', '# Chapter 1\n\nThe lantern swayed in the wind.\nShe lit the Lantern again.\n灯笼在风中摇晃。\n'),
    'c2': ('chapters/chapter2.md', 'No lanterns here.\nlantern-bearer arrives.\n'),
    'notes': ('notes.md', 'Lantern: brass, old.\n'),
    'alb': ('refs.urldb', '[Gallery torchlight]\nurl = https://img.example/t.jpg\n'),
    'sim': ('sim.md', '\n'.join('step 15000 lantern=on' if i == 15000 else f'step {i} t={i * 0.01:.2f}' for i in range(20000))),
}


def project():
    nodes = {'root': {'id': 'root', 'kind': 'folder', 'name': 'Search test', 'children': ['chapters', 'notes', 'alb', 'sim', 'img'], 'expanded': True},
             'chapters': {'id': 'chapters', 'kind': 'folder', 'name': 'chapters', 'parentId': 'root', 'children': ['c1', 'c2'], 'expanded': True},
             'img': {'id': 'img', 'kind': 'file', 'parentId': 'root', 'name': 'lantern.png', 'content': 'data:image/png;base64,iVBORw0KGgo=', 'dirty': False}}
    for node_id, (path, content) in FILES.items():
        nodes[node_id] = {'id': node_id, 'kind': 'file', 'name': path.split('/')[-1], 'parentId': 'chapters' if path.startswith('chapters/') else 'root',
                          'content': content, 'dirty': False}
    return {'id': 'search-test', 'name': 'Search test', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'notes', 'nodes': nodes}


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1300, 'height': 800}, service_workers='block')
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
                payload = {'appVersion': '0.2.30', 'minSyncVersion': 117, 'accounts': False} if path == '/api/ping' else {'configured': False}
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
        content = lambda node_id: page.evaluate(f'__s.controller.getProject().nodes["{node_id}"].content')
        results = lambda: page.evaluate('''() => ({ summary: document.querySelector(".search-files-summary").textContent,
          files: [...document.querySelectorAll(".search-files-file .search-files-name")].map((e) => e.textContent),
          counts: [...document.querySelectorAll(".search-files-file .search-files-count")].map((e) => Number(e.textContent)),
          lines: [...document.querySelectorAll(".search-files-match")].map((e) => e.textContent) })''')

        async def search_for(text):
            await page.fill('.search-files-query', text)
            await page.wait_for_timeout(500)
            return await results()

        # Ctrl+Shift+F: the Search section and its query; not the open file's find bar.
        await page.click('#editor-content')
        await page.keyboard.press('Control+Shift+F')
        await page.wait_for_timeout(400)
        state = await page.evaluate('''() => ({ focused: document.activeElement?.classList.contains("search-files-query"),
          findBar: !document.querySelector("#editor-find-bar").hidden,
          section: !document.querySelector("#search-files-body").closest(".sidebar-panel")?.dataset.collapsed?.includes("true") })''')
        assert state == {'focused': True, 'findBar': False, 'section': True}, state
        checks.append('Ctrl+Shift+F: the Search section, its query focused, no find bar')

        # Every text file, grouped in path order, totals said; the image aside.
        r = await search_for('lantern')
        assert r['files'] == ['chapter1.md', 'chapter2.md', 'notes.md', 'sim.md'], r
        assert r['counts'] == [2, 2, 1, 1] and r['summary'].startswith('6 results in 4 files'), r
        assert any(line.startswith('3') and 'The lantern swayed' in line for line in r['lines']), r['lines']
        r = await search_for('灯笼')
        assert r['files'] == ['chapter1.md'] and r['counts'] == [1], r
        checks.append('every text file, grouped, with lines and totals; Chinese too')

        # Match case, whole word, a regular expression; one that isn't one.
        await search_for('lantern')
        await page.click('[data-option="caseSensitive"]'); await page.wait_for_timeout(300)
        assert (await results())['counts'] == [1, 2, 1], 'Lantern (capital) left out'
        await page.click('[data-option="caseSensitive"]')
        await page.click('[data-option="wholeWord"]'); await page.wait_for_timeout(300)
        r = await results()
        assert r['counts'] == [2, 1, 1, 1], r  # "lanterns" left out, "lantern-bearer" kept
        await page.click('[data-option="wholeWord"]')
        await page.click('[data-option="regex"]')
        r = await search_for('lantern[=-]')
        assert r['files'] == ['chapter2.md', 'sim.md'], r
        r = await search_for('lantern(')
        assert r['summary'] == 'Not a regular expression.' and not r['files'], r
        await page.click('[data-option="regex"]')
        checks.append('match case, whole word, regular expressions; a pattern that isn\'t one said')

        # A click opens the file at the match: in a 20,000-line file too.
        await search_for('lantern')
        await page.locator('.search-files-match', has_text='step 15000').click()
        await page.wait_for_timeout(800)
        opened = await page.evaluate('''() => { const text = __s.parts.getEditorText(); const sel = __s.parts.getEditorSelection();
          const rows = [...document.querySelectorAll("#editor-gutter .editor-gutter-line")]; const view = document.querySelector("#editor-content").getBoundingClientRect();
          const row = rows.find((r) => Number(r.dataset.line) === 15000); const r = row?.getBoundingClientRect();
          return { file: __s.controller.getActiveFile().name, selected: text.slice(sel.start, sel.end), inView: Boolean(r && r.top >= view.top && r.bottom <= view.bottom) }; }''')
        assert opened == {'file': 'sim.md', 'selected': 'lantern', 'inView': True}, opened
        checks.append('a click opens the file at the match, line 15,001 of a long file in view')

        # Editing a file searches again.
        await page.evaluate('__s.controller.updateContent("notes", "Lantern: brass, old.\\nA second lantern.\\n")')
        await page.wait_for_timeout(1200)
        assert (await results())['counts'] == [2, 2, 2, 1], 'searched again after an edit'
        checks.append('an edit searches again')

        # Replace All: asked, done in every file; Undo puts it back.
        before = {node_id: await content(node_id) for node_id in FILES}
        await page.fill('.search-files-replacement', 'torch')
        await page.click('.search-files-replace-all')
        await page.wait_for_selector('#confirm-dialog[open]')
        assert '7 matches in 4 files' in await page.text_content('#confirm-dialog-message')
        await page.click('#confirm-dialog-accept-button')
        await page.wait_for_timeout(800)
        after = {node_id: await content(node_id) for node_id in FILES}
        assert after['c1'] == before['c1'].replace('lantern', 'torch').replace('Lantern', 'torch'), after['c1']
        assert 'lantern' not in after['sim'].lower() and 'step 15000 torch=on' in after['sim'], 'the long file too'
        assert (await results())['summary'] == 'No results.' + ' Undo Replace'
        await page.click('.search-files-undo')
        await page.wait_for_timeout(800)
        assert {node_id: await content(node_id) for node_id in FILES} == before, 'Undo puts every file back'
        checks.append('Replace All asks, replaces in every file; Undo puts them back')

        # Undo leaves a file changed since, and says so.
        await page.fill('.search-files-query', 'brass')
        await page.wait_for_timeout(500)
        await page.fill('.search-files-replacement', 'iron')
        await page.click('.search-files-replace-all')
        await page.wait_for_selector('#confirm-dialog[open]')
        await page.click('#confirm-dialog-accept-button')
        await page.wait_for_timeout(600)
        await page.evaluate('__s.controller.updateContent("notes", "Lantern: iron, old, polished.\\nA second lantern.\\n")')
        await page.wait_for_timeout(300)
        await page.click('.search-files-undo')
        await page.wait_for_timeout(600)
        assert await content('notes') == 'Lantern: iron, old, polished.\nA second lantern.\n', 'the later change kept'
        toast = await page.evaluate('[...document.querySelectorAll(".toast, .app-toast, [role=status]")].map((t) => t.textContent).join(" | ")')
        assert 'changed since' in toast, toast
        checks.append('Undo leaves a file changed since, and says so')

        # A file of parts (an album) is left out of Replace, and said.
        r = await search_for('torchlight')
        assert r['files'] == ['refs.urldb'], r
        await page.fill('.search-files-replacement', 'candle')
        await page.click('.search-files-replace-all')
        await page.wait_for_timeout(600)
        toast = await page.evaluate('[...document.querySelectorAll(".toast, .app-toast, [role=status]")].map((t) => t.textContent).join(" | ")')
        assert 'refs.urldb is left out' in toast, toast
        assert 'torchlight' in await content('alb'), 'the album as it was'
        checks.append('an album is left out of Replace, and said')

        # More than 20,000 results: the first shown, said; Replace asks with the true count.
        r = await search_for('t')
        assert r['summary'].startswith('20,000+ results (the first 20,000 shown).'), r['summary']
        await page.click('.search-files-replace-all')
        await page.wait_for_selector('#confirm-dialog[open]')
        asked = int(re.search(r'Replace ([\d,]+) matches', await page.text_content('#confirm-dialog-message')).group(1).replace(',', ''))
        assert asked > 40000, asked
        await page.keyboard.press('Escape')
        await page.wait_for_timeout(300)
        checks.append(f'more than 20,000 results: the first shown, said; Replace asks for all {asked:,}')

        # Typing just before Replace is kept: it replaces in the file as it is then.
        await search_for('polished')
        await page.fill('.search-files-replacement', 'shiny')
        await page.evaluate('__s.controller.updateContent("notes", "New first line.\\nLantern: iron, old, polished.\\nA second lantern.\\n")')
        await page.click('.search-files-replace-all')
        await page.wait_for_selector('#confirm-dialog[open]')
        await page.click('#confirm-dialog-accept-button')
        await page.wait_for_timeout(600)
        assert await content('notes') == 'New first line.\nLantern: iron, old, shiny.\nA second lantern.\n', await content('notes')
        checks.append('typing just before Replace is kept')

        # A word selected in the editor becomes the query.
        await page.evaluate('''() => { const c = __s.controller; c.setActiveFile("c2"); }''')
        await page.wait_for_timeout(500)
        await page.evaluate('''() => { const ed = document.querySelector("#editor-content"); ed.focus(); __s.parts.setEditorSelection(3, 10); }''')
        await page.keyboard.press('Control+Shift+F')
        await page.wait_for_timeout(500)
        assert await page.input_value('.search-files-query') == 'lantern', await page.input_value('.search-files-query')
        checks.append('a selected word becomes the query')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}, ensure_ascii=False))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
