"""Browser regression: on the phone, the bottom area (the Log) is a sheet.

It opens from the View menu as a sheet from the bottom, over the note, and
shows the log even when the desktop hides it (the default); the note keeps
its height, even when the desktop shows the Log. Its ×, a tap
above it, or a drag down on its header closes it; a short drag snaps back.
One flyout at a time: the chat drawer closes it. The desktop's Log setting is
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

# A drag on an element: touches at x=200, the finger's y going through moves.
DRAG = '''({selector, start, moves}) => {
  const target = document.querySelector(selector);
  const fire = (type, y) => {
    const touch = new Touch({identifier: 0, target, clientX: 200, clientY: y});
    target.dispatchEvent(new TouchEvent(type, {bubbles: true, cancelable: true,
      touches: type === "touchend" ? [] : [touch], changedTouches: [touch]}));
  };
  fire("touchstart", start);
  for (const y of moves) fire("touchmove", y);
  fire("touchend", moves.at(-1));
}'''


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

        async def state():
            await page.wait_for_timeout(400)
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

        # Its header drags down to close; a short drag up or a short slow drag does not.
        now = await open_log()
        header = '#debug-panel .debug-panel-heading .eyebrow'
        top = now['sheetTop'] + 20
        await page.evaluate(DRAG, {'selector': header, 'start': top, 'moves': [top - 20, top - 40]})
        assert (await state())['bottom'] == 'open', 'a drag up leaves it open'
        await page.evaluate('''({selector, start}) => new Promise((done) => {
          const target = document.querySelector(selector);
          const fire = (type, y) => {
            const touch = new Touch({identifier: 0, target, clientX: 200, clientY: y});
            target.dispatchEvent(new TouchEvent(type, {bubbles: true, cancelable: true,
              touches: type === "touchend" ? [] : [touch], changedTouches: [touch]}));
          };
          fire("touchstart", start);
          let y = start, step = 0;
          const timer = setInterval(() => {  // slowly, 40px down in all
            y += 4; fire("touchmove", y);
            if (++step === 10) { clearInterval(timer); fire("touchend", y); done(); }
          }, 40);
        })''', {'selector': header, 'start': top})
        assert (await state())['bottom'] == 'open', 'a short slow drag snaps back'
        await page.evaluate(DRAG, {'selector': header, 'start': top, 'moves': [top + 40, top + 160, top + 260]})
        now = await state()
        assert now['bottom'] == 'closed' and now['sheetTop'] >= now['height'], now

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
                                     'x closes', 'tap above closes', 'drag up stays', 'short drag snaps back', 'drag down closes',
                                     'one flyout at a time', 'menu title', 'desktop round trip']}))


asyncio.run(main())
