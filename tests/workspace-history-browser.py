"""Browser regression: Workspace History restores a deleted workspace.

Runs the real backend (a throwaway server with a temporary data folder) and a
real browser: back up, have another account delete everything, then bring back
one file, restore the whole workspace (which first backs up the current state),
and recover a deleted file through per-file Snapshots. Nothing outside the
temporary folder is touched. STILO_BROWSER may point at an installed Chromium.
"""
import asyncio, json, os, socket, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
TMP = tempfile.TemporaryDirectory()
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0)); PORT = probe.getsockname()[1]
(Path(TMP.name) / "whitelist.json").write_text(json.dumps({"users": [
    {"username": "tester", "password": "pw", "teams": ["qa"]},
    {"username": "second", "password": "pw", "teams": ["qa"]}]}))
SERVER = subprocess.Popen([sys.executable, str(ROOT / "server/mdnotes_server.py"), "--host", "127.0.0.1", "--port", str(PORT),
                           "--data-dir", str(Path(TMP.name) / "data"), "--whitelist", str(Path(TMP.name) / "whitelist.json"),
                           "--state-file", str(Path(TMP.name) / "state.json")],
                          cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(100):
    try: urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/ping", timeout=1); break
    except Exception: time.sleep(0.1)
BASE = f"http://127.0.0.1:{PORT}"; WS = "History"

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
S = {"serverUrl": "", "accountUsername": "tester", "accountPassword": "pw", "accountSuccess": {BASE: "tester"},
     "lastWorkspace": {"team": "qa", "path": WS}, "syncedProjectId": f"qa/{WS}"}
def api(method, path, body=None, token=None):
    url = f"{BASE}{path}" + (("&" if "?" in path else "?") + f"token={token}" if token else "")
    if isinstance(body, dict): body = {**body, "version": 117}
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read())
def server_files(tok):
    st = api("POST", "/api/workspaces/open", {"team": "qa", "path": WS}, token=tok)["token"]
    nodes = api("GET", "/api/session/state", token=st)["project"]["nodes"]
    def path(n):
        seg = []; cur = nodes[n]
        while cur.get("parentId"): seg.insert(0, cur["name"]); cur = nodes[cur["parentId"]]
        return "/".join(seg)
    return {path(k): v.get("content", "") for k, v in nodes.items() if v["kind"] == "file"}, st
checks = []
def ok(name): checks.append(name); print("  ok ", name)
async def main():
    owner = api("POST", "/api/auth/login", {"username": "tester", "password": "pw"})["token"]
    api("POST", "/api/workspaces/create", {"team": "qa", "name": WS, "shareTeam": True}, token=owner)
    # The other session is a DIFFERENT account: the server keeps one live session per
    # account per device, so reusing "tester" here would evict the browser's session.
    tok = api("POST", "/api/auth/login", {"username": "second", "password": "pw"})["token"]
    _, st = server_files(tok)
    op = lambda o: api("POST", "/api/operations", {"operation": o}, token=server_files(tok)[1])
    op({"type": "create-folder", "parentPath": "", "name": "第一卷"})
    op({"type": "create-file", "parentPath": "第一卷", "name": "第七回.md", "content": "第七回 正文"})
    op({"type": "create-file", "parentPath": "", "name": "大纲.md", "content": "大纲 v1"})
    op({"type": "create-file", "parentPath": "", "name": "map.png", "content": PNG})
    async with async_playwright() as pw:
        launch = {"executable_path": os.environ["STILO_BROWSER"]} if os.environ.get("STILO_BROWSER") else {}
        b = await pw.chromium.launch(**launch); ctx = await b.new_context(viewport={"width": 1280, "height": 900}, service_workers="block")
        await ctx.add_init_script("localStorage.setItem('mdnotes.settings.v1', " + json.dumps(json.dumps(S)) + ");")
        await ctx.route("**/Template/**", lambda r: r.abort())
        pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("dialog", lambda d: asyncio.ensure_future(d.accept()))
        await pg.goto(BASE + "/", wait_until="networkidle")
        await pg.wait_for_selector('.tree-row[title="大纲.md"]', timeout=30000)
        # A per-file snapshot of 大纲.md (for the Snapshots part later).
        await pg.click('.tree-row[title="大纲.md"] .tree-label'); await pg.wait_for_timeout(500)
        await pg.evaluate("() => document.querySelector('[data-command=\"history.create-snapshot\"]').click()"); await pg.wait_for_timeout(800)
        # Open Workspace History and back up by hand.
        async def confirm():
            await pg.wait_for_selector("#confirm-dialog[open]", timeout=10000)
            msg = await pg.locator("#confirm-dialog-message").inner_text()
            await pg.click("#confirm-dialog-accept-button"); return msg
        async def open_history():
            await pg.evaluate("() => document.querySelector('[data-command=\"history.workspace-history\"]').click()")
            await pg.wait_for_selector("#workspace-history-dialog[open]", timeout=10000); await pg.wait_for_timeout(600)
        await open_history()
        await pg.click("#workspace-history-backup-now"); await pg.wait_for_timeout(1000)
        rows = await pg.locator("#workspace-history-list .snapshot-item").count()
        assert rows >= 1, rows; ok(f"Back Up Now lists a backup ({rows})")
        await pg.evaluate("() => document.querySelector('#workspace-history-dialog').close()")
        # Another session deletes everything; a later edit makes the backup differ.
        op({"type": "delete-node", "path": "第一卷"}); op({"type": "delete-node", "path": "大纲.md"}); op({"type": "delete-node", "path": "map.png"})
        op({"type": "create-file", "parentPath": "", "name": "new-since.md", "content": "made after the backup"})
        await pg.wait_for_function("() => !document.querySelector('.tree-row[title=\"大纲.md\"]')", timeout=10000)
        files, _ = server_files(tok); assert set(files) == {"new-since.md"}, files; ok("everything was deleted")
        # Pick the manual backup; the file list compares it with now.
        await open_history()
        manual = pg.locator("#workspace-history-list .snapshot-item", has_text="Manual backup").first
        await manual.click(); await pg.wait_for_selector("#workspace-history-files .snapshot-item", timeout=10000)
        caption = await pg.locator("#workspace-history-files-caption").inner_text()
        assert "3 deleted since" in caption and "1 created since" in caption, caption; ok(f"comparison: {caption}")
        # Restore one deleted file.
        await pg.locator("#workspace-history-files .snapshot-item", has_text="第一卷/第七回.md").click()
        await pg.click("#workspace-history-restore-file"); print("     confirm:", await confirm()); await pg.wait_for_timeout(2500)
        files, _ = server_files(tok)
        assert files.get("第一卷/第七回.md") == "第七回 正文" and "大纲.md" not in files, files; ok("Restore File brings back one deleted file (and its folder)")
        await pg.wait_for_selector('.tree-row[title="第一卷/第七回.md"]', state="attached", timeout=10000); ok("…and it appears in the explorer")
        # Restore everything.
        await pg.click("#workspace-history-restore-all"); print("     confirm:", await confirm()); await pg.wait_for_timeout(4000)
        files, _ = server_files(tok)
        assert set(files) == {"第一卷/第七回.md", "大纲.md", "map.png"}, files
        assert files["大纲.md"] == "大纲 v1"; ok("Restore All: workspace matches the backup (new-since.md removed)")
        labels = await pg.locator("#workspace-history-list .snapshot-item").all_inner_texts()
        assert any("Before restoring" in l for l in labels), labels; ok("a 'Before restoring' backup makes the restore undoable")
        await pg.evaluate("() => document.querySelector('#workspace-history-dialog').close()")
        # Per-file Snapshots can bring back a deleted file too.
        op({"type": "delete-node", "path": "大纲.md"})
        await pg.wait_for_function("() => !document.querySelector('.tree-row[title=\"大纲.md\"]')", timeout=10000)
        await pg.evaluate("() => document.querySelector('[data-command=\"history.snapshots\"]').click()"); await pg.wait_for_timeout(1200)
        await pg.select_option("#snapshots-file-select", "大纲.md"); await pg.wait_for_timeout(800)
        await pg.locator("#snapshots-list .snapshot-item").first.click(); await pg.click("#snapshots-restore-btn"); print("     confirm:", await confirm()); await pg.wait_for_timeout(2500)
        files, _ = server_files(tok); assert files.get("大纲.md") == "大纲 v1", files; ok("Snapshots restores a file that was deleted")
        print("ERRORS:", errs or "(none)"); assert not errs, errs
        await b.close()
        image = (Path(TMP.name) / "data/team_qa" / WS / "map.png").read_bytes()
        import base64
        assert image == base64.b64decode(PNG.split(",", 1)[1]); ok("restored image bytes are identical")
    print(json.dumps({"checks": checks, "runtimeErrors": 0}, ensure_ascii=False))

try:
    asyncio.run(main())
finally:
    SERVER.terminate(); SERVER.wait(timeout=10); TMP.cleanup()
