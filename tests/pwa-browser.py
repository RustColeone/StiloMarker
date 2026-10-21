"""Browser regression: the app as an installed web app (O5 of the stability
review), served for real (a copy of this checkout over HTTP, its service
worker running).

The manifest names the app and its icons (192, 512 and a maskable 512, the
right sizes). A formula (MathJax) and a Mermaid diagram draw from the
libraries served with the app; offline, a reload opens the app and draws them
again (nothing from a CDN).
A new version, once deployed, waits: the open tab keeps its own, the status
bar says "Update ready", and Reload Window (the item) starts it. With two
windows open, the one that did not start it follows (it reloads into the new
version, not mixing them). A reload keeps the version and says one waits;
Reload Window right after it still starts it. No page errors.
"""
import asyncio, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()
SITE = Path(TMP.name) / "site"
shutil.copytree(ROOT, SITE, ignore=shutil.ignore_patterns(".git", "server", "tests", "docs", "node_modules", "__pycache__", "*.py"))


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


PORT = free_port()
SERVER = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(SITE)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/index.html", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}/"
PROJECT = {"id": "pwa", "name": "PWA", "sourceMode": "memory", "rootId": "root", "activeFileId": "n", "nodes": {
    "root": {"id": "root", "kind": "folder", "name": "PWA", "children": ["n"], "expanded": True},
    "n": {"id": "n", "kind": "file", "parentId": "root", "name": "flow.md", "dirty": False,
          "content": "# Flow\n\nEnergy $E = mc^2$.\n\n```mermaid\nflowchart LR\n  Plan --> Write\n```\n"}}}
def deploy(old, new):
    sw = SITE / "service-worker.js"
    sw.write_text(sw.read_text().replace(f'"mdnotes-shell-v{old}"', f'"mdnotes-shell-v{new}"'))


async def version_becomes(page, want, seconds=30):
    # Asked only once the page has reloaded into it: questions to the version in
    # use while a new one waits keep it busy, and the browser does not swap a busy
    # one. Each within a few seconds: one asked as the page navigates may never be answered.
    for _ in range(seconds * 4):
        try:
            if await asyncio.wait_for(page.evaluate("Boolean(navigator.serviceWorker.controller)"), 5) \
                    and await asyncio.wait_for(page.evaluate(VERSION), 8) == want: return
        except Exception: pass  # the page is navigating: asked again
        await asyncio.sleep(0.25)
    raise AssertionError(f"version {want} never controlled the page")


DRAWN = "#preview-output .mermaid-diagram svg"
VERSION = '() => new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = (e) => resolve(e.data.version);' \
          ' navigator.serviceWorker.controller.postMessage({ type: "version" }, [c.port2]); setTimeout(() => resolve(null), 3000); })'


async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(**({"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}))
        context = await browser.new_context(viewport={"width": 1280, "height": 860})
        await context.add_init_script('if (!localStorage.getItem("mdnotes.copies.v1") && !localStorage.getItem("mdnotes.project.v1"))'
                                      ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(PROJECT)) + ');')
        elsewhere = []
        context.on("request", lambda request: elsewhere.append(request.url) if not request.url.startswith(BASE) and not request.url.startswith("data:") else None)
        page = await context.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await page.goto(BASE, wait_until="domcontentloaded")
        await page.wait_for_function("navigator.serviceWorker.ready.then(() => true)", timeout=30000)

        # The manifest: the app, its icons at the sizes it says.
        manifest = await page.evaluate('''async () => { const link = document.querySelector('link[rel="manifest"]');
            const data = await (await fetch(link.href)).json();
            const icons = await Promise.all(data.icons.filter((i) => i.type === "image/png").map((i) => new Promise((resolve) => {
              const img = new Image(); img.onload = () => resolve([i.sizes, i.purpose, img.naturalWidth, img.naturalHeight]); img.onerror = () => resolve([i.sizes, "missing"]);
              img.src = new URL(i.src, link.href).href; })));
            return { name: data.name, display: data.display, start: data.start_url, icons }; }''')
        assert manifest["name"] == "Stilo Marker" and manifest["display"] == "standalone" and manifest["start"] == "./", manifest
        assert manifest["icons"] == [["192x192", "any", 192, 192], ["512x512", "any", 512, 512], ["512x512", "maskable", 512, 512]], manifest["icons"]

        # Controlled from the next load; the diagram draws from the served library.
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_function("Boolean(navigator.serviceWorker.controller)", timeout=15000)
        await page.wait_for_selector(DRAWN, timeout=30000)
        await page.wait_for_selector("#preview-output mjx-container svg", timeout=30000)
        first = await asyncio.wait_for(page.evaluate(VERSION), 8)

        # Offline: the app opens, and the formula and the diagram draw again.
        await context.set_offline(True)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_selector(DRAWN, timeout=30000)
        await page.wait_for_selector("#preview-output mjx-container svg", timeout=30000)
        await context.set_offline(False)

        # A new version is deployed: it waits; this tab keeps its own and says one is ready.
        deploy(first, "next")
        await page.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
        await page.wait_for_function('document.querySelector("#status-update-item")?.hidden === false', timeout=30000)
        assert await asyncio.wait_for(page.evaluate(VERSION), 8) == first, "the open tab keeps its version"
        title = await page.get_attribute("#status-update-item", "title")
        assert "vnext" in title or "next" in title, title

        # Reload Window (the item) starts it.
        async with page.expect_navigation(timeout=30000):
            await page.click("#status-update-item")
        await page.wait_for_function("Boolean(navigator.serviceWorker.controller)", timeout=15000)
        await version_becomes(page, "next")
        await page.wait_for_selector(DRAWN, timeout=30000)
        assert await page.evaluate('document.querySelector("#status-update-item").hidden')

        # Two windows: started in one, the other follows into it.
        other = await context.new_page()
        other.on("pageerror", lambda e: errors.append(str(e)))
        await other.goto(BASE, wait_until="domcontentloaded")
        await version_becomes(other, "next")
        await other.wait_for_selector(DRAWN, timeout=30000)
        deploy("next", "next2")
        await page.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
        for each in (page, other):
            await each.wait_for_function('document.querySelector("#status-update-item")?.hidden === false', timeout=30000)
        assert await asyncio.wait_for(other.evaluate(VERSION), 8) == "next"
        async with page.expect_navigation(timeout=60000), other.expect_navigation(timeout=60000):
            await page.click("#status-update-item")
        await version_becomes(page, "next2")
        await version_becomes(other, "next2")
        await other.wait_for_selector(DRAWN, timeout=30000)
        await other.close()

        # A reload keeps the version (as browsers do) and says one waits; Reload
        # Window, even right as the page has started, starts it.
        deploy("next2", "next3")
        await page.evaluate("navigator.serviceWorker.getRegistration().then((r) => r.update())")
        await page.wait_for_function('document.querySelector("#status-update-item")?.hidden === false', timeout=30000)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_function('document.querySelector("#status-update-item")?.hidden === false', timeout=30000)
        assert await asyncio.wait_for(page.evaluate(VERSION), 8) == "next2"
        async with page.expect_navigation(timeout=60000):
            await page.click("#status-update-item")
        await version_becomes(page, "next3")
        await page.wait_for_selector(DRAWN, timeout=30000)

        assert not [url for url in elsewhere if "jsdelivr" in url or "unpkg" in url], elsewhere
        assert not errors, errors
        await browser.close()
    print(json.dumps({"checks": ["the manifest: the app and its icons at the sizes it says",
                                 "a formula and a Mermaid diagram from the libraries served with the app; offline, the app and both again",
                                 "a new version waits; the tab keeps its own and says Update ready",
                                 "Reload Window starts it; another window follows into it",
                                 "a reload keeps the version; Reload Window right after starts it", "nothing from a CDN"], "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
    TMP.cleanup()
