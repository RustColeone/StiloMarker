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
        await page.locator('#mobile-chat-toggle').click()
        await page.locator('#chat-new-thread-button').click()
        await page.locator('#chat-input').fill('First line')
        await page.locator('#chat-input').press('Enter')
        assert await page.locator('#chat-input').input_value() == 'First line\n'
        assert len(requests) == 0
        await page.locator('#chat-input').dispatch_event('keydown', {'key': 'Enter', 'isComposing': True, 'bubbles': True})
        assert len(requests) == 0
        await page.locator('#chat-add-active-file-button').click()
        await page.locator('#chat-send-button').click()
        await page.wait_for_function('!window.__chatTest.chatState.sending')
        assert requests[0]['contextFiles'][0]['content'] == project['nodes']['file']['content']
        assert 'Test response' in await page.locator('#chat-message-list').inner_text()
        await page.locator('#chat-input').fill('Saved draft')
        first_thread = await page.evaluate('window.__chatTest.chatState.activeThreadId')
        await page.locator('#chat-new-thread-button').click()
        assert await page.locator('#chat-input').input_value() == ''
        await page.evaluate('(id) => window.__chatTest.setActiveChatThread(id)', first_thread)
        assert await page.locator('#chat-input').input_value() == 'Saved draft'
        # Simulate incremental streaming while the reader browses older messages.
        await page.evaluate('''() => {
            const t = window.__chatTest, thread = t.getActiveChatThread();
            thread.messages = Array.from({length: 35}, (_, i) => ({id: 'm'+i, role:'assistant', content:'Message '+i+'\\n\\nUseful writing context.', createdAt:Date.now()}));
            t.renderChatPanel(t.controller.getProject());
            const log = document.querySelector('#chat-message-list'); log.scrollTop = 100;
            const range = document.createRange(); range.selectNodeContents(log.querySelector('.chat-message-content'));
            getSelection().removeAllRanges(); getSelection().addRange(range);
            t.chatState.sending = true; t.chatState.turn = {threadId: thread.id, key:t.controller.getProject().id, controller:new AbortController()}; t.chatState.streamingText = 'A new reply';
            t.renderChatPanel(t.controller.getProject());
        }''')
        scroll = await page.locator('#chat-message-list').evaluate('(el) => el.scrollTop')
        assert abs(scroll - 100) < 2, scroll
        assert 'Message 0' in await page.evaluate('getSelection().toString()')
        await page.evaluate('window.__chatTest.chatState.sending = false; window.__chatTest.chatState.turn = null; window.__chatTest.renderChatPanel(window.__chatTest.controller.getProject());')
        dimensions = []
        for width, height in [(320, 640), (390, 844), (768, 1024), (852, 393), (390, 350)]:
            await page.set_viewport_size({'width': width, 'height': height})
            await page.locator('#chat-input').focus()
            await page.wait_for_timeout(100)
            result = await page.evaluate('''() => {
              const input = document.querySelector('#chat-input'), send = document.querySelector('#chat-send-button'), rect = send.getBoundingClientRect();
              return {width:innerWidth, height:visualViewport.height, bottom:rect.bottom, buttonWidth:rect.width,
                font:getComputedStyle(input).fontSize, overflow:document.documentElement.scrollWidth > innerWidth};
            }''')
            assert result['buttonWidth'] >= 44, result
            assert result['font'] == '16px', result
            assert result['bottom'] <= result['height'] + 1, result
            assert not result['overflow'], result
            dimensions.append(result)
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.screenshot(path='/tmp/stilomarker-mobile-chat-v0.1.14.png')
        # Two cloud workspaces may have identical project IDs. Their chat caches
        # and pending drafts must nevertheless remain separate.
        await page.evaluate('''() => {
          const t = window.__chatTest;
          t.setChatConnection({serverUrl:location.origin,token:'test-A',sessionId:'team/A'});
          t.renderChatPanel(t.controller.getProject());
        }''')
        await page.locator('#chat-new-thread-button').click()
        await page.locator('#chat-input').fill('Cloud A message')
        await page.locator('#chat-send-button').click()
        await page.wait_for_function('!window.__chatTest.chatState.sending && window.__chatTest.chatState.syncBase?.revision > 0')
        await page.locator('#chat-input').fill('Cloud A draft')
        active = await page.evaluate('window.__chatTest.chatState.activeThreadId')
        # A peer's new thread must not steal this user's active conversation.
        cloud['test-A']['threads'].append({'id':'peer-thread','title':'Peer','createdAt':1,'updatedAt':1,'messages':[]})
        cloud['test-A']['revision'] += 1
        await page.evaluate('(workspace) => window.__chatTest.receiveChat(workspace)', cloud['test-A'])
        assert await page.evaluate('window.__chatTest.chatState.activeThreadId') == active
        assert await page.locator('#chat-input').input_value() == 'Cloud A draft'
        await page.evaluate('''() => {
          const t = window.__chatTest;
          t.setChatConnection({serverUrl:location.origin,token:'test-B',sessionId:'team/B'});
          t.renderChatPanel(t.controller.getProject());
        }''')
        assert await page.locator('#chat-input').input_value() == ''
        assert 'Cloud A message' not in await page.locator('#chat-message-list').inner_text()
        await page.evaluate('''() => {
          const t = window.__chatTest;
          t.setChatConnection({serverUrl:location.origin,token:'test-A',sessionId:'team/A'});
          t.renderChatPanel(t.controller.getProject());
        }''')
        assert await page.locator('#chat-input').input_value() == 'Cloud A draft'
        assert not errors, errors
        print(json.dumps({'mobileViewports': len(dimensions), 'chatRequests': len(requests), 'runtimeErrors': len(errors),
                          'checks': ['Enter newline', 'IME no send', 'attached file reaches request', 'reply displayed', 'thread drafts', 'stream scroll preserved', 'touch sizes', 'composer within viewport']}))
        await browser.close()

asyncio.run(main())
