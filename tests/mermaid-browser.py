"""Browser regression: Mermaid diagrams (the mermaid extension).

A ```mermaid block in a note is drawn in its preview (a ```js block stays
code); a .mmd file previews as its diagram and its source is highlighted; a
broken diagram keeps its code with Mermaid's reason; and with the library
unreachable (offline) the block stays code and says why. Isolated: the app's
APIs are mocked and the project lives in this browser; only the pinned
Mermaid library is fetched from jsDelivr (the last check blocks it).
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')


def project():
    files = {
        'note': ('note.md', '# Plan\n\n```mermaid\nflowchart LR\n    A[Start] --> B{Choice}\n    B -->|Yes| C[Done]\n```\n\n```js\nconst x = 1;\n```\n'),
        'flow': ('flow.mmd', 'sequenceDiagram\n    participant A as Alice\n    A->>B: Hello\n'),
        'broken': ('broken.mmd', 'flowchart LR\n    A -->\n'),
    }
    nodes = {'root': {'id': 'root', 'kind': 'folder', 'name': 'Diagrams', 'children': list(files), 'expanded': True}}
    for node_id, (name, content) in files.items():
        nodes[node_id] = {'id': node_id, 'kind': 'file', 'parentId': 'root', 'name': name, 'content': content, 'dirty': False}
    return {'id': 'mermaid-test', 'name': 'Diagrams', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'note', 'nodes': nodes}


async def open_app(browser, offline=False):
    context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script('localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');')

    async def route(rt):
        url = urlparse(rt.request.url)
        if url.netloc == 'cdn.jsdelivr.net' and '/npm/mermaid@' in url.path:
            if offline:
                await rt.abort('internetdisconnected')
            else:
                await rt.continue_()
            return
        if url.path.startswith('/api/'):
            await rt.fulfill(status=200, content_type='application/json', body='{"appVersion":"dev","minSyncVersion":117}')
            return
        file = ROOT / (url.path.lstrip('/') or 'index.html')
        if url.netloc == urlparse(BASE).netloc and file.is_file():
            await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
        else:
            await rt.fulfill(status=404, body='not found')
    await context.route('**/*', route)
    await page.goto(BASE, wait_until='domcontentloaded')
    await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("Plan")', timeout=20000)
    return context, page, errors


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context, page, errors = await open_app(browser)

        # A ```mermaid block in a note: drawn; its code hidden but still copyable; a ```js block stays code.
        await page.wait_for_function('document.querySelector(\'#preview-output .md-code-block[data-lang="mermaid"]\')?.dataset.mermaid === "drawn"', timeout=30000)
        block = await page.evaluate('''() => { const b = document.querySelector('#preview-output .md-code-block[data-lang="mermaid"]');
          return { svg: Boolean(b.querySelector(".mermaid-diagram svg")), codeHidden: getComputedStyle(b.querySelector("pre")).display === "none",
                   copy: Boolean(b.querySelector(".md-code-copy-button")), text: b.querySelector(".mermaid-diagram").textContent }; }''')
        assert block['svg'] and block['codeHidden'] and block['copy'], block
        assert 'Start' in block['text'] and 'Choice' in block['text'], block
        js = await page.evaluate('''() => { const b = document.querySelector('#preview-output .md-code-block[data-lang="js"]');
          return { drawn: b.dataset.mermaid ?? null, code: b.querySelector("pre").textContent }; }''')
        assert js == {'drawn': None, 'code': 'const x = 1;'}, js

        # A .mmd file: its preview is the diagram; its source is highlighted.
        await page.locator('#explorer-tree .tree-row', has_text='flow.mmd').first.click()
        await page.wait_for_function('document.querySelector("#preview-output .mermaid-preview .mermaid-diagram svg")', timeout=30000)
        assert 'Alice' in await page.locator('#preview-output .mermaid-diagram').inner_text()
        assert await page.locator('#editor-content .token-mermaid-diagram', has_text='sequenceDiagram').count() == 1
        assert await page.locator('#editor-content .token-mermaid-link').count() >= 1
        assert await page.locator('#explorer-tree .tree-icon.is-mermaid').count() == 2, 'its icon in the explorer'

        # A broken diagram: its code stays, with Mermaid's reason.
        await page.locator('#explorer-tree .tree-row', has_text='broken.mmd').first.click()
        await page.wait_for_function('document.querySelector("#preview-output .mermaid-error")', timeout=30000)
        assert 'Parse error' in await page.locator('#preview-output .mermaid-error').inner_text()
        assert await page.locator('#preview-output .mermaid-source').is_visible()
        assert await page.evaluate('[...document.body.children].filter((e) => e.id.startsWith("dstilo-mermaid")).length') == 0, 'no leftovers'
        assert not errors, errors
        await context.close()

        # The library unreachable: the block stays code and says why.
        context, page, errors = await open_app(browser, offline=True)
        await page.wait_for_function('document.querySelector(\'#preview-output .md-code-block[data-lang="mermaid"]\')?.dataset.mermaid === "failed"', timeout=30000)
        reason = await page.locator('#preview-output .md-code-block[data-lang="mermaid"] .mermaid-error').inner_text()
        assert 'could not be loaded' in reason, reason
        assert await page.locator('#preview-output .md-code-block[data-lang="mermaid"] pre').is_visible()
        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['a block in a note drawn', 'its code copyable', 'other languages stay code', 'a .mmd previewed',
                                     'its source highlighted', 'its icon', 'a broken diagram says why', 'no leftovers', 'offline: code with the reason']}))


asyncio.run(main())
