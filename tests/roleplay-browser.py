"""Optional browser regression: the Roleplay tab with mocked chat API.
Run with Playwright installed; STILO_BROWSER may point at an existing Chromium.
Static responses are overlaid from this checkout, so no HTTP server is needed.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
SVG = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9InJlZCIvPjwvc3ZnPg=='
ARIA = '---\nname: Captain Aria Voss\navatar: portraits/aria.svg\ncolor: #b5523b\n---\n## Who they are\nA smuggler captain.\n'
BRAM = '## Who they are\nA nervous cook who talks too much.\n'


def project():
    nodes = {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['story', 'portraits', 'aria', 'bram'], 'expanded': True},
        'story': {'id': 'story', 'kind': 'folder', 'name': 'Story', 'parentId': 'root', 'children': ['chapter'], 'expanded': True},
        'chapter': {'id': 'chapter', 'kind': 'file', 'parentId': 'story', 'name': 'chapter.md', 'content': '# One\nThe ship sank at dawn.', 'dirty': False},
        'portraits': {'id': 'portraits', 'kind': 'folder', 'name': 'portraits', 'parentId': 'root', 'children': ['aria-img'], 'expanded': True},
        'aria-img': {'id': 'aria-img', 'kind': 'file', 'parentId': 'portraits', 'name': 'aria.svg', 'content': SVG, 'dirty': False},
        'aria': {'id': 'aria', 'kind': 'file', 'parentId': 'root', 'name': 'aria.persona.skill', 'content': ARIA, 'dirty': False},
        'bram': {'id': 'bram', 'kind': 'file', 'parentId': 'root', 'name': 'bram.persona.skill', 'content': BRAM, 'dirty': False},
    }
    return {'id': 'rp-test', 'name': 'Novel', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'chapter', 'nodes': nodes}


async def open_page(browser, requests, viewport, hold=None, init_project=True, **options):
    context = await browser.new_context(viewport=viewport, service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    if init_project:
        await page.add_init_script('if (!localStorage.getItem("mdnotes.project.v1")) localStorage.setItem("mdnotes.project.v1", '
                                   + json.dumps(json.dumps(project())) + ');')

    async def route_request(route):
        parsed = urlparse(route.request.url)
        if parsed.netloc != urlparse(BASE).netloc:
            await route.continue_(); return
        path = parsed.path
        if path.startswith('/api/'):
            if path == '/api/chat/status':
                payload = {'configured': True, 'provider': 'Test', 'model': 'test-model', 'models': ['test-model'], 'localOnly': False}
            elif path == '/api/chat':
                body = route.request.post_data_json
                requests.append(body)
                if hold is not None and hold.get('next'):
                    gate = hold.pop('next')
                    await gate.wait()
                name = body.get('persona', {}).get('name', 'Agent')
                payload = {'message': f'{name} answers #{len(requests)}', 'proposedOperations': [], 'speaker': body.get('persona', {}).get('path')}
            elif path == '/api/ping':
                payload = {'appVersion': '0.1.25', 'minSyncVersion': 116}
            else:
                payload = {}
            try:
                await route.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
            except Exception:
                pass  # the page aborted the request (Stop)
            return
        file = ROOT / (path.lstrip('/') or 'index.html')
        if file.is_file():
            body = file.read_bytes()
            if path == '/app/main.js':
                body += (b'\nwindow.__rpTest = {chatState, controller, moveExplorerNode, getActiveChatThread,'
                         b' get roleplay() { return roleplay; }, setChatTab, setPreviewFile};\n')
            await route.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
        else:
            await route.continue_()

    await context.route('**/*', route_request)
    await page.goto(BASE, wait_until='networkidle')
    await page.wait_for_function('Boolean(window.__rpTest)')
    return context, page, errors


async def send(page, text):
    await page.locator('#chat-input').fill(text)
    await page.locator('#chat-input').press('Enter')
    await page.wait_for_function('!window.__rpTest.chatState.sending')


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        requests, hold = [], {}
        context, page, errors = await open_page(browser, requests, {'width': 1280, 'height': 860}, hold=hold)

        # Open the chat and switch to Roleplay; the module loads on demand.
        if await page.locator('#chat-panel').is_hidden():
            await page.locator('#chat-toggle-activity-button').click()
        assert await page.locator('#chat-cast-bar').is_hidden()
        await page.locator('[data-chat-tab="roleplay"]').click()
        await page.wait_for_function('Boolean(window.__rpTest.roleplay)')
        assert await page.locator('[data-chat-tab="roleplay"]').get_attribute('aria-selected') == 'true'
        assert await page.locator('#chat-input').get_attribute('placeholder') == 'Message the group — @name to ask someone'
        assert 'Add characters' in await page.locator('#chat-message-list').inner_text()

        # Add both characters from the picker.
        await page.locator('[data-rp-add]').click()
        items = page.locator('.rp-popover .rp-item')
        labels = await items.all_inner_texts()
        assert any('Captain Aria Voss' in label for label in labels), labels
        assert any('bram' in label for label in labels), labels
        assert 'New character' in labels[-1], labels
        await items.filter(has_text='Captain Aria Voss').click()
        await page.locator('[data-rp-add]').click()
        await page.locator('.rp-popover .rp-item').filter(has_text='bram').click()
        chips = page.locator('#chat-cast-bar .rp-member')
        assert await chips.count() == 2
        assert await chips.nth(0).locator('img').count() == 1, 'avatar image should resolve'
        assert (await chips.nth(1).locator('.persona-avatar').inner_text()).strip() == 'B'
        thread = await page.evaluate('window.__rpTest.getActiveChatThread()')
        assert thread['kind'] == 'group' and thread['members'] == ['aria.persona.skill', 'bram.persona.skill'], thread

        # @mention autocomplete.
        await page.locator('#chat-input').fill('')
        await page.locator('#chat-input').type('@ar')
        await page.locator('.rp-popover .rp-item').first.wait_for()
        assert 'Captain Aria Voss' in await page.locator('.rp-popover .rp-item.is-active').inner_text()
        await page.locator('#chat-input').press('Enter')
        assert await page.locator('#chat-input').input_value() == '@aria '
        assert await page.locator('.rp-popover').is_hidden()
        assert len(requests) == 0, 'accepting a mention must not send'

        # One mention → one reply from that character.
        await page.locator('#chat-input').type('is the hold flooding?')
        await page.locator('#chat-input').press('Enter')
        await page.wait_for_function('!window.__rpTest.chatState.sending')
        assert len(requests) == 1
        first = requests[0]
        assert first['mode'] == 'persona' and first['persona']['name'] == 'Captain Aria Voss'
        assert first['persona']['content'] == ARIA
        assert [m['name'] for m in first['cast']] == ['Captain Aria Voss', 'bram']
        assert first['messages'] == [{'name': 'Author', 'content': '@aria is the hold flooding?', 'self': False}], first['messages']
        assert 'mcpServers' not in first
        reply = page.locator('#chat-message-list .rp-message').last
        assert await reply.locator('.rp-speaker').inner_text() == 'Captain Aria Voss'
        assert await reply.locator('img').count() == 1
        assert 'Captain Aria Voss answers #1' in await reply.inner_text()
        assert await page.locator('#chat-message-list .rp-mention').count() == 1

        # No mention → narration, no request.
        await send(page, 'The storm hits. Write to aria@ship.com later.')
        assert len(requests) == 1

        # @all → everyone in cast order; the second sees the first's reply.
        await send(page, '@all what now?')
        assert len(requests) == 3
        assert requests[1]['persona']['name'] == 'Captain Aria Voss' and requests[2]['persona']['name'] == 'bram'
        last = requests[2]['messages'][-1]
        assert last == {'name': 'Captain Aria Voss', 'content': 'Captain Aria Voss answers #2', 'self': False}, last
        own = [m for m in requests[1]['messages'] if m['self']]
        assert own == [{'name': 'Captain Aria Voss', 'content': 'Captain Aria Voss answers #1', 'self': True}], own

        # Stop during the first reply cancels the rest of the queue.
        hold['next'] = asyncio.Event()
        await page.locator('#chat-input').fill('@all one more time')
        await page.locator('#chat-input').press('Enter')
        await page.wait_for_function('window.__rpTest.chatState.turn?.speaker?.name === "Captain Aria Voss"')
        assert 'is replying' in await page.locator('#chat-message-list .rp-message.is-streaming').inner_text()
        assert 'Next: bram' in await page.locator('#chat-message-list .rp-message.is-streaming').inner_text()
        await page.locator('#chat-send-button').click()  # the Stop button
        await page.wait_for_function('!window.__rpTest.chatState.sending')
        assert len(requests) == 4, len(requests)
        assert 'Stopped before Captain Aria Voss replied.' in await page.locator('#chat-message-list').inner_text()

        # The agent tab never lists group chats.
        await page.locator('[data-chat-tab="agent"]').click()
        assert await page.locator('#chat-cast-bar').is_hidden()
        assert await page.evaluate('window.__rpTest.getActiveChatThread()?.kind') is None
        assert 'what now' not in await page.locator('#chat-thread-list').inner_text()
        await page.locator('[data-chat-tab="roleplay"]').click()
        assert 'what now' in await page.locator('#chat-message-list').inner_text()

        # Moving a character's file keeps it in the cast and on its old replies.
        moved = await page.evaluate('window.__rpTest.moveExplorerNode("aria", "story", "into")')
        assert moved
        thread = await page.evaluate('window.__rpTest.getActiveChatThread()')
        assert thread['members'][0] == 'Story/aria.persona.skill', thread['members']
        assert all(m.get('speaker') in (None, 'Story/aria.persona.skill', 'bram.persona.skill') for m in thread['messages'])
        assert await page.locator('#chat-cast-bar .rp-member.is-missing').count() == 0
        # (The avatar path is relative to the persona file, so after the move it no
        # longer resolves and the chip falls back to initials.)
        assert (await chips.nth(0).locator('.persona-avatar').inner_text()).strip() == 'CV'

        # Deleting a character marks it missing; the menu can replace it.
        await page.evaluate('(() => { const t = window.__rpTest; t.controller.remove("bram"); })()')
        await page.evaluate('window.__rpTest.setChatTab("agent")')
        await page.evaluate('window.__rpTest.setChatTab("roleplay")')
        assert await page.locator('#chat-cast-bar .rp-member.is-missing').count() == 1
        await page.locator('#chat-cast-bar .rp-member.is-missing').click()
        menu = await page.locator('.rp-popover .rp-item').all_inner_texts()
        assert any('Replace with' in item for item in menu) and any('Remove from chat' in item for item in menu), menu
        await page.locator('.rp-popover .rp-item').filter(has_text='Remove from chat').click()
        assert await chips.count() == 1

        # The tab, the group chat and its cast survive a reload.
        await page.reload(wait_until='networkidle')
        await page.wait_for_function('Boolean(window.__rpTest)')
        await page.wait_for_function('Boolean(window.__rpTest.roleplay)')
        assert await page.locator('[data-chat-tab="roleplay"]').get_attribute('aria-selected') == 'true'
        assert await page.locator('#chat-cast-bar .rp-member').count() == 1
        assert 'what now' in await page.locator('#chat-message-list').inner_text()

        # A character file previews as a card; New Character creates a template.
        await page.evaluate('document.getElementById("new-persona-button").click()')
        await page.wait_for_function('window.__rpTest.controller.getActiveFile()?.name === "new character 1.persona.skill"')
        created = await page.evaluate('window.__rpTest.controller.getActiveFile().content')
        assert created.startswith('---\nname: New Character\n') and '## How they speak' in created, created
        await page.evaluate('window.__rpTest.setPreviewFile(window.__rpTest.controller.getActiveFile().id)')
        await page.locator('#preview-output .persona-card').wait_for()
        assert 'New Character' in await page.locator('#preview-output .persona-card-name').inner_text()
        assert '@new-character-1' in await page.locator('#preview-output .persona-card').inner_text()
        assert 'name: New Character' not in await page.locator('#preview-output').inner_text()
        assert not errors, errors
        await context.close()

        # Phone width: tabs, cast and composer fit without sideways scrolling.
        phone_requests = []
        context, page, errors = await open_page(browser, phone_requests, {'width': 375, 'height': 760},
                                                is_mobile=True, has_touch=True, device_scale_factor=1)
        await page.locator('#mobile-chat-toggle').click()
        await page.locator('[data-chat-tab="roleplay"]').click()
        await page.wait_for_function('Boolean(window.__rpTest.roleplay)')
        await page.locator('[data-rp-add]').click()
        await page.locator('.rp-popover .rp-item').filter(has_text='Captain Aria Voss').click()
        await page.locator('[data-rp-add]').click()
        await page.locator('.rp-popover .rp-item').filter(has_text='bram').click()
        widths = await page.evaluate('''() => ({
            page: document.documentElement.scrollWidth, view: innerWidth,
            toolbar: [document.querySelector('.chat-toolbar').scrollWidth, document.querySelector('.chat-toolbar').clientWidth],
            cast: [document.querySelector('#chat-cast-bar').scrollWidth, document.querySelector('#chat-cast-bar').clientWidth],
            tabs: [...document.querySelectorAll('.chat-tab')].map(tab => tab.getBoundingClientRect().height)
        })''')
        assert widths['page'] <= widths['view'], widths
        assert widths['toolbar'][0] <= widths['toolbar'][1], widths
        assert widths['cast'][0] <= widths['cast'][1], widths
        assert all(height >= 44 for height in widths['tabs']), widths
        await page.locator('#chat-input').fill('@bram hello')
        await page.locator('#chat-send-button').click()  # Enter is a new line on phones
        await page.wait_for_function('!window.__rpTest.chatState.sending')
        assert len(phone_requests) == 1 and phone_requests[0]['persona']['name'] == 'bram'
        assert not errors, errors
        await context.close()
        await browser.close()
        print('roleplay browser regression passed')


asyncio.run(main())
