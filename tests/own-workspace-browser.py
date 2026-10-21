"""Browser regression, with a real backend: this browser's own workspace is
never lost to a shared one (each workspace has its own copy here).

An in-browser workspace (one file, "MY-LOCAL-NOTES"); a PIN session joined as
a guest, whose host's workspace replaces it on screen: the own copy stays as
it was, the shared one is kept beside it, and typing in the shared workspace
reaches the server and only the shared copy. Switching to the own workspace
(the session stays joined) brings it back, and the host's later changes stay
off it (and off its copy) until switching back, which shows them. Reloaded
on the shared workspace, the page opens it (it rejoins), and switching still
brings the
own workspace back (nothing was kept aside in memory: the pointer names
it); reloaded again, the page opens the own workspace, rejoins the session
(still joined) and switching shows the own workspace once more. No page
errors.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright
sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook
from helpers.browser_copy import POINTER, STORED_COPIES

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0)); return probe.getsockname()[1]


PORT = free_port()
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": []}))
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--pin", "2468", "--master-pin", "1367", "--data-dir", str(Path(TMP.name) / "data"),
                           "--whitelist", str(Path(TMP.name) / "whitelist.json"), "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, env={**os.environ, "MDNOTES_CHAT_API_KEY": "", "OPENAI_API_KEY": ""},
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"
SHARED = f"shared:{BASE}/"  # the guest session's copy: named for this server and the session


def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (f"?token={token}" if token else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())


def workspace(pid, file_id, name, content):
    return {"id": pid, "name": pid, "sourceMode": "memory", "rootId": "root", "activeFileId": file_id, "nodes": {
        "root": {"id": "root", "kind": "folder", "name": pid, "children": [file_id], "expanded": True},
        file_id: {"id": file_id, "kind": "file", "parentId": "root", "name": name, "content": content, "dirty": False}}}


MINE = workspace("my-local", "a", "mine.md", "# MY-LOCAL-NOTES")
SHOWN = '() => Object.values(window.__own.controller.getProject().nodes).filter((n) => n.kind === "file").map((n) => n.name + ": " + n.content).sort()'
MODE = 'window.__own.syncMode.get().workspaceMode'


async def main():
    # The host's workspace, published by the session's master.
    host = api("POST", "/api/session/connect", {"pin": "1367", "displayName": "Host"})
    state = api("GET", "/api/session/state", token=host["token"])
    api("POST", "/api/session/state", {"project": workspace("host-ws", "h", "host.md", "# HOST-NOTES"), "baseRevision": state["revision"], "version": 999},
        token=host["token"])
    async with async_playwright() as pw:
        b = await pw.chromium.launch(**({"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}))
        ctx = await b.new_context(viewport={"width": 1280, "height": 860}, service_workers="block")
        # This browser's own workspace, kept by an older version (moved over on the first start).
        await ctx.add_init_script('if (!localStorage.getItem("mdnotes.cleared-at.v1") && !sessionStorage.getItem("seeded")) {'
                                  ' sessionStorage.setItem("seeded", "1"); localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(MINE)) + '); }')

        async def route(rt):
            if urlparse(rt.request.url).path == "/app/main.js":
                response = await rt.fetch()
                await rt.fulfill(response=response, body=await response.body() + app_hook("window.__own = { shell, controller, syncMode };")); return
            await rt.continue_()
        await ctx.route("**/*", route)
        page = await ctx.new_page(); errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("dialog", lambda d: asyncio.ensure_future(d.accept()))

        async def load():
            await page.wait_for_function("Boolean(window.__own)", timeout=30000)
            await page.wait_for_timeout(500)

        async def join():
            await page.evaluate('window.__own.shell.settingsDialog.open("collaboration")')
            await page.fill("#server-url-input", BASE)
            await page.fill("#server-pin-input", "2468")
            await page.fill("#display-name-input", "Guest")
            await page.click("#connect-server-button")
            await page.wait_for_selector("#accept-connection-dialog[open]", timeout=5000)
            await page.click("#accept-connection-dialog button[value=accept]")
            await page.wait_for_function(f'{MODE} === "synced" && JSON.stringify(({SHOWN})()).includes("HOST-NOTES")', timeout=20000)
            await page.keyboard.press("Escape")

        async def leave():
            await page.evaluate('document.querySelector("#workspace-mode-toggle").click()')
            await page.wait_for_function(f'{MODE} === "private" && JSON.stringify(({SHOWN})()).includes("MY-LOCAL-NOTES")', timeout=10000)

        async def settled_copies(expected_open):
            for _ in range(100):
                await page.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))')
                await page.wait_for_timeout(100)
                if str((await page.evaluate(POINTER)).get("open")).startswith(expected_open):
                    break
            return await page.evaluate(STORED_COPIES), await page.evaluate(POINTER)

        await page.goto(BASE + "/", wait_until="networkidle")
        await load()
        assert await page.evaluate(SHOWN) == ["mine.md: # MY-LOCAL-NOTES"]

        # Joined as a guest: the host's workspace on screen; this browser's own copy untouched beside the shared one.
        await join()
        await page.click("#editor-content")
        await page.keyboard.press("Control+End")
        await page.keyboard.type(" GUEST-EDIT")
        await page.wait_for_function('!Object.values(window.__own.controller.getProject().nodes).some((n) => n.dirty)', timeout=15000)
        copies, pointer = await settled_copies(SHARED)
        shared = pointer["open"]
        assert shared.startswith(SHARED) and pointer["own"] == "local:my-local", pointer
        assert copies == {"local:my-local": ["mine.md"], shared: ["host.md"]}, copies
        server = api("GET", "/api/session/state", token=host["token"])
        assert "GUEST-EDIT" in json.dumps(server["project"]), "the guest's typing reached the server"
        stored_mine = await page.evaluate('''async () => { const q = indexedDB.open("mdnotes-workspaces"); const db = await new Promise((r) => { q.onsuccess = () => r(q.result); });
            const nodes = await new Promise((r) => { const g = db.transaction("nodes").objectStore("nodes").getAll(IDBKeyRange.bound(["local:my-local"], ["local:my-local", []])); g.onsuccess = () => r(g.result); });
            db.close(); return nodes.filter((n) => n.kind === "file").map((n) => n.content); }''')
        assert stored_mine == ["# MY-LOCAL-NOTES"], f"the own copy is untouched: {stored_mine}"

        # Switching to the own workspace (nothing reloaded): it is back; the host's
        # later change stays off it and its copy, until switching back shows it.
        await leave()
        assert await page.evaluate(SHOWN) == ["mine.md: # MY-LOCAL-NOTES"]
        state = api("GET", "/api/session/state", token=host["token"])
        content = next(n for n in state["project"]["nodes"].values() if n.get("name") == "host.md")["content"]
        api("POST", "/api/operations", {"operation": {"type": "patch-file", "path": "host.md", "start": len(content), "end": len(content),
                                                      "text": " HOST-LATER", "baseRevision": state["revision"]}, "version": 999}, token=host["token"])
        await page.wait_for_timeout(1500)
        assert await page.evaluate(SHOWN) == ["mine.md: # MY-LOCAL-NOTES"], await page.evaluate(SHOWN)
        assert await page.evaluate(MODE) == "private"
        copies, _ = await settled_copies("local:my-local")
        assert copies["local:my-local"] == ["mine.md"], copies
        await page.evaluate('document.querySelector("#workspace-mode-toggle").click()')
        await page.wait_for_function(f'{MODE} === "synced" && JSON.stringify(({SHOWN})()).includes("HOST-LATER")', timeout=10000)

        # Reloaded on the shared workspace: it opens (and rejoins); switching still
        # brings the own one back, even while the rejoin is under way (slowed here):
        # the switch stands when the session arrives.
        async def slow_join(rt):
            await asyncio.sleep(2)
            await rt.continue_()
        await ctx.route("**/api/session/connect", slow_join)
        await page.reload(wait_until="domcontentloaded")
        await load()
        await page.wait_for_function(f'{MODE} === "synced" && JSON.stringify(({SHOWN})()).includes("GUEST-EDIT")', timeout=20000)
        assert await page.evaluate("window.__own.syncMode.get().privateProject") is None, "nothing kept aside in memory after a reload"
        await leave()
        await page.wait_for_timeout(3500)
        assert await page.evaluate(MODE) == "private", "the switch stands when the session arrives"
        assert await page.evaluate(SHOWN) == ["mine.md: # MY-LOCAL-NOTES"], await page.evaluate(SHOWN)
        await ctx.unroute("**/api/session/connect", slow_join)
        copies, pointer = await settled_copies("local:my-local")
        assert pointer["open"] == "local:my-local", pointer

        # Reloaded again: the own workspace opens, the session (still joined) is rejoined, and the own one is a click away.
        await page.reload(wait_until="networkidle")
        await load()
        await page.wait_for_function(f'{MODE} === "synced" && JSON.stringify(({SHOWN})()).includes("GUEST-EDIT")', timeout=20000)
        await leave()
        assert await page.evaluate(SHOWN) == ["mine.md: # MY-LOCAL-NOTES"]

        assert not errors, errors
        await b.close()
    print(json.dumps({"checks": ["joining a session keeps this browser's own copy untouched, the shared one beside it",
                                 "typing in the shared workspace reaches the server and only the shared copy",
                                 "switching to it brings the own workspace back", "the host's later change stays off it until switching back",
                                 "after a reload the shared workspace reopens and rejoins",
                                 "switching after a reload brings the own workspace back (from storage), and stands while it rejoins",
                                 "and again after another reload"],
                      "runtimeErrors": 0}))


try:
    asyncio.run(main())
finally:
    SERVER.terminate()
