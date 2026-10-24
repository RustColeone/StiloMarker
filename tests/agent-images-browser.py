"""Optional browser regression: signed-in agent with GPT models and generated
images, against a mocked API. STILO_BROWSER may point at an existing Chromium.
Static responses are overlaid from this checkout, so no HTTP server is needed.
"""
import asyncio
import base64
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright
from helpers.chat_hook import CHAT_HOOK, WAIT_LOADED, inject_chat_internals
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
# A real 2x2 PNG, so the preview can decode it.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAwMDAwMDAAAANAAH/vsmGJQAAAABJRU5ErkJggg==')
IMAGE_ID = 'f' * 32


def project():
    return {'id': 'img-test', 'name': 'Novel', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'chapter', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['chapter'], 'expanded': True},
        'chapter': {'id': 'chapter', 'kind': 'file', 'parentId': 'root', 'name': 'chapter.md', 'content': '# One\nThe lamp.', 'dirty': False}}}


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1280, 'height': 860}, service_workers='block')
        page = await context.new_page()
        errors, chats, generated = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');')

        async def route_request(route):
            parsed = urlparse(route.request.url)
            if parsed.netloc != urlparse(BASE).netloc:
                await route.continue_(); return
            path = parsed.path
            if path == '/api/generated':
                query = parse_qs(parsed.query)
                generated.append(query)
                if query.get('token') == ['acct-1'] and query.get('id') == [IMAGE_ID]:
                    await route.fulfill(status=200, content_type='image/png', body=PNG)
                else:
                    await route.fulfill(status=403, content_type='application/json', body='{"message":"no"}')
                return
            if path.startswith('/api/'):
                if path == '/api/chat/status':
                    payload = {'configured': True, 'provider': 'DeepSeek', 'model': 'deepseek-flash', 'localOnly': False,
                               'models': ['deepseek-flash', 'deepseek-v4-pro', 'gpt-5.1', 'gpt-5.1-mini'],
                               'modelInfo': [{'id': 'deepseek-flash', 'provider': 'DeepSeek'}, {'id': 'deepseek-v4-pro', 'provider': 'DeepSeek'},
                                             {'id': 'gpt-5.1', 'provider': 'OpenAI'}, {'id': 'gpt-5.1-mini', 'provider': 'OpenAI'}],
                               'imageGeneration': True, 'requiresAccount': True, 'message': 'Chat proxy is configured for this server.'}
                elif path == '/api/auth/login':
                    payload = {'token': 'acct-1', 'username': 'leo', 'teams': ['blue'], 'lastWorkspace': None}
                elif path == '/api/chat':
                    body = route.request.post_data_json
                    chats.append(body)
                    payload = {'message': 'Here is Mara at the lamp.', 'model': body.get('model'), 'provider': 'OpenAI', 'contextPaths': [],
                               'batchId': 'batch-1', 'proposedOperations': [{
                                   'proposalId': 'op-1', 'type': 'create-file', 'parentPath': '', 'name': 'mara.png', 'content': '',
                                   'generatedImage': {'id': IMAGE_ID, 'mime': 'image/png', 'size': '1024x1536',
                                                      'model': 'gpt-image-1.5', 'prompt': 'Mara at the lamp, ink wash'}}]}
                elif path == '/api/ping':
                    payload = {'appVersion': '0.1.27', 'minSyncVersion': 117, 'accounts': True}
                elif path == '/api/workspaces':
                    payload = {'workspaces': []}
                else:
                    payload = {}
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = inject_chat_internals(path, file.read_bytes())
                if path == '/app/main.js':
                    body += app_hook('window.__imgTest = {controller, performLogin:(...a)=>modules.cloud.parts().performLogin(...a), syncState, ' + CHAT_HOOK + '};')
                await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
            else:
                await route.continue_()

        await context.route('**/*', route_request)
        await page.goto(BASE, wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__imgTest)')
        if await page.locator('#chat-panel').is_hidden():
            await page.locator('#right-panel-toggle').click()
        await page.wait_for_function(WAIT_LOADED)  # the chat panel loads on demand

        # Signed out: the server's agent asks for a sign-in and sends nothing.
        await page.wait_for_function('window.__imgTest.agentStatus.status === "signin"')
        badge = page.locator('#chat-status-text')
        # The compose footer's status: a word when something needs attention,
        # the full detail in its tooltip.
        assert (await badge.inner_text()).strip() == 'Sign in'
        assert 'Sign in to use the agent' in await badge.get_attribute('title')
        assert await badge.get_attribute('data-tone') == 'warn'
        assert await page.locator('#chat-model-select').is_hidden()
        await page.locator('#chat-input').fill('Draw Mara')
        await page.locator('#chat-input').press('Enter')
        await page.wait_for_function('!window.__imgTest.chatState.sending')
        assert chats == [], chats
        assert 'Sign in to use the agent' in await page.locator('#chat-message-list').inner_text()

        # Signed in: ready, and the picker groups models by provider.
        await page.evaluate('window.__imgTest.performLogin("leo", "pw", { silent: true })')
        await page.wait_for_function('window.__imgTest.agentStatus.status === "ready"')
        groups = await page.evaluate('[...document.querySelectorAll("#chat-model-select optgroup")].map(g => [g.label, [...g.children].map(o => o.value)])')
        assert groups == [['DeepSeek', ['deepseek-flash', 'deepseek-v4-pro']], ['OpenAI', ['gpt-5.1', 'gpt-5.1-mini']]], groups
        assert await page.locator('#chat-model-select').input_value() == 'deepseek-flash'
        assert 'DeepSeek' in await badge.get_attribute('title')
        assert await badge.get_attribute('data-tone') == 'ok'
        await page.locator('#chat-model-select').select_option('gpt-5.1')
        assert 'OpenAI' in await badge.get_attribute('title')

        # A generated image arrives as an edit, is shown, and is saved as a file.
        await page.locator('#chat-input').fill('Draw Mara at the lamp')
        await page.locator('#chat-input').press('Enter')
        await page.wait_for_function('!window.__imgTest.chatState.sending')
        assert chats[-1]['model'] == 'gpt-5.1' and chats[-1]['accountToken'] == 'acct-1', chats[-1]
        await page.wait_for_function('Object.values(window.__imgTest.controller.getProject().nodes).some(n => n.name === "mara.png")')
        saved = await page.evaluate('Object.values(window.__imgTest.controller.getProject().nodes).find(n => n.name === "mara.png").content')
        assert saved == 'data:image/png;base64,' + base64.b64encode(PNG).decode(), saved[:80]
        card = page.locator('#chat-message-list .proposal-card')
        thumb = card.locator('.proposal-image img')
        await thumb.wait_for()
        assert await thumb.evaluate('img => img.complete && img.naturalWidth === 2'), 'thumbnail should load'
        assert 'Mara at the lamp, ink wash' in await card.inner_text()
        assert '1024x1536' in await card.inner_text()
        assert any('mara.png' in row for row in await page.locator('.tree-row').all_inner_texts())
        assert all(q.get('token') == ['acct-1'] for q in generated)
        # The chat history keeps only the image id, never its bytes.
        stored = await page.evaluate('localStorage.getItem("mdnotes.chat.v1")')
        assert IMAGE_ID in stored and base64.b64encode(PNG).decode() not in stored

        # Keep finalises it; the file stays.
        await card.locator('[data-batch-keep]').click()
        assert 'Edits kept' in await page.locator('#chat-message-list .proposal-card').inner_text()
        assert any('mara.png' in row for row in await page.locator('.tree-row').all_inner_texts())
        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['signed out: sign-in status, nothing sent', 'models grouped by provider',
                                     'GPT model and account token sent', 'generated image saved as a file',
                                     'thumbnail shown in the edit card', 'chat history holds only the id', 'Keep'],
                          'chatRequests': len(chats), 'imageFetches': len(generated), 'runtimeErrors': len(errors)}))


asyncio.run(main())
