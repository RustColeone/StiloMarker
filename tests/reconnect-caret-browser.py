"""Browser regression: the caret stays where it was when a reconnect loads the
project again (O9, v0.3.13).

A reconnect that reloads the project from the server (Workspace's
replace(project, { keepView: true })) keeps the open tabs by path. A file
made during the session comes back with the server's id for it (each
browser gave it its own), so the caret, kept per file id, was lost and went
to the start. Here the reload is that replace, with the shown file's id
changed as the server's would be and no active file (the server's state
names none). The focused editor's caret and scroll stay where they were; so
does the other editor's caret (two editors on the same file), and the file
with an unchanged id too. A session joined again from scratch (a PIN
session's rejoin, nothing carried over) opens the file, under its new id, at
the caret kept for its path. No page errors.

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

# The project as the server would send it again: the given file under a new id, no active file.
RELOADED = '''([newId, rejoin]) => { const project = structuredClone(window.__t.controller.getProject());
  const oldId = project.activeFileId;
  if (newId && oldId) {
    const node = project.nodes[oldId];
    delete project.nodes[oldId];
    project.nodes[newId] = { ...node, id: newId };
    const parent = project.nodes[node.parentId];
    parent.children = parent.children.map((id) => (id === oldId ? newId : id));
  }
  // A reconnect: no active file (the server's state names none), the view kept. A session
  // joined again: the server's project as it is (its active file), nothing kept.
  project.activeFileId = rejoin ? (newId ?? oldId) : null;
  window.__t.workspace.replace(project, { keepView: !rejoin });
  return oldId; }'''
CARET = '''(group) => { const content = document.querySelector(`.source-body[data-group="${group}"] .editor-content`);
  return { focused: document.activeElement === content, scroll: Math.round(content.scrollTop),
    file: window.__t.controller.getActiveFile()?.name ?? null }; }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 700})
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
                    body += app_hook('window.__t = { controller, workspace, parts: editorParts };')
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=body)
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER") && window.__t', timeout=20000)
        checks = []
        selection = lambda: page.evaluate('window.__t.parts.getEditorSelection()')

        async def place(group, line):
            target = page.locator(f'.source-body[data-group="{group}"] .editor-content .editor-line').nth(line)
            await target.scroll_into_view_if_needed()
            await target.click(position={'x': 2, 'y': 4})
            await page.keyboard.press('End')
            await page.wait_for_timeout(200)

        # Far down the welcome page, the caret at the end of a line; the view scrolled there.
        await place('left', 40)
        before = await selection()
        where = await page.evaluate(CARET, 'left')
        assert before['start'] > 1000 and where['focused'] and where['scroll'] > 200, (before, where)

        # The reconnect: the file comes back under the server's id.
        await page.evaluate(RELOADED, ['file-from-server', False])
        await page.wait_for_timeout(600)
        after = await selection()
        now = await page.evaluate(CARET, 'left')
        assert now['file'] == 'welcome.md' and now['focused'], now
        assert (after['start'], after['end']) == (before['start'], before['end']), f'the caret stayed: {before} -> {after}'
        assert abs(now['scroll'] - where['scroll']) < 40, f'the view stayed: {where} -> {now}'
        await page.keyboard.type('Z')
        text = await page.evaluate('window.__t.parts.getEditorText()')
        assert text[before['start']] == 'Z', 'typing lands where the caret was, not at the top'
        await page.keyboard.press('Control+z')
        checks.append('a file whose id changed: the caret and the view stay')

        # The same with an id that stays (a file the server already had).
        await place('left', 30)
        before = await selection()
        await page.evaluate(RELOADED, [None, False])
        await page.wait_for_timeout(600)
        after = await selection()
        assert (after['start'], after['end']) == (before['start'], before['end']), f'{before} -> {after}'
        checks.append('a file whose id stayed: the caret stays')

        # Joined again from scratch (a PIN session's rejoin: not a reconnect, nothing carried
        # over): the file, under the server's id, opens at the caret kept for its path.
        await place('left', 25)
        before = await selection()
        await page.evaluate(RELOADED, ['file-rejoined', True])
        await page.wait_for_timeout(600)
        await page.evaluate('document.querySelector("#editor-content").focus()')
        await page.wait_for_timeout(200)
        after = await selection()
        assert (after['start'], after['end']) == (before['start'], before['end']), f'{before} -> {after}'
        checks.append('a session joined again: the file opens at the caret kept for its path')

        # Two editors on the file: the other editor's caret is kept too.
        await page.locator('#source-tab-strip .editor-tab[data-view="source"]', has_text='welcome.md').first.click(button='right')
        await page.wait_for_timeout(150)
        await page.locator('#tab-context-menu button', has_text='Open to the Side').click()
        await page.wait_for_timeout(400)
        await place('right', 20)
        right_at = await selection()
        await place('left', 35)
        left_at = await selection()
        await page.evaluate(RELOADED, ['file-again-from-server', False])
        await page.wait_for_timeout(600)
        assert (await selection())['start'] == left_at['start'], 'the focused editor\'s caret'
        await page.evaluate('document.querySelector(\'.source-body[data-group="right"] .editor-content\').focus()')
        await page.wait_for_timeout(300)
        assert (await selection())['start'] == right_at['start'], 'the other editor\'s caret'
        checks.append('two editors: both carets stay')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': checks, 'runtimeErrors': len(errors)}))


asyncio.run(main())
