"""Browser regression: on the phone, the bottom area (the Log) is a sheet.

It opens from the View menu as a sheet from the bottom, half the height,
over the note, and shows the log even when the desktop hides it (the
default); the note keeps its height, even when the desktop shows the Log.
Its header drags it: a flick goes one step (half, full, half, closed), a slow
drag settles at the nearest height. Its × or a tap above it closes it. One flyout at a time: the chat drawer closes it. The desktop's Log setting is
left alone, and crossing to the desktop closes the sheet. Isolated: every API
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

STATE = '''(() => {
  const sheet = document.querySelector("#debug-panel").getBoundingClientRect();
  return {
    bottom: document.querySelector("#app").dataset.mobileBottom,
    right: document.querySelector("#app").dataset.mobileRight,
    menu: document.querySelector("#app").dataset.mobileMenu,
    sheetTop: Math.round(sheet.top), sheetBottom: Math.round(sheet.bottom), height: innerHeight,
    editor: Math.round(document.querySelector("#editor-content").getBoundingClientRect().height),
    entries: document.querySelectorAll("#debug-log-list .debug-log-entry:not(.is-empty)").length,
    settings: localStorage.getItem("mdnotes.settings.v1")
  };
})()'''

# Whether the sheet stands still: where it is now, and 150 ms later.
SETTLED = '''() => new Promise((done) => {
  const at = () => { const box = document.querySelector("#debug-panel").getBoundingClientRect(); return `${box.top},${box.bottom}`; };
  const first = at();
  setTimeout(() => done(at() === first), 150);
})'''


# A drag on an element: touches at x=200, the finger's y going through moves,
# 16 ms apart (a phone's 60 Hz). The times are the events' own, as a real
# touch's are the input's: a synthetic event's would be when it was made, late
# whenever the page was busy with the one before, and a flick would read slow.
DRAG = '''({selector, start, moves}) => {
  const target = document.querySelector(selector);
  const at = performance.now();
  let step = 0;
  const fire = (type, y) => {
    const touch = new Touch({identifier: 0, target, clientX: 200, clientY: y});
    const event = new TouchEvent(type, {bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [touch], changedTouches: [touch]});
    Object.defineProperty(event, "timeStamp", { value: at + 16 * step++ });
    target.dispatchEvent(event);
  };
  fire("touchstart", start);
  for (const y of moves) fire("touchmove", y);
  fire("touchend", moves.at(-1));
}'''


# The same, slowly: 10 steps 40ms apart, dy in all.
SLOW_DRAG = '''({selector, start, dy}) => new Promise((done) => {
  const target = document.querySelector(selector);
  const fire = (type, y) => {
    const touch = new Touch({identifier: 0, target, clientX: 200, clientY: y});
    target.dispatchEvent(new TouchEvent(type, {bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [touch], changedTouches: [touch]}));
  };
  fire("touchstart", start);
  let step = 0;
  const timer = setInterval(() => {
    step += 1;
    fire("touchmove", start + dy * step / 10);
    if (step === 10) { clearInterval(timer); fire("touchend", start + dy); done(); }
  }, 40);
})'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 400, 'height': 820}, has_touch=True, is_mobile=True)
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
        await page.wait_for_function('document.querySelector("#editor-content")?.innerText.includes("STILO MARKER")', timeout=20000)

        # The state once the sheet has stopped moving (not after a fixed time:
        # on a busy machine its slide may still be going).
        async def state():
            await page.wait_for_timeout(250)
            await page.wait_for_function(SETTLED, polling=50)
            return await page.evaluate(STATE)

        async def open_log():
            await page.locator('#mobile-menu-button').click()
            await page.locator('#view-menu-button').click()
            await page.locator('[data-command="shell.toggle-log"]').click()
            now = await state()
            assert now['bottom'] == 'open' and now['menu'] == 'closed', now
            return now

        start = await state()
        assert start['bottom'] == 'closed' and start['sheetTop'] >= start['height'], start

        # Opened from the View menu: a sheet over the bottom of the note, with
        # the log in it although the desktop hides the Log.
        now = await open_log()
        assert now['sheetBottom'] == now['height'] and now['height'] * 0.3 < now['sheetTop'] < now['height'] * 0.6, now
        assert now['entries'] > 0, 'the sheet shows the log'
        assert now['editor'] == start['editor'], 'the note keeps its height under the sheet'
        assert now['settings'] == start['settings'], 'the desktop setting is left alone'

        # Its × closes it.
        await page.locator('#log-collapse-button').click()
        assert (await state())['bottom'] == 'closed'

        # A tap above it closes it.
        await open_log()
        await page.mouse.click(200, 150)
        assert (await state())['bottom'] == 'closed', 'a tap above closes the sheet'

        # Its header drags it: a flick goes one step (half → full → half →
        # closed); a slow drag settles at the nearest of closed, half and full.
        header = '#debug-panel .area-tabs'
        topbar = await page.evaluate('Math.round(document.querySelector(".topbar").getBoundingClientRect().bottom)')

        async def flick(dy):
            y = (await state())['sheetTop'] + 20
            await page.evaluate(DRAG, {'selector': header, 'start': y, 'moves': [y + dy / 3, y + dy * 2 / 3, y + dy]})
            return await state()

        async def slow(dy):
            y = (await state())['sheetTop'] + 20
            await page.evaluate(SLOW_DRAG, {'selector': header, 'start': y, 'dy': dy})
            return await state()

        now = await open_log()
        half = now['sheetTop']
        assert abs(half - now['height'] / 2) <= 2, now
        now = await flick(-120)
        assert now['bottom'] == 'open' and abs(now['sheetTop'] - topbar) <= 2, ('flick up: full', now, topbar)
        now = await slow(60)
        assert abs(now['sheetTop'] - topbar) <= 2, ('a short slow drag stays full', now)
        now = await flick(120)
        assert now['bottom'] == 'open' and abs(now['sheetTop'] - half) <= 2, ('flick down: half', now)
        now = await slow(-(half - topbar) * 0.7)
        assert abs(now['sheetTop'] - topbar) <= 2, ('a slow drag most of the way up: full', now)
        now = await slow((half - topbar) * 0.7)
        assert abs(now['sheetTop'] - half) <= 2, ('back down most of the way: half', now)
        now = await slow(40)
        assert now['bottom'] == 'open' and abs(now['sheetTop'] - half) <= 2, ('a short slow drag snaps back', now)
        now = await flick(120)
        assert now['bottom'] == 'closed' and now['sheetTop'] >= now['height'], ('flick down from half: closed', now)
        now = await open_log()
        assert abs(now['sheetTop'] - half) <= 2, ('it opens at half again', now)
        await page.locator('#log-collapse-button').click()

        # One flyout at a time: the chat drawer closes the sheet.
        await open_log()
        await page.locator('#mobile-chat-toggle').click()
        now = await state()
        assert (now['bottom'], now['right']) == ('closed', 'open'), now
        await page.locator('#chat-collapse-button').click()

        # Settings → the Log's entry names the sheet's state on the phone.
        await page.locator('#mobile-menu-button').click()
        await page.locator('#settings-menu-button').click()
        title = await page.locator('[data-command="shell.log-panel"]').text_content()
        assert title.strip() == 'Show Log Panel', title
        await page.locator('#mobile-menu-button').click()

        # The desktop shows the Log: on the phone it takes no row of the note.
        await page.evaluate('localStorage.setItem("mdnotes.settings.v1", JSON.stringify({...JSON.parse(localStorage.getItem("mdnotes.settings.v1") || "{}"), debugPanel: true}))')
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function('document.querySelector("#editor-content")?.innerText.includes("STILO MARKER")', timeout=20000)
        now = await state()
        assert now['bottom'] == 'closed' and now['editor'] == start['editor'], (now, start)

        # Crossing to the desktop closes the sheet; the desktop shows its Log as set.
        await open_log()
        await page.set_viewport_size({'width': 1300, 'height': 820})
        await page.wait_for_timeout(400)
        desk = await page.evaluate('''({ bottom: document.querySelector("#app").dataset.mobileBottom,
          logShown: !document.querySelector("#debug-panel").hidden,
          logHeight: document.querySelector("#debug-panel").getBoundingClientRect().height })''')
        assert desk['bottom'] == 'closed' and desk['logShown'] and desk['logHeight'] >= 120, desk

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['opens from View', 'shows the log while the desktop hides it', 'no row on the phone', 'note keeps its height', 'setting untouched',
                                     'x closes', 'tap above closes', 'flick up: full', 'flick down: half', 'slow drags settle nearest', 'flick down from half: closes', 'opens at half',
                                     'one flyout at a time', 'menu title', 'desktop round trip']}))


asyncio.run(main())
