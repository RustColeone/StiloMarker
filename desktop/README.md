# Stilo Marker for the desktop

The web app in a window of its own (Electron), from its own files: no
server needed. Writing, diagrams, formulas, the Agent and Chats with your
own key (Settings → Agent → "Directly from this browser") all work on their
own; a server is optional (Settings → Collaboration → Server URL) for shared
workspaces, accounts and the cloud.

## Run it from the repository

```sh
cd desktop
npm install        # Electron and electron-builder, pinned in package.json
npm start          # the app, from this checkout's files
```

## Build it

```sh
npm run dist       # electron-builder: AppImage and .deb (Linux), NSIS (Windows), .dmg (macOS)
```

The build carries the web app's files (`index.html`, `manifest.webmanifest`,
`app/`, `assets/`, `extensions/` without their server code, `vendor/`,
`Template/`) beside the program, as `web/`.

## How it differs from the browser

- **One fixed origin**, `app://stilo/` (`policy.mjs`), so the workspace and
  settings kept in the browser's storage are found again at every start.
  Not `file://` (no origin of its own) and not a local port (a different
  one each time would lose them).
- **No server unless you name one**: the app's requests to `app://stilo/api/…`
  answer at once as "offline", as the web app's service worker does, so
  nothing waits. With a Server URL set, the app talks to it as a browser
  does (the server allows other origins).
- **Closing with unsaved work asks** (Leave or Stay). Electron otherwise
  keeps the window open without a word.
- **Links open in your browser** (or mail app); the window only ever shows
  the app. A page never gets Node or Electron: only the bridge in
  `preload.cjs` (the release, a newer one, its download page).
- **Updates**: the desktop app can't update itself as the web app does. It
  looks at the project's releases on GitHub at start and every few hours;
  a newer one shows "Update available" in the status bar, which opens the
  release's page to download it.
- **One instance**: starting it again brings its window to the front.
- No service worker (the files are already on disk).

## Tests

`tests/desktop.test.mjs` (Node: the rules in `policy.mjs`, and that the
build carries exactly the files they allow) and `tests/desktop-browser.py`
(the app in Electron on a virtual display: it needs `STILO_ELECTRON` set to
an Electron binary, or `npm install` here, and `xvfb-run`; skipped without
them).
