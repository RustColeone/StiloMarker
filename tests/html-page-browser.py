"""Browser regression: static HTML pages (the html-page extension).

A .html file opens with its page in the preview: a sandboxed frame where the
page's own script runs but reaches neither the app (its parent) nor the
app's storage; a relative image of the workspace arrives embedded as data;
a cloud workspace's image address (which carries the session's token) is
read by the app and only its bytes reach the page; the source is
highlighted. Isolated: every API is mocked and the project lives in this
browser.
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
DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
PAGE = '''<!doctype html>
<html><head><style>h1 { color: rgb(200, 0, 0); }</style></head>
<body>
<h1 id="title">Hello page</h1>
<img id="pic" src="pics/dot.png" alt="dot">
<p id="out">not run</p>
<script>
  const notes = ["ran"];
  try { parent.document.title; notes.push("parent reachable"); } catch (error) { notes.push("parent isolated"); }
  try { localStorage.getItem("mdnotes.settings.v1"); notes.push("storage reachable"); } catch (error) { notes.push("storage isolated"); }
  const src = document.getElementById("pic").getAttribute("src");
  notes.push(src.startsWith("data:image/png") ? "image embedded" : "image " + src);
  document.getElementById("out").textContent = notes.join(", ");
</script>
</body></html>
'''


def project():
    nodes = {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Site', 'children': ['note', 'page', 'pics'], 'expanded': True},
        'note': {'id': 'note', 'kind': 'file', 'parentId': 'root', 'name': 'note.md', 'content': '# Notes\n', 'dirty': False},
        'page': {'id': 'page', 'kind': 'file', 'parentId': 'root', 'name': 'page.html', 'content': PAGE, 'dirty': False},
        'pics': {'id': 'pics', 'kind': 'folder', 'parentId': 'root', 'name': 'pics', 'children': ['dot'], 'expanded': True},
        'dot': {'id': 'dot', 'kind': 'file', 'parentId': 'pics', 'name': 'dot.png', 'content': DOT, 'dirty': False}}
    return {'id': 'html-test', 'name': 'Site', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'note', 'nodes': nodes}


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        page = await context.new_page()
        errors = []
        # Playwright's service-worker blocker runs in every frame, the sandboxed page's too, where
        # it is refused (no storage or service workers there: as it should be). Not the app's errors.
        harness = "lacks the 'allow-same-origin' flag"
        page.on('pageerror', lambda error: None if harness in str(error) else errors.append(str(error)))
        await page.add_init_script('if (window === window.top) localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');')

        async def route(rt):
            url = urlparse(rt.request.url)
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
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("Notes")', timeout=20000)

        # Opened: the page in the preview, in a frame with scripts but not the app's origin.
        await page.locator('#explorer-tree .tree-row', has_text='page.html').first.click()
        frame = page.locator('#preview-output .html-page-frame')
        await frame.wait_for(timeout=10000)
        assert await frame.get_attribute('sandbox') == 'allow-scripts'
        out = page.frame_locator('#preview-output .html-page-frame').locator('#out')
        await out.wait_for(timeout=10000)
        for _ in range(50):
            text = await out.inner_text()
            if text != 'not run':
                break
            await page.wait_for_timeout(100)
        assert text == 'ran, parent isolated, storage isolated, image embedded', text
        color = await page.frame_locator('#preview-output .html-page-frame').locator('#title').evaluate('el => getComputedStyle(el).color')
        assert color == 'rgb(200, 0, 0)', f'the page\'s own styles: {color}'
        height = await frame.evaluate('el => el.getBoundingClientRect().height')
        assert height > 600, f'the page fills the preview: {height}'

        # The source is highlighted, and the type has its icon.
        assert await page.locator('#editor-content .token-html-tag').count() > 5
        assert await page.locator('#editor-content .token-html-attribute', has_text='src').count() == 1
        assert await page.locator('#explorer-tree .tree-icon.is-html').count() == 1

        # A cloud workspace's image: read by the app, only its bytes reach the page (never the token).
        embedded = await page.evaluate('''async () => {
          const { embedImages } = await import("/extensions/html-page/browser/adapters/frame.js");
          const seen = [];
          const fetchImpl = async (url) => { seen.push(url); return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })); };
          const resolve = (url) => url === "a.png" ? "https://host/api/workspaces/asset?token=SECRET&path=a.png" : url;
          const page = await embedImages('<!doctype html><p><img src="a.png"><img src="missing.png"><img src="https://x.org/b.png"></p>', resolve, { fetchImpl });
          return { page, seen };
        }''')
        assert embedded['seen'] == ['https://host/api/workspaces/asset?token=SECRET&path=a.png'], embedded
        assert 'SECRET' not in embedded['page'] and 'data:image/png;base64,iVBORw==' in embedded['page'], embedded['page']
        assert 'src="missing.png"' in embedded['page'] and 'src="https://x.org/b.png"' in embedded['page'], 'others as written'
        assert embedded['page'].startswith('<!doctype html>'), embedded['page']

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['opens in the preview', 'sandboxed with scripts', 'its script runs', 'parent isolated',
                                     'storage isolated', 'relative image embedded', 'its own styles', 'fills the preview',
                                     'source highlighted', 'its icon', 'a token never reaches the page']}))


asyncio.run(main())
