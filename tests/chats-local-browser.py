"""Optional browser regression: Chats in a browser-only workspace (characters
only, kept in this browser), with a mocked chat API.

Checks: the list shows characters and explains people need a cloud workspace;
a private chat with a character answers every message (persona request sent);
a group with @mention suggestions, @all answering in order, Stop; an old
Roleplay group thread is moved into Chats once; a renamed character file is
followed; nothing covers the tabs; phone width fits.
Static responses are overlaid from this checkout, so no HTTP server is needed.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.chat_hook import CHAT_HOOK, WAIT_LOADED, inject_chat_internals

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
ARIA = '---\nname: Captain Aria Voss\ncolor: #b5523b\n---\n## Who they are\nA smuggler captain.\n'
BRAM = '## Who they are\nA nervous cook.\n'
OLD_THREAD = {'id': 'old', 'title': 'The storm', 'kind': 'group', 'members': ['aria.persona.skill'], 'createdAt': 1, 'updatedAt': 2,
              'messages': [{'id': 'o1', 'role': 'user', 'content': 'The lamp is out', 'createdAt': 1_700_000_000_000},
                           {'id': 'o2', 'role': 'assistant', 'content': 'Bail faster.', 'speaker': 'aria.persona.skill',
                            'speakerName': 'Captain Aria Voss', 'createdAt': 1_700_000_001_000}], 'contextPaths': [], 'draft': ''}


def project():
    return {'id': 'local-chats', 'name': 'Novel', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'ch', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Novel', 'children': ['ch', 'aria', 'bram', 'cast'], 'expanded': True},
        'ch': {'id': 'ch', 'kind': 'file', 'parentId': 'root', 'name': 'chapter.md', 'content': '# One', 'dirty': False},
        'aria': {'id': 'aria', 'kind': 'file', 'parentId': 'root', 'name': 'aria.persona.skill', 'content': ARIA, 'dirty': False},
        'bram': {'id': 'bram', 'kind': 'file', 'parentId': 'root', 'name': 'bram.persona.skill', 'content': BRAM, 'dirty': False},
        'cast': {'id': 'cast', 'kind': 'folder', 'name': 'Cast', 'parentId': 'root', 'children': [], 'expanded': True}}}


async def open_page(browser, requests, viewport, hold=None, **options):
    context = await browser.new_context(viewport=viewport, service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                               ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                               ' localStorage.setItem("mdnotes.chat.v1", ' + json.dumps(json.dumps({'projects': {'local-chats': {'threads': [OLD_THREAD]}}})) + ');'
                               ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "shown", chatTab: "chats"})); }')

    async def route(rt):
        parsed = urlparse(rt.request.url)
        if parsed.netloc != urlparse(BASE).netloc:
            await rt.continue_(); return
        path = parsed.path
        if path.startswith('/api/'):
            if path == '/api/chat/status':
                payload = {'configured': True, 'provider': 'DeepSeek', 'model': 'deepseek-flash', 'models': ['deepseek-flash', 'deepseek-v4-pro'],
                           'modelInfo': [{'id': 'deepseek-flash', 'provider': 'DeepSeek'}, {'id': 'deepseek-v4-pro', 'provider': 'DeepSeek'}],
                           'localOnly': False, 'message': 'Chat proxy is configured for this server.'}
            elif path == '/api/chat':
                body = rt.request.post_data_json
                requests.append(body)
                if hold is not None and hold.get('next'):
                    gate = hold.pop('next'); await gate.wait()
                name = body.get('persona', {}).get('name', 'Agent')
                payload = {'message': f'{name} answers #{len(requests)}', 'proposedOperations': []}
            elif path == '/api/ping':
                payload = {'appVersion': 'dev', 'minSyncVersion': 117}
            else:
                payload = {}
            try:
                await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
            except Exception:
                pass  # aborted by Stop
            return
        file = ROOT / (path.lstrip('/') or 'index.html')
        if file.is_file():
            body = inject_chat_internals(path, file.read_bytes())
            if path == '/app/main.js':
                body += b'\nwindow.__t = {controller, renameFileById, ' + CHAT_HOOK.encode() + b'};\n'
            await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
        else:
            await rt.continue_()
    await context.route('**/*', route)
    await page.goto(BASE, wait_until='networkidle')
    await page.wait_for_function('Boolean(window.__t)')
    return context, page, errors


async def send(page, text):
    await page.locator('#chats-input').fill(text)
    await page.locator('#chats-send-button').click()


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        requests, hold = [], {}
        context, page, errors = await open_page(browser, requests, {'width': 1280, 'height': 860}, hold=hold)
        await page.wait_for_function(WAIT_LOADED)
        await page.wait_for_selector('[data-chats-start]')

        # Tabs are never covered by the toolbar (v0.1.26 regression guard).
        covered = await page.evaluate('''() => [...document.querySelectorAll('.chat-tab')].filter(tab => {
            const r = tab.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== tab; }).length''')
        assert covered == 0

        # The old Roleplay group thread moved into Chats, once.
        await page.wait_for_selector('[data-chats-open]:has-text("The storm")', timeout=10000)
        assert await page.evaluate('window.__t.chatState.threads.find(t => t.id === "old").deleted') is True
        note = await page.locator('.cv-note').inner_text()
        assert 'cloud workspace' in note
        assert await page.locator('.cv-section-title', has_text='People').count() == 0
        names = await page.locator('[data-chats-start] .cv-row-title').all_inner_texts()
        assert names == ['Captain Aria Voss', 'bram'], names

        # A private chat with a character answers every message.
        await page.click('[data-chats-start="char:aria.persona.skill"]')
        # The browser's chat store opens asynchronously: wait for the chat to show.
        await page.wait_for_function('document.querySelector("#chats-input").placeholder === "Message Captain Aria Voss"', timeout=10000)
        await send(page, 'Ahoy')
        await page.wait_for_selector('.cv-message.rp-message:has-text("Captain Aria Voss answers #1")', timeout=15000)
        assert requests[0]['mode'] == 'persona' and requests[0]['persona']['name'] == 'Captain Aria Voss'
        assert requests[0]['messages'] == [{'name': 'You', 'content': 'Ahoy', 'self': False}], requests[0]['messages']

        # A group of both characters: @mention suggestions, @all in order.
        await page.click('[data-chats-back]')
        await page.click('[data-chats-new]')
        await page.check('[data-chats-pick="char:aria.persona.skill"]')
        await page.check('[data-chats-pick="char:bram.persona.skill"]')
        await page.click('[data-chats-confirm]')
        await page.wait_for_function('document.querySelector(".cv-head-sub")?.textContent === "3 members"')
        await page.locator('#chats-input').fill('')
        await page.locator('#chats-input').type('@ar')
        await page.locator('.rp-popover .rp-item.is-active').wait_for()
        await page.locator('#chats-input').press('Enter')
        assert await page.locator('#chats-input').input_value() == '@aria '
        await send(page, 'The storm hits.')  # narration: nobody replies
        await page.wait_for_timeout(600)
        assert len(requests) == 1
        await send(page, '@all what now?')
        await page.wait_for_selector('.cv-message.rp-message:has-text("bram answers #3")', timeout=15000)
        assert [r['persona']['name'] for r in requests[1:3]] == ['Captain Aria Voss', 'bram']
        assert requests[2]['messages'][-1] == {'name': 'Captain Aria Voss', 'content': 'Captain Aria Voss answers #2', 'self': False}

        # Stop during a reply keeps the chat usable and stops the queue.
        hold['next'] = asyncio.Event()
        await send(page, '@all again')
        await page.wait_for_selector('.rp-message.is-streaming [data-chats-stop]', timeout=10000)
        await page.click('[data-chats-stop]')
        await page.wait_for_selector('.cv-message .cv-state:has-text("Stopped")', timeout=10000)
        assert len(requests) == 4

        # Renaming a character file keeps it in its chats.
        await page.evaluate('() => { void window.__t.renameFileById("aria"); }')  # it waits for the dialog below
        await page.locator('#input-dialog-input').fill('captain')
        await page.locator('#input-dialog-input').press('Enter')
        await page.wait_for_timeout(800)
        await page.click('[data-chats-back]')
        await page.wait_for_selector('[data-chats-start="char:captain.persona.skill"]')
        await page.click('[data-chats-start="char:captain.persona.skill"]')
        await page.wait_for_selector('.cv-message:has-text("Ahoy")', timeout=10000)

        # Reload: the chats are still there (kept in this browser).
        await page.reload(wait_until='networkidle')
        await page.wait_for_function(WAIT_LOADED)
        await page.wait_for_selector('[data-chats-open]', timeout=15000)
        assert await page.locator('[data-chats-open]').count() == 3
        assert not errors, errors
        await context.close()

        # Phone width.
        context, phone, errors = await open_page(browser, [], {'width': 375, 'height': 760}, is_mobile=True, has_touch=True)
        await phone.locator('#mobile-chat-toggle').click()
        await phone.wait_for_function(WAIT_LOADED)
        await phone.wait_for_selector('[data-chats-start]')
        widths = await phone.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        assert widths[0] <= widths[1], widths
        assert not errors, errors
        await context.close()
        await browser.close()
        print(json.dumps({'checks': ['tabs uncovered', 'old Roleplay chat moved into Chats', 'characters only, with a note',
                                     'private character chat answers', 'group: mentions, @all order, narration',
                                     'stop', 'renamed character followed', 'kept after reload', 'phone width'], 'runtimeErrors': 0}))


asyncio.run(main())
