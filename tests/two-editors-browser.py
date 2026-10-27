"""Browser regression: a source editor in each group (v0.3.11).

Open to the Side on a source tab: both groups show the file as Source, each
in its own editor (no placeholder), the right one the active one. Typing in
one shows in the other (as typing pauses); the other's caret stays where it was in the
text (moved by the typing before it) and is drawn in the first like a
collaborator's, named for its group. Undo is the file's: Ctrl+Z in either
editor undoes the last change, whichever editor made it, in both. Two
different files: working in an editor makes it the active one (the
project's active file, the explorer's selection, the status bar's count,
the find bar, which opens in the editor worked in and searches its text).
Closing the active editor's last source tab hands the active file to the
other group's editor. A part (an album's entry) stays with its editor, and
only on its own file. A key in an editor that has the focus without being
the active one makes it the active one. A write (the agent's) to the file the
other editor shows goes through it, so undo there takes it back. The active
file deleted while the other editor shows a file: that editor is the active
one. On a phone only the active editor
shows. No page errors.

Isolated: every API is mocked; the welcome template is this checkout's
Template folder.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

EDITORS = '''() => Object.fromEntries([...document.querySelectorAll(".source-body")].map((body) => {
  const content = body.querySelector(".editor-content");
  return [body.dataset.group, {
    shown: body.dataset.shown === "true", active: body.dataset.active === "true",
    visible: getComputedStyle(body).display !== "none" && body.offsetParent !== null,
    text: [...content.children].map((line) => line.textContent).join("\\n"),
    focused: content === document.activeElement,
    peers: [...body.querySelectorAll(".remote-cursor-label")].map((label) => label.textContent),
    findBar: Boolean(body.querySelector(".editor-find-bar:not([hidden])")),
    highlights: body.querySelectorAll(".search-match").length
  }];
}))'''
STATE = '''() => { const project = window.__t.controller.getProject(); const view = window.__t.view.get();
  return { active: project.nodes[project.activeFileId]?.name ?? null, host: view.hosts.source,
    selected: document.querySelector("#explorer-tree .tree-row.is-selected, #explorer-tree .tree-row[aria-selected=true]")?.textContent.trim() ?? null,
    count: document.querySelector("#status-charcount-item")?.textContent ?? "",
    placeholders: [...document.querySelectorAll(".group-placeholder")].filter((p) => !p.hidden).length }; }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def route(rt):
            path = urlparse(rt.request.url).path
            if path.startswith('/api/'):
                await rt.fulfill(status=200, content_type='application/json', body='{"appVersion":"dev","minSyncVersion":117}')
                return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__t = { controller, parts: editorParts, view: modules.editor.view, workspace };')
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=body)
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER") && window.__t', timeout=20000)
        checks = []

        async def editors():
            await page.wait_for_timeout(250)
            return await page.evaluate(EDITORS)

        def line_in(group, index):
            return page.locator(f'.source-body[data-group="{group}"] .editor-content .editor-line').nth(index)

        async def caret(group, line):
            await line_in(group, line).click(position={'x': 2, 'y': 4})
            await page.keyboard.press('Home')
            await page.wait_for_timeout(150)

        welcome = await page.evaluate('window.__t.controller.getProject().nodes[window.__t.controller.getProject().activeFileId].content')

        # Open to the Side: the file in both groups' editors, the right one active; no placeholder.
        await page.locator('#source-tab-strip .editor-tab', has_text='welcome.md').first.click(button='right')
        await page.wait_for_timeout(150)
        await page.locator('#tab-context-menu button', has_text='Open to the Side').click()
        now = await editors()
        assert now['left']['shown'] and now['right']['shown'] and now['right']['active'] and not now['left']['active'], now
        assert now['left']['text'] == welcome and now['right']['text'] == welcome, 'both show the file'
        state = await page.evaluate(STATE)
        assert state['placeholders'] == 0 and state['host'] == 'right' and state['active'] == 'welcome.md', state
        checks.append('Open to the Side: the file in both editors, no placeholder')

        # The right editor's caret on line 5; typing at the start of line 3 in the left shows in the right at once,
        # moving the right's caret by what was typed; each draws the other's caret.
        await caret('right', 4)
        right_at = await page.evaluate('window.__t.parts.getEditorSelection().start')
        await caret('left', 2)
        state = await page.evaluate(STATE)
        assert state['host'] == 'left', 'working in the left makes it the active one'
        await page.keyboard.type('Hello ')
        now = await editors()
        assert now['right']['text'] == now['left']['text'] and 'Hello ' in now['right']['text'], 'the right followed at once'
        assert now['left']['peers'] == ['Right editor'] and now['right']['peers'] == ['Left editor'], now
        # Focused again (not clicked): its own caret comes back, moved by the typing before it.
        await page.evaluate('document.querySelector(\'.source-body[data-group="right"] .editor-content\').focus()')
        await page.wait_for_timeout(200)
        assert await page.evaluate('window.__t.parts.getEditorSelection().start') == right_at + 6, 'its caret moved with the text'
        checks.append('typing in one shows in the other at once; its caret kept and drawn as a collaborator')

        # Undo is the file's: Ctrl+Z in the right undoes the left's typing, in both.
        for _ in range(6):
            await page.keyboard.press('Control+z')
        now = await editors()
        assert now['left']['text'] == welcome and now['right']['text'] == welcome, 'undone in both'
        await page.keyboard.press('Control+y')
        now = await editors()
        assert now['left']['text'] == now['right']['text'] != welcome, 'redone in both'
        for _ in range(3):
            await page.keyboard.press('Control+z')
        checks.append('undo is the file\'s, shared by both editors')

        # Another file in the right group's editor: each editor shows its own; working in one makes its file the active one.
        mtree = await page.evaluate('Object.values(window.__t.controller.getProject().nodes).find((n) => n.name === "MeitanteiCure.mtree").id')
        await page.evaluate(f'window.__t.parts.openDroppedFileInPane("{mtree}", "source", "right")')
        now = await editors()
        state = await page.evaluate(STATE)
        tree_text = await page.evaluate(f'window.__t.controller.getProject().nodes["{mtree}"].content')
        assert now['right']['text'] == tree_text and now['left']['text'].startswith('# STILO MARKER'), now
        assert state['active'] == 'MeitanteiCure.mtree' and state['host'] == 'right', state
        await caret('left', 0)
        state = await page.evaluate(STATE)
        assert state['active'] == 'welcome.md' and state['host'] == 'left', state
        assert state['selected'] in (None, 'welcome.md') and state['count'].replace(',', '').startswith(str(len(await page.evaluate('window.__t.parts.getEditorText()')))), state
        now = await editors()
        assert now['left']['peers'] == [] and now['right']['peers'] == [], 'different files: no other caret'
        checks.append('two files: working in an editor makes its file the active one, the count its')

        # The find bar opens in the editor worked in and searches its text.
        await page.keyboard.press('Control+f')
        await page.keyboard.type('Linked Notes')
        await page.wait_for_timeout(400)
        now = await editors()
        assert now['left']['findBar'] and not now['right']['findBar'] and now['left']['highlights'] > 0, now
        await page.keyboard.press('Escape')
        await caret('right', 0)
        await page.keyboard.press('Control+f')
        await page.keyboard.type('Cure')
        await page.wait_for_timeout(400)
        now = await editors()
        assert now['right']['findBar'] and not now['left']['findBar'], now
        assert now['right']['highlights'] > 0 and now['left']['highlights'] == 0, now
        await page.keyboard.press('Escape')
        checks.append('the find bar opens in the editor worked in, its text searched')

        # Closing the active editor's last source tab: the other group's editor is the active one.
        await caret('right', 0)
        for name in ('MeitanteiCure.mtree', 'welcome.md'):
            await page.locator('#preview-tab-strip .editor-tab[data-view="source"]', has_text=name).first.click(button='right')
            await page.wait_for_timeout(150)
            await page.locator('#tab-context-menu button', has_text='Close').first.click()
            await page.wait_for_timeout(250)
        state = await page.evaluate(STATE)
        assert (state['host'], state['active']) == ('left', 'welcome.md'), state
        now = await editors()
        assert now['left']['active'] and not now['right']['shown'], now
        checks.append('closing the active editor\'s last source tab hands the active file to the other editor')

        # A part (an album's entry) in the left editor stays with it while the right is the active
        # one; when the left group moves on to another file, that file shows whole (not the entry).
        luluka = await page.evaluate('Object.values(window.__t.controller.getProject().nodes).find((n) => n.name === "LULUKA.urldb").id')
        entry = await page.evaluate(f'''() => {{ const file = window.__t.controller.getProject().nodes["{luluka}"];
          const parts = window.__t.workspace.parts.of(file.name); const part = parts.list(file.content)[0];
          return {{ id: part.id, body: parts.body(file.content, part.id) }}; }}''')
        await page.evaluate(f'window.__t.parts.setActiveSourcePart("{luluka}", "{entry["id"]}")')
        now = await editors()
        assert now['left']['active'] and now['left']['text'] == entry['body'], now['left']
        await page.evaluate(f'window.__t.parts.openDroppedFileInPane("{mtree}", "source", "right")')
        now = await editors()
        assert now['right']['active'] and now['left']['text'] == entry['body'], 'the left keeps its entry'
        await page.locator('#source-tab-strip .editor-tab[data-view="source"]', has_text='LULUKA.urldb').first.click(button='right')
        await page.wait_for_timeout(150)
        await page.locator('#tab-context-menu button', has_text='Close').first.click()
        now = await editors()
        welcome_now = await page.evaluate('Object.values(window.__t.controller.getProject().nodes).find((n) => n.name === "welcome.md").content')
        assert now['left']['text'] == welcome_now, now['left']['text'][:60]
        checks.append('a part stays with its editor, and only on its own file')

        # The focus in an editor that is not the active one (here made so directly): a key makes it the active one.
        await caret('left', 0)
        await page.evaluate('window.__t.parts.activateEditor("right")')
        assert (await page.evaluate(STATE))['host'] == 'right'
        await page.keyboard.type('Z')
        state = await page.evaluate(STATE)
        assert (state['host'], state['active']) == ('left', 'welcome.md'), state
        assert (await editors())['left']['text'].startswith('Z'), 'typed where the focus is'
        await page.keyboard.press('Control+z')
        checks.append('a key in a focused editor makes it the active one')

        # A write (the agent's) to the file the other editor shows goes through that editor
        # (v0.3.15): undo there takes it back.
        await caret('right', 0)
        assert (await page.evaluate(STATE))['host'] == 'right'
        before = await page.evaluate('Object.values(window.__t.controller.getProject().nodes).find((n) => n.name === "welcome.md").content')
        await page.evaluate('(text) => window.__t.workspace.write("welcome.md", text, { source: "agent" })', before + '\nA LINE FROM THE AGENT')
        await page.wait_for_timeout(400)
        assert (await editors())['left']['text'].endswith('A LINE FROM THE AGENT'), 'the left editor shows it'
        await page.evaluate('document.querySelector("#editor-content").focus()')
        await page.wait_for_timeout(200)
        await page.keyboard.press('Control+z')
        await page.wait_for_timeout(300)
        assert (await editors())['left']['text'] == before, 'undone from the editor it went through'
        checks.append("a write to the other editor's file is undone there")

        # The active file deleted (by anyone) while the other editor shows a file: that editor
        # is the active one (O10, v0.3.14), its file the active file.
        gone = await page.evaluate('Object.values(window.__t.controller.getProject().nodes).find((n) => n.name === "welcome.md").id')
        await page.evaluate(f'window.__t.controller.remove("{gone}")')
        await page.wait_for_timeout(400)
        state = await page.evaluate(STATE)
        assert (state['host'], state['active']) == ('right', 'MeitanteiCure.mtree'), state
        assert (await editors())['right']['active'], 'the right editor is the active one'
        checks.append('the active file deleted: the other editor is the active one')

        # On a phone only the active editor shows.
        await page.evaluate(f'window.__t.parts.openDroppedFileInPane("{mtree}", "source", "right")')
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(500)
        now = await editors()
        assert [group for group, editor in now.items() if editor['visible']] == ['right'], now
        await page.set_viewport_size({'width': 1400, 'height': 900})
        checks.append('on a phone only the active editor shows')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))


asyncio.run(main())
