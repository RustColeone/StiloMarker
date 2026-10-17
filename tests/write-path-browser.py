"""Browser regression for the one write path (Workspace module): a real
backend, two signed-in browsers in one cloud workspace, the agent's reply
mocked in Anna's browser.

Checks: Bob types while Anna's agent edits the same file elsewhere, and both
changes end up everywhere (browsers and the file on disk); Drop undoes only
the agent's line and keeps Bob's; an agent edit to a line Bob changed is
refused (stale) instead of overwriting him; a Snapshots restore goes out as a
patch; no browser sends a whole-file update-file for a text file.
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
BASE = f"http://127.0.0.1:{PORT}"; WS = "Write"
DISK = Path(TMP.name) / "data" / "team_qa" / WS / "notes.md"
ORIGINAL = "one\ntwo\nthree\nfour\nfive\n"


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    if isinstance(body, dict): body = {**body, "version": 117}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


checks = []
def ok(name): checks.append(name); print("  ok ", name)

HOOK = b"\nwindow.__w = { controller, workspace, collaboration, get project() { return controller.getProject(); } };\n"
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


def text_of(page):
    return page.evaluate('window.__w.controller.getActiveFile()?.content')


async def converge(pages, want, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        got = [await text_of(p) for p in pages]
        if all(g == want for g in got) and DISK.exists() and DISK.read_text(encoding="utf-8") == want:
            return
        await asyncio.sleep(0.2)
    files = sorted(str(p.relative_to(TMP.name)) for p in Path(TMP.name).rglob("*") if p.is_file())
    raise AssertionError(f"files {files}; did not converge on {want!r}: browsers {got!r}, disk {DISK.read_text(encoding='utf-8') if DISK.exists() else None!r}")


async def agent_edit(page, base, content, batch, edits=None):
    """Anna asks her agent; it proposes `content` for notes.md, computed from `base`
    (with `edits`, as edit_file proposes it: the full text plus each change)."""
    op = {"proposalId": f"{batch}-op", "type": "update-file", "path": "notes.md", "content": content, "preImage": base}
    if edits: op["edits"] = edits
    AGENT["next"] = {"message": "Edited.", "batchId": batch, "contextPaths": [], "proposedOperations": [op]}
    await page.locator("#chat-input").fill("Edit notes")
    await page.locator("#chat-input").press("Enter")
    await page.wait_for_function(f'window.__chatInternals?.chatState.threads.some((t) => t.messages.some((m) => m.batchId === "{batch}" && m.proposalState))', timeout=15000)


async def main():
    anna = api("POST", "/api/auth/login", {"username": "anna", "password": "pw"})["token"]
    api("POST", "/api/workspaces/create", {"team": "qa", "name": WS, "shareTeam": True}, token=anna)
    session = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS}, token=anna)["token"]
    for name, content in (("notes.md", ORIGINAL), ("refs.urldb", "[Castle]\nurl = https://img.example/castle.png\n\n[River]\nurl = https://img.example/river.png"),
                          ("more.urldb", "[Forest]\nurl = https://img.example/forest.png")):
        api("POST", "/api/operations", {"operation": {"type": "create-file", "parentPath": "", "name": name, "content": content,
                                                      "baseRevision": api("GET", "/api/session/state", token=session)["revision"]}}, token=session)
    api("POST", "/api/session/leave", {}, token=session)

    async with async_playwright() as pw:
        launch = {"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}
        b = await pw.chromium.launch(**launch)
        ctx_a, a, errors_a, sent_a = await browser_for(b, "anna")
        ctx_b, bb, errors_b, sent_b = await browser_for(b, "bob")
        await a.wait_for_function(WAIT_LOADED)
        await a.wait_for_function('window.__chatInternals.chatState.status === "ready"', timeout=15000)

        # Bob types on the last line; Anna's agent, which read the file before
        # that, edits the second line. Both edits end up everywhere.
        await bb.evaluate('window.__w.workspace.write("notes.md", window.__w.controller.getActiveFile().content.replace("five", "five (bob)"))')
        await converge([a, bb], ORIGINAL.replace("five", "five (bob)"))
        agent_text = ORIGINAL.replace("two", "TWO (agent)")
        await agent_edit(a, ORIGINAL, agent_text, "b1")
        merged = "one\nTWO (agent)\nthree\nfour\nfive (bob)\n"
        await converge([a, bb], merged)
        ok("an agent edit made before Bob typed merges with his typing, in both browsers and on disk")

        # Drop undoes only the agent's line. Both Drop buttons (the chat card's
        # and the editor bar's) belong to the asker; the editor bar's is used.
        disabled = await a.evaluate('[...document.querySelectorAll(\'[data-batch-drop-final="b1"]\')].map((b) => b.disabled)')
        assert disabled and not any(disabled), disabled
        await a.click('.agent-bar-drop[data-batch-drop-final="b1"]')
        await converge([a, bb], ORIGINAL.replace("five", "five (bob)"))
        ok("Drop undoes only the agent's change and keeps Bob's")

        # Bob changes line three; the agent's edit of that same line is refused.
        await bb.evaluate('window.__w.workspace.write("notes.md", window.__w.controller.getActiveFile().content.replace("three", "three (bob)"))')
        bobs = "one\ntwo\nthree (bob)\nfour\nfive (bob)\n"
        await converge([a, bb], bobs)
        await agent_edit(a, ORIGINAL.replace("five", "five (bob)"), ORIGINAL.replace("five", "five (bob)").replace("three", "THREE (agent)"), "b2")
        await a.wait_for_timeout(800)
        assert await text_of(a) == bobs and await text_of(bb) == bobs
        state = await a.evaluate('window.__chatInternals.chatState.threads.flatMap((t) => t.messages).find((m) => m.batchId === "b2").proposedOperations[0].proposalState')
        assert state == "stale", state
        ok("an agent edit to a line Bob changed is refused instead of overwriting him")

        # edit_file: the card shows the edit, and it merges like any other.
        await bb.evaluate('window.__w.workspace.write("notes.md", window.__w.controller.getActiveFile().content.replace("one", "one (bob)"))')
        await converge([a, bb], bobs.replace("one", "one (bob)"))
        await agent_edit(a, bobs, bobs.replace("four", "FOUR (edited)"), "b3", edits=[{"find": "four", "replace": "FOUR (edited)"}])
        await converge([a, bb], bobs.replace("one", "one (bob)").replace("four", "FOUR (edited)"))
        summary = await a.locator('.proposal-op-diff summary').last.inner_text()
        found = await a.locator('.proposal-edit del').last.text_content() if await a.locator('.proposal-edit del').count() else None
        replaced = await a.locator('.proposal-edit ins').last.text_content() if await a.locator('.proposal-edit ins').count() else None
        assert (summary, found, replaced) == ("1 edit", "four", "FOUR (edited)"), (summary, found, replaced)
        ok("an edit_file proposal shows each edit in its card and merges with Bob's typing")

        # A part dragged between two files (an album entry) is a write like any
        # other: it reaches the server and the other browser. It used to change
        # only the dragging browser's copy.
        for name in ("refs.urldb", "more.urldb"):
            await bb.locator(f'.tree-row[title="{name}"] .icon-button').click()
        await bb.locator('.tree-row-derived:has(.tree-label:text-is("River"))').drag_to(bb.locator('.tree-row-derived:has(.tree-label:text-is("Forest"))'))
        data = Path(TMP.name) / "data" / "team_qa" / WS
        moved = lambda: "[River]" in (data / "more.urldb").read_text(encoding="utf-8") and "[River]" not in (data / "refs.urldb").read_text(encoding="utf-8")
        end = time.time() + 15
        while time.time() < end and not moved():
            await asyncio.sleep(0.2)
        assert moved(), [op["path"] for op in sent_b]
        await a.wait_for_function('Object.values(window.__w.project.nodes).find((n) => n.name === "more.urldb")?.content.includes("[River]")', timeout=15000)
        ok("a part dragged between files reaches the server and the other browser")
        await bb.click('.tree-row[title="notes.md"]')
        await bb.wait_for_function('window.__w.controller.getActiveFile()?.name === "notes.md"')

        # A Snapshots-style restore (a whole text) goes out as a patch too.
        await a.evaluate(f'window.__w.workspace.write("notes.md", {json.dumps(ORIGINAL)}, {{ source: "snapshot restore" }})')
        await converge([a, bb], ORIGINAL)
        types = sorted({op["type"] for op in sent_a + sent_b})
        assert types == ["patch-file"], types
        ok("every text change left the browsers as a patch-file, never a whole-file update-file")

        assert not errors_a and not errors_b, errors_a + errors_b
        await ctx_a.close(); await ctx_b.close(); await b.close()
    print(json.dumps({"checks": checks, "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
    SERVER.wait(timeout=10)
