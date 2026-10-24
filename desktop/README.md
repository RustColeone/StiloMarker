# Stilo Marker for the desktop

The web app in a window of its own (Electron), from its own files: no
server needed. Writing, diagrams, formulas, the Agent and Chats with your
own key (Settings → Agent → "Directly from this browser") all work on their
own. For shared workspaces it can run a server itself, or connect to yours
(Settings → Server).

## Run it from the repository

```sh
cd desktop
npm install        # Electron and electron-builder, pinned in package.json
npm start          # the app, from this checkout's files
```

## Build it

```sh
npm run dist       # electron-builder, portable (nothing to install): an AppImage (Linux),
                   # a portable .exe (Windows), the app zipped (macOS, Intel and Apple Silicon)
```

The build carries, beside the program as `stilo/`, a tree shaped like the
repository: the web app's files (`index.html`, `manifest.webmanifest`,
`app/`, `assets/`, `extensions/`, `vendor/`, `Template/`), `protocol/`, and
the server's code (`server/**/*.py`, its modules' `module.json`,
`MANUAL.md`), never its data, accounts or state. The window loads only the
web app's files.

## Its server (Settings → Server)

- **None**: the app on its own.
- **Run a server on this computer**: the same server as the web app's
  (`server/mdnotes_server.py`), started with this computer's Python (3.10 or
  later; `STILO_PYTHON` names one). Its state, accounts file
  (`accounts.json`, if you add one: the server's accounts file) and data are in the app's folder
  (`server/` there), its PINs are made once at random, and it listens on
  this computer only unless "Other devices on this network can connect" is
  on; then it says the address others open in a browser. **Share This
  Workspace** joins it once with its master PIN, so your workspace is the
  session others join with its PIN; after that the app rejoins with that
  PIN too (the server's copy, with everyone's edits, stays the session's). It stops when the app quits (or
  crashes: `--parent-pid`). A taken port moves to the next.
- **Connect to another server**: your own, at its address (`https://…`, or
  `http://192.168.…` on your network).

The app's requests to its own `/api/` are sent on by the desktop app to the
chosen server (so a plain `http://` server on the network works; the window
itself is a secure origin). The choice is kept (`desktop-settings.json` in
the app's folder): at the next start the server starts again and the app
gets back on its session by itself.

## How it differs from the browser

- **One fixed origin**, `app://stilo/` (`policy.mjs`), so the workspace and
  settings kept in the browser's storage are found again at every start.
  Not `file://` (no origin of its own) and not a local port (a different
  one each time would lose them).
- **No server unless you choose one** (Settings → Server): the app's
  requests to `app://stilo/api/…` answer at once as "offline", as the web
  app's service worker does, so nothing waits; with a server chosen, they
  are sent on to it.
- **Closing with unsaved work asks** (Leave or Stay). Electron otherwise
  keeps the window open without a word.
- **Links open in your browser** (or mail app); the window only ever shows
  the app. A page never gets Node or Electron: only the bridge in
  `preload.cjs` (the release, a newer one, its download page; the zoom).
- **Updates**: the desktop app can't update itself as the web app does. It
  looks at the project's releases on GitHub at start and every few hours;
  a newer one shows "Update available" in the status bar, which opens the
  release's page to download it.
- **Zoom**: Ctrl+= / Ctrl+- / Ctrl+0 (Cmd on a Mac) and Ctrl+wheel, or
  View → Zoom In / Zoom Out / Reset Zoom; the status bar says the zoom
  while it is not 100%. Kept for the next start (`window.json` in the
  app's folder). The keys are the app's (Electron's own menu, which had
  them, is not used: the app draws its own).
- **One instance**: starting it again brings its window to the front.
- No service worker (the files are already on disk).

## Tests

`tests/desktop.test.mjs` (Node: the rules in `policy.mjs`, and what the
build carries), `tests/desktop-server.test.mjs` (Node: the server's choice,
and the server run with this computer's Python) and `tests/desktop-browser.py`
(the app in Electron on a virtual display: it needs `STILO_ELECTRON` set to
an Electron binary, or `npm install` here, and `xvfb-run`; skipped without
them).
