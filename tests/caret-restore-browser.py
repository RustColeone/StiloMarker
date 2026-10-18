"""Public-origin, isolated browser regression for per-file editor caret restoration."""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'): launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 1200, 'height': 850}, service_workers='block')
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        project = {'id':'caret-test','name':'Caret test','sourceMode':'memory','rootId':'root','activeFileId':'first','nodes':{
            'root':{'id':'root','kind':'folder','name':'Caret test','children':['first','second'],'expanded':True},
            'first':{'id':'first','kind':'file','parentId':'root','name':'first.md','content':'A first line\nSecond line with many words.','dirty':False},
            'second':{'id':'second','kind':'file','parentId':'root','name':'second.md','content':'Another file with separate content.','dirty':False}}}
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", '+json.dumps(json.dumps(project))+');')
        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                payload = {'appVersion':'0.1.19','minSyncVersion':114,'accounts':False} if path=='/api/ping' else {'configured':False}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                if os.environ.get('STILO_LIVE_ASSETS'):
                    if path != '/app/main.js': await route.continue_(); return
                    response = await route.fetch(); body = await response.body()
                else: body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__caretTest={controller,setActiveSourceFile,setEditorSelection,getEditorSelection,getViewState,setViewState:(...a)=>editorParts.setViewState(...a)};\n'
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else: await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__caretTest)')
        async def place(start, end):
            await page.locator('#editor-content').focus()
            await page.evaluate('''({start,end}) => {
              __caretTest.setEditorSelection(start,end);
              document.dispatchEvent(new Event('selectionchange'));
            }''', {'start':start,'end':end})
            await page.wait_for_timeout(50)
        async def select_file(file_id):
            await page.evaluate('(id) => __caretTest.setActiveSourceFile(id)', file_id)
            await page.locator('#editor-content').focus()
        await place(14,14)
        await page.locator('#settings-menu-button').focus()
        await page.evaluate("__caretTest.setActiveSourceFile('second')")
        assert await page.evaluate('document.activeElement.id') == 'settings-menu-button', 'file switch stole focus'
        await page.locator('#editor-content').focus()
        await place(5,11)
        await select_file('first')
        assert await page.evaluate('__caretTest.getEditorSelection()') == {'start':14,'end':14}, 'first file lost caret on switch'
        await select_file('second')
        assert await page.evaluate('__caretTest.getEditorSelection()') == {'start':5,'end':11}, 'second file lost selection on switch'
        await select_file('first')
        await page.reload(wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__caretTest)')
        await page.locator('#editor-content').focus()
        assert await page.evaluate('__caretTest.getEditorSelection()') == {'start':14,'end':14}, 'reload lost caret'
        # A deliberate pointer click must still place the caret where clicked.
        await page.locator('#settings-menu-button').focus()
        await page.locator('#editor-content .editor-line').first.click(position={'x':2,'y':5})
        clicked = await page.evaluate('__caretTest.getEditorSelection()')
        assert clicked['start'] <= 2 and clicked['end'] <= 2, clicked
        # A stale saved offset must be clamped to the new file length.
        await select_file('second')
        await page.evaluate('''() => {
          const saved=__caretTest.getViewState('first').editorSelection;
          __caretTest.setViewState('first',{editorSelection:{...saved,start:9999,end:9999}});
        }''')
        await select_file('first')
        actual = await page.evaluate('__caretTest.getEditorSelection()')
        assert actual == {'start':len(project['nodes']['first']['content']),'end':len(project['nodes']['first']['content'])}, actual
        assert not errors, errors
        print(json.dumps({'checks':['file-switch caret','file-switch range','no focus steal','reload caret','pointer click respected','clamped stale offset'],'runtimeErrors':len(errors)}))
        await browser.close()

asyncio.run(main())
