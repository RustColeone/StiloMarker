"""Optional browser regression: public origin, isolated context, mocked chat API.
Run with Playwright installed; STILO_BROWSER may point at an existing Chromium.
Static responses are overlaid from this checkout so staging needs no HTTP server.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'): options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                            device_scale_factor=1, service_workers='block')
        page = await context.new_page()
        errors, requests = [], []
        cloud = {}
        page.on('pageerror', lambda error: errors.append(str(error)))
        project = {'id': 'mobile-test', 'name': 'Mobile test', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'file', 'nodes': {
            'root': {'id': 'root', 'kind': 'folder', 'name': 'Mobile test', 'children': ['file'], 'expanded': True},
            'file': {'id': 'file', 'kind': 'file', 'parentId': 'root', 'name': 'note.md', 'content': 'Context from the attached note', 'dirty': False}}}
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", '+json.dumps(json.dumps(project))+');')
        await page.add_init_script('localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel:"hidden",showFormatToolbar:true}));')
        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                if path == '/api/chat/workspace':
                    token = parse_qs(parsed.query)['token'][0]
                    state = cloud.setdefault(token, {'revision': 0, 'threads': []})
                    if route.request.method == 'POST':
                        update = route.request.post_data_json
                        if update.get('baseRevision') != state['revision']:
                            await route.fulfill(status=409, content_type='application/json', body=json.dumps({'message':'conflict'})); return
                        assert update['version'] == 114
                        state = cloud[token] = {'revision':state['revision']+1, 'threads':update['threads']}
                    payload = state
                elif path == '/api/chat/status':
                    payload = {'configured': True, 'provider': 'Test', 'model': 'test-model', 'models': ['test-model'], 'localOnly': False}
                elif path == '/api/chat':
                    requests.append(route.request.post_data_json)
                    payload = {'message': 'Test response', 'proposedOperations': []}
                elif path == '/api/ping': payload = {'appVersion': '0.1.14', 'minSyncVersion': 114}
                else: payload = {}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__chatTest = {chatState, controller, renderChatPanel, setActiveChatThread, createNewChatConversation, getActiveChatThread, collaboration, setChatConnection: connection => { workspaceMode = connection ? "synced" : "private"; collaboration.getConnectionInfo = () => connection; }, receiveChat: workspace => chatSynchronizer.receive(workspace)};\n'
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else: await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__chatTest)')
        assert not errors, errors
        # All clicks stay in the isolated browser; API calls are mocked above.
        for width,height in [(320,640),(390,844),(768,1024),(852,393),(390,350)]:
            await page.set_viewport_size({'width':width,'height':height})
            await page.locator('#mobile-menu-button').click()
            await page.locator('#file-menu-button').click()
            metrics = await page.evaluate('''() => {
              const menu=document.querySelector('.menu-bar'), r=menu.getBoundingClientRect();
              return {bottom:r.bottom,height:visualViewport.height,overflow:document.documentElement.scrollWidth>innerWidth,
                targets:[...document.querySelectorAll('.topbar-mobile-btn')].filter(e=>!e.hidden).map(e=>({id:e.id,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))};
            }''')
            assert metrics['bottom'] <= metrics['height'], metrics
            assert not metrics['overflow'], metrics
            assert all(t['w'] >= 44 and t['h'] >= 44 for t in metrics['targets']), metrics
            await page.locator('#settings-menu-button').scroll_into_view_if_needed()
            await page.locator('#mobile-menu-button').click()
            await page.locator('#mobile-menu-button').click()
            await page.locator('#edit-menu-button').click()
            await page.locator('#find-replace-menu-button').click()
            if await page.locator('#find-replace-row').is_hidden():
                await page.locator('#find-toggle-replace').click()
            find = await page.locator('#editor-find-bar').evaluate('''el => {
              const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth,
                controls:[...el.querySelectorAll('button,input')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right,height:e.getBoundingClientRect().height}))};
            }''')
            assert find['scroll'] <= find['client']+1 and find['left'] >= 0 and find['right'] <= find['width'], find
            assert all(t['left'] >= find['left'] and t['right'] <= find['right'] and t['height'] >= 44 for t in find['controls']), find
            await page.locator('#find-close').click()
        await page.set_viewport_size({'width':390,'height':844})
        await page.locator('#editor-content').focus()
        await page.evaluate('''() => {
          const editor=document.querySelector('#editor-content');
          window.savedEditorNode=editor.firstChild;
          const range=document.createRange();range.setStart(editor.firstChild.firstChild,4);range.collapse(true);
          getSelection().removeAllRanges();getSelection().addRange(range);
        }''')
        await page.set_viewport_size({'width':390,'height':350})
        await page.wait_for_timeout(100)
        assert await page.evaluate('document.querySelector("#editor-content").firstChild === window.savedEditorNode'), 'height change rebuilt editor'
        assert await page.evaluate('getSelection().anchorOffset') == 4, 'height change moved caret'
        # A width change during IME composition must not replace the live DOM.
        await page.locator('#editor-content').dispatch_event('compositionstart')
        await page.set_viewport_size({'width':400,'height':350})
        await page.wait_for_timeout(100)
        assert await page.evaluate('document.querySelector("#editor-content").firstChild === window.savedEditorNode'), 'resize interrupted composition'
        await page.locator('#editor-content').dispatch_event('compositionend')
        await page.set_viewport_size({'width':390,'height':844})
        await page.evaluate('getSelection().removeAllRanges()')

        async def gesture(selector, moves, ending='touchend', start=270):
            await page.evaluate('''({selector,moves,ending,start}) => {
              const target=document.querySelector(selector);
              const fire=(type,x,count=1)=>{
                const touches=Array.from({length:count},(_,i)=>new Touch({identifier:i,target,clientX:x+i*20,clientY:220}));
                target.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:touches,changedTouches:touches}));
              };
              fire('touchstart',start);
              for(const x of moves) fire('touchmove',x);
              if(ending==='multitouch') fire('touchstart',moves.at(-1),2);
              else if(ending) fire(ending,moves.at(-1));
            }''', {'selector':selector,'moves':moves,'ending':ending,'start':start})

        async def assert_pane(name):
            await page.wait_for_timeout(360)
            assert await page.locator('#app').get_attribute('data-mobile-view') == name
            assert await page.locator('.pane-swipe-layer').count() == 0
            assert await page.locator('#app').get_attribute('data-drawer-drag') is None

        await gesture('#editor-content',[180,50])
        await assert_pane('source')
        await page.locator('#mobile-preview-toggle').click()
        for ending in ['touchcancel','multitouch']:
            await gesture('#preview-output',[180,50],ending)
            await assert_pane('preview')
        # Reversing across the starting point cannot select the wrong neighbor.
        await gesture('#preview-output',[180,350])
        await assert_pane('preview')
        # Tapping the current pane also cancels a pending switch.
        await gesture('#preview-output',[180,50])
        await page.locator('#mobile-preview-toggle').click()
        await assert_pane('preview')
        # A rapid topbar selection wins over a settling swipe's old timer.
        await gesture('#preview-output',[180,50])
        await page.locator('#mobile-source-toggle').click()
        await assert_pane('source')
        await page.locator('#mobile-preview-toggle').click()
        await gesture('#preview-output',[180,50])
        await assert_pane('chat')
        await gesture('#chat-input',[180,50])
        await assert_pane('chat')
        await page.locator('#chat-collapse-button').click()
        await assert_pane('source')
        # Horizontal content and the diagram canvas own even edge drags.
        await page.locator('#mobile-preview-toggle').click()
        await page.locator('#preview-output').evaluate('''el => {
          el.innerHTML='<div id="wide-content" style="width:200px;overflow-x:auto"><div style="width:1000px">Wide table</div></div><div class="bmap-editor" id="test-canvas">Diagram canvas</div>';
        }''')
        await gesture('#wide-content',[70,180],start=5)
        await assert_pane('preview')
        assert await page.locator('#app').get_attribute('data-mobile-explorer') == 'closed'
        await gesture('#test-canvas',[180,50])
        await assert_pane('preview')
        # Edge navigation still works on ordinary content; cancellation restores it.
        await gesture('#preview-output',[70,180],start=5,ending='touchcancel')
        assert await page.locator('#app').get_attribute('data-mobile-explorer') == 'closed'
        await gesture('#preview-output',[70,180],start=5)
        assert await page.locator('#app').get_attribute('data-mobile-explorer') == 'open'
        await page.locator('#mobile-menu-button').click()
        assert await page.locator('#app').get_attribute('data-mobile-explorer') == 'closed'
        # Menu actions on phones change visible panes, not saved desktop layout.
        before=await page.evaluate('localStorage.getItem("mdnotes.settings.v1")')
        await page.locator('#view-menu-button').click()
        await page.locator('#toggle-chat-button').click()
        await assert_pane('chat')
        await page.locator('#chat-collapse-button').click()
        await assert_pane('source')
        assert await page.evaluate('localStorage.getItem("mdnotes.settings.v1")') == before
        await page.locator('#mobile-chat-toggle').click()
        await page.set_viewport_size({'width':1200,'height':844})
        assert await page.locator('#chat-panel').is_hidden(), 'mobile state leaked into hidden desktop chat'
        await page.set_viewport_size({'width':390,'height':350})
        await page.locator('#mobile-menu-button').click()
        await page.locator('#settings-menu-button').click()
        await page.locator('#open-settings-menu-button').click()
        dialog=await page.locator('#settings-dialog').evaluate('el=>({height:el.getBoundingClientRect().height,viewport:visualViewport.height,overflow:el.scrollWidth>el.clientWidth})')
        assert dialog['height'] <= dialog['viewport'] and not dialog['overflow'],dialog
        await page.screenshot(path='/tmp/stilomarker-mobile-settings-v0.1.15.png')
        await page.locator('#settings-dialog .dialog-close-corner').click()
        await page.locator('#mobile-source-toggle').click()
        await page.set_viewport_size({'width':390,'height':844})
        await page.screenshot(path='/tmp/stilomarker-mobile-source-v0.1.15.png')
        assert not errors,errors
        print(json.dumps({'mobileViewports':5,'runtimeErrors':len(errors),'checks':['reachable menus','44px controls','Find controls fit','height resize preserves caret','IME resize preserves DOM','editing owns swipes','cancel and multitouch restore pane','direction reversal','rapid navigation','normal pane swipe','chat close','canvas and wide content own gestures','edge drawer','exclusive flyouts','desktop settings preserved','breakpoint state','short-screen settings']}))
        await browser.close()

asyncio.run(main())
