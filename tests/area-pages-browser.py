"""Browser regression: pages move between the areas (steps 5k and P3).

Right-click a section's header or a tab: Move to Left / Right / Bottom, or
drag it onto another area. A
section moved to a tab host becomes a tab (its toolbar in the host's header);
a tab moved to the left becomes a section; the area it went to shows it; an
area left without pages says how to fill it; the moves are kept over a
reload, and moving back restores the default places. Isolated: every API is
mocked; the welcome template is this checkout's Template folder.
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

PLACES = '''() => {
  const strip = (host) => [...document.querySelectorAll(`[data-tab-host="${host}"] [data-page]`)].filter((b) => !b.hidden).map((b) => b.dataset.page);
  const open = (host) => document.querySelector(`[data-tab-host="${host}"] [aria-selected="true"]`)?.dataset.page ?? null;
  return {
    left: [...document.querySelectorAll(".sidebar-sections > .sidebar-panel")].map((s) => s.dataset.page),
    side: strip("side"), sideOpen: open("side"), bottom: strip("bottom"), bottomOpen: open("bottom"),
    bottomEmpty: Boolean(document.querySelector('[data-tab-host="bottom"] .tab-host-empty')),
    chat: document.querySelector("#app").dataset.chat, debug: document.querySelector("#app").dataset.debug
  };
}'''
WHERE = '''(id) => { const e = document.getElementById(id); const host = e?.closest("[data-tab-host-pages], .sidebar-panel, [data-tab-host-toolbar]");
  return host ? (host.dataset.tabHostPages ?? host.dataset.tabHostToolbar ?? `section:${host.dataset.page}`) : null; }'''
MENU = '''() => [...document.querySelectorAll(".page-move-menu:not([hidden]) button")].map((b) => [b.textContent, b.disabled])'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        page = await context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))

        async def route(rt):
            path = urlparse(rt.request.url).path
            if path.startswith('/api/'):
                await rt.fulfill(status=200, content_type='application/json', body='{"appVersion":"dev","minSyncVersion":117}')
                return
            file = ROOT / (path.lstrip('/') or 'index.html')
            if file.is_file():
                await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
            else:
                await rt.fulfill(status=404, body='not found')
        await context.route('**/*', route)
        await page.goto(BASE, wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=20000)

        async def places():
            await page.wait_for_timeout(300)
            return await page.evaluate(PLACES)

        async def move(target, to):
            await target.click(button='right')
            await page.wait_for_timeout(150)
            await page.locator('.page-move-menu button', has_text=f'Move to {to}').click()

        start = await places()
        assert (start['left'], start['side'], start['bottom']) == (['search', 'links', 'session'], ['agent', 'chats'], ['log']), start

        # The menu on a section's header: where it is, ticked and disabled.
        await page.locator('.sidebar-panel-toggle[data-panel="session"]').click(button='right')
        await page.wait_for_timeout(150)
        assert await page.evaluate(MENU) == [['Move to Left', True], ['Move to Right', False], ['Move to Bottom', False]], await page.evaluate(MENU)
        await page.keyboard.press('Escape')

        # Session to the bottom: a tab there, its connection label in the bottom's header; the bottom shows.
        await move(page.locator('.sidebar-panel-toggle[data-panel="session"]'), 'Bottom')
        now = await places()
        assert now['left'] == ['search', 'links'] and now['bottom'] == ['log', 'session'] and now['bottomOpen'] == 'session', now
        assert now['debug'] == 'on', 'the bottom area shows what moved there'
        assert await page.evaluate(WHERE, 'session-panel-body') == 'bottom'
        assert await page.evaluate(WHERE, 'session-id-label') == 'bottom'
        assert await page.locator('#session-detail-text').is_visible()

        # The Log to the side panel: its toolbar in the side's header; the bottom keeps Session.
        await move(page.locator('[data-tab-host="bottom"] [data-page="log"]'), 'Right')
        now = await places()
        assert now['side'] == ['agent', 'chats', 'log'] and now['sideOpen'] == 'log' and now['chat'] == 'shown', now
        assert now['bottom'] == ['session'], now
        assert await page.evaluate(WHERE, 'log-page') == 'side' and await page.evaluate(WHERE, 'log-toolbar') == 'side'
        assert await page.locator('#debug-copy-button').is_visible() and await page.locator('#debug-log-list').is_visible()
        assert await page.locator('#debug-log-list .debug-log-entry').count() > 0, 'the Log draws where it is'

        # The Agent to the left: a section of its own height, its history button at the section's top.
        await move(page.locator('[data-tab-host="side"] [data-page="agent"]'), 'Left')
        now = await places()
        assert now['left'] == ['search', 'links', 'agent'] and now['side'] == ['chats', 'log'], now
        assert await page.evaluate(WHERE, 'agent-page') == 'section:agent'
        assert await page.evaluate('document.querySelector("#chat-history-toggle-button").closest(".sidebar-panel-toggle")') is None, 'no button in a button'
        height = await page.evaluate('document.querySelector("#agent-page").getBoundingClientRect().height')
        assert height > 200, height
        await page.wait_for_function('document.querySelector("#chat-input")?.offsetParent !== null')

        # Session to the right too: the bottom is left with no page and says how to fill it.
        await move(page.locator('[data-tab-host="bottom"] [data-page="session"]'), 'Right')
        now = await places()
        assert now['bottom'] == [] and now['bottomEmpty'], now

        # Kept over a reload.
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=20000)
        now = await places()
        assert (now['left'], now['side'], now['bottom']) == (['search', 'links', 'agent'], ['chats', 'log', 'session'], []), now
        assert await page.evaluate(WHERE, 'agent-page') == 'section:agent' and await page.evaluate(WHERE, 'log-page') == 'side'

        # Moved back: the default places.
        await move(page.locator('.sidebar-panel-toggle[data-panel="agent"]'), 'Right')
        await move(page.locator('[data-tab-host="side"] [data-page="session"]'), 'Left')
        await move(page.locator('[data-tab-host="side"] [data-page="log"]'), 'Bottom')
        now = await places()
        assert (now['left'], now['side'], now['bottom']) == (['search', 'links', 'session'], ['agent', 'chats'], ['log']), now
        assert await page.evaluate(WHERE, 'session-id-label') == 'section:session'
        assert await page.evaluate(WHERE, 'chat-history-toggle-button') == 'side'
        assert await page.evaluate(WHERE, 'log-toolbar') == 'bottom'

        # Dragged: a section onto the side panel, then a tab onto the left sidebar (the explorer's
        # own drops are files: a page passes through them); kept as Move to… keeps them.
        await page.locator('.sidebar-panel-toggle[data-panel="session"]').drag_to(page.locator('#chat-panel'), force=True)
        now = await places()
        assert now['left'] == ['search', 'links'] and now['side'] == ['agent', 'chats', 'session'] and now['sideOpen'] == 'session', now
        await page.locator('[data-tab-host="side"] [data-page="chats"]').drag_to(page.locator('#explorer-tree'))
        now = await places()
        assert now['left'] == ['search', 'links', 'chats'] and now['side'] == ['agent', 'session'], now
        assert await page.evaluate(WHERE, 'chats-page') == 'section:chats'
        assert await page.evaluate('document.querySelectorAll(".is-page-drop").length') == 0, 'no drop mark left behind'
        await page.locator('.sidebar-panel-toggle[data-panel="chats"]').drag_to(page.locator('#chat-panel'), force=True)
        await page.locator('[data-tab-host="side"] [data-page="session"]').drag_to(page.locator('#explorer-tree'))
        now = await places()
        assert (now['left'], now['side']) == (['search', 'links', 'session'], ['agent', 'chats']), now
        assert await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.settings.v1")).pageHosts') == {}, 'home again: nothing kept'

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['menu on a section', 'section to a tab host', 'its toolbar in the header', 'the area shows',
                                     'tab to another tab host', 'tab to the left as a section', 'no button in a button',
                                     'an emptied area says so', 'kept over a reload', 'moved back', 'dragged between areas',
                                     'no drop mark left']}))


asyncio.run(main())
