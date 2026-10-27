"""Browser regression: the architecture page (docs/architecture) on a phone.

On a narrow screen the page scrolls as a whole, the diagram first and its details
under it (they were a strip at the bottom scrolling on its own); its words say
tap, hold and below; a finger held on a box lights it up as hovering does and
opens nothing, a tap goes in; a link in the details goes back up to the diagram;
the diagram can fill the screen. A wide screen keeps its two columns. Isolated:
the page is this checkout's, and the layout library (ELK, from a CDN) is a
stand-in that stacks the boxes, so only the page's own behaviour is tested.
"""
import asyncio
import mimetypes
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(os.environ.get('STILO_ASSET_ROOT', Path(__file__).resolve().parents[1]))
BASE = 'https://stilomarker.test/docs/architecture/'
# Each box's children one under another, every edge drawn as a curve (no sections).
STAND_IN_ELK = '''window.ELK = class {
  layout(graph) {
    const place = (node) => {
      let y = node.children?.length ? 40 : 0, width = node.width || 0;
      for (const child of node.children || []) {
        place(child);
        Object.assign(child, { x: 16, y });
        y += child.height + 20;
        width = Math.max(width, child.width + 32);
      }
      if (node.children?.length) Object.assign(node, { width, height: y });
    };
    place(graph);
    return Promise.resolve(graph);
  }
};'''
WAIT = 'document.querySelector("#chart svg")'


async def visit(browser, path='', **options):
    context = await browser.new_context(service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    async def route(rt):
        url = urlparse(rt.request.url)
        if 'elkjs' in url.path:
            await rt.fulfill(content_type='text/javascript', body=STAND_IN_ELK)
            return
        file = ROOT / url.path.lstrip('/')
        if url.netloc == 'stilomarker.test' and file.is_file():
            await rt.fulfill(content_type=mimetypes.guess_type(str(file))[0] or 'text/plain', body=file.read_bytes())
        else:
            await rt.fulfill(status=404, body='not found')
    await context.route('**/*', route)
    await page.goto(BASE + 'index.html' + path, wait_until='load')
    await page.wait_for_function(WAIT, timeout=20000)
    return context, page, errors


async def touch(cdp, kind, x=0, y=0):
    await cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [] if kind == 'touchEnd' else [{'x': x, 'y': y}]})


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        phone = {'viewport': {'width': 390, 'height': 844}, 'has_touch': True, 'is_mobile': True}

        # One column: the page scrolls, and the details are all there under the diagram.
        context, page, errors = await visit(browser, '#/guide/extensions', **phone)
        state = await page.evaluate('''({
          layout: getComputedStyle(document.querySelector(".layout")).display,
          scrolls: document.documentElement.scrollHeight > innerHeight + 200,
          clipped: document.querySelector("#pane").scrollHeight - document.querySelector("#pane").clientHeight,
          under: document.querySelector("#pane").getBoundingClientRect().top >= document.querySelector(".chart-frame").getBoundingClientRect().bottom,
          hint: document.querySelector("#chart-hint").textContent })''')
        assert state['layout'] == 'block' and state['scrolls'] and state['clipped'] <= 1 and state['under'], state
        assert 'Tap a box' in state['hint'] and 'below' in state['hint'] and 'on the right' not in state['hint'], state
        await context.close()

        # A finger held on a box lights it and opens nothing; a tap goes in.
        context, page, errors = await visit(browser, '', **phone)
        cdp = await context.new_cdp_session(page)
        hint = await page.evaluate('document.querySelector("#chart-hint").textContent')
        assert 'Hold a module' in hint and 'tap a box' in hint, hint
        spot = await page.evaluate('''(() => {
          const frame = document.querySelector(".chart-frame").getBoundingClientRect();
          for (const node of document.querySelectorAll(".node.link")) {
            const box = node.getBoundingClientRect();
            if (box.top > frame.top && box.bottom < frame.bottom - 70 && box.left > frame.left && box.right < frame.right)
              return [box.left + box.width / 2, box.top + box.height / 2];
          }
          return null; })()''')
        assert spot, 'a box in view'
        await touch(cdp, 'touchStart', *spot)
        await page.wait_for_timeout(700)
        await touch(cdp, 'touchEnd')
        await page.wait_for_timeout(300)
        held = await page.evaluate('[location.hash, document.querySelectorAll(".graph .node.on").length]')
        assert held[0] == '' and held[1] >= 1, held
        await touch(cdp, 'touchStart', *spot)
        await page.wait_for_timeout(60)
        await touch(cdp, 'touchEnd')
        await page.wait_for_function('location.hash.length > 2', timeout=5000)
        await page.wait_for_function(WAIT, timeout=20000)

        # From a link far down in the details, back up to the diagram.
        await page.evaluate('location.hash = "#/app/modules/sync"')
        await page.wait_for_function(WAIT, timeout=20000)
        await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
        assert await page.evaluate('document.querySelector(".chart-frame").getBoundingClientRect().bottom < 0')
        await page.evaluate('[...document.querySelectorAll("#pane a[href^=\'#/\']")].at(-1).click()')
        await page.wait_for_timeout(300)
        top = await page.evaluate('Math.round(document.querySelector(".chart").getBoundingClientRect().top)')
        assert abs(top) <= 2, top

        # The diagram fills the screen, under its title; Escape puts it back.
        await page.wait_for_function(WAIT, timeout=20000)
        await page.click('#zoom-full')
        full = await page.evaluate('[getComputedStyle(document.querySelector(".chart")).position, document.querySelector(".chart-frame").getBoundingClientRect().height]')
        assert full[0] == 'fixed' and full[1] > 600, full
        await page.keyboard.press('Escape')
        assert await page.evaluate('getComputedStyle(document.querySelector(".chart")).position') == 'static'
        assert not errors, errors
        await context.close()

        # A wide screen: two columns, the details on the right, no full screen.
        context, page, errors = await visit(browser, '#/guide/extensions', viewport={'width': 1400, 'height': 900})
        wide = await page.evaluate('''[getComputedStyle(document.querySelector(".layout")).display,
          getComputedStyle(document.querySelector("#zoom-full")).display, document.querySelector("#chart-hint").textContent]''')
        assert wide[0] == 'grid' and wide[1] == 'none' and 'Click a box' in wide[2] and 'on the right' in wide[2], wide
        assert not errors, errors
        await context.close()
        await browser.close()
        print('architecture page on a phone: one column, touch words, holding, back up to the diagram, full screen')


asyncio.run(main())
