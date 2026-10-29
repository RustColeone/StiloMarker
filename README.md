# STILO MARKER

Stilo Marker is a Markdown workspace for writing: notes, diagrams, characters and chats, alone or together with
others. It runs in the browser, as an installable web app, or as a desktop app that works on its own and can run a
server for others to join.

**How it is built, and how to add to it:** the [architecture page](https://rustcoleone.github.io/StiloMarker/docs/architecture/)
is a map of the code, made from the code itself. It starts at the whole system and goes in: a module, a file, one
function and its code. It also has the guides for adding an extension (a mod) and for any change to the project.

## Try it

- **In the browser:** [rustcoleone.github.io/StiloMarker](https://rustcoleone.github.io/StiloMarker/). Your work is
  kept in that browser. The page installs as an app and works offline.
- **The desktop app:** portable files for Windows, macOS and Linux on the
  [latest release](https://github.com/RustColeone/StiloMarker/releases/latest), nothing to install. The builds are not
  signed, so the first start asks once (the release notes say how). It has not been tried on macOS yet.
- **Your own server:** `python3 server/mdnotes_server.py` serves the app and adds working together, accounts and the
  server's AI keys ([below](#run-it-from-a-checkout)).

On a first visit the welcome file walks through the basics.

## What it does

- **Files:** Markdown with a live preview; module maps (`.mtree`), brainstorm diagrams (`.bmap`), Mermaid diagrams,
  HTML pages, plain text, logs and JSON; CSV and TSV tables, as an editable grid with each column's sum, mean, minimum
  and maximum; URL albums of images; images; and character sheets for Chats.
- **Writing:** two source editors side by side (two files, or one file twice, kept in step); Find in Files, with
  Replace (`Ctrl+Shift+F`); a name filter above the Explorer's tree; a spelling check (a setting).
- **Where your work is kept:** in the browser, in a folder on disk (Chromium browsers), or in projects on a server,
  shared with accounts and teams. A server keeps snapshots and backups to go back to, and a trash.
- **Working together:** live editing on a server, with a PIN or with accounts; each person's caret; comments on a
  line; sharing a workspace for a while with a guest PIN.
- **The Agent:** an AI assistant that reads the workspace and proposes edits you keep or drop. It uses the server's
  key, or your own (then it can run straight from your browser, no server needed). **Chats** with people and with
  characters you write. Pictures, when the server has an OpenAI key. Optional read-only connected tools
  ([docs/MCP.md](docs/MCP.md)).
- **The look:** Light and Dark, plus Paper, Midnight, Forest and High Contrast; panels can be dragged between areas.
- **Extensions:** the diagrams, tables, URL albums, HTML pages, Mermaid, module maps and the extra themes are
  extensions, written against a versioned API ([docs/EXTENSIONS.md](docs/EXTENSIONS.md), and the extension guide on
  the architecture page).

## How to use it

The welcome file covers the first steps. The [manual](server/MANUAL.md) covers the rest: each file type and its
format, the Explorer, the editors and the preview, saving and exporting, working together, the Agent and Chats, and
the settings.

## Requirements

- A current browser; opening a folder on disk needs a Chromium-based one.
- Python 3.10 or later for the server (the desktop app's own server too).
- Node.js 18 or later for `npm start` and the tests. There is nothing to install and no build step: the browser loads
  the files as they are.

## Run it from a checkout

The server serves the app as well:

```bash
python3 server/mdnotes_server.py      # or: npm run backend:start
```

Then open `http://localhost:8000`. Without a server, `npm start` serves the app alone at `http://localhost:4173`, and
everything is kept in the browser.

The server's settings are command-line options or environment variables (`python3 server/mdnotes_server.py --help`):

| Setting | Default | What it is |
|---|---|---|
| `--host`, `MDNOTES_HOST` | `0.0.0.0` | The address to listen on. |
| `--port`, `MDNOTES_PORT` | `8000` | The port. |
| `--pin`, `MDNOTES_PIN` | `2468` | The PIN that joins the shared session. |
| `--master-pin`, `MDNOTES_MASTER_PIN` | `1367` | The PIN that may also replace the whole project. |
| `--whitelist`, `MDNOTES_WHITELIST` | `server/whitelist.json` | The accounts. Without this file, the server has no accounts. |
| `--data-dir`, `MDNOTES_DATA_DIR` | `server/data` | The teams' projects. |
| `--trash-days`, `MDNOTES_TRASH_DAYS` | `30` | How long deleted files are kept. |

Change both PINs before anyone else can reach the server. Accounts are managed with `python3 server/accounts.py`
(`add <name> --teams <a,b> [--admin]`, `password`, `remove`, `list`), and then by an admin in Settings → Accounts.
The desktop app turns them on from Settings → Server.

The AI keys stay on the server; browsers never get them:

| Variable | What it is |
|---|---|
| `DEEPSEEK_API_KEY` or `MDNOTES_CHAT_API_KEY` | The chat provider's key (DeepSeek unless the address says otherwise). |
| `MDNOTES_CHAT_API_URL` (or `DEEPSEEK_API_URL`) | Any OpenAI-compatible endpoint; `https://api.deepseek.com/chat/completions` by default. |
| `MDNOTES_CHAT_MODEL` (or `DEEPSEEK_MODEL`) | The default model; `deepseek-flash` by default. |
| `OPENAI_API_KEY` | OpenAI's models, and pictures. |
| `MDNOTES_CHAT_ALLOW_REMOTE=1` | Lets browsers on other computers spend the server's keys. Without it, only a browser on the server's own computer may. |

With accounts, spending the server's keys also needs a signed-in account. Behind a reverse proxy on the same computer
every browser looks local, so turn accounts on there. Anyone can bring their own key instead (Settings → Agent); it is
kept in their browser and spends nothing of the server's. The manual lists the remaining settings.

## Tests

```bash
npm run test:all        # every test but the browser tests; also tests/run-tests.sh or tests\run-tests.bat
npm run test:browser    # with the browser tests (Playwright for Python and a Chromium)
```

[tests/README.md](tests/README.md) says what each test covers and how to run one by itself.

## Reference

- [The architecture page](https://rustcoleone.github.io/StiloMarker/docs/architecture/) (`docs/architecture/`): the
  code as browsable diagrams, from the whole system down to each function's code, with the guides "How an extension
  goes in" and "How a change goes in". It is the project's guideline: every change brings it up to date
  (`python3 tools/architecture.py`).
- [server/MANUAL.md](server/MANUAL.md): the manual, with every file format.
- [docs/ISSUES.md](docs/ISSUES.md): where things stand. Known issues (none open), the ones accepted and why, what has
  not been tried, and every fix by version.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the modules, their levels and the rules between them.
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md): the extension API.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): how a release is deployed, and each deploy.
- [docs/REVIEW-0.3.md](docs/REVIEW-0.3.md): a code review of v0.3.2–v0.3.11 for developers new to the code: how the
  Editor is built, the two source editors in depth, and each smaller change.
- [docs/STATUS-0.3.11.md](docs/STATUS-0.3.11.md): where things stood after v0.3.11, kept as a record.
- [docs/HISTORY.md](docs/HISTORY.md): project history, architecture rules, and superseded decisions.

## Code layout

| Path | What it holds |
|------|---------------|
| `app/main.js` | Starts the modules; everything else is theirs. |
| `app/kernel/` | Modules, their levels, state with named actions, events, extension points and the trace. |
| `app/modules/` | The core's modules (Shell, File types, Workspace, Editor, Sync, History, Explorer, Comments, Cloud, Models, Characters, Chats, Assistant...); `docs/ARCHITECTURE.md` describes each and the rules between them. |
| `extensions/` | Extensions (diagrams, module maps, URL albums, tables, themes...): each a folder the core never names, using only modules' extension points. |
| `server/stilo/` | The server's kernel and modules, in the same levels as the browser's. |
| `protocol/`, `spec/` | What both ends agree on: each module's network messages and version, file types, the extension API; the cases a rule written in both languages passes. |
| `desktop/` | The desktop app (Electron): the window, its menus, and the server it can run. |
| `tests/`, `tools/` | The tests, and the tools: the test runner, the release labels, the generated copies, the architecture page. |

The [architecture page](https://rustcoleone.github.io/StiloMarker/docs/architecture/) shows all of it, down to each
function, and is made from the code: after a change, `python3 tools/architecture.py` (the tests fail while it is out
of date). To read it locally, serve the repository (`npm start`) and open `/docs/architecture/`.

## App releases

The app uses `vMAJOR.MINOR.PATCH` release labels, beginning with **v0.1.12**. This is separate from each document's
S.E.N version and the internal numeric sync compatibility gate. The installed app version appears in Settings, and
`GET /api/ping` returns `appVersion` for deployment checks.

To prepare a release, run `node tools/release-version.mjs 0.3.20`, then `node tools/release-version.mjs --check`.
This updates `package.json`, `desktop/package.json`, `app/modules/shell/model/version.js` and the service worker's
cache label together. It does not change sync compatibility or user preferences.

A version tag pushed to GitHub (`v0.3.20`) runs the tests, builds the portable desktop files on the three systems and
drafts a release with the notes in `docs/releases/<tag>.md` (`.github/workflows/release.yml`). See the
[deployment notes](docs/DEPLOYMENT.md) for the hosted server.
