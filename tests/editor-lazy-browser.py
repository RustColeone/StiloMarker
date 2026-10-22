"""Browser regression: a very long file (O2b, v0.2.28): only the lines in view
are in the page (lazy rendering, editor-window.js), and everything still
works on the whole text.

A 20,000-line, ~470 KB file (a simulation's output, with a ``` fence in the
middle): it opens with a few hundred lines in the page; a keystroke's own work
and key to screen stay short; the gutter's numbers are the lines'; scrolled to
the middle and to the end, the lines shown are the model's at that place, and
a line inside the fence is highlighted as code. A caret scrolled out of view
comes back on the next key, and the key lands there. Select All keeps the page
small; copying it copies the whole text; typing over it replaces it, and undo
brings it all back. A selection made with Shift and a click thousands of lines
apart deletes exactly that range. Find reaches a match near the end. Someone
else's edit while scrolled away keeps the view where it is. With word wrap off
too. After every step the editor's text is the model's, and the lines in the
page are the model's lines at their numbers. No page errors.

Isolated: APIs are mocked and static files come from this checkout.
"""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')
LINES = 20000


def sim_output():
    out = []
    for i in range(LINES):
        if i == 10000: out.append('```text')
        elif i == 10050: out.append('```')
        elif i % 2500 == 0: out.append(f'## step {i}')
        else: out.append(f'{i:06d} t={i * 0.01:.3f} x={(i * 7) % 1000:.4f} ok')
    out[15000] = 'NEEDLE 15000 here'
    return '\n'.join(out)


# The page against the model: the editor's text, the lines in the page and their gutter rows.
STATE = '''() => {
  const ed = document.querySelector("#editor-content");
  const model = __lazy.controller.getActiveFile().content;
  const lines = model.split("\\n");
  const els = [...ed.children];
  const rows = [...document.querySelectorAll("#editor-gutter .editor-gutter-line")];
  const view = ed.getBoundingClientRect();
  const shown = els.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > view.top + 2 && r.top < view.bottom - 2; });
  const numberOf = (el) => Number(rows[els.indexOf(el)]?.dataset.line);
  const bad = els.filter((el, k) => rows[k] === undefined || el.textContent !== lines[Number(rows[k].dataset.line)]
    || rows[k].textContent.replace(/[◦●]/g, "") !== String(Number(rows[k].dataset.line) + 1)).length;
  const firstShown = shown[0];
  const misaligned = shown.filter((el) => { const row = rows[els.indexOf(el)]; return !row || Math.abs(row.getBoundingClientRect().top - el.getBoundingClientRect().top) > 1.5; }).length;
  const sel = __lazy.parts.getEditorSelection();
  return { textOk: __lazy.parts.getEditorText() === model, inPage: els.length, rows: rows.length, bad, misaligned,
    stray: ed.childNodes.length - ed.children.length, firstShown: firstShown ? numberOf(firstShown) : null,
    lastShown: shown.length ? numberOf(shown[shown.length - 1]) : null, lineCount: lines.length, sel, scrollTop: ed.scrollTop }; }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1200, 'height': 700}, service_workers='block')
        await context.grant_permissions(['clipboard-read', 'clipboard-write'])
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        project = {'id': 'lazy-test', 'name': 'Lazy test', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'notes',
                   'nodes': {'root': {'id': 'root', 'kind': 'folder', 'name': 'Lazy test', 'children': ['notes'], 'expanded': True},
                             'notes': {'id': 'notes', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes', 'dirty': False}}}
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project)) + ');')

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                payload = {'appVersion': '0.2.28', 'minSyncVersion': 117, 'accounts': False} if path == '/api/ping' else {'configured': False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__lazy = { controller, shell, parts: editorParts };')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__lazy)')
        checks = []
        text = sim_output()
        model_lines = text.split('\n')

        async def state(step, expect_text=None):
            await page.wait_for_timeout(250)
            s = await page.evaluate(STATE)
            ok = s['textOk'] and s['bad'] == 0 and s['misaligned'] == 0 and s['stray'] == 0 and s['rows'] == s['inPage'] and s['inPage'] < 600
            if expect_text is not None:
                ok = ok and await page.evaluate('__lazy.controller.getActiveFile().content') == expect_text
            assert ok, f'{step}: {json.dumps(s)}'
            return s

        async def scroll_to(fraction):
            await page.evaluate(f'(() => {{ const ed = document.querySelector("#editor-content"); ed.scrollTop = (ed.scrollHeight - ed.clientHeight) * {fraction}; }})()')
            await page.wait_for_timeout(300)

        def offset_of(line, col=0):
            return sum(len(model_lines[i]) + 1 for i in range(line)) + col

        async def caret(offset):
            await page.evaluate('(at) => { document.querySelector("#editor-content").focus(); __lazy.parts.setEditorSelection(at, at); }', offset)
            await page.wait_for_timeout(150)

        # Opening: a few hundred lines in the page at most.
        await page.evaluate('(text) => { const c = __lazy.controller; c.createFile(c.getProject().rootId, "sim.md", text); }', text)
        await page.locator('#explorer-tree .tree-row', has_text='sim.md').first.click()
        await page.wait_for_function('__lazy.controller.getActiveFile()?.name === "sim.md" && document.querySelectorAll("#editor-content > .editor-line").length > 10', timeout=30000)
        s = await state('opened')
        assert s['lineCount'] == LINES and s['firstShown'] == 0, s
        checks.append(f'opened: {s["inPage"]} of {LINES} lines in the page')

        # Typing near the top: a keystroke's own work and key to screen stay short.
        await caret(offset_of(3, 6))
        await page.evaluate('''() => { window.__ev = []; new PerformanceObserver((list) => { for (const e of list.getEntries())
          if (["keydown", "input"].includes(e.name)) window.__ev.push([e.name, e.processingEnd - e.processingStart, e.duration]); }).observe({ type: "event", durationThreshold: 0 }); }''')
        await page.keyboard.type('quick brown fox', delay=120)
        await page.wait_for_timeout(600)
        ev = await page.evaluate('window.__ev')
        work = sorted(w for n, w, d in ev if n == 'input')
        screen = sorted(d for n, w, d in ev if n == 'keydown')
        # (Before v0.2.28 a key took ~1.5 s to reach the screen in a file this size.)
        assert len(work) >= 10 and work[len(work) // 2] < 40 and screen[len(screen) // 2] < 150, (work, screen)
        model_lines[3] = model_lines[3][:6] + 'quick brown fox' + model_lines[3][6:]
        await state('typed near the top', '\n'.join(model_lines))
        checks.append(f'typing: {round(work[len(work) // 2], 1)} ms of work, {screen[len(screen) // 2]} ms to the screen a key')

        # Scrolled to the middle and to the end: the model's lines at that place.
        await scroll_to(0.5)
        s = await state('scrolled to the middle')
        assert 8000 < s['firstShown'] < 12000, s
        await page.evaluate('__lazy.parts.revealEditorLine(10010)')
        await page.wait_for_timeout(300)
        code = await page.evaluate('''() => { const rows = [...document.querySelectorAll("#editor-gutter .editor-gutter-line")];
          const els = [...document.querySelector("#editor-content").children];
          const at = (n) => els[rows.findIndex((r) => Number(r.dataset.line) === n)];
          return [Boolean(at(10010)?.querySelector(".token-code-block")), Boolean(at(10060)?.querySelector(".token-code-block"))]; }''')
        assert code == [True, False], f'inside the fence highlighted as code, after it not: {code}'
        await scroll_to(1.0)
        s = await state('scrolled to the end')
        assert s['lastShown'] == LINES - 1, s
        checks.append('scrolled: the lines shown are the model\'s, with their numbers; a fence highlights across the page\'s edge')

        # A caret scrolled out of view: the next key brings it back and lands there.
        await caret(offset_of(5, 2))
        await scroll_to(1.0)
        await page.keyboard.type('Z')
        await page.wait_for_timeout(300)
        model_lines[5] = model_lines[5][:2] + 'Z' + model_lines[5][2:]
        s = await state('a key at a caret out of view', '\n'.join(model_lines))
        assert s['firstShown'] is not None and s['firstShown'] <= 5 <= s['lastShown'], s
        checks.append('a caret out of view: the key brings it back, and lands there')

        # Select All: the page stays small; copy has the whole text; typing replaces it; undo brings it back.
        full = '\n'.join(model_lines)
        await page.evaluate('''() => { window.__copied = null; document.addEventListener("copy", (e) => { window.__copied = e.clipboardData.getData("text/plain"); }); }''')
        await page.keyboard.press('Control+a')
        s = await state('select all')
        assert s['sel'] == {'start': 0, 'end': len(full)}, s['sel']
        await page.keyboard.press('Control+c')
        await page.wait_for_timeout(200)
        assert await page.evaluate('window.__copied') == full, 'copying a selection of the whole file copies the whole text'
        await page.keyboard.type('x')
        await state('typed over all', 'x')
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(400)
        await state('undo brings it all back', full)
        checks.append('Select All: the page stays small, copy has the whole text, typing replaces it, undo brings it back')

        # Shift and a click thousands of lines away: exactly that range deleted.
        await caret(offset_of(100))
        await page.evaluate('__lazy.parts.revealEditorLine(9000)')
        await page.wait_for_timeout(300)
        target = await page.evaluate('''() => { const rows = [...document.querySelectorAll("#editor-gutter .editor-gutter-line")];
          const els = [...document.querySelector("#editor-content").children]; const k = rows.findIndex((r) => Number(r.dataset.line) === 9000);
          const r = els[k].getBoundingClientRect(); return [r.left + 2, r.top + r.height / 2]; }''')
        await page.keyboard.down('Shift')
        await page.mouse.click(target[0], target[1])
        await page.keyboard.up('Shift')
        await page.wait_for_timeout(200)
        sel = await page.evaluate('__lazy.parts.getEditorSelection()')
        assert sel['start'] == offset_of(100) and offset_of(9000) <= sel['end'] <= offset_of(9000, 3), (sel, offset_of(100), offset_of(9000))
        await page.keyboard.press('Backspace')
        expected = full[:sel['start']] + full[sel['end']:]
        await state('a long Shift-click selection deleted', expected)
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(400)
        await state('and undone', full)
        checks.append('a Shift-click selection 8,900 lines long deletes exactly that range')

        # Find: a match near the end, selected and in view.
        await page.keyboard.press('Control+Home')
        await page.keyboard.press('Control+f')
        await page.fill('#find-input', 'NEEDLE 15000')
        await page.keyboard.press('Enter')
        await page.wait_for_timeout(500)
        s = await page.evaluate(STATE)
        # The match counted, its line in view, and its highlight drawn over that line's text.
        found = await page.evaluate('''() => { const box = document.querySelector("#editor-search-highlights .search-match.is-current");
          const rows = [...document.querySelectorAll("#editor-gutter .editor-gutter-line")];
          const els = [...document.querySelector("#editor-content").children];
          const line = els[rows.findIndex((r) => Number(r.dataset.line) === 15000)];
          const a = box?.getBoundingClientRect(), b = line?.getBoundingClientRect();
          return { count: document.querySelector("#find-count").textContent, onLine: Boolean(a && b && a.top >= b.top - 1 && a.bottom <= b.bottom + 1) }; }''')
        assert found == {'count': '1 of 1', 'onLine': True}, found
        assert s['firstShown'] <= 15000 <= s['lastShown'], s
        await page.keyboard.press('Escape')
        checks.append('find: a match near the end is selected and in view')

        # Someone else's edit while scrolled away: the view stays where it is.
        await caret(offset_of(5))
        await scroll_to(0.75)
        before = (await page.evaluate(STATE))['firstShown']
        edited = 'a new first line\n' + full
        await page.evaluate('(t) => { const c = __lazy.controller; c.updateContent(c.getActiveFile().id, t); }', edited)
        await page.wait_for_timeout(400)
        s = await state('someone else\'s edit', edited)
        assert abs(s['firstShown'] - before) <= 2, (before, s)
        checks.append('someone else\'s edit while scrolled away: the view stays')

        # Word wrap off: the same.
        await page.evaluate('__lazy.shell.settings.change({ wordWrap: false }, "test")')
        await page.wait_for_timeout(400)
        await scroll_to(0.3)
        s = await state('word wrap off')
        assert 4000 < s['firstShown'] < 8000, s
        checks.append('word wrap off: scrolled, the lines shown are the model\'s')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
