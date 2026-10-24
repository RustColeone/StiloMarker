"""Browser regression: pages move between the areas (steps 5k and P3, v0.3.7).

The left window shows one page at a time, the activity bar its icons: the
Explorer (its tree, and its sections: Linked Notes, Session) and Search. An
icon shows its page; the icon of the page showing hides the window; the
Explorer has no menu and stays. Right-click a section's header or a tab (an
icon too): Move to Explorer / Left / Right / Bottom, or drag it onto another
area. A page moved to a tab host becomes a tab (its toolbar in the host's
header, the left window's title row); one moved to the Explorer a section,
its header drawn like the others'; dropped anywhere on the left window or
its activity bar, a page is one of its tabs. The area it went to shows it;
an area left without pages says how to fill it; the moves are kept over a
reload, and moving back restores the default places. Isolated: every API
is mocked; the welcome template is this checkout's Template folder.
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
  const strip = (selector) => [...document.querySelectorAll(`${selector} [data-page]`)].filter((b) => !b.hidden).map((b) => b.dataset.page);
  const open = (selector) => document.querySelector(`${selector} [aria-selected="true"]`)?.dataset.page ?? null;
  const app = document.querySelector("#app").dataset;
  const title = document.querySelector('[data-tab-host-header="left"]');
  return {
    explorer: [...document.querySelectorAll('[data-section-host="explorer"] > .sidebar-panel')].map((s) => s.dataset.page),
    left: strip(".activity-pages"), leftOpen: open(".activity-pages"),
    side: strip('[data-tab-host="side"]'), sideOpen: open('[data-tab-host="side"]'),
    bottom: strip('[data-tab-host="bottom"]'), bottomOpen: open('[data-tab-host="bottom"]'),
    bottomEmpty: Boolean(document.querySelector('[data-tab-host="bottom"] .tab-host-empty')),
    shown: app.explorer, chat: app.chat, debug: app.debug,
    title: title.hidden ? null : title.querySelector('[data-tab-host-title="left"]').textContent
  };
}'''
WHERE = '''(id) => { const e = document.getElementById(id); const host = e?.closest("[data-tab-host-pages], .sidebar-panel, [data-tab-host-toolbar]");
  return host ? (host.dataset.tabHostPages ?? host.dataset.tabHostToolbar ?? `section:${host.dataset.page}`) : null; }'''
MENU = '''() => [...document.querySelectorAll(".page-move-menu:not([hidden]) button")].map((b) => [b.textContent, b.disabled])'''
# How each section's header in the Explorer looks (all alike).
LOOKS = '''() => [...document.querySelectorAll('[data-section-host="explorer"] .sidebar-panel-header')].map((h) => {
  const style = getComputedStyle(h), section = getComputedStyle(h.closest(".sidebar-panel"));
  return [style.fontSize, style.letterSpacing, style.fontWeight, style.textTransform, style.color, style.padding, section.paddingLeft, section.paddingTop]; })'''
FILLS = '''(id) => { const box = document.getElementById(id).getBoundingClientRect(), window = document.querySelector("#explorer-panel").getBoundingClientRect();
  return [box.height, window.bottom - box.bottom]; }'''
DEFAULT = {'explorer': ['links', 'session'], 'left': ['explorer', 'search'], 'side': ['agent', 'chats'], 'bottom': ['log']}


def where(now):
    return {key: now[key] for key in DEFAULT}


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

        async def menu_of(target):
            await target.click(button='right')
            await page.wait_for_timeout(150)
            items = await page.evaluate(MENU)
            await page.keyboard.press('Escape')
            return items

        async def move(target, to):
            await target.click(button='right')
            await page.wait_for_timeout(150)
            await page.locator('.page-move-menu button', has_text=f'Move to {to}').click()

        def icon(id):
            return page.locator(f'.activity-pages [data-page="{id}"]')

        def header(id):
            return page.locator(f'.sidebar-panel-toggle[data-panel="{id}"]')

        start = await places()
        assert where(start) == DEFAULT and start['leftOpen'] == 'explorer' and start['title'] is None, start
        looks = await page.evaluate(LOOKS)
        assert len(looks) == 2 and looks[0] == looks[1], looks

        # The activity bar: an icon shows its page; the one showing hides the window; the Explorer stays put.
        await icon('search').click()
        now = await places()
        assert (now['leftOpen'], now['shown'], now['title']) == ('search', 'expanded', 'Search'), now
        assert await page.locator('.search-files-query').is_visible() and await page.locator('#explorer-tree').is_hidden()
        size = await page.evaluate(FILLS, 'search-files-body')
        assert size[0] > 600 and abs(size[1]) < 2, f'Search fills the left window: {size}'
        await icon('search').click()
        assert (await places())['shown'] == 'collapsed'
        await icon('explorer').click()
        now = await places()
        assert (now['leftOpen'], now['shown'], now['title']) == ('explorer', 'expanded', None), now
        assert await page.locator('#explorer-tree').is_visible() and await page.locator('.search-files-query').is_hidden()
        assert await menu_of(icon('explorer')) == [], 'the Explorer has no Move to… menu'
        assert await icon('explorer').get_attribute('draggable') == 'false'

        # The menu on a section's header: where it is, ticked and disabled.
        assert await menu_of(header('session')) == [['Move to Explorer', True], ['Move to Left', False], ['Move to Right', False], ['Move to Bottom', False]]

        # Session to the bottom: a tab there, its connection label in the bottom's header; the bottom shows.
        await move(header('session'), 'Bottom')
        now = await places()
        assert now['explorer'] == ['links'] and now['bottom'] == ['log', 'session'] and now['bottomOpen'] == 'session', now
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

        # The Agent to the Explorer: a section of its own height, its history button at the section's top.
        await move(page.locator('[data-tab-host="side"] [data-page="agent"]'), 'Explorer')
        now = await places()
        assert now['explorer'] == ['links', 'agent'] and now['side'] == ['chats', 'log'] and now['leftOpen'] == 'explorer', now
        assert await page.evaluate(WHERE, 'agent-page') == 'section:agent'
        assert await page.evaluate('document.querySelector("#chat-history-toggle-button").closest(".sidebar-panel-toggle")') is None, 'no button in a button'
        height = await page.evaluate('document.querySelector("#agent-page").getBoundingClientRect().height')
        assert height > 200, height
        await page.wait_for_function('document.querySelector("#chat-input")?.offsetParent !== null')
        looks = await page.evaluate(LOOKS)
        assert len(looks) == 2 and looks[0] == looks[1], looks

        # Then to the left window: a tab of its own, named in the title row with its "+" and history button.
        await move(header('agent'), 'Left')
        now = await places()
        assert now['explorer'] == ['links'] and now['left'] == ['explorer', 'search', 'agent'], now
        assert (now['leftOpen'], now['shown'], now['title']) == ('agent', 'expanded', 'Agent'), now
        assert await page.evaluate(WHERE, 'agent-page') == 'left' and await page.evaluate(WHERE, 'chat-history-toggle-button') == 'left'
        assert await page.locator('[data-tab-host-new="left"]').is_visible() and await page.locator('#chat-history-toggle-button').is_visible()
        size = await page.evaluate(FILLS, 'agent-page')
        assert size[0] > 600 and abs(size[1]) < 2, f'the Agent fills the left window: {size}'
        await page.wait_for_function('document.querySelector("#chat-input")?.offsetParent !== null')
        assert await page.locator('#explorer-tree').is_hidden()

        # Search to the Explorer (its icon's menu): a section like the others; the Explorer shows.
        await move(icon('search'), 'Explorer')
        now = await places()
        assert now['explorer'] == ['links', 'search'] and now['left'] == ['explorer', 'agent'] and now['leftOpen'] == 'explorer', now
        assert await page.evaluate(WHERE, 'search-files-body') == 'section:search'
        looks = await page.evaluate(LOOKS)
        assert len(looks) == 2 and looks[0] == looks[1], looks

        # Session to the right too: the bottom is left with no page and says how to fill it.
        await move(page.locator('[data-tab-host="bottom"] [data-page="session"]'), 'Right')
        now = await places()
        assert now['bottom'] == [] and now['bottomEmpty'], now

        # Kept over a reload.
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#preview-output")?.innerText.includes("STILO MARKER")', timeout=20000)
        now = await places()
        assert where(now) == {'explorer': ['links', 'search'], 'left': ['explorer', 'agent'], 'side': ['chats', 'log', 'session'], 'bottom': []}, now
        assert await page.evaluate(WHERE, 'agent-page') == 'left' and await page.evaluate(WHERE, 'log-page') == 'side'

        # Moved back: the default places.
        await move(icon('agent'), 'Right')
        await move(header('search'), 'Left')
        await move(page.locator('[data-tab-host="side"] [data-page="session"]'), 'Explorer')
        await move(page.locator('[data-tab-host="side"] [data-page="log"]'), 'Bottom')
        now = await places()
        assert where(now) == DEFAULT, now
        assert await page.evaluate(WHERE, 'session-id-label') == 'section:session'
        assert await page.evaluate(WHERE, 'chat-history-toggle-button') == 'side'
        assert await page.evaluate(WHERE, 'log-toolbar') == 'bottom'

        # Dragged: a section onto the side panel; a tab onto the Explorer's tree (its own drops
        # are files: a page passes through them) is a tab of the left window, and its icon
        # dragged onto the side panel goes back; a tab dropped on the activity bar is a tab
        # there too. Kept as Move to… keeps them.
        if (await places())['leftOpen'] != 'explorer':
            await icon('explorer').click()
        await header('session').drag_to(page.locator('#chat-panel'), force=True)
        now = await places()
        assert now['explorer'] == ['links'] and now['side'] == ['agent', 'chats', 'session'] and now['sideOpen'] == 'session', now
        await page.locator('[data-tab-host="side"] [data-page="chats"]').drag_to(page.locator('#explorer-tree'))
        now = await places()
        assert now['left'] == ['explorer', 'search', 'chats'] and now['leftOpen'] == 'chats' and now['side'] == ['agent', 'session'], now
        assert await page.evaluate(WHERE, 'chats-page') == 'left'
        assert await page.evaluate('document.querySelectorAll(".is-page-drop").length') == 0, 'no drop mark left behind'
        await icon('chats').drag_to(page.locator('#chat-panel'), force=True)
        await page.locator('[data-tab-host="side"] [data-page="session"]').drag_to(page.locator('.activity-bar'))
        now = await places()
        assert now['left'] == ['explorer', 'search', 'session'] and now['leftOpen'] == 'session' and now['side'] == ['agent', 'chats'], now
        assert await page.evaluate(WHERE, 'session-id-label') == 'left', 'its connection label in the title row'
        await move(icon('session'), 'Explorer')
        now = await places()
        assert where(now) == DEFAULT, now
        assert await page.evaluate('JSON.parse(localStorage.getItem("mdnotes.settings.v1")).pageHosts') == {}, 'home again: nothing kept'

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['every section header alike', 'an icon shows its page, the showing one hides the window',
                                     'the Explorer stays', 'menu on a section', 'section to a tab host', 'its toolbar in the header',
                                     'the area shows', 'tab to another tab host', 'tab to the Explorer as a section', 'no button in a button',
                                     'a section to the left window as a tab, in the title row', 'an icon to the Explorer',
                                     'an emptied area says so', 'kept over a reload', 'moved back', 'dragged between areas',
                                     'dropped on the left: a tab', 'no drop mark left']}))


asyncio.run(main())
