"""Browser regression: Chats between two people and a character, live.

Runs the real backend (a throwaway server, temporary data folder) with a fake
OpenAI-compatible model endpoint that streams a short reply, and two browsers
signed in as different accounts in one shared cloud workspace:

  A messages B in a private chat; B sees it live with an unread badge, reads it
  (badge clears) and answers; B's alias for A is visible only to B; A searches
  the chat; A invites the character, which starts a new group and keeps the
  private chat; in the group "@aria" streams a reply that both see being typed;
  a private chat with the character answers every message; phone width fits.

Nothing outside the temporary folder is touched. STILO_BROWSER may point at an
installed Chromium.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()


CALLS = []  # (from a browser?, persona name) for each model call


class FakeModel(BaseHTTPRequestHandler):
    """Streams 'Aye, <last line>' as chat-completions deltas, slowly. Allows
    browsers (CORS), so a page can call it directly like a local model."""
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))))
        system = body["messages"][0]["content"]
        name = system.split("You are playing ", 1)[1].split(",", 1)[0] if "You are playing " in system else "Agent"
        # Consecutive user turns arrive merged ("bob: …\n\nanna: …"): answer the last.
        last = body["messages"][-1]["content"].split("\n")[-1].split(": ", 1)[-1]
        words = f"{name} here. Aye, {last}".split(" ")
        CALLS.append((bool(self.headers.get("Origin")), name))
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for word in words:
            chunk = {"choices": [{"delta": {"content": word + " "}, "finish_reason": None}]}
            self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode()); self.wfile.flush()
            time.sleep(0.15)
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *args):
        pass


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


MODEL_PORT = free_port()
model_server = ThreadingHTTPServer(("127.0.0.1", MODEL_PORT), FakeModel)
threading.Thread(target=model_server.serve_forever, daemon=True).start()
PORT = free_port()
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": [
    {"username": "anna", "password": "pw", "teams": ["qa"]},
    {"username": "bob", "password": "pw", "teams": ["qa"]}]}))
env = {**os.environ, "MDNOTES_CHAT_API_KEY": "test-key", "MDNOTES_CHAT_API_URL": f"http://127.0.0.1:{MODEL_PORT}/chat/completions",
       "MDNOTES_CHAT_MODEL": "fake-model", "MDNOTES_CHAT_ALLOW_REMOTE": "1", "OPENAI_API_KEY": ""}
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(Path(TMP.name) / "whitelist.json"),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"; WS = "Chats"


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    if isinstance(body, dict): body = {**body, "version": 117}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


checks = []
def ok(name): checks.append(name); print("  ok ", name)
SHOTS = os.environ.get("STILO_SHOTS")  # a folder: save screenshots there for a visual check
async def shot(page, name):
    if SHOTS: await page.screenshot(path=str(Path(SHOTS) / f"chats-{name}.png"))


async def browser_for(b, user, viewport={"width": 1280, "height": 860}, own=None, **extra):
    settings = {**(own or {}), "serverUrl": "", "accountUsername": user, "accountPassword": "pw", "accountSuccess": {BASE: user},
                "lastWorkspace": {"team": "qa", "path": WS}, "syncedProjectId": f"qa/{WS}", "chatPanel": "shown", "chatTab": "chats"}
    ctx = await b.new_context(viewport=viewport, service_workers="block", **extra)
    await ctx.add_init_script("localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(settings)) + ");")
    await ctx.route("**/Template/**", lambda r: r.abort())
    page = await ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(f"{user}: {e}"))
    await page.goto(BASE + "/", wait_until="networkidle")
    await page.wait_for_selector('.tree-row[title="Cast"]', timeout=30000)
    if extra.get("is_mobile"):
        await page.locator("#mobile-chat-toggle").click()
    await page.wait_for_selector("#chat-cast-bar .cv-search", timeout=30000)
    return ctx, page, errors


async def send(page, text):
    await page.locator("#chat-input").fill(text)
    await page.locator("#chat-send-button").click()


async def main():
    anna = api("POST", "/api/auth/login", {"username": "anna", "password": "pw"})["token"]
    api("POST", "/api/workspaces/create", {"team": "qa", "name": WS, "shareTeam": True}, token=anna)
    session = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS}, token=anna)["token"]
    for operation in ({"type": "create-folder", "parentPath": "", "name": "Cast"},
                      {"type": "create-file", "parentPath": "Cast", "name": "aria.persona.skill",
                       "content": "---\nname: Captain Aria Voss\ncolor: #b5523b\n---\nA smuggler captain."}):
        api("POST", "/api/operations", {"operation": {**operation, "baseRevision": api("GET", "/api/session/state", token=session)["revision"]}}, token=session)
    api("POST", "/api/session/leave", {}, token=session)

    async with async_playwright() as pw:
        launch = {"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}
        b = await pw.chromium.launch(**launch)
        ctx_a, a, errors_a = await browser_for(b, "anna")
        ctx_b, bb, errors_b = await browser_for(b, "bob")

        # The list: people with access (online) and the project's character.
        await a.wait_for_selector('[data-chats-start="user:bob"]')
        assert "Captain Aria Voss" in await a.locator('[data-chats-start="char:Cast/aria.persona.skill"]').inner_text()
        await a.wait_for_function('document.querySelector(\'[data-chats-start="user:bob"] .cv-person\')?.classList.contains("is-online")', timeout=15000)
        ok("contacts: people with access (online) and characters")
        await shot(a, "list")

        # A → B privately; B sees it live with an unread badge.
        await a.click('[data-chats-start="user:bob"]')
        await a.wait_for_selector("#chat-input:visible")
        await send(a, "hello from anna about the lighthouse")
        await bb.wait_for_function('document.querySelector(\'[data-chat-tab="chats"]\').dataset.unread === "1"', timeout=15000)
        assert await bb.locator('[data-chats-open][data-unread] .cv-badge').inner_text() == "1"
        ok("B gets the message live with an unread badge")
        await bb.click("[data-chats-open]")
        await bb.wait_for_selector('.cv-message:has-text("hello from anna")')
        await bb.wait_for_function('!document.querySelector(\'[data-chat-tab="chats"]\').dataset.unread', timeout=15000)
        ok("opening the chat clears the badge")
        await send(bb, "hi anna")
        await a.wait_for_selector('.cv-message:has-text("hi anna")', timeout=15000)
        ok("A sees B's answer live")
        await shot(bb, "pair")

        # B's alias for anna is private.
        await bb.click("[data-chats-details]")
        await bb.fill("[data-chats-alias]", "Captain Anna")
        await bb.locator("[data-chats-alias]").press("Tab")
        await bb.wait_for_function('document.querySelector(".cv-head-title")?.textContent === "Captain Anna"', timeout=10000)
        assert await a.locator(".cv-head-title").inner_text() == "bob"
        ok("an alias shows only for the person who set it")

        # A searches the chat and jumps to the message.
        await a.click("[data-chats-details]")
        await a.fill("[data-chats-search]", "lighthouse")
        await a.wait_for_selector("[data-chats-jump]", timeout=10000)
        assert "lighthouse" in (await a.locator("[data-chats-jump]").first.inner_text()).lower()
        await a.click("[data-chats-jump]")
        await a.wait_for_selector(".cv-message.is-found", timeout=10000)
        await a.click("[data-chats-details]")
        await shot(a, "details")
        await a.click("[data-chats-details]")
        ok("search in the chat finds and jumps to a message")

        # Inviting the character into the pair starts a new group; the pair stays.
        await a.click("[data-chats-details]")
        await a.click("[data-chats-invite]")
        await a.check('[data-chats-pick="char:Cast/aria.persona.skill"]')
        await a.click("[data-chats-confirm]")
        await a.wait_for_function('document.querySelector(".cv-head-sub")?.textContent === "3 members"', timeout=10000)
        await a.click("[data-chats-back]")
        rows = await a.locator("[data-chats-open] .cv-row-title").all_inner_texts()
        assert len(rows) == 2 and "bob" in rows and any("Captain Aria Voss" in r for r in rows), rows
        ok("inviting into the private chat started a new group; the private chat is kept")

        # In the group, @aria replies; both see it being written, then the reply.
        group = a.locator("[data-chats-open]", has_text="Captain Aria Voss").first
        await group.click()
        await bb.click("[data-chats-back]")  # details → conversation
        await bb.click("[data-chats-back]")  # conversation → list
        await bb.locator("[data-chats-open]", has_text="Captain Aria Voss").first.click(timeout=15000)
        await send(a, "@aria the lamp is out")
        await a.wait_for_selector(".rp-message.is-streaming", timeout=15000)
        await bb.wait_for_selector(".rp-message.is-streaming", timeout=15000)
        ok("both members watch the character's reply being written")
        await shot(bb, "typing")
        await a.wait_for_selector('.cv-message.rp-message:has-text("Captain Aria Voss here.")', timeout=30000)
        await bb.wait_for_selector('.cv-message.rp-message:has-text("Aye, @aria the lamp is out")', timeout=30000)
        await send(bb, "the storm grows")  # no mention: narration, nobody replies
        await a.wait_for_selector('.cv-message:has-text("the storm grows")', timeout=15000)
        await a.wait_for_timeout(1500)
        assert await a.locator(".rp-message.is-streaming").count() == 0
        ok("a mention gets a reply in the group; a message without one does not")

        # A private chat with the character answers every message.
        await a.click("[data-chats-back]")
        await a.click('[data-chats-start="char:Cast/aria.persona.skill"]')
        await send(a, "Ahoy")
        await a.wait_for_selector('.cv-message.rp-message:has-text("Aye, Ahoy")', timeout=30000)
        assert await bb.locator('[data-chats-open]:has-text("Ahoy")').count() == 0
        ok("a private chat with a character answers every message, privately")

        # A browser that runs replies itself (a local model): the server only
        # relays them. The fake model sees the call come from the page.
        own = {"agentSource": "own", "agentRunner": "browser", "agentApiKey": "",
               "agentApiUrl": f"http://127.0.0.1:{MODEL_PORT}/chat/completions", "agentModel": "local-model"}
        ctx_l, local, errors_l = await browser_for(b, "anna", own=own)
        # The group (Aria + bob), not anna's private chat with Aria.
        await local.locator("[data-chats-open]").filter(has_text="Captain Aria Voss").filter(has_text="bob").click()
        await bb.click("[data-chats-back]")
        await bb.locator("[data-chats-open]", has_text="Captain Aria Voss").first.click()
        before = len(CALLS)
        await send(local, "@aria from my machine")
        await bb.wait_for_selector(".rp-message.is-streaming", timeout=15000)
        await bb.wait_for_selector('.cv-message.rp-message:has-text("Aye, @aria from my machine")', timeout=30000)
        assert CALLS[before:] == [(True, "Captain Aria Voss")], CALLS[before:]
        ok("a reply written by a member's own browser (local model) reaches everyone live")
        errors_a += errors_l
        await ctx_l.close()

        # Phone width: nothing sideways.
        ctx_p, phone, errors_p = await browser_for(b, "bob", {"width": 375, "height": 760}, is_mobile=True, has_touch=True)
        widths = await phone.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        assert widths[0] <= widths[1], widths
        await phone.locator("[data-chats-open]").first.click()
        await phone.wait_for_timeout(800)
        await shot(phone, "phone")
        ok("phone width fits")

        assert not (errors_a + errors_b + errors_p), errors_a + errors_b + errors_p
        await b.close()
    print(json.dumps({"checks": checks, "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate(); SERVER.wait(10); model_server.shutdown(); TMP.cleanup()
