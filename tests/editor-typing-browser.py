"""Browser regression: typing on a long document stays incremental and correct.

v0.1.22 stopped rebuilding the whole editor on every keystroke: only changed
lines are replaced, line HTML is memoised, the explorer is not rebuilt while you
type, and undo stores patches instead of full copies. This pins the properties
that make that safe, against a novel-length chapter:

  * after each kind of edit, the DOM text, line count, gutter rows/heights,
    highlighting and caret all agree with the model;
  * an incrementally patched editor is byte-identical to a full re-render;
  * a keystroke replaces at most a couple of line elements (churn budget);
  * undo/redo round-trips exactly;
  * the explorer does not drift while typing (Chromium scroll anchoring used to
    pull it up a little on every key).

Isolated: APIs are mocked and static files come from this checkout.
"""
import asyncio
import json
import mimetypes
import os
import random
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')
HAN = '的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经'


def chapter(lines=1200):
    rnd = random.Random(11)
    out = ['# 第七回', '']
    for i in range(lines):
        if i % 7 == 6: out.append('')
        elif i % 41 == 0: out.append(f'## {rnd.choice(HAN) * 4}')
        else: out.append(''.join(rnd.choice(HAN) for _ in range(rnd.randint(18, 160))))
    return '\n'.join(out)


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1200, 'height': 560}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        files = {f'f{i}': {'id': f'f{i}', 'kind': 'file', 'parentId': 'root', 'name': f'第{i:02d}回.md', 'content': f'回 {i}', 'dirty': False}
                 for i in range(1, 31)}
        files['big'] = {'id': 'big', 'kind': 'file', 'parentId': 'root', 'name': '第七回.md', 'content': chapter(), 'dirty': False}
        project = {'id': 'typing-test', 'name': 'Typing test', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'big',
                   'nodes': {'root': {'id': 'root', 'kind': 'folder', 'name': 'Typing test', 'children': ['big', *[f'f{i}' for i in range(1, 31)]], 'expanded': True}, **files}}
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project)) + ');')

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                payload = {'appVersion': '0.1.22', 'minSyncVersion': 117, 'accounts': False} if path == '/api/ping' else {'configured': False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__typing={controller,renderEditorContent,getEditorText};\n'
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__typing) && document.querySelectorAll("#editor-content > .editor-line").length > 1000')
        await page.wait_for_timeout(500)
        checks = []

        STATE = '''() => {
          const ed = document.querySelector('#editor-content'); const lines = [...ed.children];
          const rows = [...document.querySelectorAll('#editor-gutter .editor-gutter-line')];
          const lh = parseFloat(getComputedStyle(ed).lineHeight) || 20.8;
          const badRows = rows.filter((r, i) => r.textContent.replace(/[◦●]/g, '') !== String(i + 1)
            || Math.abs(parseFloat(r.style.height) - Math.max(lh, lines[i]?.getBoundingClientRect().height || 0)) > 0.6).length;
          let inside = false; const wantCode = []; const domText = lines.map(l => l.textContent);
          for (const t of domText) { const s = t.trimStart(); if (!s) { wantCode.push(false); continue; }
            if (s.startsWith('```')) { inside = !inside; wantCode.push(false); continue; } wantCode.push(inside); }
          const badHighlight = lines.filter((l, i) => !!l.querySelector('.token-code-block') !== wantCode[i]).length;
          const sel = getSelection(); let caret = null;
          if (sel.rangeCount) { const r = sel.getRangeAt(0); let n = r.startContainer; while (n && n.parentNode !== ed) n = n.parentNode;
            if (n) { const pre = document.createRange(); pre.selectNodeContents(n); pre.setEnd(r.startContainer, r.startOffset);
              caret = [lines.indexOf(n), pre.toString().length]; } }
          return { text: domText.join('\\n'), model: __typing.controller.getActiveFile().content, lines: lines.length,
                   rows: rows.length, badRows, badHighlight, stray: ed.childNodes.length - ed.children.length, caret }; }'''
        async def caret_at(line, col):
            await page.evaluate('''([line, col]) => { const ed = document.querySelector('#editor-content'); ed.focus();
              const el = ed.children[line]; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, left = col, node = null, off = 0;
              while ((n = w.nextNode())) { if (left <= n.length) { node = n; off = left; break; } left -= n.length; }
              const r = document.createRange(); if (node) r.setStart(node, off); else { r.selectNodeContents(el); r.collapse(col === 0); }
              r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }''', [line, col])
        async def verify(step, expected, caret=None):
            await page.wait_for_timeout(200)
            s = await page.evaluate(STATE)
            ok = (s['text'] == expected and s['model'] == expected and s['lines'] == expected.count('\n') + 1
                  and s['rows'] == s['lines'] and not s['badRows'] and not s['badHighlight'] and s['stray'] == 0
                  and (caret is None or s['caret'] == list(caret)))
            assert ok, f'{step}: {json.dumps({k: v for k, v in s.items() if k not in ("text", "model")})} text-ok={s["text"] == expected} model-ok={s["model"] == expected}'
            checks.append(step)

        lines = (await page.evaluate(STATE))['text'].split('\n')
        await caret_at(10, 3); await page.keyboard.type('XYZ')
        lines[10] = lines[10][:3] + 'XYZ' + lines[10][3:]; await verify('type mid-line', '\n'.join(lines), (10, 6))
        await caret_at(10, 4); await page.keyboard.press('Enter')
        lines[10:11] = [lines[10][:4], lines[10][4:]]; await verify('Enter splits', '\n'.join(lines), (11, 0))
        join = len(lines[10]); await caret_at(11, 0); await page.keyboard.press('Backspace')
        lines[10:12] = [lines[10] + lines[11]]; await verify('Backspace merges', '\n'.join(lines), (10, join))
        await page.evaluate('''() => { const dt = new DataTransfer(); dt.setData('text/plain', '甲\\n乙\\n丙');
          document.querySelector('#editor-content').dispatchEvent(new InputEvent('beforeinput', {inputType: 'insertFromPaste', dataTransfer: dt, bubbles: true, cancelable: true})); }''')
        lines[10:11] = [lines[10][:join] + '甲', '乙', '丙' + lines[10][join:]]; await verify('multi-line paste', '\n'.join(lines), (12, 1))
        await caret_at(3, 0); await page.keyboard.type('```'); await page.keyboard.press('Enter')
        lines[3:4] = ['```', lines[3]]; await verify('opening a fence re-highlights every following line', '\n'.join(lines))

        # Incremental patching must land on exactly what a full re-render produces.
        same = await page.evaluate('''() => { const ed = document.querySelector('#editor-content'); const g = document.querySelector('#editor-gutter');
          const inc = ed.innerHTML, incG = g.innerHTML; __typing.renderEditorContent(__typing.getEditorText(), { full: true });
          return inc === ed.innerHTML && incG === g.innerHTML; }''')
        assert same, 'incremental editor/gutter differ from a full re-render'
        checks.append('incremental == full render')

        # Churn budget: a keystroke replaces a line, it does not rebuild the document.
        await caret_at(600, 5)
        before_typing = (await page.evaluate(STATE))['text']
        churn = await page.evaluate('''async () => { const ed = document.querySelector('#editor-content'); let n = 0;
          const mo = new MutationObserver(ms => { for (const m of ms) if (m.target === ed) n += m.addedNodes.length; });
          mo.observe(ed, { childList: true }); window.__mo = mo; window.__n = () => n; return true; }''')
        for ch in 'abcdefghij': await page.keyboard.type(ch); await page.wait_for_timeout(40)
        added = await page.evaluate('() => { window.__mo.disconnect(); return window.__n(); }')
        assert added <= 10 * 2, f'typing 10 keys added {added} line elements; expected about one per key'
        checks.append(f'churn budget ({added} line elements for 10 keys)')

        # Undo all the way back, then redo all the way forward.
        after_typing = (await page.evaluate(STATE))['text']
        for _ in range(10): await page.keyboard.press('Control+z')
        await page.wait_for_timeout(200)
        undone = await page.evaluate(STATE)
        assert undone['text'] == before_typing and undone['model'] == before_typing, 'undo did not restore the text exactly'
        for _ in range(10): await page.keyboard.press('Control+Shift+z')
        await page.wait_for_timeout(200)
        redone = await page.evaluate(STATE)
        assert redone['text'] == after_typing and redone['model'] == after_typing, 'redo did not restore the text exactly'
        checks.append('undo/redo round trip')

        # The explorer keeps its place while typing.
        await page.evaluate("() => { const t = document.querySelector('#explorer-tree'); t.scrollTop = (t.scrollHeight - t.clientHeight) * 0.6; }")
        await page.wait_for_timeout(200)
        start = await page.evaluate("() => document.querySelector('#explorer-tree').scrollTop")
        assert start > 50, f'explorer must be scrollable for this check (scrollTop {start})'
        await caret_at(20, 2)
        for _ in range(20): await page.keyboard.type('x'); await page.wait_for_timeout(60)
        await page.wait_for_timeout(800)
        end = await page.evaluate("() => document.querySelector('#explorer-tree').scrollTop")
        assert abs(end - start) < 1, f'explorer drifted from {start} to {end} while typing'
        checks.append('explorer does not drift while typing')

        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}, ensure_ascii=False))
        assert not errors, errors
        await browser.close()

asyncio.run(main())
