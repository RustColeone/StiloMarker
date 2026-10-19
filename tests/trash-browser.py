"""Browser regression for the team's trash, with a real backend: deleting a
cloud project in the file manager says it goes to the Trash; the Trash lists
it with the days left; Restore brings it back where it was; Delete now
removes it for good."""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


PORT = free_port()
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": [{"username": "anna", "password": "pw", "teams": ["qa"]}]}))
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(Path(TMP.name) / "whitelist.json"),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env={**os.environ, "MDNOTES_CHAT_API_KEY": "", "OPENAI_API_KEY": ""},
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"
DATA = Path(TMP.name) / "data"
checks = []


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


async def main():
    anna = api("POST", "/api/auth/login", {"username": "anna", "password": "pw"})["token"]
    for name in ("Novel", "Poems"):
        api("POST", "/api/workspaces/create", {"team": "qa", "name": name}, token=anna)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(**({"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}))
        ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
        settings = {"serverUrl": "", "accountUsername": "anna", "accountPassword": "pw", "accountSuccess": {BASE: "anna"}, "chatPanel": "hidden"}
        await ctx.add_init_script("localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(settings)) + ");")

        async def route(rt):
            if urlparse(rt.request.url).path == "/app/main.js":
                response = await rt.fetch()
                await rt.fulfill(response=response, body=await response.body() + app_hook("window.__t = { shell, identity };")); return
            await rt.continue_()
        await ctx.route("**/*", route)
        page = await ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE + "/", wait_until="networkidle")
        await page.wait_for_function("Boolean(window.__t?.identity.account())", timeout=15000)  # signed in
        rows = lambda: page.locator("#browser-list .browser-item-label").all_inner_texts()

        await page.evaluate('window.__t.shell.run("cloud.file-manager")')
        await page.locator('#browser-list .browser-item:has-text("qa")').dblclick()
        await page.wait_for_selector('#browser-list .browser-item-label:text-is("Novel")', timeout=15000)
        assert await page.locator("#browser-trash").is_visible(), "the Trash button shows inside a team"
        await page.click("#browser-select-toggle")
        await page.locator('#browser-list .browser-item:has-text("Novel")').click()
        await page.click("#browser-delete-btn")
        await page.wait_for_selector("#confirm-dialog[open]")
        message = await page.locator("#confirm-dialog-message").inner_text()
        assert "Trash keeps it for 30 days" in message, message
        await page.click("#confirm-dialog-accept-button")
        await page.wait_for_function('![...document.querySelectorAll("#browser-list .browser-item-label")].some((e) => e.textContent === "Novel")')
        assert not (DATA / "team_qa" / "Novel").exists()
        checks.append("deleting a cloud project says it goes to the Trash")

        await page.click("#browser-trash")
        await page.wait_for_selector("#trash-dialog[open] .trash-row", timeout=10000)
        row = page.locator("#trash-dialog .trash-row")
        text = await row.inner_text()
        assert "Novel" in text and "30 days left" in text and "deleted by anna" in text, text
        await row.get_by_text("Restore", exact=True).click()
        await page.wait_for_selector("#trash-dialog .subtle-label:text-is('The trash is empty.')", timeout=10000)
        await page.wait_for_function('[...document.querySelectorAll("#browser-list .browser-item-label")].some((e) => e.textContent === "Novel")', timeout=10000)
        assert (DATA / "team_qa" / "Novel" / "manifest.json").exists()
        checks.append("Restore brings the project back where it was")
        await page.click("#trash-dialog .dialog-actions button")

        api("POST", "/api/workspaces/delete", {"team": "qa", "path": "Poems"}, token=anna)
        await page.click("#browser-trash")
        await page.wait_for_selector('#trash-dialog[open] .trash-row:has-text("Poems")', timeout=10000)
        await page.locator('#trash-dialog .trash-row:has-text("Poems")').get_by_text("Delete now", exact=True).click()
        await page.wait_for_selector("#confirm-dialog[open]")
        await page.click("#confirm-dialog-accept-button")
        await page.wait_for_selector("#trash-dialog .subtle-label:text-is('The trash is empty.')", timeout=10000)
        assert list((DATA / "_trash" / "qa").iterdir()) == []
        checks.append("Delete now removes it for good")

        assert not errors, errors
        await b.close()
    print(json.dumps({"checks": checks, "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
    SERVER.wait(timeout=10)
