# Status after v0.3.11 (2026-10-25)

Where the project stands after this round of work:
- what was fixed: a summary, version by version;
- what was **not** fixed, or is only partly done: in detail, so whoever
  picks it up knows the impact, why it is open, where in the code to look,
  and a next step.

v0.3.11 is deployed on stilomarker.ngantech.net. The deploy is recorded in
`docs/DEPLOYMENT.md`. For how the code works, see `docs/REVIEW-0.3.md`; for
every issue's history, `docs/ISSUES.md`.

---

## Fixed

### This release (v0.3.2 – v0.3.11)

| Version | What changed |
|---|---|
| v0.3.2 | Open Project opens a project only with its Open button. A double-click (or two quick clicks) had opened it at once. |
| v0.3.3 | A pane label's Source/Preview switches the tab in use in place, instead of opening a second tab. |
| v0.3.4 | Tab strips: the tab in use is the darker one in every theme; the pane label has a border; a full strip shows no scrollbar (the wheel scrolls it), so both pane headers keep one height. |
| v0.3.5 | A team project's tree is headed by its name, not "Workspace". Every section header in the left area is drawn alike. |
| v0.3.6 | A file-name search box above the Explorer's tree filters it. Enter opens the first match, Escape clears it. |
| v0.3.7 | The left area is a window of tabs: the activity bar holds its icons (Explorer, Search, anything dragged there), and the icon of the page showing hides the window. The right panel's toggle is in the top bar. Fixed on the way: Find in Files' rows ran past the window's edge, and on a phone its search box was squeezed to a sliver (since v0.2.30). |
| v0.3.8 | The desktop app zooms: Ctrl+= / Ctrl+- / Ctrl+0, Ctrl+wheel, and View's Zoom In / Out / Reset. The status bar shows the zoom when it isn't 100%. Kept between starts. |
| v0.3.9 | The desktop app has one bar: no system title bar; the app's top bar is it, with the window buttons drawn over its end in the theme's colours. |
| v0.3.10 | Settings → Agent says "Checking the server…" until the server answers (it said "Ready" first), and an older check finishing late no longer overwrites the newest one. |
| v0.3.11 | A source editor in each group: two files, or the same file twice, side by side. The same file stays in step as you type, each editor shows the other's caret, and undo belongs to the file. Fixed on the way: an editor without the focus whose file changed elsewhere reloaded with its caret at the start; a long file's comment popover could sit beside the wrong line. A review before release found seven more bugs, fixed before the commit. |

Then v0.3.12 (docs only): the README, the welcome page and the in-app manual describe the two editors, and `docs/HISTORY.md` records the decisions they superseded; deployed 2026-10-25.

Also done: open issue O9 written down (2026-10-24); the maintainers'
review (`docs/REVIEW-0.3.md`); v0.3.11 deployed and checked from a fresh
browser.

### Earlier in the same stretch (v0.2.39 – v0.3.1), for context

- **v0.2.39 – v0.2.42**: fixes from the review before calling a version
  stable:
  - nothing reaches outside a workspace's folder;
  - an account loses what it may no longer have;
  - coming back to a tab leaves a PIN session as it is;
  - Find in Files, tables and the extension API's test.
- **v0.3.0**: tagged as the stable version; the live account file
  converted to hashed passwords.
- **v0.3.1**: a browser keeps a sign-in token, not the password.
- **Repository**:
  - `server/session-state.json` purged from the repository's history;
  - CI removed;
  - a portable desktop release workflow added.

### How it was checked

- **Each version** passed every Node, Python and browser suite (including
  the desktop app in Electron) before its commit. v0.3.11's final run: 415
  Node tests, 25 of 25 Python suites, 48 of 48 browser suites.
- **Three tests failed once and passed when rerun alone** (noted in their
  commits):
  - `pwa-browser` during v0.3.8;
  - `agent-here-browser` during v0.3.9, which exposed the v0.3.10 bug;
  - the desktop test's serve phase once while v0.3.9 was being built (not
    seen again).

---

## Not fixed

Ordered by how much it matters to a user. Each item: what it is, its
impact, why it is still open, where to look, and a next step.

### 1. The caret can jump to the top after a reconnect (O9) — fixed in v0.3.13

**Update (v0.3.13):** fixed as the next step below suggests (carets kept by path across a reload, and found by path when a file's id is new); see `docs/ISSUES.md`, v0.3.13. What follows is how it stood after v0.3.11.

- **What.** You reported that after the connection comes back (a shared
  or cloud workspace), the caret sometimes goes to the very start of the
  file.
- **Impact.** Annoying, and risky: typing right after lands at the top of
  the file. Nothing is lost.
- **Status.** Not reproduced yet. Two suspects:
  1. **Removed in v0.3.11.** An editor without the focus whose file changed
     elsewhere was reloaded with `loadEditorContent(text)`, putting its
     caret at 0. It now follows the change and keeps its caret
     (`followText` in `editor/adapters/show-file.js`).
  2. **Still there, the likeliest.** When a reconnect loads the project
     again from the server (Workspace's `replacing` / `replaced` events;
     `editor/adapters/together.js` keeps the open tabs through it, not the
     caret), a file can come back with a **different node id**:
     - the server gives its own ids to files made in this tab
       (`editor-cursors.js` says so for carets);
     - the saved caret is looked up by id
       (`resume.js`, `savedEditorSelection(fileId)`, in
       `mdnotes.viewstate.v1`);
     - the file then counts as a new file (`show-file.js`: `fileChanged`),
       and `loadEditorContent` puts the caret at the saved one, or at 0 when
       none is found.
- **Next step.**
  - **Reproduce.** In a cloud workspace, make a file in this tab, type in
    it, force a reload of the project (drop the connection long enough for
    the server's session to close, or restart the server), and watch the
    caret. The log panel shows "render→…" and "caret" lines.
  - **Fix.** On `replacing`, keep each editor's caret by **path**; on
    `replaced`, give it back by path. Or key the saved carets by path,
    which `resume.js` already scopes per workspace (`app.scope()`).
  - **Test.** A browser test with a mocked server whose reload returns new
    ids.

### 2. Deleting the active file leaves no active editor (O10) — fixed in v0.3.14

**Update (v0.3.14):** fixed as the next step below suggests; see `docs/ISSUES.md`, v0.3.14.

- **What.** With two editors, deleting the file the active editor shows
  clears the project's active file (`removeNodeRecursive` in
  `workspace/model/project.js` sets `activeFileId` to null). Nothing hands
  the active role to the other editor.
- **Impact.** Minor. The active group shows its preview or the welcome
  page. The other editor keeps its file but is not the active one until
  clicked. Until then, the explorer, Linked Notes and the status bar
  describe no file.
- **Why open.** Found while writing this summary. The hand-on rules
  (`handOn` in `editor/adapters/tabs.js`) run when a tab closes or turns
  Preview, and when a group closes (`closeGroupIfEmpty`), not when the
  project changes underneath.
- **Next step.** On a render where `activeFileId` is null and another
  group shows a source tab, activate that group's editor (as `handOn`'s
  second branch does). It runs inside a render, so guard against
  re-entry; `tests/two-editors-browser.py` can take the case.

### 3. Limits of the two editors (designed, worth knowing)

Details in `docs/REVIEW-0.3.md` §1.8 and §1.11.

- **The agent's edits and Find in Files' Replace** go through the active
  editor's undo history only when it shows the file whole
  (`workspace.editing` in `together.js`). Otherwise the file is written
  directly; editors showing it follow, and their history starts again
  from the new text, so Ctrl+Z there cannot undo that edit.
  - Next step: let the write path apply through any editor showing the
    file, with its kept caret.
- **Resume keeps one caret and scroll per file.** With the same file in
  both editors, the last one captured wins on reload. The inactive
  editor's scroll is not saved at all (`captureViewState` saves the active
  editor's).
- **The other editor's caret can lag 90–400 ms while typing.** Following
  is paced so a 20,000-line file stays fast; see `FOLLOW_IDLE` /
  `FOLLOW_MAX` in `editors.js`.
- **The highlighter's memo is shared.** Two editors with different kinds
  of file re-highlight more on redraws that reach both editors. This only
  costs speed.
- **Undo can put the caret where the other editor's edit was.** One
  history per file means undoing the other editor's typing moves your
  caret there. This is by design, as VS Code does it.

### 4. The desktop app's one bar is unverified on Windows and macOS

- **What.** v0.3.9 hides the system title bar and draws the window buttons
  over the app's top bar (Electron's Window Controls Overlay).
- **Status.** Checked only in the test's Electron 44 on Linux under a
  virtual display: the overlay is reported visible, the bar is a drag
  region and its controls are not, room is kept for the buttons, and the
  colours are kept. Not checked:
  - Windows (the buttons' colours, the snap layouts menu on hover over
    maximize);
  - macOS (`trafficLightPosition: { x: 14, y: 14 }` was chosen without
    seeing it);
  - real Linux desktops (GNOME/KDE, Wayland).
- **Risk.** The buttons sit wrong or in the wrong colours, or part of the
  bar doesn't drag. The window always keeps its system buttons, so it can
  still be closed, moved and resized.
- **Next step.** Build the portable files (`.github/workflows/release.yml`,
  manual run = build only) and try them on each system before publishing
  a release.

### 5. Nothing of v0.3.2 – v0.3.11 is on GitHub or in a desktop release

- **What.**
  - GitHub's `main` is still at v0.3.1 plus the CI removal (dc91c00).
    v0.3.2 – v0.3.11, the review, this summary and their tags are only on
    this server (the `dev` branch and the live checkout).
  - GitHub Pages serves `main`, so the copy there is v0.3.1.
  - The v0.3.1 desktop release draft was taken down because of these
    usability bugs, and no new build exists.
- **Impact.**
  - Desktop users get none of this release: not the zoom, not the one bar,
    not the two editors.
  - The desktop app's update check reads GitHub's latest release
    (`desktop/policy.mjs`, `FEED`), so no one is told an update exists.
- **Why open.** Pushing and releasing publish the code. They are waiting
  for your go-ahead (and for item 4's checks).
- **Next step.**
  1. Push `dev` to `main` on GitHub.
  2. Tag `v0.3.11`. The workflow builds the portable files and drafts the
     release, using `docs/releases/<tag>.md`, which needs writing for
     v0.3.11.
  3. Check the builds (item 4), then publish the draft.

### 6. Old commits with the session file are still reachable on GitHub

- **What.** `server/session-state.json` (a PIN session's workspace) was
  purged from the history and force-pushed on 2026-10-24. GitHub still
  serves the old commits by SHA until GitHub Support purges them.
- **Status.** Left as is by your decision (the file held nothing sensitive).
  The list of SHAs is in the private backup
  `~/backups/stilomarker/20261024T043049Z-repo-before-purge/`, should it
  ever be wanted.

### 7. Accepted issues (unchanged)

Kept as they are, with reasons, in `docs/ISSUES.md`:

- **A1.** After a server restart, a tab with older edits may need a fresh
  cloud snapshot. Recovery is automatic and keeps the conflicting text.
- **A2.** An old browser-local snapshot could migrate to the wrong
  workspace if two workspaces have a same-named file. This is theoretical
  and only touches history from before snapshots moved to the server.
- **A3.** Typing in the last moment before a PIN session drops (not yet
  confirmed by the server) is not sent on rejoin. Cloud workspaces keep it.

### 8. Tests are flaky on this machine under memory pressure

- **What.** The server has 2 CPUs and 2 GB of RAM, and the full run fills
  most of its 2 GB swap. Browser tests that wait on timing can then fail
  once and pass alone.
- **Seen this round:**
  - `pwa-browser`: a page load over 240 s;
  - `agent-here-browser`: a real race, fixed in v0.3.10;
  - the desktop test's serve phase: typing that never landed, seen once
    and not reproduced. The test now records where the focus was if it
    happens again (`focusBeforeTyping` in `tests/desktop-smoke.mjs`).
- **Impact.** A failed run needs a rerun before trusting it; the commits
  say when one was rerun. Nothing ships on a failure unless it passes
  alone.
- **Next step.** Run the browser suites with more memory, or in two
  halves.

### 9. Measured only here

- **Typing speed** with the same 20,000-line file in both editors (about
  30 ms a key, median) was measured in headless Chromium on this server,
  not on your hardware.
- **The phone layout** of the left window and the two editors was checked
  with Chromium's phone emulation, not on a phone.
