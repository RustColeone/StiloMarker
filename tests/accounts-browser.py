"""Browser regression: Settings → Accounts, the admin page (v0.2.33), on a
real backend whose account file still keeps its passwords as typed (amy is
the admin, ben is not).

Checks: ben signs in and sees no Accounts page; amy does, with the accounts,
their teams and who is an admin (never a password); she adds an account
(who can then sign in), sets ben's password (the old one no longer works),
changes his teams, cannot stop being the last admin (the server's reason is
shown, the box goes back), makes ben an admin and then can; she removes an
account, which is signed out at once; a short password is refused with the
server's reason. The file keeps every password hashed that the page set.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.error, urllib.request
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
    {"username": "amy", "password": "amy-password", "teams": ["red"], "admin": True},
    {"username": "ben", "password": "ben-password", "teams": ["red"]},
    {"username": "cal", "password": "cal-password", "teams": []}]}))
env = {**os.environ, "MDNOTES_CHAT_API_KEY": "", "OPENAI_API_KEY": ""}
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(ACCOUNTS),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"


def login(username, password):
    req = urllib.request.Request(f"{BASE}/api/auth/login", method="POST", data=json.dumps({"username": username, "password": password}).encode(),
                                 headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
    except urllib.error.HTTPError:
        return None


checks = []
def ok(name): checks.append(name); print("  ok ", name)

HOOK = app_hook("window.__id = { identity, shell };")


async def open_page(b, username, password):
    settings = {"accountUsername": username, "accountPassword": password, "accountSuccess": {BASE: username}, "serverUrl": BASE}
    ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
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
    await page.wait_for_function("Boolean(window.__id) && window.__id.identity.account()", timeout=20000)
    return ctx, page, errors


async def accounts_page(page):
    await page.click("#settings-button")
    await page.click('#settings-tab-strip [data-page="accounts"]')
    await page.wait_for_selector(".accounts-admin tbody tr")


def rows(page):
    return page.evaluate('''[...document.querySelectorAll(".accounts-admin tbody tr")].map((tr) => [tr.dataset.username,
      tr.children[1].textContent, tr.querySelector("input[type=checkbox]").checked])''')


async def fill_form(page, values):
    await page.wait_for_selector("#form-dialog[open]")
    for name, value in values.items():
        await page.fill(f'#form-dialog-field-{name}', value)
    await page.click("#form-dialog-submit-button")


async def main():
    async with async_playwright() as pw:
        launch = {"headless": True}
        if os.environ.get("STILO_BROWSER"): launch["executable_path"] = os.environ["STILO_BROWSER"]
        b = await pw.chromium.launch(**launch)
        try:
            ctx, page, errors = await open_page(b, "ben", "ben-password")
            await page.click("#settings-button")
            tab = page.locator('#settings-tab-strip [data-page="accounts"]')
            assert await tab.count() == 0 or not await tab.is_visible(), "no Accounts page for ben"
            await ctx.close()
            ok("an ordinary account sees no Accounts page")

            ctx, page, errors = await open_page(b, "amy", "amy-password")
            await accounts_page(page)
            assert await rows(page) == [["amy", "red", True], ["ben", "red", False], ["cal", "–", False]], await rows(page)
            shown = await page.evaluate("document.querySelector('.accounts-admin').outerHTML")
            assert not any(secret in shown for secret in ("amy-password", "ben-password", "cal-password", "scrypt$")), "never a password or its hash"
            ok("the admin sees every account, its teams and admins, never a password")

            await page.click('.accounts-admin [data-act="add"]')
            await fill_form(page, {"username": "dee", "password": "dee-password", "teams": "red, blue"})
            await page.wait_for_function('document.querySelectorAll(".accounts-admin tbody tr").length === 4')
            assert (await rows(page))[3] == ["dee", "red, blue", False], await rows(page)
            assert login("dee", "dee-password")["teams"] == ["red", "blue"]
            ok("an account added can sign in, with its teams")

            stored = lambda: next(u["password"] for u in json.loads(ACCOUNTS.read_text())["users"] if u["username"] == "ben")
            before = stored()
            await page.click('.accounts-admin tr[data-username="ben"] [data-act="password"]')
            await fill_form(page, {"password": "ben-new-password"})
            for _ in range(150):  # kept once hashed (slow on purpose); signing in to find out would count wrong tries
                if stored() != before: break
                await page.wait_for_timeout(100)
            assert login("ben", "ben-new-password") and not login("ben", "ben-password"), "the new password, not the old"
            await page.click('.accounts-admin tr[data-username="ben"] [data-act="teams"]')
            await page.wait_for_selector("#input-dialog[open]")
            await page.fill("#input-dialog-input", "red, green")
            await page.click("#input-dialog-submit-button")
            await page.wait_for_function('document.querySelector(".accounts-admin tr[data-username=ben]").children[1].textContent === "red, green"')
            ok("a password set (the old one no longer works) and teams changed")

            cal = login("cal", "cal-password")["token"]
            page.once("dialog", lambda dialog: asyncio.ensure_future(dialog.accept()))
            await page.click('.accounts-admin tr[data-username="cal"] [data-act="remove"]')
            await page.wait_for_selector("#confirm-dialog[open]")
            await page.click("#confirm-dialog-accept-button")
            await page.wait_for_function('!document.querySelector(".accounts-admin tr[data-username=cal]")')
            req = urllib.request.Request(f"{BASE}/api/workspaces/browse?token={cal}")
            try:
                urllib.request.urlopen(req, timeout=10); refused = False
            except urllib.error.HTTPError:
                refused = True
            assert refused and not login("cal", "cal-password"), "removed: signed out at once, and cannot sign in"
            ok("a removed account is signed out at once")

            await page.click('.accounts-admin tr[data-username="dee"] [data-act="password"]')
            await fill_form(page, {"password": "short"})
            await page.wait_for_function('document.querySelector(".accounts-admin-status").textContent.includes("at least 8")')
            ok("a short password is refused with the server's reason")

            await page.uncheck('.accounts-admin tr[data-username="amy"] input[type=checkbox]')
            await page.wait_for_function('document.querySelector(".accounts-admin-status").textContent.includes("last admin")')
            assert await page.is_checked('.accounts-admin tr[data-username="amy"] input[type=checkbox]'), "the box goes back"
            await page.check('.accounts-admin tr[data-username="ben"] input[type=checkbox]')
            await page.wait_for_timeout(400)
            await page.uncheck('.accounts-admin tr[data-username="amy"] input[type=checkbox]')
            await page.wait_for_timeout(400)
            assert [row[0] for row in await rows(page) if row[2]] == ["ben"], await rows(page)
            ok("the last admin stays (the server's reason shown); another admin, then she can step down")


            kept = json.loads(ACCOUNTS.read_text())["users"]
            assert all(user["password"].startswith("scrypt$") for user in kept if user["username"] in ("ben", "dee")), "set passwords are hashed"
            assert not errors, errors
            await ctx.close()
        finally:
            await b.close()
            SERVER.terminate()
    print(json.dumps({"checks": checks}))


asyncio.run(main())
