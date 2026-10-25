"""Browser regression: editor groups come and go (step 5h).

A tab moves to the other group (a source tab shows in that group's own
editor, v0.3.11; the group it left shows its own tab in its own editor, no
placeholder), opens there too ("Open to the Side"), or is dragged onto the
other group's strip. A group whose last tab
closes closes: the other takes the width and the bodies, so a file opened
from the explorer shows there; View → Toggle Source brings the group back.
Two previews at once: a second one with an editor of its own; while focus
is inside it, another file's tab still draws that file there.
Isolated: every API is mocked; the welcome template is this checkout's
Template folder.
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

GROUPS = '''() => Object.fromEntries([...document.querySelectorAll(".editor-group")].map((g) => {
  const placeholder = g.querySelector(".group-placeholder");
  const active = g.querySelector(".editor-tab.is-active[data-file-id]");
  return [g.dataset.group, {
    width: Math.round(g.getBoundingClientRect().width),
    tabs: [...g.querySelectorAll(".editor-tab[data-file-id]")].map((t) => [t.querySelector(".tab-title").textContent, t.dataset.view]),
    active: active ? [active.querySelector(".tab-title").textContent, active.dataset.view] : null,
    bodies: [...g.querySelectorAll(":scope > .source-body, :scope > .preview-body")].filter((b) => b.dataset.shown !== "false")
      .map((b) => b.id || (b.classList.contains("source-body") ? "right-source-body" : "")),
    placeholder: placeholder.hidden ? null : placeholder.querySelector(".group-placeholder-text").textContent
  }];
}))'''


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

        async def groups():
            await page.wait_for_timeout(300)
            return await page.evaluate(GROUPS)

        async def menu(group, name, view, label):
            strip = '#source-tab-strip' if group == 'left' else '#preview-tab-strip'
            await page.locator(f'{strip} .editor-tab[data-view="{view}"]', has_text=name).first.click(button='right')
            await page.locator('#tab-context-menu button', has_text=label).first.click()

        await page.locator('#explorer-tree .tree-row', has_text='LULUKA.urldb').first.click()
        now = await groups()
        assert now['left']['tabs'] == [['welcome.md', 'source'], ['LULUKA.urldb', 'source']], now

        # Move to Other Group: it shows in the right group's own editor; the left group keeps welcome.md in its own.
        await menu('left', 'LULUKA.urldb', 'source', 'Move to Other Group')
        now = await groups()
        assert now['left']['tabs'] == [['welcome.md', 'source']] and now['left']['bodies'] == ['source-body'], now['left']
        assert now['left']['placeholder'] is None, now['left']
        assert now['right']['tabs'] == [['welcome.md', 'preview'], ['LULUKA.urldb', 'source']], now['right']
        assert now['right']['active'] == ['LULUKA.urldb', 'source'] and now['right']['bodies'] == ['right-source-body'], now['right']
        assert (await page.locator('.source-body[data-group="right"] .editor-content').inner_text()).startswith('[Moria Luluka]')
        assert (await page.locator('#editor-content').inner_text()).startswith('# STILO MARKER')

        # Open to the Side: welcome.md's preview opens in the left group too.
        await menu('right', 'welcome.md', 'preview', 'Open to the Side')
        now = await groups()
        assert now['left']['tabs'] == [['welcome.md', 'source'], ['welcome.md', 'preview']], now['left']
        assert now['left']['active'] == ['welcome.md', 'preview'] and now['left']['bodies'] == ['preview-body'], now['left']
        assert ['welcome.md', 'preview'] in now['right']['tabs'], 'it stays where it was'

        # Dragged onto the other group's strip: LULUKA's source moves to the left, after welcome.md's source.
        target = page.locator('#source-tab-strip .editor-tab[data-view="source"]', has_text='welcome.md')
        box = await target.bounding_box()
        await page.locator('#preview-tab-strip .editor-tab[data-view="source"]', has_text='LULUKA.urldb').drag_to(
            target, target_position={'x': box['width'] - 8, 'y': box['height'] / 2})
        now = await groups()
        assert now['left']['tabs'] == [['welcome.md', 'source'], ['LULUKA.urldb', 'source'], ['welcome.md', 'preview']], now['left']
        assert now['left']['active'] == ['LULUKA.urldb', 'source'] and now['left']['bodies'] == ['source-body'], now['left']
        assert now['right']['tabs'] == [['welcome.md', 'preview']], now['right']

        # The right group's last tab closes: the group closes, the left takes the width and both bodies.
        await page.locator('#preview-tab-strip .editor-tab[data-view="preview"] .tab-close').first.click()
        now = await groups()
        assert await page.locator('#app').get_attribute('data-preview') == 'hidden', 'the emptied group closed'
        assert now['right']['width'] == 0 and now['left']['width'] > 900, now
        assert set(await page.evaluate('[...document.querySelectorAll("#source-pane > .source-body, #source-pane > .preview-body")].map((b) => b.id)')) == {'source-body', 'preview-body'}

        # A file opened from the explorer shows in the group that is left.
        await page.locator('#explorer-tree .tree-row', has_text='MeitanteiCure.mtree').first.click()
        now = await groups()
        assert now['left']['active'] == ['MeitanteiCure.mtree', 'source'] and now['left']['bodies'] == ['source-body'], now['left']

        # View → Toggle Preview brings the right group back, empty; Move to Other Group fills it.
        await page.locator('#view-menu-button').click()
        await page.locator('[data-command="editor.toggle-preview"]').click()
        now = await groups()
        assert now['right']['width'] > 200 and now['right']['tabs'] == [], now['right']
        await menu('left', 'welcome.md', 'preview', 'Move to Other Group')
        now = await groups()
        assert now['right']['active'] == ['welcome.md', 'preview'] and now['right']['bodies'] == ['preview-body'], now['right']
        assert 'STILO MARKER' in await page.locator('#preview-output').inner_text()
        assert ['welcome.md', 'preview'] not in now['left']['tabs'], now['left']

        # Two previews at once (stage 2): a diagram in the right group's preview, then the
        # note's preview taken to the left group; the diagram stays, in a second preview
        # with an editor of its own.
        await page.locator('#explorer-tree .tree-row', has_text='welcome.bmap').first.click()
        await page.wait_for_selector('#preview-pane #preview-output .bmap-editor', timeout=15000)
        await menu('right', 'welcome.md', 'preview', 'Move to Other Group')
        now = await groups()
        assert now['left']['active'] == ['welcome.md', 'preview'] and now['left']['bodies'] == ['preview-body'], now['left']
        assert now['right']['active'] == ['welcome.bmap', 'preview'], now['right']
        await page.wait_for_selector('#preview-pane .second-preview .bmap-editor', timeout=15000)
        assert await page.locator('#preview-pane .second-preview').is_visible()
        assert 'STILO MARKER' in await page.locator('#preview-output').inner_text()
        assert await page.locator('.bmap-editor').count() == 1, 'the note in the preview, the diagram in the second one'

        # A second preview whose file changes while focus is inside it (a diagram's field) draws
        # the new file. Both previews to the side twice, then the diagram chosen on the right (the
        # main preview goes with it): the left shows the diagram in a second preview. Its tab
        # closed (without taking focus), the left's next preview tab, the note, is drawn there.
        await menu('left', 'welcome.md', 'preview', 'Open to the Side')
        await menu('right', 'welcome.bmap', 'preview', 'Open to the Side')
        await page.evaluate('''() => { const tab = [...document.querySelectorAll(".editor-group[data-group='right'] .editor-tab[data-view='preview']")]
          .find((t) => t.querySelector(".tab-title").textContent === "welcome.bmap");
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) tab.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })); }''')
        await page.wait_for_selector(".editor-group[data-group='left'] .second-preview .bmap-editor", timeout=15000)
        inside = await page.evaluate('''() => { const editor = document.querySelector(".editor-group[data-group='left'] .second-preview .bmap-editor");
          const field = document.createElement("input");
          editor.append(field);
          field.focus();
          return editor.contains(document.activeElement); }''')
        assert inside, 'focus inside the diagram'
        await page.evaluate('''() => { const tab = [...document.querySelectorAll(".editor-group[data-group='left'] .editor-tab[data-view='preview']")]
          .find((t) => t.querySelector(".tab-title").textContent === "welcome.bmap");
          const close = tab.querySelector(".tab-close");
          for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) close.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })); }''')
        await page.wait_for_timeout(800)
        now = await groups()
        assert now['left']['active'] == ['welcome.md', 'preview'], now['left']
        second = await page.evaluate('''document.querySelector(".editor-group[data-group='left'] .second-preview .preview-output").innerText''')
        assert 'STILO MARKER' in second and await page.locator(".editor-group[data-group='left'] .second-preview .bmap-editor").count() == 0, second[:80]

        assert not errors, errors
        await browser.close()
        print(json.dumps({'checks': ['move to other group', 'placeholder left behind', 'open to the side', 'drag to the other strip',
                                     'emptied group closes', 'explorer opens in the group left', 'group comes back', 'move back',
                                     'a diagram in a second preview', 'another file drawn in it while focus is inside']}))


asyncio.run(main())
