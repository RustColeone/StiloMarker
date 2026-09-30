"""Isolated public-origin browser regression for the optional in-app MCP controls."""
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
    async with async_playwright() as playwright:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await playwright.chromium.launch(**launch)
        context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                            has_touch=True, service_workers='block')
        page = await context.new_page()
        errors, mcp_requests, chat_requests = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        project = {'id':'mcp-test','name':'MCP test','sourceMode':'memory','rootId':'root','activeFileId':'file','nodes':{
            'root':{'id':'root','kind':'folder','name':'MCP test','children':['file'],'expanded':True},
            'file':{'id':'file','kind':'file','parentId':'root','name':'note.md','content':'A test note','dirty':False}}}
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", '+json.dumps(json.dumps(project))+');')
        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path.startswith('/api/'):
                if path == '/api/chat/mcp':
                    assert route.request.headers.get('authorization') == 'Bearer test-account'
                    body = route.request.post_data_json
                    mcp_requests.append(body)
                    if body['action'] == 'list':
                        payload = {'servers':[{'id':'library','label':'Reference library'}, {'id':'archive','label':'Team archive'}, {'id':'third','label':'Third library'}]}
                    else:
                        payload = {'servers':[{'id':body['servers'][0], 'ready':True,'toolCount':2,'message':'Ready'}]}
                elif path == '/api/chat/status':
                    payload = {'configured':True,'provider':'Test','model':'test-model','models':['test-model'],'localOnly':False}
                elif path == '/api/chat':
                    chat_requests.append(route.request.post_data_json)
                    payload = {'message':'Test response','proposedOperations':[]}
                elif path == '/api/ping': payload = {'appVersion':'0.1.17','minSyncVersion':114}
                else: payload = {}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += b'\nwindow.__mcpTest = {mcpControls, syncState, settings, openSettingsDialog, renderChatPanel, controller};\n'
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()
        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__mcpTest)')
        assert not errors, errors
        assert not mcp_requests, 'MCP must not run during project load'
        await page.evaluate('''() => {
          const t=window.__mcpTest;
          t.syncState.account={token:'test-account',username:'tester',teams:['friends']};
          t.openSettingsDialog('agent');
        }''')
        await page.locator('#mcp-load-button').click()
        await page.locator('#mcp-connections input').first.wait_for()
        assert len(mcp_requests) == 1 and mcp_requests[0]['action'] == 'list'
        boxes = page.locator('#mcp-connections input')
        await boxes.nth(0).check()
        await boxes.nth(1).check()
        assert await boxes.nth(2).is_disabled()
        assert 'Reference library' in await page.locator('#chat-mcp-summary').inner_text()
        await page.get_by_role('button',name='Test Reference library').click()
        await page.get_by_text('Ready · 2 read-only tools').wait_for()
        assert len(mcp_requests) == 2 and mcp_requests[1] == {'action':'check','servers':['library']}
        width = await page.evaluate('document.documentElement.scrollWidth')
        assert width <= 390, width
        await page.locator('#settings-dialog').evaluate('(el) => el.close()')
        await page.locator('#mobile-chat-toggle').click()
        await page.locator('#chat-new-thread-button').click()
        await page.locator('#chat-input').fill('Find relevant notes')
        await page.locator('#chat-send-button').click()
        await page.wait_for_function('document.querySelector("#chat-message-list").textContent.includes("Test response")')
        assert chat_requests[0]['mcpServers'] == ['library','archive']
        assert chat_requests[0]['accountToken'] == 'test-account'
        # Changing account scope drops opt-in without making a network request.
        await page.evaluate('''() => {
          const t=window.__mcpTest;
          t.syncState.account={token:'test-account',username:'other',teams:['friends']};
          t.renderChatPanel(t.controller.getProject());
        }''')
        assert await page.locator('#chat-mcp-summary').is_hidden()
        assert len(mcp_requests) == 2
        await page.locator('#chat-input').fill('Ordinary chat')
        await page.locator('#chat-send-button').click()
        await page.wait_for_function('document.querySelector("#chat-message-list").textContent.includes("Ordinary chat") && !window.__mcpTest.controller.getProject().missing')
        await page.wait_for_timeout(100)
        assert len(chat_requests) == 2, chat_requests
        assert 'mcpServers' not in chat_requests[1] and 'accountToken' not in chat_requests[1]
        await page.evaluate('window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));')
        assert len(mcp_requests) == 2, 'Foreground/recovery must not run MCP'
        assert not errors, errors
        print(json.dumps({'mcpRequests':len(mcp_requests),'chatRequests':len(chat_requests),'runtimeErrors':len(errors)}))
        await browser.close()

asyncio.run(main())
