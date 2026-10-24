"""Browser regression: the Agent with the user's own key and no server (O3 of
the stability review; experiment E1).

Every /api/ request is refused (there is no server). Settings → Agent: the
user's own endpoint, "Directly from this browser"; the endpoint is a stand-in
OpenAI-compatible model on another origin (it answers CORS, streams). The
status says it is ready from this browser; a turn reads a file, proposes an
edit and answers; the edit lands in the file with a Keep / Drop bar, and
Keep keeps it; the server was never asked. Switched to "Through this
server", the status says the server can't be reached and how to work
without it, instead of claiming to be ready. And Chats, in the same
browser-only workspace: a private chat with a character gets its reply from
the same endpoint, the request built in the browser (the character's sheet,
never its author's notes, read-only tools), no server asked. No page errors.
"""
import asyncio, json, mimetypes, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
MODEL = 'https://llm.example/v1/chat/completions'
SETTINGS = {'chatPanel': 'shown', 'agentSource': 'own', 'agentApiKey': 'sk-test', 'agentApiUrl': MODEL,
            'agentModel': 'test-model', 'agentRunner': 'browser'}
PROJECT = {'id': 'byok', 'name': 'BYOK', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'n', 'nodes': {
    'root': {'id': 'root', 'kind': 'folder', 'name': 'BYOK', 'children': ['n'], 'expanded': True},
    'n': {'id': 'n', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes\n\nOne two three.', 'dirty': False}}}
HOOK = app_hook('window.__byok = { shell, controller };')


def sse(*chunks):
    lines = [f'data: {json.dumps({"choices": [{"delta": chunk}]})}\n\n' for chunk in chunks]
    return ''.join(lines) + 'data: [DONE]\n\n'


def tool_call(call_id, name, args):
    return {'tool_calls': [{'index': 0, 'id': call_id, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context = await browser.new_context(viewport={'width': 1400, 'height': 860}, service_workers='block')
        page = await context.new_page()
        errors, api, bodies = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await context.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                      ' localStorage.setItem("mdnotes.settings.v1", ' + json.dumps(json.dumps(SETTINGS)) + ');'
                                      ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(PROJECT)) + '); }')

        async def route(rt):
            url = urlparse(rt.request.url)
            if url.netloc == 'llm.example':
                cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'}
                if rt.request.method == 'OPTIONS':
                    await rt.fulfill(status=204, headers=cors); return
                body = json.loads(rt.request.post_data or '{}')
                bodies.append(body)
                last = body['messages'][-1]
                # A character: answers in character.
                if body['messages'][0]['content'].startswith('You are playing '):
                    said = last['content'].split(': ', 1)[-1]
                    await rt.fulfill(status=200, headers={**cors, 'content-type': 'text/event-stream'},
                                     body=sse({'content': f'Aye, {said}'})); return
                # The stand-in model: read the file, then edit it, then answer.
                if last['role'] == 'user':
                    reply = sse({'role': 'assistant'}, tool_call('c1', 'read_file', {'path': 'notes.md'}))
                elif 'One two three' in last.get('content', ''):
                    reply = sse(tool_call('c2', 'edit_file', {'path': 'notes.md', 'edits': [{'find': 'two', 'replace': '2'}]}))
                else:
                    reply = sse({'reasoning_content': 'The edit is proposed. '}, {'content': 'Changed two '}, {'content': 'to 2.'})
                await rt.fulfill(status=200, headers={**cors, 'content-type': 'text/event-stream'}, body=reply); return
            if url.netloc != urlparse(BASE).netloc:
                await rt.abort(); return
            if url.path.startswith('/api/'):
                api.append(f'{rt.request.method} {url.path}')
                await rt.abort('connectionrefused'); return
            file = ROOT / (url.path.lstrip('/') or 'index.html')
            if not file.is_file():
                await rt.fulfill(status=404, body=''); return
            body = file.read_bytes() + (HOOK if url.path == '/app/main.js' else b'')
            await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
        await context.route('**/*', route)

        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('Boolean(window.__byok)', timeout=30000)
        await page.wait_for_selector('#chat-input', state='visible', timeout=20000)
        await page.wait_for_timeout(800)

        # Ready, from this browser.
        await page.evaluate('window.__byok.shell.settingsDialog.open("agent")')
        line = await page.locator('#agent-status-line').inner_text()
        assert 'from this browser' in line and 'Ready' in line, line
        await page.keyboard.press('Escape')

        # A turn: read, edit, answer.
        await page.fill('#chat-input', 'Use digits in my notes')
        await page.keyboard.press('Enter')
        await page.wait_for_function('document.body.textContent.includes("Changed two to 2.")', timeout=20000)
        assert len(bodies) == 3, len(bodies)
        assert bodies[0]['model'] == 'test-model' and bodies[0]['stream'] is True
        assert any(tool['function']['name'] == 'edit_file' for tool in bodies[0]['tools'])
        assert 'workspace assistant' in bodies[0]['messages'][0]['content'] and 'file: notes.md' in bodies[0]['messages'][0]['content']
        assert json.loads(bodies[1]['messages'][-1]['content']) == {'content': '# Notes\n\nOne two three.'}
        assert json.loads(bodies[2]['messages'][-1]['content'])['status'] == 'proposed'
        assert bodies[0]['messages'][0]['role'] == 'system'

        # The edit is in the file, with a Keep / Drop bar; Keep keeps it.
        content = await page.evaluate('window.__byok.controller.getProject().nodes.n.content')
        assert content == '# Notes\n\nOne 2 three.', content
        await page.wait_for_selector('[data-batch-keep]', timeout=10000)
        await page.locator('[data-batch-keep]').first.click()
        await page.wait_for_function('![...document.querySelectorAll("[data-batch-keep]")].some((button) => button.offsetParent !== null)', timeout=10000)
        assert await page.evaluate('window.__byok.controller.getProject().nodes.n.content') == '# Notes\n\nOne 2 three.'
        assert not [request for request in api if request.endswith('/api/chat') or '/api/chat/' in request], api

        # Through the server, which can't be reached: said, not "ready".
        await page.evaluate('window.__byok.shell.settingsDialog.open("agent")')
        await page.select_option('#agent-runner-select', 'server')
        # (Read as it is seen: the app may ask the server again meanwhile, and say "Checking" while it does.)
        seen = await page.wait_for_function('(() => { const text = document.querySelector("#agent-status-line").textContent; return text.includes("unreachable") && text; })()', timeout=15000)
        line = await seen.json_value()
        assert 'Directly from this browser' in line, line

        # Chats in the same browser-only workspace: a character's reply from the same endpoint.
        chats = await browser.new_context(viewport={'width': 1400, 'height': 860}, service_workers='block')
        aria = '---\nname: Captain Aria Voss\n---\nA smuggler with a soft heart.\n\n## Author\'s notes\nShe betrays them in act 3.\n'
        project = {**PROJECT, 'nodes': {**PROJECT['nodes'], 'root': {**PROJECT['nodes']['root'], 'children': ['n', 'a']},
                                        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'aria.persona.skill', 'content': aria}}}
        await chats.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                                    ' localStorage.setItem("mdnotes.settings.v1", ' + json.dumps(json.dumps({**SETTINGS, 'chatTab': 'chats'})) + ');'
                                    ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project)) + '); }')
        await chats.route('**/*', route)
        talk = await chats.new_page()
        talk.on('pageerror', lambda error: errors.append(str(error)))
        await talk.goto(BASE, wait_until='domcontentloaded')
        await talk.wait_for_selector('#chats-cast-bar .cv-search', timeout=30000)
        before, asked_server = len(bodies), len(api)
        await talk.click('[data-chats-start="char:aria.persona.skill"]')
        await talk.locator('#chats-input').fill('Ahoy')
        await talk.locator('#chats-send-button').click()
        await talk.wait_for_selector('.cv-message.rp-message:has-text("Aye, Ahoy")', timeout=30000)
        asked = bodies[before]
        system = asked['messages'][0]['content']
        assert system.startswith('You are playing Captain Aria Voss') and 'A smuggler with a soft heart.' in system, system[:200]
        assert 'betrays' not in system, 'never the author\'s notes'
        assert sorted(tool['function']['name'] for tool in asked['tools']) == ['list_files', 'read_file']
        assert asked['model'] == 'test-model'
        assert not [request for request in api[asked_server:] if request.startswith('POST')], api[asked_server:]
        await chats.close()

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['ready, from this browser, with no server', 'a turn reads a file, proposes an edit and answers (streamed)',
                                     'the first request carries the instructions, the tree and the tools', 'the edit lands with Keep / Drop; Keep keeps it',
                                     'the server was never asked', 'through an unreachable server: said, with the way out',
                                     "Chats: a character's reply from the same endpoint, built in the browser (sheet, not notes; read-only tools)"],
                          'runtimeErrors': 0}))


asyncio.run(main())
