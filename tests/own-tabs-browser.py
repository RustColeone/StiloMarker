"""Browser regression: the browser's own workspace keeps its tabs on a reload (O12, v0.3.19).

A cloud workspace's groups and tabs came back after a reload; the browser's
own workspace kept only its active file, so both groups showed that one
file. Now its tabs are kept in this browser too and come back as they were:
each group's tabs (Source or Preview), the one each shows, the active file.

Isolated: every API is mocked; the template is this checkout's Template folder.
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

# Each group's tabs by file name and view, the one it shows, and the active file.
TABS = '''() => { const project = window.__t.controller.getProject(), name = (id) => project.nodes[id]?.name ?? id;
  const view = window.__t.view.get();
  return { groups: view.groups.map((group) => ({ id: group.id, tabs: group.tabs.map((tab) => `${name(tab.fileId)}:${tab.view}`),
    shows: group.active ? `${name(group.active.fileId)}:${group.active.view}` : null })),
    active: name(project.activeFileId) }; }'''

LOADED = 'document.querySelector("#editor-content")?.innerText.includes("STILO MARKER") || document.querySelector("#editor-content")?.innerText.includes("Cure")'


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
                    body += app_hook('window.__t = { controller, view: modules.editor.view, parts: editorParts };')
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=body)
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function(LOADED, timeout=20000)
        await page.wait_for_function('Boolean(window.__t)', timeout=10000)

        # Work in it: the diagram's outline opened (a second tab on the left),
        # then opened to the side too (the right shows it as Source beside the
        # welcome's preview), then the welcome worked in again on the left.
        await page.locator('#explorer-panel').get_by_text('MeitanteiCure.mtree', exact=True).click()
        await page.wait_for_timeout(300)
        await page.evaluate('''() => { const project = window.__t.controller.getProject();
          const id = Object.values(project.nodes).find((node) => node.name === "MeitanteiCure.mtree").id;
          window.__t.parts.moveTabToGroup("left", { fileId: id, view: "source" }, { keep: true }); }''')
        await page.wait_for_timeout(300)
        await page.locator('#source-tab-strip .tab-title', has_text='welcome.md').first.click()
        await page.wait_for_timeout(300)
        before = await page.evaluate(TABS)
        left, right = before['groups'][0]['tabs'], before['groups'][1]['tabs']
        assert len(left) == 2 and 'MeitanteiCure.mtree:source' in right and len(right) == 2, before
        assert before['active'] == 'welcome.md', before
        await page.wait_for_timeout(2500)  # the project kept in this browser (auto-save)

        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function(LOADED, timeout=20000)
        await page.wait_for_function('Boolean(window.__t)', timeout=10000)
        await page.wait_for_timeout(800)
        after = await page.evaluate(TABS)
        assert after == before, f'the tabs come back as they were:\n before {before}\n after  {after}'
        shown = await page.evaluate('document.querySelector("#editor-content").innerText.slice(0, 20)')
        assert shown.startswith('# STILO MARKER'), shown

        # Worked in after the reload, they are kept again (a second reload).
        await page.locator('#source-tab-strip .tab-title', has_text='MeitanteiCure.mtree').first.click()
        await page.wait_for_timeout(300)
        again = await page.evaluate(TABS)
        await page.wait_for_timeout(2500)
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function(LOADED, timeout=20000)
        await page.wait_for_function('Boolean(window.__t)', timeout=10000)
        await page.wait_for_timeout(800)
        assert await page.evaluate(TABS) == again, 'kept again after the reload'

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['the own workspace\'s groups and tabs come back after a reload, with the active file',
                                     'worked in after it, they are kept again']}))


asyncio.run(main())
