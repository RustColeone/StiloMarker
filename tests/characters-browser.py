"""Browser regression for the Characters module in the page: a character's
preview shows its sheet, and its author's notes only in a marked, collapsed
panel; with `notes: hints` the panel says so. Static files from this checkout."""
import asyncio, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
MARA = "---\nname: Mara Quill\n---\n## Who they are\nA lighthouse keeper.\n\n## Author's notes\n- Goes blind in chapter nine.\n"
BRAM = "---\nname: Bram\nnotes: hints\n---\n## Who they are\nA cook.\n\n## Author's notes\n- Poisons the soup.\n"


def project():
    return {'id': 'chars', 'name': 'Novel', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'm', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['m', 'b'], 'expanded': True},
        'm': {'id': 'm', 'kind': 'file', 'parentId': 'root', 'name': 'mara.persona.skill', 'content': MARA, 'dirty': False},
        'b': {'id': 'b', 'kind': 'file', 'parentId': 'root', 'name': 'bram.persona.skill', 'content': BRAM, 'dirty': False}}}


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800}, service_workers='block')
        page = await context.new_page(); errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                   ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                                   ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "hidden"})); }')

        async def route(rt):
            parsed = urlparse(rt.request.url)
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

        await page.dblclick('.tree-row[title="mara.persona.skill"]')
        await page.wait_for_selector('.persona-card-name:has-text("Mara Quill")', timeout=15000)
        preview = page.locator('#preview-output')
        panel = page.locator('.persona-notes')
        assert await panel.count() == 1
        assert await panel.get_attribute('open') is None, 'the notes panel starts collapsed'
        assert 'never sees these' in await panel.locator('summary').inner_text()
        sheet_text = await preview.inner_text()
        assert 'A lighthouse keeper.' in sheet_text
        rendered_sheet = await page.evaluate('[...document.querySelectorAll("#preview-output > :not(.persona-notes)")].map((e) => e.innerText).join("\\n")')
        assert 'blind' not in rendered_sheet, 'the notes are only in their panel'

        await page.click('.tree-row[title="bram.persona.skill"]', button='right')
        await page.locator('#explorer-context-menu').get_by_text('Open Preview', exact=True).click()
        await page.wait_for_selector('.persona-card-name:has-text("Bram")', timeout=15000)
        assert 'light hints' in await page.locator('.persona-notes summary').inner_text()
        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['notes in a collapsed, marked panel', 'sheet shown without the notes', 'hints mode is labelled'], 'runtimeErrors': 0}))


asyncio.run(main())
