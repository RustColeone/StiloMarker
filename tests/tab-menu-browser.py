"""Browser regression: a tab's menu (right-click on a tab).

Close, Close Others, Close to the Right, Close All; Open as Source / Preview
(the view the tab is in is ticked; opening as the other opens it in the same
group, whose tabs then name their views, while the other group keeps its tab
behind a placeholder with Show here); Copy Path; History's diff tab only
closes. Escape and a press outside close the menu. Isolated: every API is mocked; the welcome template
is this checkout's Template folder.
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

TABS = '''(pane) => [...document.querySelectorAll(`#${pane}-tab-strip .editor-tab[data-file-id]`)].map(t => t.querySelector(".tab-title").textContent)'''
GROUPS = '''() => Object.fromEntries([...document.querySelectorAll(".editor-group")].map((g) => {
  const shown = [...g.querySelectorAll(":scope > .source-body, :scope > .preview-body")].filter((b) => b.dataset.shown !== "false");
  const placeholder = g.querySelector(".group-placeholder");
  const tabs = [...g.querySelectorAll(".editor-tab[data-file-id]")];
  const active = g.querySelector(".editor-tab.is-active[data-file-id]");
  return [g.dataset.group, {
    label: g.querySelector(".pane-label-view").textContent,
    body: shown.length ? (shown[0].classList.contains("second-preview") ? "second" : shown[0].classList.contains("source-body") ? "source" : "preview") : null,
    placeholder: placeholder.hidden ? null : placeholder.querySelector(".group-placeholder-text").textContent,
    tabs: tabs.map((t) => [t.querySelector(".tab-title").textContent, t.dataset.view]),
    marks: tabs.map((t) => t.querySelector(".tab-view-mark")?.textContent ?? null),
    active: active ? [active.querySelector(".tab-title").textContent, active.dataset.view] : null
  }];
}))'''
MENU = '''() => { const m = document.querySelector("#tab-context-menu"); return m.hidden ? null : [...m.querySelectorAll("button")].map(b => [b.textContent, b.disabled, b.getAttribute("aria-checked") === "true"]); }'''


async def main():
    async with async_playwright() as pw:
        launch = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            launch['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**launch)
        context = await browser.new_context(service_workers='block', viewport={'width': 1400, 'height': 900})
        await context.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
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

        async def open_file(name):
            await page.locator('#explorer-tree .tree-row', has_text=name).first.click()
            await page.wait_for_timeout(300)

        async def tab_menu(pane, name):
            await page.locator(f'#{pane}-tab-strip .editor-tab', has_text=name).first.click(button='right')
            await page.wait_for_timeout(150)
            return await page.evaluate(MENU)

        async def choose(label):
            await page.locator('#tab-context-menu button', has_text=label).first.click()
            await page.wait_for_timeout(300)

        for name in ('MeitanteiCure.mtree', 'LULUKA.urldb'):
            await open_file(name)
        assert await page.evaluate(TABS, 'source') == ['welcome.md', 'MeitanteiCure.mtree', 'LULUKA.urldb']

        # In a narrow window the strip scrolls, and the active tab is always in
        # view: wholly when it fits, else its start (it was scrolled by its place
        # in the header, label included).
        await page.set_viewport_size({'width': 980, 'height': 900})
        in_view = '''() => { const strip = document.querySelector("#source-tab-strip"), tab = strip.querySelector(".editor-tab.is-active");
          const s = strip.getBoundingClientRect(), t = tab.getBoundingClientRect();
          const fits = t.width <= s.width + 0.5;
          return [tab.querySelector(".tab-title").textContent, Math.abs(t.left - s.left) < 0.5 || (t.left >= s.left - 0.5 && (fits ? t.right <= s.right + 0.5 : false)), strip.scrollWidth > strip.clientWidth]; }'''
        overflowed = False
        for name in ('LULUKA.urldb', 'welcome.md', 'MeitanteiCure.mtree', 'LULUKA.urldb', 'welcome.md'):
            await open_file(name)
            title, whole, scrolls = await page.evaluate(in_view)
            assert title == name and whole, (name, title, whole)
            overflowed = overflowed or scrolls
        assert overflowed, 'the strip must overflow for this check'
        await page.set_viewport_size({'width': 1400, 'height': 900})
        await page.wait_for_timeout(300)

        # The menu of a source tab: the view it is in ticked, a one-view file not previewable.
        entries = await tab_menu('source', 'MeitanteiCure.mtree')
        labels = [label for label, _, _ in entries]
        assert labels == ['Close', 'Close Others', 'Close to the Right', 'Close All', 'Open as Source', 'Open as Preview', 'Move to Other Group', 'Open to the Side', 'Copy Path'], labels
        assert entries[4] == ['Open as Source', True, True] and entries[5][1] is True, entries
        await page.keyboard.press('Escape')
        assert await page.evaluate(MENU) is None, 'Escape closes the menu'

        # Today's layout: Source on the left, Preview on the right, no marks.
        groups = await page.evaluate(GROUPS)
        assert (groups['left']['label'], groups['left']['body'], groups['right']['label'], groups['right']['body']) == ('Editing', 'source', 'Previewing', 'preview'), groups
        assert set(groups['left']['marks']) == {None}, groups

        # Open as Preview: in the same group. The preview moves to the left
        # group, whose tabs name their views; the right group, whose tab is a
        # preview too, shows a second preview of its own: two side by side.
        await tab_menu('source', 'LULUKA.urldb')
        await choose('Open as Preview')
        groups = await page.evaluate(GROUPS)
        left, right = groups['left'], groups['right']
        assert (left['label'], left['body'], left['placeholder']) == ('Previewing', 'preview', None), left
        assert left['tabs'] == [['welcome.md', 'source'], ['MeitanteiCure.mtree', 'source'], ['LULUKA.urldb', 'source'], ['LULUKA.urldb', 'preview']], left
        assert left['active'] == ['LULUKA.urldb', 'preview'], left
        assert left['marks'] == ['Source', 'Source', 'Source', 'Preview'], left
        assert (right['body'], right['placeholder']) == ('second', None), right
        assert right['active'] == ['welcome.md', 'preview'], right
        assert 'STILO MARKER' in await page.locator('#preview-pane .second-preview .preview-output').inner_text()
        assert 'Moria Luluka' in await page.locator('#preview-output').inner_text(), 'the album in the left group'
        await page.locator('#source-tab-strip .editor-tab[data-view="preview"]', has_text='LULUKA.urldb').click(button='right')
        await page.wait_for_timeout(150)
        entries = await page.evaluate(MENU)
        assert entries[4][2] is False and entries[5][2] is True, f'the preview tab is ticked as Preview: {entries}'
        await page.keyboard.press('Escape')

        # The right group's preview tab clicked: the preview comes back there,
        # and the left group keeps the album in a second preview of its own.
        await page.locator('#preview-tab-strip .editor-tab[data-view="preview"]', has_text='welcome.md').click()
        await page.wait_for_timeout(300)
        groups = await page.evaluate(GROUPS)
        assert (groups['right']['body'], groups['right']['placeholder']) == ('preview', None), groups['right']
        assert 'STILO MARKER' in await page.locator('#preview-output').inner_text()
        assert (groups['left']['body'], groups['left']['placeholder']) == ('second', None), groups['left']
        assert 'Moria Luluka' in await page.locator('#source-pane .second-preview .preview-output').inner_text()

        # A source tab there brings the source editor back to the left group.
        await page.locator('#source-tab-strip .editor-tab[data-view="source"]', has_text='welcome.md').click()
        await page.wait_for_timeout(300)
        groups = await page.evaluate(GROUPS)
        assert (groups['left']['label'], groups['left']['body'], groups['left']['placeholder']) == ('Editing', 'source', None), groups['left']
        assert (await page.locator('#editor-content').inner_text()).startswith('# STILO MARKER')

        # A group's label says what it does with which file; its ▾ switches
        # that file between Source and Preview, in the group.
        label = await page.evaluate('''() => { const l = document.querySelector("#source-pane-label");
          return [l.querySelector(".pane-label-view").textContent, l.querySelector(".pane-label-file").textContent, l.disabled]; }''')
        assert label == ['Editing', 'welcome.md', False], label
        await page.click('#source-pane-label')
        await page.wait_for_timeout(150)
        assert await page.evaluate(MENU) == [['Source', True, True], ['Preview', False, False]], await page.evaluate(MENU)
        assert await page.get_attribute('#source-pane-label', 'aria-expanded') == 'true'
        await choose('Preview')
        groups = await page.evaluate(GROUPS)
        assert (groups['left']['label'], groups['left']['active']) == ('Previewing', ['welcome.md', 'preview']), groups['left']
        assert await page.get_attribute('#source-pane-label', 'aria-expanded') == 'false'
        await page.click('#source-pane-label')
        await page.wait_for_timeout(150)
        await choose('Source')
        groups = await page.evaluate(GROUPS)
        assert (groups['left']['label'], groups['left']['body'], groups['left']['active']) == ('Editing', 'source', ['welcome.md', 'source']), groups['left']

        # Narrowed to a phone with the preview in the left group: the groups
        # draw nothing of their own, and each view shows its body.
        await tab_menu('source', 'LULUKA.urldb')
        await choose('Open as Preview')
        await page.set_viewport_size({'width': 400, 'height': 820})
        await page.wait_for_timeout(400)
        phone = '''() => ({ view: document.querySelector("#app").dataset.mobileView,
          source: document.querySelector("#source-body").getBoundingClientRect().width,
          preview: document.querySelector("#preview-body").getBoundingClientRect().width,
          placeholder: [...document.querySelectorAll(".group-placeholder")].some((p) => p.getBoundingClientRect().width > 0) })'''
        now = await page.evaluate(phone)
        assert now['view'] == 'source' and now['source'] > 300 and now['preview'] == 0 and not now['placeholder'], now
        await page.locator('#mobile-view-toggle').click()
        await page.wait_for_timeout(400)
        now = await page.evaluate(phone)
        assert now['view'] == 'preview' and now['preview'] > 300 and now['source'] == 0, now
        await page.set_viewport_size({'width': 1400, 'height': 900})
        await page.wait_for_timeout(400)
        await page.locator('#source-tab-strip .editor-tab[data-view="source"]', has_text='welcome.md').click()
        await page.wait_for_timeout(300)

        # Copy Path.
        await tab_menu('source', 'LULUKA.urldb')
        await choose('Copy Path')
        copied = await page.evaluate('navigator.clipboard.readText()')
        assert copied == 'Images/LULUKA.urldb', copied

        # Close to the Right, then Close Others.
        await tab_menu('source', 'welcome.md')
        await choose('Close to the Right')
        assert await page.evaluate(TABS, 'source') == ['welcome.md']
        await open_file('MeitanteiCure.mtree')
        await tab_menu('source', 'MeitanteiCure.mtree')
        await choose('Close Others')
        assert await page.evaluate(TABS, 'source') == ['MeitanteiCure.mtree']

        # A press outside closes the menu; Close All empties the pane.
        await tab_menu('preview', 'welcome.md')
        await page.mouse.click(700, 500)
        assert await page.evaluate(MENU) is None, 'a press outside closes the menu'
        await tab_menu('preview', 'welcome.md')
        await choose('Close All')
        assert await page.evaluate(TABS, 'preview') == [], await page.evaluate(TABS, 'preview')

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['active tab in view', 'menu entries', 'escape', 'default layout', 'open as preview in the same group', 'two previews side by side', 'the preview back', 'source back', 'the label switches views', 'phone with a mixed group', 'copy path',
                                     'close to the right', 'close others', 'press outside', 'close all']}))


asyncio.run(main())
