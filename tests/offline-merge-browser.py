"""Browser regression, with a real backend: what a tab does while it can't
reach a cloud workspace is merged in when it is back, file by file (O4 of
the stability review).

Anna's tab loses the server; meanwhile she edits notes.md and makes a file,
and Bob (on the server) edits another line of notes.md and plan.md. Back:
her edit and his are both in notes.md, her new file is made, his plan.md
stands, nothing goes to Snapshots. Again, but both change the same line:
his stands, hers is kept in Snapshots, and she is told. And with a reload
while the server can't be reached: the page opens the workspace as this
browser kept it, her edits made before and after the reload are merged when
it is back. No page errors.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


PORT = free_port()
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": [
    {"username": "anna", "password": "pw", "teams": ["qa"]}, {"username": "bob", "password": "pw", "teams": ["qa"]}]}))
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(Path(TMP.name) / "whitelist.json"),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env={**os.environ, "MDNOTES_CHAT_API_KEY": "", "OPENAI_API_KEY": ""},
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"; WS = "Away"
NOTES = "One.\n\nTwo.\n\nThree.\n"


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    if isinstance(body, dict): body = {**body, "version": 117}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


def server_files(token):
    project = api("GET", "/api/session/state", token=token)["project"]
    out = {}
    def walk(node_id, prefix):
        for child in project["nodes"][node_id].get("children", []):
            node = project["nodes"][child]; path = f"{prefix}/{node['name']}" if prefix else node["name"]
            if node["kind"] == "file": out[path] = node.get("content", "")
            else: walk(child, path)
    walk(project["rootId"], "")
    return out


def bob_writes(token, path, find, replace):
    """Bob, on the server, changes one passage of a file (a whole-file write from the revision he read)."""
    state = api("GET", "/api/session/state", token=token)
    text = server_files(token)[path]
    api("POST", "/api/operations", {"operation": {"type": "update-file", "path": path, "content": text.replace(find, replace),
                                                  "baseRevision": state["revision"]}}, token=token)


HOOK = app_hook("window.__a = { controller, workspace, sync: modules.sync, collaboration, shell };")


async def main():
    anna = api("POST", "/api/auth/login", {"username": "anna", "password": "pw"})["token"]
    bob = api("POST", "/api/auth/login", {"username": "bob", "password": "pw"})["token"]
    api("POST", "/api/workspaces/create", {"team": "qa", "name": WS, "shareTeam": True}, token=anna)
    session = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS}, token=anna)["token"]
    for name, content in (("notes.md", NOTES), ("plan.md", "Plan.\n")):
        api("POST", "/api/operations", {"operation": {"type": "create-file", "parentPath": "", "name": name, "content": content,
                                                      "baseRevision": api("GET", "/api/session/state", token=session)["revision"]}}, token=session)
    api("POST", "/api/session/leave", {}, token=session)
    bobs = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS, "device": "bob-api"}, token=bob)["token"]

    async with async_playwright() as pw:
        b = await pw.chromium.launch(**({"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}))
        settings = {"serverUrl": "", "accountUsername": "anna", "accountPassword": "pw", "accountSuccess": {BASE: "anna"},
                    "lastWorkspace": {"team": "qa", "path": WS}, "syncedProjectId": f"qa/{WS}", "chatPanel": "hidden"}
        ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
        await ctx.add_init_script("if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');"
                                  " localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(settings)) + "); }")
        down = {"on": False}

        async def route(rt):
            path = urlparse(rt.request.url).path
            if down["on"] and path.startswith("/api/"):
                await rt.abort("connectionrefused"); return
            if path == "/app/main.js":
                response = await rt.fetch()
                await rt.fulfill(response=response, body=await response.body() + HOOK); return
            if path.startswith("/Template/"):
                await rt.abort(); return
            await rt.continue_()
        await ctx.route("**/*", route)
        page = await ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        # Every toast the page shows, as it shows it.
        await ctx.add_init_script('''window.__toasts = []; new MutationObserver((records) => { for (const record of records) for (const node of record.addedNodes)
            if (node.nodeType === 1 && node.matches?.(".app-toast")) window.__toasts.push(node.textContent); }).observe(document, { childList: true, subtree: true });''')
        toasts = lambda: page.evaluate("window.__toasts")

        async def opened():
            await page.wait_for_function("Boolean(window.__a)", timeout=30000)
            await page.wait_for_function('window.__a.sync.status.status === "connected" && window.__a.sync.mode.get().workspaceMode === "synced"', timeout=30000)
            await page.wait_for_selector('.tree-row[title="notes.md"]', timeout=30000)

        text = lambda path: page.evaluate('(path) => Object.values(window.__a.controller.getProject().nodes).find((n) => n.name === path)?.content ?? null', path)
        write = lambda path, find, replace: page.evaluate('([path, find, replace]) => window.__a.workspace.write(path, Object.values(window.__a.controller.getProject().nodes).find((n) => n.name === path).content.replace(find, replace))', [path, find, replace])

        async def away():
            await ctx.set_offline(True)
            await page.wait_for_function('window.__a.sync.status.status !== "connected"', timeout=30000)

        async def back():
            await ctx.set_offline(False)
            down["on"] = False
            await page.evaluate('() => { void window.__a.collaboration.resumeConnection(); }')
            await page.wait_for_function('window.__a.sync.status.status === "connected"', timeout=45000)
            await page.wait_for_timeout(800)

        await page.goto(BASE + "/", wait_until="networkidle")
        await opened()

        # 1. Away: her edit and new file; his edit (another line) and plan.md. Back: all of it.
        await away()
        await write("notes.md", "One.", "One, Anna.")
        await page.evaluate('''() => { const c = window.__a.controller, root = c.getProject().rootId;
            c.createFile(root, "away.md", "Made away."); void window.__a.sync.publish({ type: "create-file", parentPath: "", name: "away.md", content: "Made away." }); }''')
        bob_writes(bobs, "notes.md", "Three.", "Three, Bob.")
        bob_writes(bobs, "plan.md", "Plan.", "Plan, Bob.")
        await back()
        want = {"notes.md": "One, Anna.\n\nTwo.\n\nThree, Bob.\n", "plan.md": "Plan, Bob.\n", "away.md": "Made away."}
        for _ in range(50):
            if server_files(bobs) == want: break
            await asyncio.sleep(0.2)
        assert server_files(bobs) == want, server_files(bobs)
        assert [await text(path) for path in want] == list(want.values())
        assert not [t for t in await toasts() if "Snapshots" in t], await toasts()

        # 2. Both change the same line: his stands; hers is kept in Snapshots, and said.
        await away()
        await write("notes.md", "Two.", "Two, Anna.")
        bob_writes(bobs, "notes.md", "Two.", "Two, Bob.")
        await back()
        await page.wait_for_function('() => Object.values(window.__a.controller.getProject().nodes).find((n) => n.name === "notes.md").content.includes("Two, Bob.")', timeout=15000)
        assert server_files(bobs)["notes.md"] == "One, Anna.\n\nTwo, Bob.\n\nThree, Bob.\n"
        await page.wait_for_function('window.__toasts.some((text) => text.includes("Snapshots"))', timeout=10000)

        # 3. A reload while the server can't be reached: edits before and after it are merged when it is back.
        await away()
        await write("notes.md", "One, Anna.", "One, Anna again.")
        await ctx.set_offline(False)
        down["on"] = True
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_function("Boolean(window.__a)", timeout=30000)
        await page.wait_for_function('window.__a.sync.mode.get().workspaceMode === "synced"', timeout=15000)
        assert (await text("notes.md")).startswith("One, Anna again."), await text("notes.md")
        await write("notes.md", "Two, Bob.", "Two, Bob. And Anna, after the reload.")
        bob_writes(bobs, "notes.md", "Three, Bob.", "Three, Bob again.")
        down["on"] = False
        await page.evaluate('() => window.dispatchEvent(new Event("online"))')
        want = "One, Anna again.\n\nTwo, Bob. And Anna, after the reload.\n\nThree, Bob again.\n"
        for _ in range(150):
            if server_files(bobs)["notes.md"] == want: break
            await asyncio.sleep(0.2)
        assert server_files(bobs)["notes.md"] == want, server_files(bobs)["notes.md"]
        await page.wait_for_function('(want) => Object.values(window.__a.controller.getProject().nodes).find((n) => n.name === "notes.md").content === want', arg=want, timeout=15000)

        assert not errors, errors
        await b.close()
    print(json.dumps({"checks": ["away: her edit and his (other lines) both land; her new file is made; his other file stands; nothing to Snapshots",
                                 "away: the same line changed by both: his stands, hers kept in Snapshots and said",
                                 "a reload while the server can't be reached: edits before and after it merged when it is back"], "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
