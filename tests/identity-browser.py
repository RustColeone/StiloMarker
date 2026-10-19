"""Browser regression for Identity and access: a real backend with two
accounts (amy owns a project, ben is in her team).

Checks: a wrong password shows the server's refusal; signing in shows the
account and its team; a reload signs in again by itself; the access dialog
reads and saves the project's lists (the server keeps them); ben, not the
owner, is refused; signing out forgets the password but keeps the username,
and a reload then stays signed out.
"""
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
ACCOUNTS = Path(TMP.name) / "accounts.json"
ACCOUNTS.write_text(json.dumps({"users": [
    {"username": "amy", "password": "pw", "teams": ["red"]},
    {"username": "ben", "password": "pw", "teams": ["red"]}]}))
env = {**os.environ, "MDNOTES_CHAT_API_KEY": "", "OPENAI_API_KEY": ""}
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(ACCOUNTS),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"


def api(method, path, body=None):
    req = urllib.request.Request(f"{BASE}{path}", method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


checks = []
def ok(name): checks.append(name); print("  ok ", name)

HOOK = app_hook("window.__id = { identity, openAccessEditor: (...a) => cloudParts.openAccessEditor(...a), controller, render: (p) => shell.render(p) };")


async def open_page(b, settings=None):
    ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
    if settings is not None:
        await ctx.add_init_script("localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(settings)) + ");")

    async def route(rt):
        path = urlparse(rt.request.url).path
        if path == "/app/main.js":
            response = await rt.fetch()
            await rt.fulfill(response=response, body=(await response.body()) + HOOK); return
        if path.startswith("/Template/"):
            await rt.abort(); return
        await rt.continue_()
    await ctx.route("**/*", route)
    page = await ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    await page.goto(BASE + "/", wait_until="networkidle")
    await page.wait_for_function("Boolean(window.__id)")
    return ctx, page, errors


async def collaboration_settings(page):
    await page.click("#settings-button")
    await page.click('#settings-tab-strip [data-page="collaboration"]')
    await page.wait_for_selector("#account-login-row:not([hidden])", timeout=15000)


def stored(page):
    return page.evaluate("JSON.parse(localStorage.getItem('mdnotes.settings.v1'))")


async def main():
    amy = api("POST", "/api/auth/login", {"username": "amy", "password": "pw"})["token"]
    path = api("POST", f"/api/workspaces/create?token={amy}", {"team": "red", "path": "", "name": "Novel", "version": 117})["path"]

    async with async_playwright() as pw:
        launch = {"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}
        b = await pw.chromium.launch(**launch)
        ctx, page, errors = await open_page(b)
        await collaboration_settings(page)

        await page.fill("#account-username-input", "amy")
        await page.fill("#account-password-input", "wrong")
        await page.click("#account-login-button")
        await page.wait_for_function("document.querySelector('#account-status-text').textContent.includes('Invalid username or password')")
        assert await page.evaluate("window.__id.identity.account()") is None
        ok("a wrong password shows the server's refusal and signs nobody in")

        await page.fill("#account-password-input", "pw")
        await page.click("#account-login-button")
        await page.wait_for_function("document.querySelector('#account-status-text').textContent === 'Logged in as amy · teams: red'")
        assert await page.is_visible("#account-logout-button")
        assert not await page.is_visible("#account-login-fields")
        saved = await stored(page)
        assert saved["accountUsername"] == "amy" and saved["accountPassword"] == "pw" and list(saved["accountSuccess"].values()) == ["amy"], saved
        ok("signing in shows the account and its team, and stores the sign-in")

        await page.reload(wait_until="networkidle")
        await page.wait_for_function("Boolean(window.__id) && window.__id.identity.account()?.username === 'amy'", timeout=15000)
        ok("a reload signs in again by itself")

        # Signed in, the welcome page offers to open a workspace from the server
        # (the button did nothing from the unified file browser until v0.1.75).
        await page.keyboard.press("Escape")
        await page.evaluate("() => { const c = window.__id.controller; c.getProject().activeFileId = null; window.__id.render(c.getProject()); }")
        await page.wait_for_selector("#welcome-open-server", state="visible")
        await page.click("#welcome-open-server")
        await page.wait_for_function("document.querySelector('#open-server-dialog')?.open")
        await page.keyboard.press("Escape")
        ok("signed in, the welcome page opens a workspace from the server")

        await page.keyboard.press("Escape")
        await page.evaluate(f"window.__id.openAccessEditor('red', {json.dumps(path)}, 'Novel')")
        await page.wait_for_selector("#access-dialog[open]")
        assert await page.text_content("#access-dialog-title") == "Access — Novel"
        assert await page.input_value("#access-whitelist") == ""
        await page.fill("#access-whitelist", "amy\nben")
        await page.fill("#access-blacklist", "eve")
        await page.click("#access-save-button")
        await page.wait_for_selector("#access-dialog[open]", state="detached")
        kept = api("GET", f"/api/workspaces/access?token={amy}&team=red&path={path}")
        assert (kept["whitelist"], kept["blacklist"], kept["createdBy"]) == (["amy", "ben"], ["eve"], "amy"), kept
        await page.evaluate(f"window.__id.openAccessEditor('red', {json.dumps(path)}, 'Novel')")
        await page.wait_for_function("document.querySelector('#access-whitelist').value === 'amy\\nben'")
        await page.keyboard.press("Escape")
        ok("the access dialog reads and saves the project's lists on the server")

        ctx_b, ben_page, errors_b = await open_page(b, {"serverUrl": "", "accountUsername": "ben", "accountPassword": "pw", "accountSuccess": {BASE: "ben"}})
        await ben_page.wait_for_function("window.__id.identity.account()?.username === 'ben'", timeout=15000)
        await ben_page.evaluate(f"window.__id.openAccessEditor('red', {json.dumps(path)}, 'Novel')")
        await ben_page.wait_for_function("document.querySelector('#access-whitelist').value === 'amy\\nben'")
        await ben_page.fill("#access-whitelist", "ben")
        await ben_page.click("#access-save-button")
        await ben_page.wait_for_function("document.querySelector('#access-status').textContent.includes('Only the project owner can change access')")
        assert api("GET", f"/api/workspaces/access?token={amy}&team=red&path={path}")["whitelist"] == ["amy", "ben"]
        ok("someone who is not the owner is refused, and the lists stay")

        await collaboration_settings(page)
        await page.click("#account-logout-button")
        await page.wait_for_function("window.__id.identity.account() === null")
        assert await page.is_visible("#account-login-fields")
        saved = await stored(page)
        assert saved["accountUsername"] == "amy" and saved["accountPassword"] == "" and saved["accountSuccess"] == {}, saved
        await page.reload(wait_until="networkidle")
        await page.wait_for_function("Boolean(window.__id)")
        await page.wait_for_timeout(1500)
        assert await page.evaluate("window.__id.identity.account()") is None
        await collaboration_settings(page)
        assert await page.input_value("#account-username-input") == "amy"
        ok("signing out forgets the password, keeps the username, and stays signed out after a reload")

        assert not errors and not errors_b, errors + errors_b
        await ctx.close(); await ctx_b.close(); await b.close()
    print(json.dumps({"checks": checks, "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
    SERVER.wait(timeout=10)
