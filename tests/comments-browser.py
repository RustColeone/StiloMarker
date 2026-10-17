"""Browser regression for line comments (Comments module): a real backend,
two signed-in browsers in one cloud workspace.

Checks: Anna comments on a line from the gutter and Bob sees it at once (the
comments event on Sync's stream); when a line is added above it, the comment
follows its line in both browsers and on the server; deleting it removes it
for Bob too.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
from helpers.chat_hook import inject_chat_internals, WAIT_LOADED

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


PORT = free_port()
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": [
    {"username": "anna", "password": "pw", "teams": ["qa"]},
    {"username": "bob", "password": "pw", "teams": ["qa"]}]}))
env = {**os.environ, "MDNOTES_CHAT_API_KEY": "test-key", "MDNOTES_CHAT_API_URL": "http://127.0.0.1:9/unused",
       "MDNOTES_CHAT_ALLOW_REMOTE": "1", "OPENAI_API_KEY": ""}
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(Path(TMP.name) / "whitelist.json"),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"; WS = "Notes"
ORIGINAL = "one\ntwo\nthree\nfour\nfive\n"


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    if isinstance(body, dict): body = {**body, "version": 117}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


checks = []
def ok(name): checks.append(name); print("  ok ", name)

HOOK = b"\nwindow.__w = { controller, workspace, collaboration, lineComments, get project() { return controller.getProject(); } };\n"
AGENT = {"next": None}  # the reply Anna's agent gives next


async def browser_for(b, user):
    settings = {"serverUrl": "", "accountUsername": user, "accountPassword": "pw", "accountSuccess": {BASE: user},
                "lastWorkspace": {"team": "qa", "path": WS}, "syncedProjectId": f"qa/{WS}", "chatPanel": "shown", "chatTab": "agent"}
    ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
    await ctx.add_init_script("localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(settings)) + ");")
    sent = []

    async def route(rt):
        path = urlparse(rt.request.url).path
        if path == "/api/chat" and rt.request.method == "POST":
            reply = AGENT["next"]
            await rt.fulfill(status=200, content_type="application/json", body=json.dumps(reply)); return
        if path == "/api/operations" and rt.request.method == "POST":
            sent.append(json.loads(rt.request.post_data)["operation"])
        if path in ("/app/main.js", "/app/features/chat-panel.js"):
            response = await rt.fetch()
            body = inject_chat_internals(path, await response.body()) + (HOOK if path == "/app/main.js" else b"")
            await rt.fulfill(response=response, body=body); return
        if path.startswith("/Template/"):
            await rt.abort(); return
        await rt.continue_()
    await ctx.route("**/*", route)
    page = await ctx.new_page(); errors = []
    page.on("pageerror", lambda e: errors.append(f"{user}: {e}"))
    await page.goto(BASE + "/", wait_until="networkidle")
    await page.wait_for_function("Boolean(window.__w)")
    await page.wait_for_selector('.tree-row[title="notes.md"]', timeout=30000)
    await page.click('.tree-row[title="notes.md"]')
    await page.wait_for_function('window.__w.controller.getActiveFile()?.name === "notes.md"')
    return ctx, page, errors, sent


COMMENTS_FILE = Path(TMP.name) / "data" / "team_qa" / WS / "comments.json"


def server_comments():
    return json.loads(COMMENTS_FILE.read_text(encoding="utf-8"))["files"].get("notes.md", []) if COMMENTS_FILE.exists() else []


def marked(page):
    return page.evaluate('[...document.querySelectorAll(".editor-gutter-line.has-comment")].map((row) => Number(row.dataset.line))')


async def main():
    anna = api("POST", "/api/auth/login", {"username": "anna", "password": "pw"})["token"]
    api("POST", "/api/workspaces/create", {"team": "qa", "name": WS, "shareTeam": True}, token=anna)
    session = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS}, token=anna)["token"]
    api("POST", "/api/operations", {"operation": {"type": "create-file", "parentPath": "", "name": "notes.md", "content": ORIGINAL,
                                                  "baseRevision": api("GET", "/api/session/state", token=session)["revision"]}}, token=session)
    api("POST", "/api/session/leave", {}, token=session)

    async with async_playwright() as pw:
        launch = {"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}
        b = await pw.chromium.launch(**launch)
        ctx_a, a, errors_a, _ = await browser_for(b, "anna")
        ctx_b, bb, errors_b, _ = await browser_for(b, "bob")

        await a.click('.editor-gutter-line[data-line="2"]')
        await a.wait_for_selector("#line-comment-popover:not([hidden])")
        await a.fill("#line-comment-input", "Is three right?")
        await a.click("#line-comment-save")
        await a.wait_for_selector("#line-comment-popover", state="hidden")
        await bb.wait_for_function('document.querySelector(\'.editor-gutter-line[data-line="2"]\')?.classList.contains("has-comment")', timeout=15000)
        saved = server_comments()
        assert [(c["line"], c["anchorText"], c["text"], c["author"]) for c in saved] == [(2, "three", "Is three right?", "anna")], saved
        assert await marked(a) == [2] and await marked(bb) == [2]
        ok("a comment made from the gutter reaches the other browser at once, and the server keeps it")

        await a.evaluate('window.__w.workspace.write("notes.md", "zero\\n" + window.__w.controller.getActiveFile().content)')
        for _ in range(60):
            if [c["line"] for c in server_comments()] == [3]:
                break
            await a.wait_for_timeout(250)
        assert [c["line"] for c in server_comments()] == [3], server_comments()
        await bb.wait_for_function('document.querySelector(\'.editor-gutter-line[data-line="3"]\')?.classList.contains("has-comment")', timeout=15000)
        assert await marked(a) == [3] and await marked(bb) == [3]
        ok("a line added above moves the comment with its line, in both browsers and on the server")

        await a.click('.editor-gutter-line[data-line="3"]')
        await a.wait_for_selector("#line-comment-delete:not([hidden])")
        await a.click("#line-comment-delete")
        await bb.wait_for_function('!document.querySelector(".editor-gutter-line.has-comment")', timeout=15000)
        assert server_comments() == []
        ok("deleting the comment removes it for everyone")

        assert not errors_a and not errors_b, errors_a + errors_b
        await ctx_a.close(); await ctx_b.close(); await b.close()
    print(json.dumps({"checks": checks, "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
    SERVER.wait(timeout=10)
