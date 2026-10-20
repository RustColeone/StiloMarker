"""Browser regression for the first modules in the page: Shell (the menu bar
is drawn from registered commands, shortcuts run commands, dialogs work) and
File types (the page's lists of file types are filled from one list).

Checks: five menus in order with their items; a menu item runs its command;
live titles ("Show Chat" / "Hide Chat"); Ctrl+S runs Save from anywhere;
the rename dialog keeps the file extension out of the field; a module added
after start-up appears in the menus; the phone's menu panel shows the same
groups; the trace records errors nothing caught and its log tab shows them; the
explorer's Replace File replaces an image; Settings' sections and fields come
from their owners and take effect;
no page errors. Static responses come from this checkout.
"""
import asyncio, base64, json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('STILO_TEST_URL', 'http://127.0.0.1:8765')
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360f8cf0000000301010018dd8db40000000049454e44ae426082')
HOOK = app_hook('window.__shellTest = { shell, controller, renameFileById, openFileFromExplorer, get log() { return shell.logLines().map((e) => e.message); } };')


def project():
    return {'id': 'shell-test', 'name': 'Shell', 'sourceMode': 'memory', 'rootId': 'root', 'activeFileId': 'a', 'nodes': {
        'root': {'id': 'root', 'kind': 'folder', 'name': 'Shell', 'children': ['a', 'd', 'p'], 'expanded': True},
        'a': {'id': 'a', 'kind': 'file', 'parentId': 'root', 'name': 'notes.md', 'content': '# Notes', 'dirty': False},
        'd': {'id': 'd', 'kind': 'file', 'parentId': 'root', 'name': 'welcome.bmap', 'content': (ROOT / 'Template/welcome.bmap').read_text(), 'dirty': False},
        'p': {'id': 'p', 'kind': 'file', 'parentId': 'root', 'name': 'dot.png', 'content': 'data:image/png;base64,' + base64.b64encode(PNG).decode(), 'dirty': False}}}


async def open_page(browser, viewport, **options):
    context = await browser.new_context(viewport=viewport, service_workers='block', **options)
    page = await context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    await page.add_init_script('if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1");'
                               ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(project())) + ');'
                               ' localStorage.setItem("mdnotes.settings.v1", JSON.stringify({chatPanel: "hidden"})); }')

    async def route(rt):
        parsed = urlparse(rt.request.url)
        if parsed.netloc != urlparse(BASE).netloc:
            await rt.continue_(); return
        path = parsed.path
        if path.startswith('/api/'):
            payload = {'appVersion': 'dev', 'minSyncVersion': 117} if path == '/api/ping' else {}
            await rt.fulfill(status=200, content_type='application/json', body=json.dumps(payload)); return
        file = ROOT / (path.lstrip('/') or 'index.html')
        if not file.is_file():
            await rt.continue_(); return
        body = file.read_bytes() + (HOOK if path == '/app/main.js' else b'')
        await rt.fulfill(status=200, content_type=mimetypes.guess_type(str(file))[0] or 'application/octet-stream', body=body)
    await context.route('**/*', route)
    await page.goto(BASE, wait_until='networkidle')
    await page.wait_for_function('Boolean(window.__shellTest)')
    return context, page, errors


async def main():
    async with async_playwright() as pw:
        options = {'headless': True}
        if os.environ.get('STILO_BROWSER'):
            options['executable_path'] = os.environ['STILO_BROWSER']
        browser = await pw.chromium.launch(**options)
        context, page, errors = await open_page(browser, {'width': 1280, 'height': 800})

        # File types fills every list of types the page shows.
        accept = await page.get_attribute('#import-file-input', 'accept')
        assert accept.split(',')[:2] == ['.md', '.mtree'] and '.persona.skill' in accept and accept.endswith('.zip'), accept
        assert await page.get_attribute('#replace-file-input', 'accept') == '.png,.jpg,.jpeg,.gif,.svg,.webp,.bmp'
        supported = await page.locator('#add-file-status-text').text_content()
        assert supported.startswith('Supported: .md') and '.bmap' in supported and '.skill' in supported, supported
        options = await page.evaluate('[...document.querySelectorAll("#new-file-type option")].map((o) => [o.value, o.textContent])')
        assert options == [['md', 'Markdown (.md)'], ['mtree', 'MTREE (.mtree)'], ['urldb', 'URL Album (.urldb)'],
                           ['bmap', 'Brainstorm Diagram (.bmap)'], ['persona', 'Character (.persona.skill)'],
                       ['mermaid', 'Mermaid (.mmd)'], ['htmlpage', 'HTML Page (.html)']], options

        # Five menus, in order, each with its items.
        labels = await page.locator('.menu-bar .menu-trigger').all_inner_texts()
        assert labels == ['File', 'Edit', 'Create', 'View', 'Settings'], labels
        counts = await page.evaluate('[...document.querySelectorAll(".menu-bar .menu-popover")].map((p) => p.children.length)')
        assert counts == [9, 5, 8, 6, 6], counts  # Create: md, mtree, urldb, bmap, persona, mermaid, html, folder
        assert await page.locator('#file-menu').is_hidden()

        # Opening one closes the others; a click outside closes it.
        await page.click('#file-menu-button')
        assert await page.locator('#file-menu').is_visible()
        await page.click('#view-menu-button')
        assert await page.locator('#file-menu').is_hidden() and await page.locator('#view-menu').is_visible()
        await page.mouse.click(640, 500)
        assert await page.locator('#view-menu').is_hidden()

        # A live title, and a menu item running its command.
        await page.click('#view-menu-button')
        assert await page.locator('[data-command="assistant.toggle-chat"]').inner_text() == 'Show Chat'
        await page.click('[data-command="assistant.toggle-chat"]')
        await page.wait_for_function('document.querySelector(".app-shell")?.dataset.chat === "shown"')
        await page.click('#view-menu-button')
        assert await page.locator('[data-command="assistant.toggle-chat"]').inner_text() == 'Hide Chat'
        await page.keyboard.press('Escape')
        await page.mouse.click(640, 500)

        # Ctrl+S runs Save, even while typing in the editor.
        await page.click('#editor-content')
        await page.keyboard.press('Control+s')
        await page.wait_for_function('window.__shellTest.log.includes("shell: command workspace.save")')

        # Save took a snapshot (History's). After an edit, comparing with it opens
        # the diff as a tab in the preview pane (an Editor pane view); closing the
        # tab brings the file's preview back.
        await page.wait_for_selector('.app-toast:has-text("Snapshot saved: notes.md")')
        await page.keyboard.press('End')
        await page.keyboard.type(' and more')
        await page.evaluate('window.__shellTest.shell.run("history.snapshots")')
        await page.click('#snapshots-list .snapshot-item')
        await page.click('#snapshots-compare-btn')
        await page.wait_for_selector('#preview-diff-view:not([hidden])')
        diff = await page.evaluate('''() => [document.querySelector("#preview-output").hidden,
            [...document.querySelectorAll("#preview-tab-strip .editor-tab")].map((t) => t.textContent.trim()).filter((s) => s.includes("±")).length,
            document.querySelector("#diff-body").textContent.includes("and more")]''')
        assert diff == [True, 1, True], diff
        await page.click('#preview-tab-strip .editor-tab:has-text("±") .tab-close')
        await page.wait_for_selector('#preview-diff-view', state='hidden')
        assert not await page.locator('#preview-output').is_hidden()

        # The rename dialog keeps ".md" out of the field and puts it back.
        await page.evaluate('() => { void window.__shellTest.renameFileById("a"); }')
        await page.wait_for_selector('#input-dialog[open]')
        assert await page.locator('#input-dialog-input').input_value() == 'notes'
        await page.locator('#input-dialog-input').fill('ideas')
        await page.locator('#input-dialog-input').press('Enter')
        await page.wait_for_selector('.tree-row[title="ideas.md"]', timeout=10000)

        # Something added after start-up (as a module or an extension would) appears.
        await page.evaluate('''() => {
            window.__shellTest.shell.menus.add({ id: "extra", label: "Extra", order: 9 });
            window.__shellTest.shell.commands.add({ id: "extra.hello", title: "Hello", menu: { id: "extra" },
                run: () => window.__shellTest.shell.toast("hello") });
        }''')
        await page.wait_for_selector('#extra-menu-button')
        await page.click('#extra-menu-button')
        await page.click('[data-command="extra.hello"]')
        await page.wait_for_selector('.app-toast:has-text("hello")')
        assert not errors, errors

        # The explorer's Replace File (an image) picks a file and replaces the image's bytes.
        await page.locator('.tree-row[title="dot.png"]').click(button='right')
        async with page.expect_file_chooser() as chooser:
            await page.locator('#explorer-context-menu').get_by_text('Replace File', exact=True).click()
        await (await chooser.value).set_files({'name': 'new.png', 'mimeType': 'image/png', 'buffer': PNG + b'\0'})
        replaced = 'data:image/png;base64,' + base64.b64encode(PNG + b'\0').decode()
        await page.wait_for_function('(replaced) => window.__shellTest.controller.getProject().nodes.p.content === replaced', arg=replaced)
        assert not errors, errors

        # The welcome page (no file open): its parts are their owners' (New file:
        # the Explorer; Open a workspace: Cloud, only when signed in).
        await page.evaluate('() => { const c = window.__shellTest.controller; c.getProject().activeFileId = null; window.__shellTest.shell.render(c.getProject()); }')
        await page.wait_for_selector('#welcome-new-file', state='visible')
        assert await page.locator('#welcome-open-server').is_hidden()
        await page.click('#welcome-new-file')
        await page.wait_for_function('document.querySelector("#new-file-dialog").open')
        await page.keyboard.press('Escape')
        await page.evaluate('window.__shellTest.openFileFromExplorer("a")')

        # The status bar: each item added by its owner, in order; the count
        # follows the selection; the server item opens Settings → Collaboration.
        items = await page.evaluate('[...document.querySelectorAll(".status-bar > *")].map((e) => e.id)')
        assert items == ['status-source-item', 'status-browser-item', 'status-server-item', 'status-presence-item',
                         'status-version-item', 'status-charcount-item'], items
        await page.click('#editor-content')
        await page.keyboard.press('Control+a')
        await page.wait_for_function('/ \\/ .* chars$/.test(document.querySelector("#status-charcount-text").textContent)')
        await page.click('#status-server-item')
        assert await page.evaluate('[document.querySelector("#settings-dialog").open, window.__shellTest.shell.pages.active("settings")]') == [True, 'collaboration']
        await page.keyboard.press('Escape')

        # Settings: sections added by their owners, in order; Appearance's fields
        # declared by Shell, the Editor, Workspace and the diagram, each showing
        # its setting; a change takes effect whoever owns it.
        await page.evaluate('window.__shellTest.shell.settingsDialog.open("appearance")')
        tabs = await page.evaluate('[...document.querySelectorAll("#settings-tab-strip [data-page]")].map((b) => [b.dataset.page, b.getAttribute("aria-selected")])')
        assert tabs == [['appearance', 'true'], ['agent', 'false'], ['collaboration', 'false']], tabs
        fields = await page.evaluate('[...document.querySelectorAll("#settings-panel-appearance [data-settings-fields] select, #settings-panel-appearance [data-settings-fields] input")].map((c) => c.id)')
        assert fields == ['explorer-select', 'explorer-anchor-select', 'preview-select', 'source-font-size-select',
                          'source-font-family-select', 'source-font-custom-input', 'word-wrap-select', 'indent-style-select',
                          'format-toolbar-input', 'auto-save-input', 'bmap-generate-scope-select', 'bmap-auto-pan-input'], fields
        # Theme: a card per theme (System, Light, Dark, then the extension's); a click applies one.
        cards = await page.evaluate('[...document.querySelectorAll("#theme-picker .theme-card")].map((c) => [c.dataset.themeChoice, c.getAttribute("aria-checked")])')
        assert cards == [['system', 'true'], ['light', 'false'], ['dark', 'false'], ['paper', 'false'], ['midnight', 'false'],
                         ['forest', 'false'], ['high-contrast', 'false']], cards
        await page.click('#theme-picker [data-theme-choice="dark"]')
        assert await page.evaluate('document.documentElement.dataset.theme') == 'dark'
        await page.click('#theme-picker [data-theme-choice="paper"]')
        theme = await page.evaluate('''[document.documentElement.dataset.theme, document.documentElement.dataset.themeId,
            getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(), document.querySelector('#theme-picker [aria-checked="true"]').dataset.themeChoice]''')
        assert theme == ['light', 'paper', '#efe8dc', 'paper'], theme
        await page.keyboard.press('ArrowRight')
        assert await page.evaluate('document.documentElement.dataset.themeId') == 'midnight', 'arrows move the choice'
        await page.click('#theme-picker [data-theme-choice="dark"]')
        await page.select_option('#source-font-size-select', '18')
        assert await page.evaluate('document.documentElement.style.getPropertyValue("--editor-font-size")') == '18px'
        await page.select_option('#word-wrap-select', 'off')
        assert await page.evaluate('document.querySelector(".app-shell").dataset.wordWrap') == 'off'
        # A change made elsewhere shows in its field.
        await page.evaluate('window.__shellTest.shell.settings.change({ preview: "hidden" }, "test")')
        assert await page.input_value('#preview-select') == 'hidden'
        await page.click('#settings-tab-strip [data-page="collaboration"]')
        assert await page.is_hidden('#settings-panel-appearance') and await page.is_visible('#settings-panel-collaboration')
        # Collaboration (Cloud's) shows its settings, whoever changed them.
        await page.evaluate('window.__shellTest.shell.settings.change({ displayName: "Ada" }, "test")')
        assert await page.input_value('#display-name-input') == 'Ada'
        # Agent (Models'): choosing your own key shows its fields, its note and the status line.
        await page.click('#settings-tab-strip [data-page="agent"]')
        await page.select_option('#agent-source-select', 'own')
        agent = await page.evaluate('[document.querySelector("#agent-own-fields").hidden, document.querySelector("#agent-status-line").textContent]')
        assert agent == [False, 'Enter your API key below to enable the agent.'], agent
        await page.fill('#agent-api-key-input', '  sk-test  ')
        await page.press('#agent-api-key-input', 'Tab')
        assert await page.evaluate('window.__shellTest.shell.settings.agentApiKey') == 'sk-test'
        await page.wait_for_function('document.querySelector("#agent-status-line").textContent.startsWith("Ready")')
        await page.keyboard.press('Escape')
        assert not errors, errors

        # The trace: module logs and errors nothing caught are recorded with
        # where they came from; the log panel's Trace tab and stiloTrace() show them.
        await page.evaluate('''() => {
            setTimeout(() => { throw new Error("trace check: thrown"); });
            Promise.reject(new Error("trace check: rejected"));
        }''')
        await page.wait_for_function('stiloTrace().filter((e) => e.kind === "uncaught").length >= 2')
        uncaught = await page.evaluate('stiloTrace().filter((e) => e.kind === "uncaught").map((e) => [e.owner, e.message])')
        assert ['promise', 'Error: trace check: rejected'] in uncaught, uncaught
        assert any(message == 'Error: trace check: thrown' for owner, message in uncaught), uncaught
        assert await page.evaluate('stiloTrace().some((e) => e.kind === "log" && e.message === "started shell")')
        await page.evaluate('window.__shellTest.shell.run("shell.toggle-log")')
        await page.click('#debug-tab-trace')
        await page.wait_for_selector('#debug-log-list .debug-log-entry.is-uncaught:has-text("trace check: rejected")')
        await page.click('#debug-clear-button')
        await page.wait_for_function('stiloTrace().length === 0')
        errors[:] = [e for e in errors if 'trace check' not in e]
        assert not errors, errors

        # A diagram previews as the diagram editor, not as its text (lost in v0.1.48).
        await page.evaluate('window.__shellTest.openFileFromExplorer("d")')
        await page.wait_for_selector('#preview-output .bmap-editor', timeout=15000)
        # In the source editor the extension's highlighting, toolbar buttons and
        # autocomplete apply to the diagram (the Editor's extension points).
        await page.wait_for_selector('#editor-content .token-bmap-selector')
        await page.evaluate('window.__shellTest.shell.settings.change({ showFormatToolbar: true }, "test")')
        await page.wait_for_selector('#editor-format-toolbar [data-toolbar-button-id="bmap-node-rect"]')
        await page.focus('#editor-content')
        await page.keyboard.press('Control+End')
        await page.keyboard.press('Enter')
        await page.keyboard.type('.no')
        await page.wait_for_selector('#editor-autocomplete:not([hidden])')
        assert 'node' in await page.locator('#editor-autocomplete').inner_text()
        await page.keyboard.press('Escape')
        # Diagrams are an extension (extensions/bmap-diagram): its Export As in the
        # explorer's menu, and a new diagram's first content.
        await page.locator('.tree-row[title="welcome.bmap"]').click(button='right')
        await page.locator('#explorer-context-menu').get_by_text('Export As', exact=True).hover()
        async with page.expect_download() as download:
            await page.locator('#explorer-context-menu').get_by_text('Vector (SVG)', exact=True).click()
        assert (await download.value).suggested_filename.endswith('.svg'), (await download.value).suggested_filename
        await page.evaluate('window.__shellTest.shell.run("file-types.new-bmap")')
        await page.wait_for_function('Object.values(window.__shellTest.controller.getProject().nodes).some((n) => /^new diagram.*\\.bmap$/.test(n.name) && n.content.includes("{"))')
        assert not errors, errors
        await context.close()

        # Phone: the ⋮ panel shows the same groups.
        context, phone, errors = await open_page(browser, {'width': 390, 'height': 760}, is_mobile=True, has_touch=True)
        await phone.locator('#mobile-menu-button').click()
        await phone.wait_for_function('document.querySelector(".app-shell")?.dataset.mobileMenu === "open"')
        assert await phone.locator('.menu-bar .menu-trigger').count() == 5
        await phone.locator('#edit-menu-button').click()
        assert await phone.locator('[data-command="editor.find-replace"]').is_visible()
        widths = await phone.evaluate('[document.documentElement.scrollWidth, innerWidth]')
        assert widths[0] <= widths[1], widths
        assert not errors, errors
        await context.close()
        await browser.close()
        print(json.dumps({'checks': ['file-type lists from File types', 'five menus with their items', 'one menu open at a time', 'live titles',
                                     'menu item runs its command', 'Ctrl+S runs Save', 'a snapshot compared in the diff tab', 'rename keeps the extension',
                                     'late menus and commands appear', 'Replace File replaces an image', 'the welcome page from its owners', 'status bar items from their owners', 'Settings sections and fields', 'the trace and its tab', 'a diagram previews as a diagram', 'diagram source: highlighting, toolbar, autocomplete (extension)', 'diagram Export As and new diagram (extension)', 'phone menu panel'], 'runtimeErrors': 0}))


asyncio.run(main())
