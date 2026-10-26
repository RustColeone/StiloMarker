"""Browser regression: each editor keeps its own place in a file (v0.3.16).

The same long file in both groups, each editor at its own caret and scroll
(the right one scrolled without the focus, as the wheel does): a reload
brings each back where it was (before, both opened at the one place kept
for the file, and the editor without the focus kept no scroll at all).
Closing the file's tab in a group forgets that group's place, the file's
latest being where it was left; Open to the Side starts the editor there
where the first one was. No page errors.

Isolated: a mocked account and workspace; no real account or writing project is used.
"""
import asyncio
import json
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = os.environ.get('STILO_TEST_URL', 'https://stilomarker.ngantech.net')

LINES = [f'Line {n} of the long chapter, written out to fill the editor.' for n in range(1, 601)]
TEXT = '\n'.join(LINES)


def offset(line):
    """The offset of the start of a line (1-based)."""
    return sum(len(text) + 1 for text in LINES[:line - 1])


# Each editor: the file it shows, its caret (the page's where it has the focus, else its kept one), its scroll.
PLACES = '''() => Object.fromEntries(["left", "right"].map((group) => {
  const editor = window.__t.parts.editorOf(group);
  const content = editor.elements.editorContent;
  const caret = document.activeElement === content ? editor.getEditorSelection() : editor.keptSelection();
  return [group, { file: editor.shown.fileId, caret: caret?.start ?? null, scroll: Math.round(content.scrollTop),
    shown: editor.elements.sourceBody.dataset.shown === "true" }];
}))'''

# Put an editor's caret at an offset (it has the focus), then scroll it.
PLACE = '''async ([group, at, scroll]) => {
  const editor = window.__t.parts.editorOf(group);
  editor.elements.editorContent.focus();
  editor.setEditorSelection(at, at);
  await new Promise((resolve) => setTimeout(resolve, 150));
  editor.elements.editorContent.scrollTop = scroll;
  editor.elements.editorContent.dispatchEvent(new Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 150));
}'''

# Scroll an editor without giving it the focus (the wheel does that).
SCROLL = '''async ([group, scroll]) => {
  const content = window.__t.parts.editorOf(group).elements.editorContent;
  content.scrollTop = scroll;
  content.dispatchEvent(new Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 150));
}'''

BOTH_SHOW = '''() => { const parts = window.__t?.parts; return Boolean(parts) && ["left", "right"].every((group) =>
  parts.editorOf(group)?.shown.fileId === "long" && parts.editorOf(group).elements.editorContent.textContent.includes("Line 1 of")); }'''


def near(value, expected, slack=40):
    return value is not None and abs(value - expected) <= slack


async def main():
    project = {'id': 'places', 'name': 'Campaign', 'rootId': 'root', 'activeFileId': None, 'sourceMode': 'memory', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Campaign', 'children': ['long', 'short'], 'expanded': True},
        'long': {'id': 'long', 'kind': 'file', 'parentId': 'root', 'name': 'long.md', 'content': TEXT, 'dirty': False},
        'short': {'id': 'short', 'kind': 'file', 'parentId': 'root', 'name': 'short.md', 'content': '# Short', 'dirty': False}}}
    resume = {'openFiles': ['long.md', 'short.md'], 'activeFile': 'long.md', 'groups': [
        {'id': 'left', 'tabs': [{'path': 'long.md', 'view': 'source'}], 'active': {'path': 'long.md', 'view': 'source'}},
        {'id': 'right', 'tabs': [{'path': 'short.md', 'view': 'source'}, {'path': 'long.md', 'view': 'source'}],
         'active': {'path': 'long.md', 'view': 'source'}}]}
    settings = {'serverUrl': BASE, 'accountUsername': 'test-user', 'accountPassword': 'test-only', 'accountSuccess': {BASE: 'test-user'},
                'lastWorkspace': {'team': 'friends', 'path': ''}, 'syncedProjectId': 'friends/other', 'syncedRevision': 1}
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("mdnotes.settings.v1",' + json.dumps(json.dumps(settings)) + '); }')
        await page.add_init_script('window.EventSource = class { constructor() {} close() {} };')

        async def route(rt):
            path = urlparse(rt.request.url).path
            if path.startswith('/api/'):
                payload = {}
                if path == '/api/ping':
                    payload = {'accounts': True, 'appVersion': 'dev', 'minSyncVersion': 114}
                elif path == '/api/chat/status':
                    payload = {'configured': False}
                elif path == '/api/auth/login':
                    payload = {'token': 'account-1', 'username': 'test-user', 'teams': ['friends']}
                elif path == '/api/workspaces/open':
                    payload = {'token': 'session-1', 'clientId': 'desk', 'workspace': 'friends/', 'revision': 1, 'role': 'master', 'resume': resume}
                elif path == '/api/session/state':
                    payload = {'project': project, 'revision': 1, 'presence': []}
                elif path == '/api/chat/workspace':
                    payload = {'threads': [], 'revision': 0}
                elif path == '/api/workspaces/user-state':
                    payload = {'ok': True}
                elif 'snapshots' in path:
                    payload = {'snapshots': []}
                await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload))
                return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                body = file.read_bytes()
                if path == '/app/main.js':
                    body += app_hook('window.__t = { controller, parts: editorParts };')
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=body)
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function(BOTH_SHOW, timeout=20000)
        await page.wait_for_timeout(600)

        # Each editor at its own place: the right one's caret at line 400, then
        # the left's at line 100 (the left the active one), the right scrolled
        # once more without the focus.
        await page.evaluate(PLACE, ['right', offset(400), 7000])
        await page.evaluate(PLACE, ['left', offset(100), 1800])
        await page.evaluate(SCROLL, ['right', 8200])
        before = await page.evaluate(PLACES)
        assert before['left']['caret'] == offset(100) and before['right']['caret'] == offset(400), before
        assert near(before['left']['scroll'], 1800) and near(before['right']['scroll'], 8200), before
        assert await page.evaluate('window.__t.parts.editorOf("left").isActiveEditor()'), 'the editor worked in last is the active one'

        # A reload: each comes back at its own caret and scroll.
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function(BOTH_SHOW, timeout=20000)
        for _ in range(40):
            after = await page.evaluate(PLACES)
            if near(after['left']['scroll'], 1800) and near(after['right']['scroll'], 8200):
                break
            await page.wait_for_timeout(100)
        assert after['left']['caret'] == offset(100) and after['right']['caret'] == offset(400), after
        assert near(after['left']['scroll'], 1800) and near(after['right']['scroll'], 8200), after

        # The right one worked in, then its tab of the file closed: the right's
        # own place goes; the file's latest is where it was left (the right's).
        await page.evaluate('() => { const content = window.__t.parts.editorOf("right").elements.editorContent; content.focus(); }')
        await page.wait_for_timeout(200)
        assert await page.evaluate('window.__t.parts.editorOf("right").isActiveEditor()')
        await page.evaluate('() => window.__t.parts.closeTab("right", { fileId: "long", view: "source" })')
        await page.wait_for_timeout(300)
        closed = await page.evaluate('''() => { const parts = window.__t.parts; const state = parts.getViewState("long");
          return { own: Object.keys(state.byEditor ?? {}), latest: state.editorSelection?.start ?? null, right: parts.editorOf("right").shown.fileId }; }''')
        assert closed['right'] == 'short' and closed['own'] == ['left'] and closed['latest'] == offset(400), closed

        # Open to the Side from the left: the right editor starts where the left one is.
        await page.evaluate('() => window.__t.parts.moveTabToGroup("left", { fileId: "long", view: "source" }, { keep: true })')
        for _ in range(40):
            side = await page.evaluate(PLACES)
            if side['right']['file'] == 'long' and near(side['right']['scroll'], 1800):
                break
            await page.wait_for_timeout(100)
        assert side['right']['file'] == 'long' and side['right']['caret'] == offset(100) and near(side['right']['scroll'], 1800), side
        assert side['left']['caret'] == offset(100) and near(side['left']['scroll'], 1800), side

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['each editor at its own caret and scroll after a reload',
                                     'the scroll of the editor without the focus kept',
                                     'a closed tab forgets its group\'s place; the file keeps where it was left',
                                     'Open to the Side starts where the first editor is']}))


asyncio.run(main())
