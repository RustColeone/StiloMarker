"""The desktop app in Electron (O6 of the stability review): desktop/app.mjs
started by tests/desktop-smoke.mjs, on a virtual display, with the web app's
files (a copy whose main.js exposes the app to the test).

It loads from app://stilo/; the server's addresses answer at once as offline
(no server), other files are not served, no service worker; a formula and a
Mermaid diagram draw from the app's own libraries; a link and a navigation
away open in the system's browser (a stand-in) and the window stays; a newer
release (a feed of the test's own) shows "Update available", whose item opens
its page; typing is saved; closing with unsaved work asks (Stay keeps the
window, Leave closes it). Reopened, the work is still there (one origin at
every start), and a second start hands over to the first and quits.

Needs Electron: STILO_ELECTRON (its binary), or desktop/node_modules (npm
install in desktop/), and xvfb-run without a display. Skipped, and said,
without them.
"""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from helpers.app_hook import app_hook

ROOT = Path(__file__).resolve().parents[1]
ELECTRON = os.environ.get("STILO_ELECTRON") or str(ROOT / "desktop/node_modules/electron/dist/electron")
WEB = ["index.html", "manifest.webmanifest", "app", "assets", "extensions", "vendor", "Template"]

if not Path(ELECTRON).exists():
    print(json.dumps({"skipped": "no Electron (set STILO_ELECTRON, or npm install in desktop/)"}))
    sys.exit(0)

TMP = tempfile.TemporaryDirectory()
SITE = Path(TMP.name) / "web"
PROFILE = Path(TMP.name) / "profile"
for entry in WEB:
    source = ROOT / entry
    (shutil.copytree(source, SITE / entry, ignore=shutil.ignore_patterns("server", "__pycache__", "*.py")) if source.is_dir()
     else (SITE.mkdir(exist_ok=True), shutil.copy(source, SITE / entry)))
with open(SITE / "app/main.js", "ab") as main:
    main.write(app_hook("window.__ui = { shell, controller };"))
# A fresh profile starts with one note (a formula, a link, a diagram), shown in the preview.
NOTE = {"id": "smoke", "name": "Smoke", "sourceMode": "memory", "rootId": "root", "activeFileId": "n", "nodes": {
    "root": {"id": "root", "kind": "folder", "name": "Smoke", "children": ["n"], "expanded": True},
    "n": {"id": "n", "kind": "file", "parentId": "root", "name": "flow.md", "dirty": False,
          "content": "# Flow\n\nEnergy $E = mc^2$, see [the site](https://example.com/stilo).\n\n```mermaid\nflowchart LR\n  Plan --> Write\n```\n\nThe end."}}}
SEED = ('<script>if (!localStorage.getItem("mdnotes.copies.v1") && !localStorage.getItem("mdnotes.project.v1"))'
        ' localStorage.setItem("mdnotes.project.v1", ' + json.dumps(json.dumps(NOTE)) + ');</script>')
index = (SITE / "index.html").read_text()
(SITE / "index.html").write_text(index.replace('<script src="./app/boot-theme.js"></script>', SEED + '\n    <script src="./app/boot-theme.js"></script>', 1))


def electron(phase, **popen):
    display = [] if os.environ.get("DISPLAY") else ["xvfb-run", "-a", "-s", "-screen 0 1400x1000x24"]
    # --no-sandbox: a downloaded Electron's sandbox helper is not set up (it needs root); the app's own settings are tested as written.
    command = display + [ELECTRON, "--no-sandbox", str(ROOT / "tests/desktop-smoke.mjs")]
    # Without ELECTRON_RUN_AS_NODE (an editor's terminal may set it): Electron would run as plain Node.
    env = {**{k: v for k, v in os.environ.items() if k != "ELECTRON_RUN_AS_NODE"},
           "STILO_SMOKE_ROOT": str(SITE), "STILO_SMOKE_PROFILE": str(PROFILE), "STILO_SMOKE_PHASE": phase}
    return subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, **popen)


def result(process, timeout=150):
    out, err = process.communicate(timeout=timeout)
    line = next((l for l in out.splitlines() if l.startswith("SMOKE ")), None)
    assert line, f"no result (exit {process.returncode}):\n{out[-2000:]}\n{err[-3000:]}"
    return json.loads(line[6:])


try:
    first = result(electron("first"))
    assert not first.get("failed"), first
    assert first["where"] == "app://stilo/", first
    assert first["api"] == [503, "offline"] and first["missing"] == 404 and first["serviceWorkers"] == 0, first
    assert first["drawn"], first
    release = "https://github.com/RustColeone/StiloMarker/releases/tag/v9.9.9"
    assert first["opened"] == ["https://example.com/stilo", "https://example.com/elsewhere", release], first["opened"]
    assert first["stillHere"] == "app://stilo/", first
    assert first["updateItem"][0] == "Update available" and "9.9.9" in first["updateItem"][1], first["updateItem"]
    assert first["stayed"] and first["askedAfterStay"] == 1 and first["asked"] == 2, first
    assert not first["errors"], first["errors"]

    again = electron("again")
    for _ in range(600):  # until it is up, then a second start
        line = again.stdout.readline()
        if line.startswith("READY") or not line: break
    second = electron("second")
    second_code = second.wait(timeout=30)
    rest, err = again.communicate(timeout=60)
    line = next((l for l in rest.splitlines() if l.startswith("SMOKE ")), None)
    assert line, f"no result:\n{rest[-2000:]}\n{err[-3000:]}"
    reopened = json.loads(line[6:])
    assert not reopened.get("failed"), reopened
    assert reopened["where"] == "app://stilo/" and reopened["kept"], reopened
    assert second_code == 0 and reopened["focusedBySecond"] == 1, (second_code, reopened)
    assert not reopened["errors"], reopened["errors"]
finally:
    TMP.cleanup()

print(json.dumps({"checks": ["loads from app://stilo/; no server, answered at once as offline; nothing else served; no service worker",
                             "a formula and a Mermaid diagram from the app's own libraries",
                             "a link and a navigation away open in the system's browser; the window stays",
                             "a newer release: Update available, its item opens the release's page",
                             "closing with unsaved work asks: Stay keeps the window, Leave closes it",
                             "reopened: the work is there; a second start hands over and quits"], "runtimeErrors": 0}))
