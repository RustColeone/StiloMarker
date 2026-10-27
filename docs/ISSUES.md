# Known Issues

Findings from the September 2026 reliability pass. Split into what is **still
open** (needs a decision) and what is **already fixed and deployed**, with
confidence stated — some items are confirmed, some are suspicions that could not
be proven.

Last updated: 2026-10-27 · release `v0.3.18` built on `dev` (not deployed); `v0.3.15`
deployed (public checks passed) and drafted as a desktop release (GitHub, not yet
published); `v0.3.0` is
the stable version. v0.2.30–v0.2.42 were gone over again before calling it so; what that found is
fixed in v0.2.39–v0.2.42. Where things stand after v0.3.11, what is fixed and what is not, in
`docs/STATUS-0.3.11.md`.

---

## Open

One, found using the app as a first visitor would (2026-10-27, against a
scratch server); the small things found with it are fixed in v0.3.17, and
O11 (the welcome file) in v0.3.18.

### O12. The browser's own workspace forgets its tabs on a reload
**Confidence:** confirmed · **Severity:** low

A cloud workspace's groups and tabs come back after a reload (kept in this
browser and on the server); the browser's own workspace keeps only its
active file, so after a reload both groups show that one file. The cache
(`cacheWorkspaceView` in `editor/adapters/tabs.js`) is written only for a
cloud workspace. Next step: keep it for the own workspace too (by its copy's
key) and restore it once the restored project is drawn, minding the first
visit's template and a cloud workspace resuming over it. Not a small fix.

O9 (the caret after a reconnect) was fixed in v0.3.13 and O10 (deleting
the active file) in v0.3.14. Before them, everything the stability review of 2026-10-21 found (the app as a PWA,
in Electron, with the user's own key and no server; each found by an
experiment) is fixed: the storage limit (O0) in v0.2.19, a copy per
workspace (O7) in v0.2.20, two windows (O1) in v0.2.21, the Agent and Chats
with the user's own key and no server (O3) in v0.2.22, offline edits merged
per file (O4) in v0.2.23, typing in a long chapter (O2) in v0.2.24, the app
as an installed web app (O5) in v0.2.25, the desktop app (O6) in v0.2.26,
very long files (O2b) in v0.2.28. The review before calling a version
stable (2026-10-23, of v0.2.30–v0.2.38) found the problems fixed in
v0.2.39 (paths), v0.2.40 (accounts), v0.2.41 (PIN sessions) and v0.2.42
(Find in Files, tables, the extension API's test); v0.3.0 is that version.

## Accepted

Known and kept as they are, with the reason.

### A1. Restart recovery can require a fresh cloud snapshot
**Confidence:** confirmed, intended · **Severity:** informational

The OT rebase log is in-memory and capped at 2,000 entries, so it is empty after a
restart. Patches based on an older revision are now **refused** rather than applied
at wrong offsets (which silently corrupted text before). Recovery automatically fetches
the current cloud snapshot and preserves conflicting local text in Snapshots.

Accepted (2026-10-20): it is how the rebase log is meant to work; recovery is automatic and keeps the conflicting text.

### A2. Residual risk in the snapshot migration
**Confidence:** theoretical · **Severity:** low

Legacy browser-local snapshots were filed under the shared `server-project` key.
Migration only adopts files whose paths exist in the workspace being opened, so if
two workspaces contain a **same-named file**, a snapshot could migrate to the wrong
one. Affects only pre-existing local history.

Accepted (2026-10-20): it can only touch history from before snapshots lived on the server, and only when two workspaces share a file's name.

### A3. Typing unconfirmed when a PIN session drops does not reach it
**Confidence:** confirmed by reading and an experiment · **Severity:** low

A PIN session (a guest's PIN, the desktop app's Share This Workspace) that
drops goes back to the tab's own workspace by design, and joining again
shows the session's copy; nothing of the own workspace leaks into it (tried
2026-10-22). Typing made in the last moment before the drop, not yet
confirmed by the server (usually well under a second), is not sent when the
tab joins again. Cloud workspaces merge such typing since v0.2.23.

Accepted (2026-10-22, found as O8): it is a moment's typing, and a cloud
workspace keeps it. Since a shaky connection makes it more likely, drops
that come close together are said (v0.2.36; since v0.2.41 only sessions
lost while the page is in view count, not one left on purpose).

---

## Fixed

### v0.3.18: the welcome file, written for someone using the site (O11)

Found with v0.3.17's small things; the user asked for it and the cosmetic
ones polished (2026-10-27).

- **The welcome file** (`Template/welcome.md`, the first file a first visit
  shows) read like the developers' README: Requirements (Node.js, Python),
  `npm start` on `localhost:4173`, the backend's default PIN; it named things
  the app no longer has (`Open Directory`, Settings → Toggle Log Panel,
  `IMAGE URL` labels) and described collaboration from before accounts. It
  is written again for someone using the site: where the work is kept and
  how to keep a copy, writing in the two panes, links (with a real one, to
  the sample diagram), the sample's files, working with others, the Agent
  and Chats, and the rest in a line each. Every menu item and shortcut it
  names was checked in the app. One line per paragraph: the preview breaks
  a line where the text does.
- **Linked Notes listed a link written inside a code span** (how to write a
  link, `` `[a](b.md)` ``, showed as a broken outgoing link); the preview
  shows it as code, and now the panel leaves it out too
  (`extractMarkdownLinks`, `editor/model/markdown.js`).
- **The Log had two entries with two names**: View → Toggle Log and
  Settings → Show Log Panel. It has one, in View, saying what it does now
  (Show Log / Hide Log, as Show Chat / Hide Chat beside it).
- **Settings → Collaboration's Account section** had a line under its heading
  with nothing above it to set off (left from when the sign-in sat under the
  PIN controls); it is gone, and the section reads as Server's does.
- `server/MANUAL.md`'s Settings section described Connect / Disconnect and a
  Toggle Log Panel; it lists the dialog's pages as they are.

Tests: `markdown-syntax.test.mjs` (a link inside a code span; fails before),
`phone-log-sheet-browser.py` checks the one entry under View (it read the
Settings one), `two-editors-browser.py` finds a phrase of the new welcome.

### v0.3.17: small things a first visit ran into

Found using the app as a first visitor would, on a desktop and a phone
(2026-10-27, against a scratch server), asked for by the user as cheap fixes
a user would meet:

- **"No server checked yet." with the server reachable.** The page pings
  its server silently at start; that marked it reachable but kept the
  placeholder detail, which Session and Settings → Server showed. A silent
  ping that finds the server from offline now says "Server reachable — not
  in a shared session." (`cloud/adapters/accounts.js`).
- **Typing after Create → New Markdown was lost.** The new file opened with
  the keys left on the page. Its editor now takes them, from the menu, the
  explorer's + and the New File dialog; not on the phone, where the explorer
  stays open over it (`explorer/adapters/naming.js`). The empty file's editor
  said "Select or create a file"; it says "Empty file — start typing".
- **Escape left the explorer's menus open** (right-click, + and the filter);
  it closes them now, as it does the tab menu (`explorer/adapters/tree.js`).
  Not the window resizing, as the tab menu's does: on a phone the keyboard
  going down would close the + menu as it opens.
- **Find in Files cut off a match far into its line.** A result kept 40
  characters before the match, more than the list shows at its usual width;
  it keeps 16 (`editor/model/search.js`).

Test: `small-things-browser.py` (new; each of its checks fails before, run
alone against v0.3.16); `editor-search.test.mjs` checks the shorter lead.
Found and left open: O11 (the welcome file) and O12 (the own workspace's
tabs).

### v0.3.16: each editor keeps its own place in a file

A limit of the two editors (v0.3.11), listed in `docs/STATUS-0.3.11.md` and
picked by the user to fix (2026-10-26): a file's caret and scroll were kept
once per file, so with the same file in both editors a reload opened both at
the one place (the last captured), and the editor without the focus kept no
scroll at all (only the active editor's was captured). Now each editor keeps
its own place in each file open in it (`byEditor` in the file's saved view
state, `resume.js`), and the place the file was last left too; an editor
showing a file resumes at its own place, else at the file's last one. All
editors on screen are captured (the active one last), the other's scroll
included. Closing a file's tab in a group forgets that group's place in it
(reopened there later, it starts where the file was last left, not at a
stale place), and a tab moved or opened to the other group (Open to the
Side) starts there where it was. Test: `pane-places-browser.py` (new; fails
before: both editors came back at the left one's caret). On the way: saving
the caret of an editor without the focus at a capture first saved a stale one
on a phone that delivers no selectionchange (`mobile-caret-browser.py`
caught it); the caret saved as the finger goes down is now the editor's
kept caret too. `caret-restore-browser.py` now plants its stale offset in
the editor's own place, which is the one it resumes at.

### v0.3.15: the agent's edits undo from either editor

A limit of the two editors (v0.3.11), listed in `docs/STATUS-0.3.11.md`: the
write path (the agent's edits, Find in Files' Replace) went through the
editor only when the active editor showed the file whole; when only the
other editor showed it, the file was written directly, that editor followed
with its history started again, and Ctrl+Z there could not take the edit
back. Now a write to a file goes through whichever editor shows it whole
(the active one first, else the other, if on screen: `writerFor` and each
editor's `applyWrite` in `editors.js`): it joins the file's undo history, is
sent as typing is, and moves the caret with the edit (the page's where the
editor has the focus, else its kept one). The caret of the active editor
used to stay at the same offsets, so an edit above it shifted the text under
it; it now moves with the text. Test: `two-editors-browser.py` (fails
before).

### v0.3.14: deleting the active file hands it to the other editor (O10)

Found 2026-10-25 while writing `docs/STATUS-0.3.11.md`: with two editors,
deleting the file the active editor shows cleared the project's active file
and nothing handed the active role to the other group's editor (its file
showing, but not the open file until clicked; the explorer, Linked Notes and
the status bar describing none). Now a render that finds no active file while
the other group's editor shows a file makes that editor the active one
(`handOnWhenGone` in `editors.js`, right after the render; the hand-over moved there
from `tabs.js`, which had grown past its size budget), as closing the active
file's tab does. Test: `two-editors-browser.py` (fails before).

### v0.3.13: the caret stays where it was when the project is loaded again (O9)

Found by the user (2026-10-24): after a reconnect, the caret sometimes went to
the very start of the file. The cause, found by reading and reproduced in a
browser test: a reconnect that loads the project again from the server keeps
the open tabs by path, but the caret was kept per file **id**, and a file made
during the session comes back under another id (the server gives every new
file its own; each browser had given it one of its own). Its caret was not
found, and it went to 0. The same happened to a PIN session joined again
after a drop, which loads the session afresh. Now a reconnect's reload keeps
each editor's caret and scroll by path and gives them back (`together.js`,
`keptCarets` / `carryCarets` / `giveCaretsBack` in `editors.js`), and a file's
saved caret and scroll are found by its path in the workspace when its id is
new (`resume.js`), so any reload opens a file where it was. (v0.3.11 had
already removed another way to it: an editor without the focus whose file
changed elsewhere was loaded again at 0.)

Reproduced by loading the project again as the server would (the file under a
new id), not with a real dropped connection: should it still happen, it is
reopened. Tests: `reconnect-caret-browser.py` (new; fails before: the caret
went from 1,009 to 0, and from 808 to 0 for a session joined again).

### v0.3.12: the user documents describe the two editors

Found 2026-10-25 when the user asked whether every document was updated.
The current-behaviour documents still had a few places from before: the
README's and the welcome page's "Write In The Source Pane" said the left pane
is where you write; the manual's layout called the Source pane "the text
editor for the active file", and its Source Pane section described a header
(file name and buttons) from before the tabs and had no undo or redo keys.
They now say each pane can show Source (Open to the Side, the same file in
step, undo from either), and the manual lists Undo and Redo. `docs/HISTORY.md`
records the two decisions this round superseded (one source editor; the left
area as stacked sections). The dated records (past releases in
`DEPLOYMENT.md`, past steps in `ARCHITECTURE.md`, past fixes here) are left as
they were: they describe their time. The in-app manual changed, so the version
did too (an installed app keeps its files until a new version).

### v0.3.11: a source editor in each group

Asked for by the user (2026-10-24): only one group could show a file as
Source; the other showed a placeholder ("open as Source in the other
group"). Each group has its own source editor now, so two files, or the same
one twice, can be edited side by side. The editor last worked in is the
active one (its file is the project's active file; the find bar, the
completions, the links panel, the character count and comments follow it).
The same file in both stays in step as you type, like a live collaboration:
the other editor's caret is drawn in the one you type in, named for its
group, and stays where it was in the text. Undo belongs to the file (one
history for both editors, as VS Code has it, kept while the file's tab is
open; it used to start again on every switch of file). On a phone only the
active editor shows. Found on the way: an editor without the focus whose file
changed elsewhere (someone else's edit, the agent's) was loaded again with
its caret at the start; it now follows the change where it is, its caret
kept (one suspect for O9, which stays open until it is reproduced); a long
file's comment popover could sit beside the wrong line. Tests:
`two-editors-browser.py` (new), `editor-view.test.mjs`.

### v0.3.10: the Agent's status says "Ready" only once it is

Found by a test that failed once (2026-10-24). Settings → Agent said
"Ready — using your own API key, through this server." while the server was
still being asked, and two askings close together (the dialog opening, a
setting changed, a session joined) could finish out of order, the earlier
answer last. Now the line says "Checking the server…" until the server
answers, and only the latest asking's answer counts. Tests:
`models.test.mjs` (both fail before), `agent-here-browser.py` reads the
line as it sees it.

### v0.3.9: the desktop app has one bar

Asked for by the user (2026-10-24): the desktop window had the system's
title bar above the app's own top bar, two bars doing one job. The window
has no title bar of the system's now: the top bar is it. Dragging it moves
the window (its menus and buttons stay buttons); the system's window
buttons are drawn
over its right end (on a Mac, its left), in the theme's colours, with room
kept for them. The look is kept for the next start (`window.json`), so the
buttons start in the right colours. Tests: `desktop.test.mjs` (what the
page may tell, the buttons' height with the zoom, the colours read),
`desktop-browser.py` (the bar a handle and its controls not, the room, the
dark theme's colours kept).

### v0.3.8: the desktop app zooms

Asked for by the user (2026-10-24): the desktop app had no way to zoom. The
app has no menu of Electron's (it draws its own), and with it went the
zoom keys. Ctrl+= (or +), Ctrl+- and Ctrl+0 (Cmd on a Mac; the number
pad's too) and Ctrl+wheel zoom the window again, through a browser's steps
(50% to 300%); View has Zoom In, Zoom Out and Reset Zoom; the status bar
says the zoom while it is not 100% (a click: 100% again). The zoom is kept
for the next start (`window.json` in the app's folder). Tests:
`desktop.test.mjs` (the steps, the keys, the page's commands and item),
`desktop-browser.py` (the keys and the wheel in Electron, the page given
no key, kept over a restart, Ctrl+0).

### v0.3.7: the left window has tabs

Asked for by the user (2026-10-24). The activity bar's Search icon showed
nothing (it only opened a section under the tree), its Chat icon opened the
right panel, and dragging the Agent to the left split the Explorer. The
left area is now a window of tabs, like the editor's: the activity bar holds
its icons, one per page (the Explorer first, then Search: Find in Files, on
a tab of its own); an icon shows its page, and pressing the icon of the page
showing hides the window. A page dragged anywhere on the left window or its
activity bar is one of its tabs, with its name, its toolbar and its "+" in a
title row. Linked Notes and Session stay sections under the Explorer's tree
(Move to Explorer puts any page there). The right panel is toggled from a
button at the right end of the top bar (and View → Show Chat).
On a phone the left drawer shows the icons in a row at its top. Pages moved
to the left before are its tabs now (they were sections). Found on the
way: Find in Files' rows ran past the window's right edge, and on a phone
its search box was squeezed to a sliver (since v0.2.30: it took the phone
layout meant for the editor's find bar); both fit now. Tests:
`area-pages-browser.py` (rewritten), `search-files-browser.py` (Ctrl+Shift+F
shows the Search tab; on a phone the box is wide and both rows fit, which
fails before).

### v0.3.6: a search box for file names above the tree

Asked for by the user (2026-10-24): the Search under the tree was unclear
(file names, or the text in the files?), and a file-name search belongs at
the top of the Explorer. A box now sits under the Explorer's header, above
the tree: typed, the tree keeps the files and folders whose name holds it
(any case) and the folders that hold them, shown open while it lasts (their
own open or closed state is kept); nothing found is said; Enter opens the
first file found; Escape clears it. Searching the files' text stays Find in
Files (its own tab from v0.3.7). Tests: `explorer-filter.test.mjs`,
`explorer-filter-browser.py` (new; the tree keeps its height under the box).

### v0.3.5: a project's tree is headed by its name

Found by the user (2026-10-24). A team project's tree was headed
"Workspace": a project was made with that name, and the server kept it. A
project is named by its folder now, when it is made and whenever it opens
(a project made before keeps its files where they are; only the heading
changes). The left area's sections were not drawn alike: Linked Notes had
its own header (smaller, bolder, darker, indented less); every section's
header is one style now. Tests: `cloud.test.py` (a project made, and one
from before, named by its folder), `area-pages-browser.py` (every header
alike; both fail before).

### v0.3.4: the tab strips

Found by the user (2026-10-24). The tab in use was the darker one in a dark
theme but the lighter one in a light theme; it is the darker one in every
theme now (on a light base, a shade darker than the others). A pane's label
had no border between it and its tabs; it has one. A strip full of tabs
showed a scrollbar that made its header taller than the other pane's; the
strips show none (the wheel scrolls one sideways, "⋯" lists every tab), so
both headers keep one height. Test: `tab-strip-browser.py` (new).

### v0.3.3: a pane's label switches its tab where it is

Found by the user (2026-10-24). Choosing Source or Preview from a pane's
label (▾) opened a second tab beside the one in use; it now switches that
tab's view in its place. The source editor and the preview move on to the
group's other tab of their kind (or none) as when such a tab closes, so no
tab comes back by itself. Tests: `editor-view.test.mjs`,
`tab-menu-browser.py` (the strip keeps its tabs, in their places).

### v0.3.2: a project opens only with Open

Found by the user (2026-10-24). In Open Project, a double-click on a
project opened it straight away, and two quick clicks (one to select, one
more, as the list redraws) count as one; the dialog is meant to open a
project only with its Open button. A double-click now enters a team or a
folder and only selects a project. Test: `trash-browser.py` (fails before).

### v0.3.1: a browser keeps a sign-in, not a password

Asked for 2026-10-24, after the review noted it. Until now a browser kept
the account's password (in its settings, readable by anyone at that
computer and by any script the page ran) so it could sign in again after a
reload, because the server kept sign-ins only in memory: every restart
ended them all.

- The server keeps its sign-ins in its data folder (`sign-ins.json`,
  owner-only), only a fingerprint (SHA-256) of each token, so the file signs
  no one in and a restart or a deploy signs no one out.
- A sign-in ends when its account signs out (the server is told), gets a
  new password or is removed, or after 30 days unused (each use keeps it);
  this replaces v0.2.40's fixed 14 days, which made sense only for sign-ins
  in memory.
- A browser keeps the token and signs in again with it
  (`GET /api/auth/me`); signing out ends it on the server
  (`POST /api/auth/logout`). A browser that kept a password (v0.3.0 and
  before) signs in with it once more, then keeps the token and empties the
  password. A token the server no longer takes is forgotten, and the account
  signs in by hand.
- Tests: `account-security.test.py` (a restart, the file, signing out, a
  new password, 30 days, the two routes over HTTP), `identity.test.mjs`
  (the token kept, no password sent, the move from a kept password),
  `identity-browser.py` (a reload after the server restarted, ben's page
  from before, signing out ends the token on the server).

### v0.2.42: Find in Files, tables and the extension API, as the review asked

Found by the review before calling a version stable (2026-10-23), in
v0.2.30-v0.2.37 (not deployed).

- **Find in Files' Replace could work from an old text** (fixed): a file
  typed in after the search was replaced from the searched text. Replace
  now works on every file as it is when it asks (not only the results
  drawn), with the true count, and typing during the question is kept.
  Undo puts back only files nobody changed since, and only in the
  workspace it was made in (it could write the same paths in another).
- Whole words in any script (`\b` knew only ASCII: "café" was found inside
  "cafés"); `^` and `$` are a line's; an emoji is one character; at most
  20,000 results, said as "20,000+"; an album is left out of Replace, and
  said; the find bar's single Replace reads lookbehinds, `^` and `$1` in
  the whole text.
- **A table's Undo could take away another person's row** (fixed): it
  restored the text the edit began on, so a row that came in during the
  edit went too. It now restores only what the grid changed; a step that
  no longer fits stays to undo. A cell over lines in a CRLF file no longer
  rewrites its line breaks when opened and left. The delimiter is guessed
  past quotes and once per file name; renamed .csv/.tsv, read again; new
  rows end as the file's lines do (`\r` too); blank lines stay blank as
  columns change; a last empty row copies as a row; the menu says how many
  rows or columns it inserts. A deeply nested JSON file no longer
  overflows the stack when its error is looked for.
- **The extension API's test missed uses** (fixed): a module's API under
  another name, destructured, over several lines, the project store in a
  getter, and the module context destructured all went unread. It reads
  them now, refuses what it cannot read, and is itself tested with a probe
  of each kind; members must be in the module's API object.
- The desktop app's right-click Select All selects the whole of a long
  file (the page's own Ctrl+A); a second preview draws another file even
  while focus is inside it.
- Tests: `editor-search.test.mjs`, `search-files-browser.py`,
  `data-table.test.mjs`, `data-table-browser.py`, `editor-json.test.mjs`,
  `extension-api.test.mjs`, `desktop.test.mjs`, `editor-groups-browser.py`.

### v0.2.41: coming back to a tab leaves a PIN session as it is

Found by the review before calling a version stable (2026-10-23). Came
with v0.2.34, which is not deployed (the live server runs v0.2.29).

- **A host's tab coming back ended the session for its guests** (fixed):
  since v0.2.34 a PIN or guest session's resume (the tab shown again, the
  network back) opened a new stream on the same token. Closing the old one
  ended the session's presence (others saw it leave and join), and for a
  session hosted for guests (Collaboration → Host) the server took it as
  the host leaving and closed the session. Now the resume leaves the stream
  open and renews the lease at once; a stream that died quietly is found
  by the server, which refuses a lease without its stream, and the tab
  then drops and joins again as after any drop.
- A tab told it is out of date is no longer brought back by a resume.
- The shaky-connection warning counts only sessions lost while the page is
  in view: leaving on purpose, or a hidden tab letting its lease go, are no
  drops.
- Tests: `collaboration-runtime.test.mjs`, `server-reliability.test.py`,
  `shaky-connection-browser.py`.

### v0.2.40: an account loses what it may no longer have (security)

Found by the review before calling a version stable (2026-10-23). Server,
and the desktop app's first admin. Accounts as an admin manages them
(v0.2.35, v0.2.38) are not deployed yet; the first item was true before
them too, for an account removed from the file by hand.

- **A removed account kept its open projects** (fixed): its session in
  each team project went on (editing, saving) until it disconnected.
  Identity now says when an account changes (removed, a new password,
  other teams), wherever it was changed: the admin page,
  `server/accounts.py`, or the file by hand (read again every 15 seconds
  even when no one signs in). Sync ends its sessions: all of them when it
  is removed or given a new password, those in the teams it left.
- **Sign-ins**: a new password signs the account out everywhere but the
  page that set it; a sign-in lasts 14 days at most.
- **Signing in**: five wrong passwords for a name make that name wait a
  minute (any name, so it tells nothing about which have accounts); a
  name with no account takes as long to refuse as one with; two password
  checks at most at once.
- **The account file is never served, whatever it is called**: only the
  name `whitelist.json` was kept private, so a file given another name
  inside the folder the app is served from would have been served. And
  the server's own files are refused under any spelling a disk that
  ignores case, look-alikes and trailing dots would take (`/SERVER/`,
  `/Data./` on Windows or macOS; not the live server, on Linux).
- **The file read as it should be**: teams a list of names (a string was
  read as one team per letter), a password a string (anything else signs
  no one in). A file that does not read keeps the accounts from before,
  as it did, but the page no longer writes them over it, and the desktop
  app makes no first admin over it (it says the file does not read).
- **Names**: an account name holds nothing invisible (control and format
  characters, which take in zero-width and right-to-left marks) and only
  its NFKC form, and two names differing in case or form are one. A team
  name is a folder name (letters, numbers, spaces, `_.-`, up to 64) and
  takes the spelling the accounts already use ("Red" joins "red").
- `server/accounts.py` reads a password from standard input as UTF-8 on
  any system.
- Tests: `account-security.test.py` (new); `desktop-server.test.mjs` and
  `desktop-browser.py` (an account file that does not read).

### v0.2.39: nothing reaches outside a workspace's folder (security)

Found by the review before calling a version stable (2026-10-23). Server and
browser. The first two were in deployed versions before this round (a team
project's folder storage), reachable by signed-in accounts with access to a
project; PIN guests and temporary shares keep no folder.

- **A name could walk out of the workspace's folder** (fixed): no name was
  checked as a path. An account that may edit a project could make a folder
  named `..` and write (or, deleting it, remove) files outside the project's
  folder: another project's, or the server's own. Names are now checked on
  both ends (`name_problem` / `nameProblem`: not `.` or `..`, no slash,
  backslash or control character, no trailing dot or space, at most 255
  characters), and the folder store never writes, moves, replays or deletes
  outside its folder (`FolderStore.inside`, checked for the whole tree before
  the write-ahead record; a project saved before with such a node opens
  without it, said).
- **The image upload wrote any file, for anyone in the session** (fixed): it
  checked only that the path stayed in the folder (and by a string prefix, so
  a neighbour folder named alike passed), not the role or the type, so even a
  reader could overwrite the project's access list and become its owner. Now
  only someone who may edit uploads, only images, at paths a file may have,
  never over a name the server keeps; and only the workspace's own files are
  served (never its bookkeeping beside them).
- **Names kept for the app** are complete (`user-state.json`, the chats'
  database and its two side files), apply to folders too, and are compared as
  a disk that ignores case and look-alikes would (NFKC, case folded, `ß` as
  `ss`, trailing dots and spaces dropped; both ends fold the same way); on the
  server's disk, a top-level name that is one of its own files under another
  spelling is refused as well.
- **A whole project brought in at once** (Share This Workspace, a state
  pushed, an import) is checked whole (`tree_problem`): every name, every
  node in the folder it names, known types, no loop, no two alike in a
  folder, nothing reserved at the top.
- **A folder inside a project is never a project of its own** (one holding a
  user's `manifest.json` could be opened, with its own access list).
- **Opening a folder or ZIP**: a path that walks out (`../x.md`) is left out
  whole, a name the app cannot keep is left out, a name kept for the app's
  own files at the top is reported (no longer dropped without a word), and
  the notice gives each one's reason. **Renaming or moving a folder** of a
  local project no longer deletes files in it the project left out (too
  large, or of a type the app does not open): the old folder keeps them.
- Tests: `path-safety.test.py` (new: names that walk out, a whole project
  that does, the store never writing, replaying or deleting outside, the
  server's own file under another spelling (a hard link), uploads and what is
  served, a folder inside a project); the operations and file-types tables
  (names, folds); `file-types.test.py` (the list covers every file a module
  keeps in a project's folder); `zip-fs.test.mjs` (the reasons, a ZIP path
  that walks out, a renamed folder keeping a left-out file); `sync.test.py`
  (an uploaded image is served once it is a file of the workspace).

### v0.2.38: accounts in the desktop app, turned on from its Server page

Asked (2026-10-22): what happens for a user setting up accounts in the
desktop app, and could it give an initial account and password? Chosen: set
up in the app, no default password ("A").

- **Turn On Accounts…** (new, Settings → Server, when the app runs its own
  server): the first admin's name and password (twice) are asked; the
  desktop app makes the account with the server's own tool
  (`server/accounts.py add --admin`, the password on standard input, the
  name after `--`), so the rules and the hashing are the server's; the
  server reads the file again within seconds and the app signs in as the
  admin, who then has Settings → Accounts. Before, the desktop server had no
  account file and no way to make one without a terminal.
- **Only the first**: refused once the server has accounts (the admins
  manage the rest); the page says whether accounts are on and how many.
  There is no default account or password, so a server open to the network
  never has a guessable admin. Turning accounts off is not offered (projects
  belong to accounts by then).
- Desktop: `desktop/server.mjs` (`accounts()`, `firstAdmin()`),
  `server-policy.mjs` (`ACCOUNTS_FILE`, `firstAdminArgs`, `accountCount`), a
  bridge call (`stilo:server-first-admin`; the server's state carries the
  count), and the page (`cloud/adapters/desktop-server.js`).
- Tests: `desktop-server.test.mjs` (the tool's command line; the first admin
  made by the real tool, hashed, readable by its owner only; a short
  password refused in the server's words; a second refused),
  `desktop.test.mjs` (the bridge's calls), `desktop-browser.py` (a new phase
  in Electron: off, turned on from the page, the first admin hashed and
  signed in, Settings → Accounts shown).

### v0.2.37: the extension API, version 1

Asked for (2026-10-22): settle and document the extension surface, with a
declaration and tests, before freezing the core.

- **What an extension may use** is listed in `protocol/extension-api.json`
  (version 1): the manifest's fields; the kernel's `defineModule` and
  `ignore` and the module context's `use` and `log`; and per module (Shell,
  File types, Workspace, Editor, Explorer, Identity, Sync, Assistant) the
  members, the static exports, and what `editor.parts()` and
  `workspace.project()` return, as the extensions use them today plus the
  core's other public extension points. `docs/EXTENSIONS.md` (new) describes
  all of it, with the callbacks' shapes, a skeleton and the steps to add an
  extension.
- **Each extension declares the version** it is written for (`"api": 1` in
  its `extension.json`; all seven now do). One written for another version is
  refused when the browser's copies are written, and the server leaves its
  file types out, saying so.
- **Held both ways by tests**: an extension imports, uses and calls only what
  is listed; everything listed still exists in the modules; the page names
  all of it. Adding to the list is not a new version; removing or changing
  anything is.
- Two variables in the diagram editor were named like modules' APIs
  (`types`, a drag's data types; `workspace`, an element) and are renamed:
  extensions keep those names for the APIs.
- Tests: `extension-api.test.mjs` (new) and `file-types.test.py` (an
  extension for another version left out).

### v0.2.36: a shaky connection is said

Asked for (2026-10-22): O8 is accepted (A3), "but we should warn user about a
shaky connection". Browser only.

- **Drops close together are said** (new): when a PIN session's connection
  drops a second time within ten minutes, the tab says the connection keeps
  dropping and that words typed just before a drop may not reach the others,
  to check that the last words arrived once it is back (at most once every
  ten minutes; `sync/model/shaky.js`, pure). A single drop rejoins quietly,
  as before.
- Tests: `sync-shaky.test.mjs` (new: two drops in four minutes said, once in
  a while; drops far apart not) and `shaky-connection-browser.py` (new: one
  drop quiet, a second soon after said, rejoined each time).

### v0.2.35: accounts with hashed passwords, and admins who manage them

Before freezing the core (2026-10-22), the last of four. Asked for: hashed
passwords, a one-time conversion of the account file, and an admin page;
the first admin named on the command line ("Command line (Recommended)").

- **Passwords hashed** (`identity/model/passwords.py`: salted scrypt,
  n=2^14, r=8, p=1, compared in constant time). An account file from before
  keeps them as typed: they still sign in (no one is locked out by the
  update), and the server says at every load how many need converting.
- **`server/accounts.py`** (new): `convert --admin <name>` hashes every
  password once and names the first admin; `list`, `add`, `password`,
  `admin [--off]`, `remove`. Passwords are asked for (or read from standard
  input with `--password-stdin`), never given on the command line or
  printed. The file is written whole and at once, readable by its owner
  only. The rules are Identity's (`model/accounts.py`, pure), shared with
  the admin page: names and team names checked, a new password of at least
  8 characters, and the last admin can be neither removed nor made ordinary.
- **Settings → Accounts** (new, for an admin): the accounts, their teams and
  who is an admin (never a password or its hash); add an account, set a
  password, change teams, make or unmake an admin, remove one. The server
  keeps the rules and its reason for a refusal is shown. Routes
  `GET /api/accounts` and `POST /api/accounts` (admins only; in Identity's
  contract), and the sign-in reply says whether the account is an admin.
- **A removed account is signed out at once**: an account token whose account
  is gone from the file no longer works (it did until a restart).
- A form's password field is taken as typed (not trimmed) and asks the
  browser for a new password, not a saved one.
- Tests: `accounts.test.py` (new: hashing, the rules, the file written whole
  and private, the command line, the admin operations) and
  `accounts-browser.py` (new, a real backend: an ordinary account sees no
  page; the admin's list; add, password, teams, remove (signed out at once),
  a short password refused, the last admin kept); `identity.test.mjs` and
  `identity.test.py` (the account carries `admin`; a missing flag reads as
  not an admin); `shell-browser.py` counts only the Settings tabs shown (the
  Accounts tab is there, hidden, for anyone not an admin).

### v0.2.34: a live PIN session is never joined again by itself

Found by the desktop test still failing now and then after v0.2.32: the
status of every change, recorded, showed a second join right after Share
This Workspace with no drop between. Browser only.

- **A resume dropped a live PIN session** (fixed): Cloud's resume (at start,
  when the page or the network comes back, and as a retry while the server
  could not be reached) reconnects a session it cannot reopen in place, and a
  PIN session never could, so it joined again even when it was live. Joining
  drops the session first; with the PIN saved since (Share This Workspace
  saves the guest's) the app came back as someone else, and the server's copy
  replaced typing not yet sent. This was not only the desktop app's: any tab
  in a PIN session did it when the network or the tab came back.
- **Joining by itself leaves a live session alone** (`connectSaved({ auto })`,
  for every automatic caller: a resume, a retry, the desktop app's server
  coming up; v0.2.32's guard on the last one alone is folded into it).
- **A PIN session resumes in place**: its stream is opened again on the same
  token (a quietly dead stream replaced, what was missed arriving with it),
  as a cloud workspace's resume does; a token the server no longer knows
  fails there, and the session is joined again as after any drop.
- Tests: `desktop-follow-browser.py` (a resume, then a change of the desktop
  server's state: no second join; each fails without the fix);
  `collaboration-runtime.test.mjs` (a PIN session's resume: a fresh stream on
  the same token, no second join, the typing kept); `desktop-smoke.mjs`'s
  reopened app waits for the second start (up to 45 s, not 6 s, which a
  loaded machine sometimes outlasted).

### v0.2.33: a spelling check, as a setting

Before freezing the core (2026-10-22), the third of four. Asked for:
"Spellcheck as a setting, toggle in a setting is fine."

- **Check spelling** (new, Settings → Appearance, off at first): the
  browser's spelling check in the source editor, with its own dictionary and
  language; kept in this browser.
- **The desktop app's right-click menu** (new): Electron shows none of its
  own, so a right click in the desktop app did nothing (no Cut, Copy or
  Paste either). It now shows a misspelled word's suggestions and Add to
  Dictionary where the page checks spelling, then Cut, Copy, Paste and
  Select All as the place allows (`desktop/context-menu.mjs`, pure: Electron's
  details in, a menu out).
- Tests: `spellcheck-browser.py` (new: off at first, on from Settings, kept
  over a reload, off again); `desktop.test.mjs` (the menu for a misspelled
  word, one with no suggestions, a plain field, selected text, nothing; and
  every module the main process imports is in the build's files, so a
  packaged app never misses one).

### v0.2.32: the desktop app keeps its live session when its server's state changes

Found by the desktop test failing now and then (2026-10-22). Browser only.

- **Share This Workspace could lose what was typed next** (fixed): when the
  desktop app's server reported a change of state (as it does while it
  starts), the app joined its session again with the PIN it had saved, which
  dropped the live session first; right after Share This Workspace that PIN
  is already the guest's, so the app came back as a client and took the
  server's copy over typing not yet sent. A session the app is in (or
  rejoining) is now left as it is; one it was in before and is not in now is
  still joined again.
- Tests: `desktop-follow-browser.py` (new: a stand-in for the desktop
  bridge; in a session, a change of the server's state makes no second
  join); `desktop-smoke.mjs` reports what Sync said in the serve phases, for
  a failure's report.

### v0.2.31: plain text, JSON and tables

Before freezing the core (2026-10-22), the second of four. Asked for: "the
csv might need a table editor for the preview mode" (chosen: a grid, with
the numbers in a column summed up).

- **Plain text** (`.txt`, `.log`; new, in the core): edited as it is (no
  Markdown colours, no formatting toolbar; a type with no toolbar buttons no
  longer shows an empty toolbar), previewed as it is. Create → New Text File.
- **JSON** (`.json`; new, in the core): coloured in the source
  (`editor/model/json.js`: keys, strings, numbers, literals, punctuation, a
  line at a time); the preview says whether it is valid, with what it holds
  and the value formatted, or where it is not (line and column, found by the
  app's own check: browsers word the error differently and some never say
  where).
- **Tables** (`.csv`, `.tsv`; new, an extension: `extensions/data-table/`):
  the table editor in the preview, shown when a table opens. Only the rows
  and columns in view are drawn (20,000 rows scroll like twenty); the first
  row kept in view as a header (found by itself, a checkbox to change it);
  cells edited in place (typed over, or Enter / F2 / a double click; Enter
  and Tab move on; Escape drops the edit; an input method's text goes in);
  blocks copied and pasted as tab-separated text (one value pasted on a
  block fills it); rows and columns inserted and deleted (a right click, or
  Add Row / Add Column); columns resized; the numbers in the selection, or
  one cell's whole column, summed up below (sum, mean, min, max); Ctrl+Z
  and Ctrl+Shift+Z for its own edits. An edit rewrites only the records it
  touches (the rest of the file byte for byte, quoting as the writer chose)
  and is written with the text it was made on, so it merges with others'
  typing, and an edit begun before a row came in above still lands on its
  own row. The source colours each column. Create → New Table.
- **Names kept for the app** (both ends): no file or folder at a workspace's
  top may be named like a file the server keeps there (`manifest.json`,
  `access.json`, `comments.json`, `chat.json`, `.pending-state.json`, any
  case); with `.json` a known type, a file of that name would have
  overwritten the workspace's tree, its access list, its comments or the
  agent's threads. The list is `reserved` in `protocol/file-types.json`
  (both ends read it; a server test checks it covers every bookkeeping name
  a module reserves that is a known type); Workspace refuses such a create,
  rename or move on both ends (the operations table has the cases); a local
  folder's own `manifest.json` is no longer read as a file.
- **The keyboard stays where it is**: the write path edits the file shown in
  the source editor as if typed (it joins the undo history), and that render
  put the keyboard back in the editor, so a table's next key went into the
  source; when something else has the keyboard (a table's cell, the chat, a
  Replace button) it now keeps it. And the preview, which is not drawn while
  the keyboard is inside it (a diagram's fields, a table's cell), is drawn
  when another file is to show there.
- **Large text files left out**: a folder or ZIP opened as a workspace
  leaves out text files over 5 MB (now that logs and data files are known,
  a folder of results could hold one of hundreds of MB), and says which;
  adding one is refused the same way.
- Tests: `data-table.test.mjs` and `editor-json.test.mjs` (new: records read
  as written, each edit's text, the numbers in a block, the clipboard's form;
  JSON's colours, validity and where it stops), `data-table-browser.py` (new:
  the 14 checks above, in a browser), the file-types and operations tables
  (the new types; reserved names refused at the top on both ends, fine in a
  folder), `file-types.test.py` (the list covers every bookkeeping file of a
  known type), `zip-fs.test.mjs` (a folder's and a ZIP's left-out files) and
  `shell-browser.py` (the Create menu's two new items).

### v0.2.30: Find in Files

Before freezing the core (2026-10-22), the first of four. Browser only.

- **Search every file** (new): a Search section in the left area (Edit →
  Find in Files, Ctrl+Shift+F, or the activity bar's magnifier; like any
  page it can be moved to another area). It searches every text file as you
  type, with Match case, whole word and regular expressions; results are
  grouped by file in path order, each match with its line number and the
  words around it, and a click opens the file at the match (in a very long
  file too: the line is rendered and shown). It searches again as files
  change. A word selected in the editor becomes the query.
- **Replace in every file**: Replace All, or one file's Replace, asks first,
  then writes through Workspace's one write path (merged with others' edits,
  and synced); Undo Replace puts back what it changed, except in a file
  changed since (left as it is, and said).
- **The find bar shares the search** (`editor/model/search.js`), and its
  Replace All took `$&` and `$1` in a plain (not regular expression)
  replacement as patterns (fixed: taken as they are). Ctrl+Shift+F no longer
  also opens the open file's find bar.
- Tests: `editor-search.test.mjs` (new: patterns and options, matches,
  lines, snippets, replacing) and `search-files-browser.py` (new: the
  shortcut, results across files and in Chinese, the options, opening a
  match in a 20,000-line file, searching again after an edit, Replace All
  and Undo, an Undo that leaves a file changed since, a selected word as the
  query); `area-pages-browser.py` and `shell-browser.py` expect the Search
  section first in the left area and Find in Files in the Edit menu.

### v0.2.29: the desktop app runs a server, and gets back on it by itself

Asked for (2026-10-22): a way to start the sync server from the desktop
app, which then connects to it (or to a server of one's own) by itself.

- **Settings → Server** (the desktop app only): no server; run a server on
  this computer (its port; whether other devices on the network reach it);
  or connect to another server (its address, http or https). Running, it
  says where others open it (in a browser: the server serves the app too)
  and the PIN they join with; **Share This Workspace** makes this workspace
  the server's (joined once with its master PIN, which stays here); after
  that this app rejoins with the session's PIN, as anyone does, so the
  server's copy, with everyone's edits, stays the session's (a master pushes
  its own copy on joining: after a crash, an older one).
- **The app reaches the chosen server through the desktop app**: its
  requests to its own `/api/` are sent on to the server (the sync events'
  stream too), so a server on the network at a plain `http://` address works
  (the app's own origin is secure, and a page there could not call it
  directly) and the Server URL stays blank.
- **By itself**: the choice is kept; at the next start the server is
  started again and the app joins its session again (Remember & reconnect).
  Choosing another server drops the session joined on the last one.
- **The server is this app's part**: its state, accounts file and data are
  in the app's own folder, its PINs are made at random once, and it stops
  when the app quits, and also when the app crashes or is killed (the
  server's new `--parent-pid`). It needs Python 3.10 or later on this
  computer (it says so when there is none); a taken port moves to the next.
- Tests: `desktop-server.test.mjs` (new: the kept choice, where requests
  go, the server's command line and Python; the server started with this
  computer's Python, answering, stopped; a taken port; no Python),
  `parent-watch.test.py` (new: the server stops when the process that
  started it ends) and `desktop-browser.py` (the app in Electron: a server
  run here, reached through the app, shared on, joined by someone else who
  finds the typing; reopened, back on it with nothing clicked; quit, it
  stops; another server reached and joined; none: offline).

### v0.2.28: a very long file types like a short one

From the stability review (2026-10-21), O2b. Browser only.

- **A 450 KB file took about 1.5 s a key** (fixed): the browser laid out
  every one of its 20,000 lines whenever the editor drew. Now only the lines
  in view, and 60 more each side, are in the page (lazy rendering); empty
  space above and below stands for the rest, as tall as those lines were
  measured or, never shown yet, are estimated (wrapping included), and the
  view is kept steady as the estimates become measurements. A file of up to
  2,000 lines is in the page whole, as before. On a 450 KB file a key's own
  work is now 2-3 ms and it reaches the screen in about 25 ms (the same as a
  short file on the server's two slow cores).
- **Everything still works on the whole text**: a selection longer than the
  page can hold (Select All; a Shift-click thousands of lines away) is kept
  as text offsets while the page shows the part in view, and copying,
  cutting, typing over it and pasting use the whole of it; a caret scrolled
  far out of view comes back with the next key, and the key lands there;
  find, undo and going to a line render the lines they need and move the
  view there; someone else's edit while you are scrolled away leaves the
  view where it is.
- **Work every key did on the whole text** (fixed, any file): the undo
  history compared the texts a character at a time (now a 4 KB chunk at a
  time), every line went through the highlighter (now only changed lines,
  and those after a changed ``` fence until it closes as before), word
  suggestions read the whole text (now 16 KB either side of the caret), the
  Linked Notes panel re-read a long note's links on every key (now at most
  every 1.5 s while it changes), the editor's style was read on every draw
  (now when the width, font or wrapping change), the line numbers' layer was
  as tall as the file, and the view state was written on every caret move
  (now at most every 2 s, and when the page is hidden).
- Tests: `editor-lazy-browser.py` (new: a 20,000-line file with a fence in
  the middle: a few hundred lines in the page; a key's work and time to the
  screen; the lines and numbers shown at the middle and the end; the fence
  highlighted across the page's edge; a caret out of view; Select All with
  copy, typing over and undo; an 8,900-line Shift-click selection deleted;
  find near the end; someone else's edit; word wrap off) and
  `editor-typing-browser.py` (the long chapter, now rendered lazily).

### v0.2.27: tabs from before v0.2.25 still get the new version

Found preparing the deploy. Browser only (and the release tool).

- **Open tabs of an older version would have kept it** (fixed before it
  shipped): versions up to 0.2.24 took over open tabs at once, and their
  pages have no "Update ready". A version that now waits would have stayed
  waiting behind them through every reload, until all the app's tabs were
  closed, while the server had moved on. Replacing a version from before
  0.2.25, a new one still takes over at once, as those pages expect; from
  then on, versions wait.
- **The desktop app's version**: the release tool now sets it with the
  app's (`desktop/package.json`), and checks it.
- Tests: `pwa-browser.py` (the app first served as 0.2.24, then this
  version replaces it without anyone clicking; it fails without the fix).

### v0.2.26: the desktop app

From the stability review (2026-10-21), O6. A new `desktop/` folder; in the
web app only Shell's update item and the Server URL field's hint change.

- **The app in a window of its own** (Electron, `desktop/`), from its own
  files, with no server needed: writing, diagrams, formulas, and the Agent
  and Chats with the user's own key (O3) work on their own.
- **One fixed origin**, `app://stilo/`: not `file://` (no origin of its own)
  and not a local port (a different one each start would lose the
  workspace and settings kept in the browser's storage).
- **No server unless one is named**: the server's addresses answer at once
  as offline (as the web app's service worker answered), so nothing waits;
  with a Server URL, the app talks to that server (it allows other origins).
- **Closing with unsaved work asks** (Leave or Stay); Electron otherwise
  keeps the window open without a word.
- **Links open in the system's browser** (or mail app) and the window only
  ever shows the app; the page gets no Node or Electron, only a bridge of
  three calls (its release, a newer one, that one's download page).
- **Updates**: the desktop app can't update itself as the web app does; it
  looks at the project's GitHub releases at start and every six hours, and
  "Update available" in the status bar opens the newer release's page.
- One instance (a second start shows the first's window); no service worker.
- Not done here: no build has been made or published (`npm run dist` needs
  npm, which the server does not have), nor signed; updates are downloaded
  by hand.
- A test that failed by chance (about one run in seven hundred):
  `openai-images.test.py` checked that no "b64" appeared in the agent's
  reply, and a random proposal id could contain it; it now looks for the
  image's data itself.
- Tests: `desktop.test.mjs` (new: what the window may load, the no-server
  answer, where links go, which releases are newer, that the build carries
  exactly the allowed files at the app's version, the bridge's three calls
  in an isolated, sandboxed window) and `desktop-browser.py` (new: the app
  in Electron 44 on a virtual display: loaded from `app://stilo/`, no
  server, nothing else served, no service worker; a formula and a diagram;
  a link and a navigation away open outside; a newer release shown and
  opened; closing with unsaved work asks, Stay keeps the window and Leave
  closes it; reopened, the work is there; a second start hands over).

### v0.2.25: the app installs, updates wait for you, and works offline whole

From the stability review (2026-10-21), O5. Browser, and one header on the server.

- **Not installable** (fixed): the app has a web app manifest (its name,
  a window of its own, its colours) and icons at 192 and 512 pixels, and a
  maskable one for Android's shapes, so browsers offer to install it.
- **An update could mix versions in an open tab** (fixed): a new version
  took over open tabs at once, while parts of the app load later (the
  Agent page, a diagram's editor), so a tab could run old and new code
  together. A new version now waits: an open tab keeps the version it
  started with (served from that version's own files, never the waiting
  one's), the status bar says **Update ready**, and Reload Window (or the
  item) starts it, keeping the work. With other windows open, they follow
  it (each reloads the same way). A plain reload keeps the version, as
  browsers do; closing every window of the app starts it too. New versions
  are looked for every half hour and when the page shows again.
- **Taking a new version could stall the tab** (found while testing this):
  the browser swaps versions only once the one in use has stopped; it asks
  it to stop as soon as it is idle only if it is running when the new one
  asks, and asks again only after it has handled another request from a
  page. A message to it is not enough (the browser may still count it as
  work), so a swap could wait for minutes, and a reload made meanwhile
  could hang the tab. Reload Window now asks for a small file through the
  version in use (it is then running), asks the new one to take over, and
  asks for the file again each second until the swap: about a second, a
  few right after the app started. If it still has not happened after 45 s
  it does not reload (it says so: close the other windows or try again).
  The server's requests go straight to the network now, not through the
  service worker (the server marks its replies never to be kept).
- **Formulas and diagrams needed the internet** (fixed): MathJax (unpinned
  `@3`) and Mermaid came from a CDN, so offline formulas and diagrams
  showed as code. Both are served with the app now, pinned (MathJax in
  `vendor/`, Mermaid in its extension's own `vendor/` folder; each file's
  SHA-256 checked by a test), fetched once when the app is first kept for
  offline use and kept across versions.
- Tests: `pwa-browser.py` (new: the app served for real with its service
  worker; the manifest and its icons' sizes; a formula and a diagram, and
  both again offline; a new version waits, says so, starts on Reload
  Window, another window follows, and Reload Window right after a reload
  starts it); `vendor.test.mjs` (new); `command-line.test.mjs` (a reload
  that declines leaves the page as it was); `backend-selftest.py` (a reply
  is never kept); `mermaid-browser.py`
  (offline, the library is the app's own).

### v0.2.24: typing in a long chapter keeps up

From the stability review (2026-10-21), O2, measured. Browser only.

- **Typing slowed with the size of the file** (fixed for long chapters):
  every key re-drew its line, measured the editor, put the caret back and
  worked out suggestions, each forcing the browser to lay out the whole
  editor; once a key took longer than the gap to the next, the app's full
  redraw ran between keys too, and it got worse quickly. Plain typing
  within a line (which the browser has already drawn) now only changes the
  text, its undo history and what is sent; the line's highlighting, the
  gutter, the caret's overlays and suggestions follow once typing pauses
  (90 ms), or every 0.4 s in a long burst. A new line, a paste or lines
  joined are drawn at once, as before. On an 89 KB chapter: a key's own
  work from about 225 ms to about 2 ms, and from key to screen from about
  0.75 s to under 0.1 s (two slow cores).
- **Less work when the app redraws**: the Linked Notes panel is rebuilt only
  when its links change (a chapter with a thousand links rebuilt it on every
  pause), and the active tab is scrolled into view only when it changes.
- **Reading the text and the caret**: from the lines as last drawn, reading
  again only the line that changed (every line was read on every key).
- A 450 KB file still lags (O2b).
- Tests: `editor-typing-browser.py` (a long chapter: a keystroke's own work
  stays under 40 ms, and the editor is drawn right on a pause).

### v0.2.23: edits made away from a cloud workspace are merged, file by file

From the stability review (2026-10-21), O4. Browser only.

- **Offline edits were all or nothing** (fixed): when a tab got back to a
  cloud workspace someone had changed meanwhile, the server's version opened
  and every edit made away went to Snapshots, even in files nobody else
  touched. Now each file is put together on its own: a file only this tab
  changed gets its edit; a file both changed is merged line by line where
  that is sure (changes to different lines); where both changed the same
  lines (or one inserted right at the other's change, or the file was
  removed meanwhile) this tab's text is kept in Snapshots, the other stands,
  and that is said. Also after a reload while the server could not be
  reached (what was done away is kept in this browser).
- **Files and places changed away**: files and folders made away are made;
  renames and moves are made again where they still fit; a deletion only of
  what nobody changed meanwhile (else it is left out, and said). These were
  dropped before.
- **Coming back unchanged could still lose edits**: with nobody else's
  changes, an offline session that both made a file and edited another sent
  the new file first and then edits based on the old revision, which the
  server refused, so they went to Snapshots. Text now goes first.
- Tests: `offline-merge-browser.py` (new, with a real backend: edits on
  different lines merged, a new file made, the same line kept in Snapshots
  and said, a reload while away); `offline-merge.test.mjs` and
  `sync-merge.test.mjs` (new: the merge's rules, a stand-in server; the
  line diff on every small pair of texts).

### v0.2.22: the Agent and Chats with your own key run in this browser, no server needed

From the stability review (2026-10-21), O3, found by an experiment. Browser
and server.

- **The Agent with the user's own key needed the server** (fixed): it sent
  its request and the key through the server's `/api/chat`, so without a
  server it failed ("Failed to fetch"), though its status said ready. With
  **My own API key** and **Replies run → Directly from this browser**
  (Settings → Agent), the Agent now runs in this browser and calls the
  user's endpoint itself: the same instructions, manual, tools and limits as
  the server's agent, streamed (with a reasoning model's thinking), its
  proposals reviewed with Keep / Drop as before. Connected tools and
  pictures still need the server.
- **Chats' replies "in this browser" asked the server for the prompt first**
  (fixed): a character's request is now built in this browser, as the
  server builds it (the sheet, its author's notes only as hints and only
  when the sheet allows, the cast, the transcript, what characters may read,
  read-only tools), so a browser-only workspace's characters answer with no
  server. The server's stateless `/api/chat/prompt` is gone (a tab still on
  an older version needs a reload for its direct replies).
- **The status says where replies run, and is honest**: "Ready — your own
  endpoint, called from this browser"; with the key sent through a server
  that can't be reached, it says so and how to work without it, instead of
  "ready".
- **One description of the agent for both**: its tools, limits and
  instructions are now `protocol/agent.json`, read by the server and copied
  for the browser; the browser's tool runner, its first request and a
  character's request are twins of the server's, each with a shared case
  table both languages run.
- Tests: `agent-here-browser.py` (new: no server, a stand-in model on another
  origin; a turn reads, proposes and answers; Keep; the status through an
  unreachable server; a character's reply in Chats); `agent-tools.test.mjs`
  (new) and `assistant-edits.test.py` run `spec/assistant/tools.cases.json`
  and `spec/assistant/request.cases.json`; `reply-request.test.mjs` (new)
  and `persona-chat.test.py` run `spec/characters/reply-request.cases.json`.

### v0.2.21: two windows on one workspace are live in both

From the stability review (2026-10-21), O1, found by an experiment;
decided "Live in both". Browser only.

- **Two windows on one of this browser's workspaces overwrote each other**
  (fixed; O1): each saved its own copy, the later save won, the other
  window's edit was lost, and neither saw the other's. Now they are linked:
  what is typed or changed in one shows in the others at once (typing in
  one file in both at once ends the same in both, as with two devices on a
  cloud workspace).
- **One window keeps the workspace**: the one that opened it first puts the
  windows' edits in order and alone writes this browser's copy (and its
  folder, for a project on this device); the others send it their changes,
  and their changed marks clear once it has saved them. When it closes (or
  crashes), the next window takes over where it stopped, and a new or
  reloaded window joins whichever keeps it.
- **A window alone starts nothing**: its link starts when another window
  opens the same workspace, so a single window works as before.
- **A window joining always gets what the keeping window shows**: should a
  change ever reach that window other than through the link, the link
  starts again from its copy and the other windows reload it, rather than a
  joining window (or one taking over) taking older text.
- The status bar says "2 windows" while they are linked, and warns when a
  window has waited a while for the one that keeps the workspace (its
  changes then stay marked as unsaved).
- Reload Window waits for this window's changes to reach the one that keeps
  the workspace, and says when they haven't.
- **A journal could bring older text back** (since v0.2.19): what changed
  is journaled as a page hides, and the journal stayed after the next save,
  so after a crash the next load laid its older text over newer. A journal
  now goes once a save that began after it lands; a window that takes over
  a workspace drops the journal of the one that went (it holds more).
- A browser that never answers for the lock that links windows leaves the
  window unlinked after 3 s (it saves its own copy, as before).
- Tests: `linked-windows-browser.py` (new: typing both ways, both in one
  file at once, a new file, only the first window writing the copy, the
  first closing and the other taking over, a third and a reloaded window
  joining, the experiment's edit in each window); `tab-link.test.mjs` (new:
  two production runtimes over a real BroadcastChannel, a crash and a
  takeover, a change that bypassed the link); `browser-copy-browser.py` (a journal goes once a later save
  lands); `sync-broker.test.mjs` (new: the broker's order and refusals,
  a follower's copy, the rebase log answering as the server's does).

### v0.2.20: a copy per workspace; the own workspace is never lost to a shared one

From the stability review (2026-10-21), O7, found by an experiment. Browser only.

- **Joining a shared session, then reloading, lost the in-browser workspace**
  (fixed; O7): this browser kept one copy, which after joining was the
  shared workspace's, and the one kept aside to come back to lived only in
  memory, so after a reload switching back showed the wrong workspace and
  the in-browser one was gone. Now each workspace has its own copy in this
  browser (the in-browser one, and each shared or cloud workspace's), so
  none is written over another's; switching back (◑ Private), leaving a
  cloud workspace or signing out brings the own workspace back as it was
  last saved, after a reload too.
- **Switched to Private, the host's changes replaced the guest's own
  workspace on screen**: a guest who switched to their own workspace (◑
  Private) stays in the session, and the host's next change was applied to
  the workspace on screen, or (not fitting it) replaced it with the
  host's. The shared workspace's changes now stay off the screen until the
  guest switches back, which loads it afresh.
- **A switch to Private during a rejoin stands**: a page reopened on a
  shared workspace rejoins it in the background; switching to the own
  workspace meanwhile was undone when the session arrived.
- **A guest kept the wrong workspace aside**: a guest's own project was
  replaced by the host's as it connected, and the host's was then kept aside
  as if it were theirs. The project from before the connect is kept now.
- **A page that opens on a shared workspace stays on it while it rejoins**:
  connecting starts by saying "offline", which was taken for a dropped
  session and switched to the own workspace mid-rejoin; only a session that
  was there can drop now. Such a page is shared (not yet connected) from the
  start, so its files are never taken for the own workspace's, and nothing
  is marked saved until the server confirms it.
- **A copy that names something it lacks still opens** (the file it shows,
  a child): it opened to a blank page with "Node not found" before.
- **The file shown is kept as the page goes**: the journal kept only
  changed files, so switching files just before closing could reopen on the
  previous one; and a page that changed nothing since it opened journals
  nothing (it wrote the whole workspace, which fails past ~5 MB).
- **A cloud workspace's id on an own copy is dropped**: a page that opens
  this browser's own workspace is no cloud workspace's copy, so reopening
  the cloud workspace pulls it instead of pushing these files into it.
- **Reset and Empty Everything in one window**: other open windows of the
  app reload too, writing nothing back (before, a window left open could
  save its workspace over the emptied one).
- The "Connect to Server?" dialog is now "Join the Shared Session?" and says
  what happens: the host's workspace opens in place of yours, which stays in
  this browser.
- Moved over once: v0.2.19's copy and its journal (as this browser's own
  workspace, or as a shared one's when a session was open then).
- The welcome page still offers Resume while a page on a cloud workspace
  waits offline to reconnect.
- Tests: `own-workspace-browser.py` (new, with a real backend: a guest's
  own copy untouched beside the shared one, typing reaching the server and
  only the shared copy, the host's later change kept off the own workspace
  while Private, switching back without and after reloads);
  `browser-copy-browser.py` (v0.2.19's copy moved over and repaired, the
  file shown journaled, nothing journaled when nothing changed, a new
  project a copy of its own, another window following Reset).

### v0.2.19: this browser's copy in IndexedDB; a failing save said

From the stability review (2026-10-21), found by an experiment. Browser only.

- **Work stopped being saved past ~5 MB** (fixed; O0): the in-browser
  workspace lived in localStorage, which holds about 5 MB per site; once the
  workspace passed it (a few pasted images), nothing was saved any more,
  only logged, and a reload lost the large file and every edit after it. The
  copy now lives in IndexedDB (no such limit), a record per file: a save
  writes only what changed. An older copy is moved over once.
- **A save that fails is said**: a notice the first time, and a red "Not
  saved in this browser" item in the status bar while it lasts (it explains
  and tries again with each change); "Saved in this browser again" once a
  save works.
- **Kept as the page goes**: an IndexedDB write begun as a tab closes may
  never land, so what changed since the last save is also written at once to
  a small journal (localStorage) and applied on the next load.
- **The browser is asked to keep the data** (`navigator.storage.persist()`)
  once something is saved, so it isn't cleared under storage pressure.
- Reset to Default Workspace and Empty Everything leave no older copy behind
  (Shell notes when the app's storage was cleared; Workspace drops a copy
  saved before).
- Tests: `browser-copy-browser.py` (moved over once, a workspace past 5 MB
  saved and reloaded, a failing write said and kept marked, journaled as the
  page goes, saving again said, Reset and Empty Everything);
  `url-album-browser.py` reads the stored copy through `helpers/browser_copy.py`.

### v0.2.18: the diagram's inspector floats

Decided 2026-10-21 ("Float over it"): in edit mode the inspector took a
fixed 320 px column beside the diagram, even with nothing selected, which
left a narrow pane's diagram a sliver (about 100 px with the Agent panel
open). Browser only.

- **The diagram keeps its width**: the inspector floats over its right side
  only while a node or connector is selected (or the diagram has errors to
  list); its × folds it to a tab at the edge, Escape closes it; the zoom and
  edit buttons step to its left while it is open. The editing tips moved
  behind a ? button. On a phone it still docks under the diagram.
- Tests: `shell-browser.py` (no inspector with nothing selected; selected,
  it floats and the diagram keeps its width; Escape closes it).

### v0.2.17: file icons, a quieter status bar, a diagram click that changed the file

Asked for 2026-10-21 (file icons; the status bar quieter, its information
still there when it isn't 0). Browser only.

- **File icons**: each file type has its own icon in the explorer and on its
  tabs (Markdown's M↓, a tree for module maps, a person for characters, a
  picture for images and album entries, a diagram, Mermaid's branches, an
  HTML page's </>, an album's pictures, folders open and closed), in its
  own colour, instead of two or three letters in a box. An extension draws
  its own type's icon in its own stylesheet; images have their own icon
  class (`is-image`).
- **A quieter status bar**: "0 collaborators online", a file's "v0.0.0" (no
  snapshot, sitting or edit yet) and "Chromium directory access available"
  are no news and no longer show; the collaborators and the version show
  once there are some, and a browser that can't edit folders in place says
  so. The rest stays where it was.
- **A click on a diagram node changed the file** (fixed): in edit mode,
  pressing and releasing on a node without moving it saved the whole
  diagram, which writes every node's size in its own form (`width: 240px`
  became `width: 240` and `height: 90` was added) and marked the file
  changed. A move or a resize now saves only when something moved.
- Tests: `shell-browser.py` (the quiet items; a click on a node saves
  nothing, a drag moves it).

### v0.2.16: menus and tabs

Part of the polish decided 2026-10-20 ("Menus and tabs"). Browser only.

- **The explorer's menus are grouped**: a line between opening, the
  clipboard, a new folder, new files, adding a file, renaming and deleting,
  and exporting (a file type's own entries, such as a diagram's Export As,
  join their group, or come last). The menu bar had them since v0.2.11; the
  tab menu already had them.
- **A tab's × shows on the active tab and on hover** (its place is kept, so
  tabs don't shift); an unsaved tab shows its dot there instead, and the ×
  when hovered, as in VS Code.
- Tests: `shell-browser.py` (the explorer menu's groups), `tab-menu-browser.py`
  (the ×, the dot, on hover).

### v0.2.15: dialogs that say what they ask

Part of the polish decided 2026-10-20 ("Dialogs"). Browser only.

- **A question is the dialog's title**: "Delete welcome.md?" instead of
  CONFIRM / Confirm Action with the question in small grey text; what more
  it has to say is the text under it. A notice is titled by its first
  sentence (they were all "Message"). The fixed eyebrows (Confirm, Notice,
  Rename) are gone, and a message that only repeated its title.
- **Buttons say what they do and look it**: Delete, Restore, Bring Back,
  Rename, Add… instead of Confirm and Save; the one that does it is the
  highlighted one, and red when it destroys something (deleting a file, a
  snapshot, a conversation, for good from the Trash; Reset to Default
  Workspace; Empty Everything). Each theme's red keeps 4.5:1 with its text
  (the themes test checks it).
- **Rename Selected kept the extension in the field** (fixed): it passed it
  under another name than the dialog reads, so `welcome.md` could be renamed
  to `welcome` by accident. Both renames keep it out now, and the box says
  which: "Keep .md at the end". Its row was laid out on two lines.
- Tests: `dialogs.test.mjs` (a question split into title and message),
  `themes.test.mjs` (the red's contrast), `shell-browser.py` (rename's
  words, Rename Selected's extension, delete's title and red Delete);
  `url-album-browser.py`, `workspace-history-browser.py` and
  `trash-browser.py` read the whole question. `identity-browser.py`'s
  reloads wait for the page, not for the network to go quiet (a slow request
  elsewhere once held that past 30 s); the app's own state is waited for next.

### v0.2.14: small things that were wrong

Found looking for polish after v0.2.13 (2026-10-20). Browser only.

- **Toasts were unreadable in Light**: white text on a light grey pill
  (since before the themes). A toast is now the theme turned over, readable
  on all seven. Opening a file no longer shows an "Opened …" toast (it was
  on every open; the file opening says so).
- **A pane's active tab could sit off-screen**: its strip was scrolled by
  the tab's place in the whole header, the group's label included (wider
  since v0.2.13), and not again when the strip narrowed. It is measured in
  the strip and kept in view as the strip resizes; a tab wider than the
  strip shows its name rather than its ×.
- An empty pane said "No preview file selected" whatever it showed: now
  "No file open".
- **A diagram opened cut off**: it started at 100% from the top-left. A
  fresh open now fits it to its pane (zoomed out to at most 50%, a bigger
  one showing its top-left part), and fits again as the pane resizes until
  you pan or zoom (its side panel opening had narrowed it after the fit);
  a diagram looked at before still opens where it was left. ⊡ fits it
  (it reset to the top-left). The fitting is its own small model
  (`extensions/bmap-diagram/browser/model/fit.js`); the view file got
  smaller.
- A diagram's status (top right) was white text: invisible in light themes.
- Tests: `bmap-service.test.mjs` (the fit), `tab-menu-browser.py` (the
  active tab in view in a narrow window), `themes-browser.py` (a toast's
  colours), `shell-browser.py` (a diagram fitted, its status readable).

### v0.2.13: a group's label switches its view

Asked for 2026-10-20: since either pane can show either view, its fixed
SOURCE / PREVIEW label should say what it shows and switch it. Browser only.

- **Each pane's label** says what it is doing with which file: EDITING (or
  READING, when the file can't be changed) or PREVIEWING over the file's
  name; VIEWING for History's comparison. Its ▾ opens Source and Preview,
  the current one ticked (a file with one view can't switch): the file
  switches in the same pane, as Open as… in a tab's menu does.
- Tests: `tab-menu-browser.py` (the label's words, its menu, both ways).

### v0.2.12: the Settings dialog

Part of the UI polish (2026-10-20: "Settings dialog"). Browser only.

- **Settings → Appearance** reads like an editor's settings: one row per
  setting, its name on the left and its control on the right, a line between
  rows, no box around the page; the theme cards head it. On the phone the
  rows stay side by side, the control taking at most half the width.
- **Inputs and lists show their edges** throughout Settings (they had none,
  white on a near-white page).
- Buttons on the accent colour take the theme's text colour for it (High
  Contrast's is black on orange; they were always white).
- Tests: `shell-browser.py` (a field's control at its row's right end).
  `phone-log-sheet-browser.py` reads the sheet once it stands still, not
  after a fixed 400 ms (on a busy machine its slide was once still going);
  `editor-typing-browser.py` allows one redraw per pause over 250 ms between
  keys (on a saturated machine keys came 400–600 ms apart, and each such
  pause rightly lets a waiting redraw through). Typing measured as fast as
  v0.2.7's (70–100 ms a key here, against 75–125).

### v0.2.11: the frame's chrome

Part of the UI polish (2026-10-20: chrome, and the top bar). Browser only.

- **Icons**: the activity bar's Explorer, Chat and Settings are icons (they
  were the characters ≡, AI and ⋯); the explorer's + is an icon too, and the
  stray accent mark at the bottom of the activity bar is gone.
- **Buttons without boxes**: the explorer's and the Log's buttons are plain
  until hovered, as in VS Code.
- **Menus** show a command's shortcut (File → Save, Ctrl+S; View → Run
  Command…, F1) and a line between groups: File's open / import / save /
  export, Edit's find / history / selection, View's panels / Run Command…,
  Settings' settings / Reload Window / the reset commands.
- **The top bar** names the app once (it said "Stilo Marker, a Markdown
  workspace", "Stilo Marker" and "Markdown IDE").
- **Fonts**: each system's own (San Francisco on Apple, Segoe UI on
  Windows, Noto or Liberation Sans on Linux; before, Apple and Linux fell
  back to Tahoma or a default), and a code font each has.
- Thin scrollbars in the theme's colours; a file's row in the explorer no
  longer shows a dot where a folder has its arrow.
- Tests: `shell-browser.py` (the menus' groups and Save's shortcut),
  `shell-module.test.mjs` (each item's group and shortcut).

### v0.2.10: Markdown's missing syntax, and spaces kept after a list marker

Part of the UI polish (2026-10-20, "fix what's broken"). Browser only.

- **Spaces typed after a list marker were lost** (fixed): the editor drew
  `-   item` as `- item`, and the next keystroke saved what it drew, so
  extra spaces after a list's dash vanished as you typed. Every highlighted
  line now shows exactly its text (a test checks it line by line).
- **Lists the preview did not draw** (fixed; the manual already listed
  them): numbered lists, nested items, `*` and `+` bullets and task lists
  showed as plain lines. Now numbered lists count from their first number,
  indented items nest, `- [ ]` / `- [x]` show boxes in the theme's colours.
- Also new in the preview: rules (`---`, `***`, `___`), `~~strikethrough~~`,
  footnotes (a number with the note on hover, the notes listed at the end;
  before, a footnote became a broken link), code fences indented under a
  list item, and a cleaner page: headings, spacing, quotes and table headers.
- Tests: `markdown-syntax.test.mjs` (lists, tasks, rules, indented fences,
  strikethrough, footnotes; every highlighted line drawn as typed). The
  phone tests' swipes and flicks now carry their own times, 16 ms apart, as a
  real touch carries the input's: a made-up touch was stamped when made, late
  whenever the page was busy with the one before, so on a loaded machine a
  flick read as a slow drag (the Log sheet's test failed once in the gate,
  and every time with the CPU slowed sixfold).

### v0.2.9: themes

Asked for 2026-10-20 (a better UI, and themes; decided: Paper, Midnight,
Forest and High Contrast, built in, from an extension). Browser only.

- **Themes**: Settings → Appearance → Theme shows System, Light, Dark,
  Paper, Midnight, Forest and High Contrast as cards in their own colours;
  a click applies one at once and it is kept. Change Theme… (the Log's
  command line) opens them. The four new ones come from an extension
  (`extensions/theme-pack/`, data only): adding a theme is one entry there.
- **Light was hard to read in the editor** (fixed): its syntax colours were
  Dark's, so bold text was pale yellow and emphasis pale blue on white, and
  the Diagram, HTML, Mermaid and album highlighters were the same (a
  diagram's values pale grey). Each theme now has its own syntax colours,
  and every highlighter uses them.
- **Preview links** take the theme's link colour, not the browser's blue and
  purple.
- **No flash of Light on load** with a dark theme: the theme last shown is
  applied before the app's code runs.
- Tests: `themes.test.mjs` (the tokens, Light and Dark as styles.css draws
  them, the contributed themes, every theme's contrast: text, links and
  every syntax colour against the editor), `themes-browser.py` (a card
  applies its theme, kept across a reload, shown with the app's code
  blocked, System follows the device); `shell-browser.py` picks themes from
  the cards.

### v0.2.8: the Log's command line, and Reload Window

Asked for 2026-10-20: commands typed in the Log with suggestions, and a
reload for a page that seems stuck which, unlike the browser's, can't lose
work. Browser only.

- **A command line under the Log**: type part of a command's name and pick
  it (↑ ↓, Enter, Tab completes, Esc closes then clears). Nothing typed lists
  every command, Reload Window first; `help` writes them all in the log; an
  unknown command says so and stays in the line to be put right. Run
  Command… (View menu, `F1`) opens the Log with the line ready, on the phone
  in its sheet. Rename File, which needs to be told which file, is not
  offered.
- **Reload Window** (the command line, or Settings → Reload Window) keeps
  the work, then reloads: the shared workspace's typing confirmed by the
  server (it waits up to 5 s), the files written to this browser and a local
  project's folder, the open tabs and the caret. No "Leave site?" question,
  which a plain reload of a page with unsaved changes asks. When something
  can't be kept (typing the server has not confirmed, a folder on disk with
  unsaved files, the Agent still answering) it says what and asks; staying
  reloads nothing.
- Tests: `command-line.test.mjs` (finding commands, keywords, Reload
  Window's steps, problems and time limit), `project-save.test.mjs`
  (Workspace's step: written now, or what could not be), `log-commands-browser.py` (the
  line on the desktop and the phone; a plain reload asks, Reload Window
  doesn't and brings back the edit, the file and the caret; a problem asks
  first); `shell-browser.py` counts the two new menu items.

### v0.2.7: the open issues

The last of the plans on paper (decided 2026-10-20). A server change too (a
restart on deploy).

- **Typing in a URL album entry no longer jumps the caret** (was open item
  3). Clicking an entry in the explorer redrew the app with the project as it
  was before the click, which told the editor another file was shown; the
  next redraw, which a slow machine delays into typing, reloaded the entry
  with the caret at the start, so the rest of the typing went in front of
  `url =` and the entry was saved without its link. The Explorer now draws
  the project as it is, and the editor always draws from the current
  project, whatever it is handed. Found with a trace of every caret move
  under a sixfold-slowed CPU.
- Also in an album entry: a pause after typing a space no longer eats the
  space. Writing the entry back trims a trailing space, and the editor was
  rewritten to match; now the text as typed stays when it means the same.
- **An unreadable access file locks its project** (was open item 5): nobody
  may open it until it is repaired or restored, and the message says to ask
  the server's admin (the server log names the file). Before, the project
  opened to its whole team.
- **An unreadable comments file, or History's index, is set aside** before a
  new one is written (was open item 4): kept as
  `<name>.unreadable-<time>.json` and named in the server log. Before, the
  next comment replaced it.
- Restart recovery and the snapshot migration's residual risk (open items 1
  and 2) are accepted, with the reasons, under Accepted.
- Tests: `projects.test.py` (a locked project, repaired), `comments.test.py`
  and `history.test.py` (set aside, kept), `url-album-browser.py` (a pause
  after a space; its waits now grow with `STILO_CPU_SLOWDOWN`).

### v0.2.6: two previews side by side

Editor groups, stage 2 (decided 2026-10-20: several previews, still one
source editor).

- When both groups show a preview tab, each shows its own preview: a note on
  one side and a diagram (or another note) on the other. Before, the second
  group showed a placeholder. Two Source tabs at once still share the one
  source editor (its placeholder, with Show here).
- A diagram in the second preview has a diagram editor of its own.
- Links in either preview open their file.
- On the phone nothing changes: one view at a time.
- Tests: `tab-menu-browser.py` (two previews, the preview taken back) and
  `editor-groups-browser.py` (a diagram in a second preview).

### v0.2.5: panels dragged between areas

- A panel's tab (side panel, bottom panel) or its section title (left
  sidebar) can be dragged onto another area: the area is outlined while it
  is over it, and dropping moves the panel there, as Move to… does.
- Tests: `area-pages-browser.py` drags a section onto the side panel and a
  tab onto the sidebar, and back.

### v0.2.4: Diagrams wholly an extension

Nothing on screen changed (the diagram editor compared pixel for pixel), but
for one name. A server change too (a restart on deploy).

- Everything about diagrams (`.bmap`) now lives in their extension folder:
  the file type, the two settings, and the styles (1,230 lines moved out of
  the app's stylesheet, in the same order). The core no longer names them.
- The file type's name in lists is "Brainstorm Diagram" (Create still says
  New Diagram), apart from Mermaid's diagrams.
- On the phone, an element that keeps its own drags (the diagram editor)
  says so with an attribute any extension can use.
- Quick Generate sends the map's overview as a named context; the server
  takes any such overview. A page from before this release still generates,
  without the map's overview.
- Tests: `openai-images.test.py` (the named overview, on the route and in
  the generator's instructions).

### v0.2.3: settings an extension contributes

Groundwork for moving Diagrams wholly into their extension; nothing on
screen changed.

- An extension's manifest can declare its settings (key, default, and the
  field Settings shows). The app knows their defaults and shows their fields
  before any extension code runs; the core no longer holds an extension's
  defaults. The Diagram's two settings (Bmap Generate Context, Auto-pan) are
  the first.
- Tests: `file-types.test.mjs` checks the contributed settings.

### v0.2.2: static HTML pages

The second extension decided on 2026-10-20. A server change too (a restart
on deploy).

- `.html` (and `.htm`) files: web pages kept in the workspace. Their source
  is highlighted, opening one shows the page in the preview, Create → New
  HTML Page starts one, and the formatting toolbar offers a section, an image
  and a link.
- The preview is a sandboxed frame: the page's own styles and scripts run,
  in an origin of their own, with no reach into the app, the account, the
  browser's storage or the workspace, and no popups. A relative image of the
  workspace is embedded as data, so a cloud workspace's image address (which
  carries your session's token) never reaches the page.
- Hardened, and older than pages: a file the server answers with (a
  workspace's image, now a page, an export) carries `Content-Security-Policy:
  sandbox` and `X-Content-Type-Options: nosniff`, so opened on its own (its
  address in a tab) it never runs as the app. Before, an SVG with a script,
  opened that way, could have.
- The manual has an HTML pages section (8; the later ones moved down by one).
- Tests: `html-page.test.mjs`, `html-page-browser.py`, and in `sync.test.py`
  a page and an SVG served sandboxed.

### v0.2.1: Mermaid diagrams

The first of the two extensions decided on 2026-10-20 (Mermaid, then static
HTML pages).

- A ```` ```mermaid ```` block in a note is drawn as its diagram in the
  preview; Copy still copies its code. Other code blocks are unchanged.
- `.mmd` (and `.mermaid`) files: Mermaid diagrams as files. Their source is
  highlighted, opening one shows the diagram in the preview, Create → New
  Mermaid Diagram starts one, and the formatting toolbar offers a flowchart,
  a sequence diagram and a mind map.
- A diagram with a mistake keeps its code, with Mermaid's reason above it.
- The Mermaid library (11.17.2) loads from jsDelivr the first time a diagram
  shows, in strict mode (no scripts or click handlers in labels); offline,
  diagrams show as code.
- The manual has a Mermaid section (7; the later ones moved down by one), so
  the Agent knows it can write them.
- Tests: `mermaid.test.mjs` (the fence's language, the highlighting, the
  loader) and `mermaid-browser.py` (a note's block, a `.mmd` file, a broken
  diagram, offline).

### v0.2.0: Source and Preview half and half

A new minor version: since v0.1.60 the app has been rebuilt on a small
kernel and modules, in the browser and on the server (the restructure), and
step 5 added editor groups (a tab is a file shown as Source or Preview, in
either of two groups), the phone's drawers and sheet, and panels that move
between the left, right and bottom areas. This release:

- Source and Preview split the editor half and half until the splitter is
  dragged, and stay even when the side panel or the Log opens or the window
  narrows (the preview keeps at least 280 px, or half when the editor is
  narrower). Before, opening the side panel at 1400 px squeezed the source
  to 108 px, because the preview's width was measured before the panel took
  its space; and the start gave about 744/320 instead of half and half.
- A dragged width stays; a double-click on the splitter gives the even split
  back.
- New browser test: `editor-split-browser.py`.

### v0.1.101: pages move between the areas

Step 5k. On the desktop (the phone's drawers show what is placed in them).

- Right-click a section's header in the left area, or a tab in the side
  panel or the bottom area: **Move to Left / Right / Bottom**. A section
  moved to the side panel or the bottom becomes a tab, its toolbar (the
  Session's connection label, the Log's filters) in that area's header; a tab
  moved to the left becomes a section. The area it went to shows it, and an
  area left with no page says how to fill it.
- The places are kept (over a reload); moving a page back home forgets it.
- The Agent page now loads when the area holding it shows, wherever that is.
- Drags on the phone measure their speed over the last tenth of a second,
  so touch events arriving in a bunch no longer count as a flick (the sheet
  test failed once under load from this).
- New browser test: `area-pages-browser.py`. Found while testing, older than
  this work: the side panel squeezed the source pane (fixed in v0.2.0).

### v0.1.100: the areas are hosts

Step 5j. Groundwork for moving pages between areas; one visible change.

- The bottom area's header is one row now: the LOG tab, the Log's filters,
  Copy and Clear, and the area's ×. It was two rows (a LOG title over the
  filters). On the phone the Log's toolbar sits on a second row of the sheet.
- Linked Notes and Session are now pages of the left area, drawn by the app
  as sections; they look and behave as before (collapsed per section, kept).
- New pages can be added to the left area (as sections), the side panel and
  the bottom area (as tabs) the same way.

### v0.1.99: the editor groups are kept

Step 5i. Cloud workspaces; the server changed too (a restart on deploy).

- Which tabs each group holds, and which one it shows, are saved with the
  workspace's open tabs: on the server (per account) and in this browser.
- A reload brings back the tabs and groups as you left them. Before, a
  reload kept only the active file, because the freshly started page's one
  tab won over what was saved. Opening the workspace on another device
  brings back what the server kept.
- Tabs saved before groups still come back, as source tabs.
- Tests: `projects.test.py` (the groups kept, cleaned and capped),
  `editor-view.test.mjs` (kept by path and restored), and the new
  `groups-resume-browser.py` (restored from the server, saved again, back
  after a reload).

### v0.1.98: editor groups come and go

Step 5h. On the desktop.

- A tab's menu has **Move to Other Group** and **Open to the Side**, and a
  tab can be dragged onto the other group's tabs. The source editor or the
  preview follows the tab.
- When a group's last tab closes, the group closes and the other takes the
  width, holding both the source editor and the preview, so the next file
  opened from the explorer shows there. View → Toggle Source / Toggle
  Preview brings the group back. Hiding a group with its × keeps its tabs,
  as before.
- Fixed, older than groups: with the other pane hidden, a pane's header
  wrapped its × onto a second row.
- New browser test: `editor-groups-browser.py`.

### v0.1.97: editor groups: Open as in the same group

Step 5g. On the desktop; the default layout looks the same.

- The source and preview panes are now two groups of tabs. "Open as Source"
  or "Open as Preview" in a tab's menu opens the file that way in the same
  group: the source editor or the preview moves there, and the group's tabs
  say which view each is when it holds both.
- There is still one source editor and one preview. When the other group was
  showing the one that moved, it keeps its tab and says where it went, with
  **Show here** to take it back.
- Each group's label (SOURCE, PREVIEW) names what it shows.
- A file dropped on a group opens in the view that group shows.
- On the phone nothing changes: Source and Preview still show one at a time.
- Tests: `tab-menu-browser.py` checks Open as in the same group, the
  placeholder, Show here, and the phone with a mixed group;
  `editor-view.test.mjs` checks `activate` and moving tabs of both views.

### v0.1.96: editor groups, the model

Step 5f. Nothing on screen changed.

- The editor now keeps its tabs as groups (left and right), a tab being a
  file in a view (Source or Preview), as the first stage of editor groups.
  Today's layout is the default: the source tabs on the left, the preview
  tabs on the right.
- Tests: `editor-view.test.mjs` checks the groups (the default layout, which
  group holds each view, the active tabs after closing and after the project
  changed).

### v0.1.95: the phone's sheet and edge swipes, as decided

Step 5e. On the phone only.

- The Log's sheet opens over the lower half of the screen. Dragging its
  header up gives it the full height (below the top bar); a flick moves it
  one step (half, full, half, closed), and a slow drag settles at the nearest
  height. It opens at half each time.
- The explorer and chat drawers open with a swipe that starts 24–64 px in
  from their side, no longer at the very edge, where Android and iOS take a
  swipe as Back. A swipe starting in the outer 24 px does nothing in the app.
- Tests: `phone-log-sheet-browser.py` checks the heights;
  `mobile-navigation-browser.py` checks the edge band.

### v0.1.94: on the phone, the Log is a sheet from the bottom

Step 5d. On the phone only; the desktop looks the same.

- View → Toggle Log opens the Log as a sheet from the bottom, over the note.
  Its ×, a tap above it, or a drag down on its header closes it, as does
  opening the explorer, the chat or a menu.
- The Log no longer squeezes the note on the phone when the desktop shows it,
  and opening it on the phone leaves the desktop's setting alone. It shows
  the log even when the desktop hides it (it drew only while that setting
  was on).
- The explorer, chat and Log drawers share one piece of code.
- New browser test: `phone-log-sheet-browser.py`.

### v0.1.93: on the phone, the chat is a drawer from the right

Step 5c. On the phone only; the desktop looks the same.

- The chat button opens the Agent and Chats as a drawer from the right, about
  85% of the width, so the note still shows at its left; it takes the whole
  width while you type in it. A swipe from the right edge opens it too.
- A tap on the note, a drag to the right, its › button, or opening the
  explorer, the menu or the file list closes it. The file and its view stay
  as they were underneath.
- Swiping between panes is only Source ↔ Preview now; the chat is no longer
  a third pane.
- View → Show/Hide Chat names the drawer's state on the phone (it named the
  desktop setting).
- Tests: `mobile-navigation-browser.py` and `phone-views-browser.py` check
  the drawer.

### v0.1.92: a tab's menu

Step 5b. On the desktop.

- Right-click a tab: Close, Close Others, Close to the Right, Close All;
  Open as Source or Preview (the file in the other pane, which shows again
  if it was hidden; the tab's own view is ticked); Copy Path. History's diff
  tab offers Close.
- New browser test: `tab-menu-browser.py`.

### v0.1.91: on the phone, Source and Preview are one file's two views

Step 5a. On the phone only; the desktop looks the same.

- The top bar names the file on screen. Tap the name for the list of open
  files, with Rename first (the pen is gone). One switch replaces the Source
  and Preview buttons: it shows the same file in its other view, and hides
  when a file has only one (a module tree has no preview).
- Switching, or swiping between Source and Preview, keeps the file: Preview
  of one file and Source of another can no longer be mixed up. A file picked
  in the explorer drawer shows in the view on screen.
- New browser test: `phone-views-browser.py`.

### v0.1.90: a first visit's preview shows the welcome file

Found while starting step 5; old (v0.1.60 had it too).

- On a first visit, the source editor showed the welcome file but the
  preview said "No preview file selected" (on the phone, Preview stayed
  empty) until the first edit or a reload. The welcome template replaces the
  starting project, and the app drew it before the editor had switched its
  view to the new project; nothing drew again. It draws again now. A new
  browser test (`first-visit-browser.py`) visits with nothing kept, on a
  desktop and a phone.

### v0.1.89: an ended session is refused, not a storage failure

Found while checking the v0.1.88 deploy; wrong since v0.1.41.

- A request with a session token that is no longer valid (the session ended,
  or the server restarted) to the project's state or a change was answered
  503 "Workspace storage is unavailable", and the server logged a storage
  failure. It is now 403. The browser treated both the same way (it keeps
  the typing and reconnects), so nothing changes on screen; the server's
  log and the answer now say what happened. The agent's shared
  conversations had the same mistake (since v0.1.87). Both are covered by
  tests over HTTP.

### v0.1.88: the server's entry only starts the modules

Step S4s-6, the last of the server's restructure. Nothing changes for users.

- `server/mdnotes_server.py` (2,577 lines at v0.1.82) is now 123: it reads
  the command line and environment, starts the server's modules and
  listens. Serving the app's files (and never the server's own) and the
  server's ping are the Transport module's; what the ping says about
  accounts and sync comes from those modules.

### v0.1.87: the agent is the server Assistant's

Step S4s-5. Nothing changes for users.

- The workspace agent on the server (a turn of the assistant, a character's
  reply in Chats, Quick Generate, generated images, connected tools, the
  agent's shared conversations) is the Assistant module, split by job, with
  its routes listed in its own contract. The old server file now holds only
  the start-up and the static files (347 lines, from 2,577 at v0.1.82).
- When the agent makes a picture, the file types it may save it as come
  from File types, so the tool's hint to the model now lists .jpeg too.
- A mistake of mine in the script that ran the server's tests reported
  every Python suite as passing for v0.1.84 to v0.1.86. In fact three test
  cases failed there, all of them in the tests themselves (leftovers of the
  v0.1.84 test rewrite: an old name for a session's leases, and one lookup
  the rewrite missed), not in the server. They are fixed, and the runner
  now reports real results.

### v0.1.86: the server's Cloud module

Step S4s-4. Nothing changes for users.

- Making, deleting (into the trash), exporting and importing a project on
  the server are a module of their own (Cloud), the server half of the
  browser's file browser. Exporting and importing now have a test, with an
  image travelling inside the copy.
- What the server does now and then (closing quiet sessions and replies,
  the backup sweep) and the last backup when it stops are each module's
  own, run by the kernel.

### v0.1.85: History, Comments and Chats start themselves on the server

Step S4s-3. Nothing changes for users.

- On the server, snapshots and backups, line comments and chats each set
  themselves up when the server starts, and hear about changes in a live
  project from the Sync module, instead of being wired together by hand in
  the old server file.

### v0.1.84: what is open now is the server's Sync

Step S4s-2. Nothing changes for users.

- The server's list of open workspaces, session tokens, joining by PIN,
  hosting for guests and closing quiet sessions are now the Sync module's.
  A safety backup before a change that loses data, characters following a
  moved file, and a deleted project's chats closing now hang off Sync's news
  instead of being wired by hand.
- Images in a cloud workspace are uploaded and served by Sync on both ends.
- An old flat workspace kept as one file still moves into its folder the
  first time it opens.

### v0.1.83: the server's Projects module

Step S4s-1. Nothing changes for users.

- Where the teams' projects are kept on the server and who may open them is
  now a module of its own (Projects): browsing the server's folders, making
  a folder, each account's open files in a project, and reading or setting a
  project's access list. The replies are the same as before.
- Two server routes nobody has called since v0.1.60 (listing and making the
  flat workspaces from before folders) are gone. Those old workspaces still
  open.
- The browser's access dialog now asks the server itself (Cloud) instead of
  going through the sign-in module.

### v0.1.82: main.js only starts the modules

Step S4e-4c. Nothing changes for users.

- `app/main.js` (4,539 lines when the moves out of it began) is now 27: it
  starts the modules and nothing else. Each module finds its own part of the
  page and does its own part of the start; resuming the last session waits
  until every module has started, as before. The start screen, Settings and
  the status bar were compared pixel for pixel with v0.1.81.
- The first-visit template still stays out of a cloud workspace that opens
  while it loads (the template race test passes).

### v0.1.81: the last of main.js's ports

Step S4e-4b2.

- "Generate Module Map" is now the last entry of a `.mtree` file's menu
  (after Export): module maps are an extension (`extensions/module-map`), and
  a file type's own entries come after the common ones. The dialog and its
  Ctrl+S work as before (the dialog was compared pixel for pixel).
- The Chats tab's unread count now updates on every redraw, even before the
  Agent page has ever been opened; before, it waited for the Agent page.
  Drawing it that early showed that the Chats page threw on every redraw
  when a server answered without a list of conversations; it now treats such
  an answer as no answer.
- "Manage Preview" on the project's root, dropping files into the editor,
  following a renamed character in local group chats and new character
  sheets work as before, each now run by its own module.

### v0.1.80: the Editor and Sync meet in Workspace

Step S4e-4b1. Nothing changes for users.

- The Editor and Sync, which may not call each other, now share what they
  must through Workspace: typing goes out as patches, others' changes and
  carets come in, a reload keeps the view, and carets are a small presence
  model there. `main.js` no longer carries any of it.
- The write-path, comments, session-recovery and editing browser tests (two
  browsers on one workspace among them) pass through the new route.

### v0.1.79: Shell owns the log panel

Step S4e-4a. Nothing changes for users.

- The log panel and its trace tab are Shell's, and every module writes to it
  through Shell rather than through `main.js`. Lines logged while the app
  starts no longer fail and get dropped (the trace used to fill with "the log
  panel is not ready yet" during start-up); they wait and follow.

### v0.1.78: Shell owns the frame

Step S4e-3. Nothing changes for users.

- Showing, hiding and sizing the explorer, the side panel, the log and the
  source and preview panes, the phone's single pane, its swipes, drawer and
  menus moved from `main.js` and `ui/layout.js` into Shell; the modules say
  what they put in it (the phone's panes) and react when it changes. The
  Agent page loads itself the first time it is needed.
- The page looks the same: whole-page screenshots before and after match
  pixel for pixel, at desktop and phone width and after toggling areas.

### v0.1.77: each module draws itself

Step S4e-2. Nothing changes for users.

- Redrawing the app is asked of Shell, and each module draws its own part
  when it hears it, instead of `main.js` drawing the editor, the tree and the
  Agent page by name. While you type, full redraws still wait until you pause
  (or every 1.5 s in a long burst); `editor-typing-browser.py` now checks
  that 30 keystrokes bring only a few redraws.

### v0.1.76: the File menu and the project's location belong to their modules

Step S4e-1. Nothing changes for users.

- Each File menu command is now registered by the module that does it (the
  menu looks and works the same); Save announces itself and History takes the
  snapshot it always took.
- Where the open project lives (its key, and where its images are served
  from) is answered by Workspace, as Sync configures it, instead of by
  `main.js`; avatars by Characters.

### v0.1.75: the welcome page and maintenance belong to their modules

Step S4d-3b. One fix for users:

- **"Open a workspace" on the welcome page did nothing** (since the unified
  file browser replaced the server directory button it clicked). It now opens
  the file browser on the server's side. `identity-browser.py` checks it.
- The welcome page's buttons are drawn and bound by the modules they belong
  to; Reset, Clear All Cache and Empty Everything moved into Shell and
  Workspace with the app's offline files. `shell-browser.py` checks the
  welcome page.

### v0.1.74: Comments runs itself

Step S4d-3a. Nothing changes for users.

- The Comments module now starts like the others and owns everything about
  comments on the page: the gutter marks and ruler ticks (through a new
  Editor extension point for notes on lines), the popover, keeping each
  comment on its line as the text changes, and others' changes arriving
  live. `main.js` no longer mentions comments.

### v0.1.73: the Editor no longer knows diagrams

Step S4d-2b. Nothing changes for users.

- A diagram's highlighting, toolbar buttons and autocomplete moved from the
  Editor into the diagram extension, through the Editor's extension points
  (autocomplete got one). Opening a diagram still shows it in the preview,
  now because its preview says so.
- `shell-browser.py` now checks a diagram's highlighting, its toolbar button
  and its autocomplete in the source editor.

### v0.1.72: diagrams are an extension

Step S4d-2a. One small change for users:

- A diagram's **Export As** now comes after **Export** in the explorer's
  menu, as other file types' own entries do (it was between Export and
  Rename).
- The diagram editor, Quick Generate, export and the diagrams' settings moved
  from `app/ui`, `app/services`, `app/features` and `main.js` into
  `extensions/bmap-diagram`. The Explorer gained extension points for a file
  type's menu entries and a new file's content.
- `shell-browser.py` now exports a diagram as SVG from the explorer and
  creates a new diagram.

### v0.1.71: History owns snapshots and the diff tab

Step S4d-1. Nothing changes for users.

- Snapshots, the version label, the Snapshots and Workspace History dialogs
  and their menu items moved from `app/features` and `main.js` into the History
  module.
- The diff is a tab in the preview pane through a new Editor extension point
  for tabs that are not files; the Editor draws the preview pane itself.
- `shell-browser.py` now compares a snapshot in the diff tab and closes it.
  It caught two slips before release: renaming a file failed (a name the
  Editor's port still used had moved), and Compare failed (one call still used
  the diff's old action name).

### v0.1.70: resuming and leaving belong to their modules

Step S4c-2. Nothing changes for users.

- Resuming the last session (at start, on returning to the page, when the
  network returns, and from the welcome page) is the Cloud module's.
- When the page hides or closes, the Editor, Workspace and Sync each keep
  their own part, instead of `main.js` doing all three; Workspace reattaches
  an on-device folder by itself.

### v0.1.69: Sync owns the connection

Step S4c-1. One fix for users:

- **Chats' live events:** another person's message, typing or change in
  Chats was passed on only once this tab had loaded its Agent page (on first
  opening the side panel or Settings); before that it was dropped. Chats now
  hears its own events on the session's stream.
- Joining, reconnecting, switching between the shared workspace and your own,
  and sending changes moved from `main.js` into the Sync module.
- `session-recovery-browser.py` caught a slip on the way: cancelling the
  automatic resume whenever the workspace became private (a failed open does
  too) stopped the retry. Only a deliberate switch cancels it.

### v0.1.68: the status bar is Shell's, its items their owners'

Step S4b. Nothing changes for users.

- Shell draws the status bar; each item is added and kept current by the
  module it describes (Workspace, Cloud, Sync, the Editor), from that
  module's own state, instead of `main.js` rewriting all of them on every
  redraw. The Session panel is Sync's.
- `shell-browser.py` checks the items and their order, the character count
  following a selection, and the server item opening Settings →
  Collaboration.

### v0.1.67: Settings' sections belong to their modules

Step S4a-2. Nothing changes for users.

- Settings → Agent is the Models module's, with the Assistant's connected
  tools; Settings → Collaboration is the Cloud module's. Both look exactly as
  before.
- The agent's status is asked again when its settings or the server address
  change, by Models, and the Agent page redraws whenever that status changes.
- `shell-browser.py` checks that choosing your own key shows its fields and
  status, that a pasted key is trimmed and the agent asked again, and that
  Collaboration's fields follow their settings.

### v0.1.66: Shell owns the Settings dialog

Step S4a-1. One small change for users:

- The theme now follows the device when it is set to "System" and the device
  switches between light and dark; before, it changed only on a reload.
- Settings' sections are pages in a tab host (like the side panel's), and
  each field is declared by the module whose setting it changes. Shell draws
  and saves it; the owner reacts to the setting, whoever changed it. The
  dialog looks exactly as before, on the desktop and on the phone.
- `shell-browser.py` now checks the sections, the fields and their order,
  and that a change takes effect.

### v0.1.65: the agent's edit review is the Assistant's

Step S3d-4b. Nothing changes for users.

- The marks an applied agent edit leaves until Keep or Drop (its lines tinted,
  a badge on the tab and the explorer row, the Keep / Drop bar over the file)
  are now an Editor extension point, `editor.marks`, which any module can
  use; the Explorer reads it as well.
- The rest of the review moved from `main.js` into the Assistant: which lines
  an edit changed, the copies of the project Drop uses to bring back deleted
  files, and jumping to a change. `main.js` is 180 lines shorter.
- `write-path-browser.py` now checks the marks appear on the edited line, the
  tab, the explorer row and the bar, and go after Drop.

### v0.1.64: the Agent page is the Assistant module's

Step S3d-4a. One fix for users:

- **Replace File did nothing (since v0.1.60):** when the explorer moved into
  its module, the "Replace File" menu item on an image was left setting a name
  that lives in another part of the explorer, so it failed before the file
  picker opened. It works again; `shell-browser.py` now replaces an image.

- The Agent page moved from `app/features/chat-panel.js` (1,280 lines) into
  the Assistant module, which loads it the first time the side panel opens.
  It is split by job into six pieces that share one context: conversations,
  the conversation list's actions, drawing, a turn of the agent, the edits it
  proposes (Keep/Drop), and the page's controls.
- Its services moved with it: talking to the server about conversations,
  keeping them in this browser, syncing them, the MCP controls and undoing
  the agent's edits.
- Operation names such as `update-file` are constants exported by Workspace,
  so only Workspace spells them.
- Two slips in the move, found by the browser tests before release: sending a
  message failed on a name the turn's piece no longer had (`mcpControls`), and
  applying an edit failed on one the drawing piece had not taken
  (`agentPendingDecorations`). `chat-turn.test.mjs` now gives a piece only the
  names it takes from its context, imports or defines, so such a slip fails
  there too.

### v0.1.63: the Chats page is the Chats module's

Step S3d-3. Nothing changes for users.

- The Chats page moved from `app/features` into the Chats module, which
  registers it in the side panel and draws it. It reaches everything through
  modules (Shell, Workspace, Identity, Sync, the Editor, Characters, Models)
  and a five-name port; the Agent page gives it the old Roleplay threads.
- The request to the server's agent is Models' now, and the helpers both
  pages use to show a conversation are Shell's.
- `main.js` starts Models, Characters and Chats with the other modules, and
  following a renamed character no longer loads the whole chat panel.

### v0.1.62: the agent's connection belongs to Models

Step S3d-2. One fix for users:

- **The "+" button (a bug in v0.1.61, never deployed):** after the split it
  still had its old handler as well as the page's, so on the Agent page it
  started two conversations and on the Chats page it also started an agent
  conversation. Only the open page's action runs now;
  `chats-local-browser.py` checks it.
- Whether the server's agent is set up (and why not), the models it offers,
  the chosen model and what a request carries with the user's own key are
  the Models module's (`models.agent`), with their rules as pure functions
  and tests. What a request carries from the project is Characters'.
- The Chats page no longer borrows any of this from the Agent page.
- 49 forwarding functions in `main.js` that nothing called any more (left by
  the earlier moves) were removed: 2,971 → 2,921 lines.

### v0.1.61: the side panel's Agent and Chats are separate pages

Step S3d-1. Nothing changes for users: the tabs look and work the same.
Underneath, each has its own input box and conversation instead of the two
swapping their drafts and messages in one shared set.

- Shell has pages in tab hosts, like a browser's tabs: a feature adds itself
  as a page (a label, its own body, what "+" does, a badge), and Shell draws
  the strip, shows one page and remembers which (`settings.openPages`,
  migrated from `chatTab`). The side panel is the first host; the log panel's
  tabs and the Settings sections can become hosts later.
- The Agent and Chats were one 1,666-line file sharing the conversation list,
  the input and its handlers, with a dozen "which tab is this" branches. The
  Chats page is now `features/chats-page.js` (331 lines) with its own body;
  it shares only the agent's server connection, which it is given.

### v0.1.60: the Cloud module

Step S3c. Nothing changes for users.

- Signing in and out, the file browser (the server's teams, folders and
  projects, and this device's projects), deleting to the Trash, moving and
  copying, project access, hosting, publishing and opening a cloud workspace
  are one browser module on level 5 (`app/modules/cloud`), split by job.
- It reaches the settings and dialogs through Shell, the session and its
  status through Sync, the project through Workspace, the trash through
  History and the resume positions through the Editor. `main.js` attaches a
  port for the rest (12 names).
- The server's workspace routes moved from the legacy sync service into the
  module (`api.js`); two calls nothing used were dropped.
- Fixed on the way: since v0.1.52 the Trace tab's listener read the log
  panel's state before it existed during start-up, so the console showed a
  few harmless "Cannot access 'debugState'" errors at every load.

### v0.1.59: redrawing is asked of Shell

Step S3o-4. Nothing changes for users.

- Modules ask Shell to draw the app again (`shell.render`); `main.js` answers
  Shell's `render` event. The Editor and the Explorer no longer receive
  `main.js`'s render functions through their ports.
- A redraw that throws is now recorded in the Trace tab (a failed listener)
  instead of breaking the action that asked for it.
- With this, the four things every legacy feature needed have owners:
  settings (Shell), the live session and its status (Sync), saving
  (Workspace) and redrawing (Shell).

### v0.1.58: Workspace owns saving

Step S3o-3. Nothing changes for users.

- The four storage services (this browser's copy, folders on disk,
  on-device folders, the save queue) are Workspace's adapters now.
- What `main.js` did around them is Workspace's `saving`: the browser copy
  written shortly after edits and at once when the page may go away, a local
  project's folder, auto-save when idle and every 15 seconds, and Save.
  Whether a shared workspace's file may lose its dirty mark is still decided
  by the session (the server must have confirmed it), now through a hook.
- `project-save.test.mjs` tests Workspace's saving directly instead of
  cutting the functions out of `main.js`'s source.

### v0.1.57: Sync owns the live session and its status

Step S3o-2. Nothing changes for users.

- `main.js` created the live session with eleven callbacks. Sync creates it
  now: `main.js` gives it what only the app can do (replace the project,
  apply a collaborator's change, keep local edits before a reload, sign in
  again, upload an image), and the session's news are Sync's events (its
  status, others' cursors, the host's counters, a confirmed patch, other
  modules' events on its stream).
- The session's status (connected, who is here, the role, what the server
  offers) was one object that 23 places in 2 files wrote. Sync owns it; code
  reads a live view and says what happened with `status.change`, which shows
  in the Trace tab.
- The Explorer asks Sync for the session itself.

### v0.1.56: Shell owns the settings

Step S3o-1. Nothing changes for users, except that changing one setting no
longer writes back every other setting this tab holds.

- The settings were one object that 64 places in 5 files changed directly
  and then saved whole. Shell owns them now: code reads a read-only view and
  changes them with `settings.change({ key: value })`. A plain assignment
  throws, so a missed one fails loudly instead of changing settings unseen.
- Each change saves only the keys it changed. Before, any save wrote this
  tab's whole copy, so changing the theme in one tab could undo a font or
  sign-in another tab had saved since. The revision a cloud copy was last in
  sync with is still saved only with its workspace (or by the guarded merge
  when the page goes away), as before.
- Every change is in the Trace tab with the file and line that made it; the
  PIN, the stored password and an API key show as "(hidden)".
- `lastLocalProject` was written but had no default; it has one now.

### v0.1.55: the Explorer module

Step S3b of the follow-up to the restructure. Nothing changes for users.

- The explorer's tree and the file actions are one browser module on level 4
  (`app/modules/explorer`): moving and copying files, folders and parts, the
  Add File dialog and files dropped into the editor, creating, renaming,
  deleting, exporting, the context menu, and the Edit / Create menu items it
  registers itself. The 1,188-line file-actions file is split by job.
- It reaches the project through Workspace, the editor through the Editor's
  functions and the dialogs through Shell. `main.js` attaches a port for the
  rest (16 names: the sync session, saving, the app's render...).
- The file-content and ZIP helpers moved into Workspace (legacy saving uses
  them too); diagram export waits in `app/features/diagram-export.js` until
  diagrams become an extension.
- A structure rule now fails when a module imports code from before the
  restructure.
- Getters handed out by `main.js`: 133 → 90. `main.js`: 3,731 → 3,328 lines.

### v0.1.54: the Editor owns all of itself

Step S3a of the follow-up to the restructure. Nothing changes for users.

- The Editor creates and wires its parts itself: the source editor,
  highlighting, find and replace, autocomplete, links, the tab strips and the
  preview. `main.js` used to create six of them, each with its own list of
  main's values (about 100 names in all), and kept their state.
- Their state moved in with them (undo history, search, autocomplete, the
  render cache, dragged text, other people's cursors, the file shown, the
  saved scroll and caret per file), as did the editor's events (typing, IME
  composition, the find bar, links under the mouse, drag and drop, the wheel),
  the resize observer and showing the active file.
- `main.js` attaches one port for what no module owns yet (25 names, listed
  in `surface.js`); each should find an owner or become an extension point.
- A preview may now offer `viewState()`: the diagram preview remembers its pan
  and zoom that way, instead of `main.js` reaching into it.
- Getters handed out by `main.js`: 227 → 133. `main.js`: 4,539 → 3,731 lines.

### v0.1.53: one owner for each piece of shared state; the diagram preview is back

Step S2 of the follow-up to the restructure. For users, one thing changes:
diagrams preview as diagrams again.

- **Diagram preview (a bug since v0.1.48):** moving the URL album into an
  extension also deleted the `.bmap` preview, so a diagram showed as text in
  the preview instead of the diagram editor, and its pan and zoom were no
  longer remembered. Restored; `shell-browser.py` now opens a diagram. Also:
  a link to another file inside a diagram called a function the preview was
  never given (an error on click, older than v0.1.48); it is passed now.
- **One owner per variable:** `main.js` handed out 26 setters, so any of
  several files could change, for example, the selected node (written in 23
  places). None are left, and rule 10 fails on a new one:
  - what the editor shows (open tabs, the preview's file and part, the
    explorer selection, a dragged tab) is the Editor's `view`;
  - shared or local work and the local project kept aside meanwhile is Sync's
    `mode` (Sync now starts through the kernel);
  - the rest moved into the only file that used it.
- Every change of `view` and `mode` goes through a named action (`pick`,
  `showPreview`, `share`, `leave`...) and appears in the Trace tab with what
  it changed. Their lists are frozen, so code that pushes onto a tab list
  fails loudly instead of changing it behind the owner's back.
- The getters `main.js` hands to the code it wires: 261 → 227, now counted
  and allowed only to shrink. `main.js` is 4,539 lines (was 4,667).

### v0.1.52: the trace, and no error swallowed in silence

Step S1 of the follow-up to the restructure (docs/ARCHITECTURE.md, "Next: one
owner per piece of state"). Nothing changes for users except the log panel's
new Trace tab.

- **The trace:** the browser's kernel records what happened lately and who did
  it: every module event, every failed listener, every error code chose to
  ignore (with its reason and file:line), every error nothing caught. The log
  panel's Trace tab shows it; `stiloTrace()` in the console prints it.
- **No silent catches (rule 9):** 57 catches (36 in the browser, 21 on the
  server) dropped their error without a word. Each now handles it, or says why
  it carries on with `ignore(error, why)`, so it reaches the trace or the
  server log. A structure test fails on a new one.
- Among them: a failure to apply a collaborator's change (two places) was
  dropped before reloading; a bug in dropping dragged text or a part into the
  editor vanished (the catch covered the whole drop, not only the parsing);
  failed writes of account preferences and access lists were silent. Found
  while doing this: items 4 and 5 above.
- **Server:** a browser that stops receiving an agent's or character's
  progress is now reported once (`best_effort` in the kernel), not once per
  streamed token. The legacy server's two copies of that code became one.

### v0.1.51: the Trash button waits for its folder

The file manager shows its dialog before the folder list arrives. For that
moment the toolbar showed the state from the last time it was open, so the
Trash button could appear at the team list, where it has no team. Found by
the live check of v0.1.50. The button now stays hidden until the folder
loads, and opening the trash without a team does nothing.

### v0.1.50: deleted cloud projects go to the team's Trash for 30 days

Item 3 ("Deleting a project keeps its history") is decided: the history
becomes a trash.

- **Delete:** a deleted cloud project or folder is moved into its team's
  Trash (`data/_trash`), with its snapshots, backups, comments and chats,
  instead of being removed.
- **Restore:** the file manager's new Trash button lists what is there and
  how many days each item has left. Its owner can restore it where it was
  (or as "Name (restored)" if that name was taken meanwhile), or delete it
  for good.
- **Expiry:** after 30 days the regular backup sweep removes it. A server can
  keep items for less with `--trash-days` (1 to 30).
- **Earlier deletes:** history left by projects deleted before this release
  is picked up by the sweep and expires the same way. It can only be
  removed, since the project itself is gone.
- **Wording:** the delete confirmation for a cloud project now says it goes
  to the Trash. Deleting on this device is still permanent.
- **Server change:** who may delete or restore (a project's owner; a folder
  unless it holds someone else's projects) is now one rule in Identity, used
  by both.

### v0.1.49: dragging an album entry between albums now syncs

In a cloud workspace, an entry dragged to another album, or to a new place
in its own album, used to change only the browser that dragged it. Nothing
reached the server, so other people never saw the move, and the next reload
brought the old order back.

- Found by the live check of v0.1.48. The bug dates from the first explorer
  drag-and-drop: moves wrote straight into the browser's copy of the project
  instead of going through the write path.
- Both files now change through `workspace.write`, the target first. If the
  second write is refused, the entry ends up in both albums rather than in
  neither.
- `write-path-browser.py` now drags an entry between albums with a real
  server and two browsers, and checks the disk and the other browser.

### v0.1.48: restructure step 8 (the URL album as an extension)

The URL album lives in `extensions/url-album/` and reaches the app only
through public extension points. For users, two things look different:
the menu item is "Add Album Entry", and the entry dialog is Shell's new form
dialog.

- The core gained extension points instead of album code:
  - file parts in Workspace: a file's named parts are listed under it, opened,
    renamed, deleted, copied, dragged and dropped into Markdown;
  - highlighters and toolbars in Editor;
  - `shell.form`, a dialog with several fields;
  - New ... entries drawn from File types.
- The album's file type moved from `protocol/file-types.json` into its
  `extension.json`, which both ends read.
- A new structure rule fails if code outside the extension names it.
  `url-album-browser.py` was written against the old code first, then kept
  passing through the move. It also starts the app without the extension.
- Two album words left the core: the "add it to a .urldb album" hint when a
  remote image is blocked, and the lists of file kinds in the Add File and ZIP
  messages, which now come from File types.

### v0.1.47: restructure step 7g-2 (panes and previews); step 7 complete

The panes and the preview pane are the Editor's. Nothing changes for users.

- `panes.js` (1,046 lines) is the tab strips and panes (with resuming the
  last view through a port) and the preview pane.
- The preview pane has an extension point: images, Markdown and mind-map
  trees are built in; URL albums, diagrams and character sheets add their
  previews from `app/features/previews.js`, so the Editor no longer knows
  those file types. Printing asks the preview for its HTML (or prints what is
  shown).
- With this, every module of the design exists on its end. What is left is
  step 8 (the URL album as the first extension) and legacy code that still
  wires the modules together (`main.js`, the registry in the server).
- Caught before release by `session-recovery-browser.py`: after the split,
  remembering a cloud workspace's open file locally failed silently (an
  import was left behind, inside a try that swallowed the error), so a
  suspended phone tab would not have restored its file. Fixed.

### v0.1.46: restructure step 7g-1 (the Editor)

The source editor is the Editor module. Nothing changes for users.

- `editor-core.js` (1,655 lines, one closure) is six files that share one
  editor object: the text and the DOM (caret, selection), rendering, edits
  and undo, other people's cursors and the overview ruler, the formatting
  toolbar's edits, and keys. Each is under 400 lines; the typing hot path is
  unchanged (the browser test's per-key churn budget still holds).
- Highlighting, find and replace, autocomplete, links, the formatting
  toolbar, the table picker and the Markdown renderer moved into the Editor
  module; the comments popover moved into Comments. `app/editor/` is gone.
- The editor no longer knows the URL album: when it shows one album entry,
  the app maps the edited text back into the whole file.

### v0.1.45: restructure step 7f-2 (Chats in the browser)

Chats' browser side is the Chats module. Nothing changes for users.

- The Chats view, the cloud store (the server calls) and this browser's own
  store for a browser-only workspace are the Chats module; the chat panel
  asks it for them, and the view still loads only when the tab first opens.
- `protocol/chats.contract.json` lists Chats' routes and its three live
  events; the legacy contract keeps only the agent's events now.

### v0.1.44: restructure step 7f-1 (Chats on the server)

Chats' server side is the Chats module. Nothing changes for users.

- `conversations.py` is gone: the chat store (one SQLite database per
  project), who answers in a chat, the reply queue, and the claims for
  replies written in a member's own browser are the Chats module, which
  serves its own routes and tells only a conversation's members.
- A character's name in Chats is read with Characters' header rules; the
  registry had its own fourth copy of that parsing.
- The registry keeps only Chats' port (a copy of the project, who may open
  it) and the hooks (a renamed character file, the daily backup of the chat
  databases). `mdnotes_server.py` is 2,590 lines.

### v0.1.43: restructure step 7e (Comments)

Line comments are the Comments module on each end. Nothing changes for users.

- Server: the rules for adding, editing, moving and deleting a comment are
  pure functions; the comments file belongs to Comments (the structure test
  fails if other code names it); Comments serves its routes
  (`protocol/comments.contract.json`) and tells the live workspace through
  Sync's broadcast. Its writes are now crash-safe (atomic and synced), like
  the rest of the project folder.
- Browser: keeping a comment on its line is a pure function, and the server
  calls are Comments'; the gutter popover stays in `app/editor/comments.js`.
- New browser test: a comment from the gutter reaches a second browser at
  once, follows its line when lines are added above, and is removed for
  everyone. There was none before.
- `chats-local-browser.py` read the chat's placeholder before the browser's
  chat store had opened (a race that showed under load); it now waits.

### v0.1.42: restructure step 7d (History)

Snapshots and backups are the History module on each end. Nothing changes
for users.

- Server: snapshots and backups each keep a content-addressed, refcounted
  store beside the project data; the two stores had two copies of the same
  blob code, now one. The retention rules (which snapshots go when over
  budget, when a backup is skipped, which backups a policy keeps) are pure
  functions. History serves its own routes (`protocol/history.contract.json`)
  and is told about destructive changes and the daily sweep through hooks.
- The rule for a file path used as a key (in History's indexes and in
  comments) is Workspace's.
- Browser: this browser's own snapshot store, History's server calls and the
  line diff; the dialogs still live in `app/features` and call History.

### v0.1.41: restructure step 7c-2 (Sync in the browser, Sync's routes and contract)

Nothing changes for users.

- Browser: the 1,100-line collaboration runtime is the Sync module, split by
  job: the runtime (joining, applying everyone's changes in order, reconnects,
  keeping unconfirmed typing safe), the patch queue (coalescing and
  serializing typing per file), and pure rules (rebasing an incoming patch,
  the project's paths, what an error means). Events Sync does not own
  (comments, Chats, the agent's threads) go to one `onEvent` hook instead of
  being named inside Sync.
- Server: Sync serves its own routes (joining, state, presence, leases,
  changes, the event stream). Transport gained server-sent event streams and
  refusals with a status of the route's choosing (409 conflicts, 426
  out-of-date tabs, 503 storage).
- `protocol/sync.contract.json` holds Sync's routes, operations, events and
  the sync version (still 117, with its history). Both ends read the version
  from it; it is no longer written down in three places.
- The backend self-test (640 lines of test code) moved out of the server into
  `tests/backend-selftest.py`. `mdnotes_server.py` is now 3,782 lines (6,047
  when step 7 began).

### v0.1.40: restructure step 7c-1 (Sync on the server)

The server's 1,000-line session broker is split by job. Nothing changes for
users.

- Workspace: applying an operation to a tree is one pure function, the same
  rules the browser's `applySyncOperation` follows (both still run the shared
  operation cases); the open project and its storage (a folder, one JSON file,
  or memory) are one object.
- Sync: sessions and their roles, presence, leases and event streams; the
  rebase log (text patches moved over the ones since; stale whole-file writes,
  renames, moves and replaces as barriers); one path for every change, which
  checks the sender's role and revision, applies, commits and broadcasts.
- Rebasing a text patch now has a shared case table (17 cases) that the
  browser and the server both run; it was the last rule written in both
  languages without one.
- Removed: "revert to revision", unused since the agent's Drop became the
  write path backwards (v0.1.33). It kept 40 full copies of every open project
  in memory. Also an unused folder wipe.
- `mdnotes_server.py` is 856 lines shorter.

### v0.1.39: restructure step 7b (Models)

The model providers moved out of the agent into a Models module on each end.
Nothing changes for users.

- Server: DeepSeek (or another OpenAI-compatible endpoint), OpenAI's chat and
  image models and a user's own key; which models are offered; what each
  request must carry for its model (thinking, temperature); both streams
  (chat completions and the Responses API); generated images; MCP
  connections. `openai_support.py` and `mcp_client.py` are gone.
- A request now gets an explicit route (model, URL, key, provider) that is
  passed along, instead of the provider fields the agent used to set on
  shared per-thread state and clear afterwards. The one-shot generator
  (Quick Generate) uses the same provider code as chat.
- Browser: a model called straight from the browser (own key or a local
  model) and the picker's grouping and choice.
- Fixed (found while splitting the server's session code for the next step):
  when a session's event stream dropped and came back with the same token,
  the server forgot the session's role. A read-only member could then write,
  and a project's owner could no longer publish. A role now lasts as long as
  its token; a regression test covers both.

### v0.1.38: restructure step 7a (Identity and access)

Accounts, sign-in and who may open a project now live in one module on each
end, instead of being spread over the server's workspace registry, its request
handler, and the browser's main script, cloud browser, chat panel and panes.
Nothing changes for users.

- Server: the account file, sign-in tokens, teams, the access record of each
  project (whitelist, blacklist, readers, owner), roles and what each role may
  do (`can(role, "open" | "edit" | "replace")`), and the per-account
  preferences (the last workspace, for resuming on another device). The rule
  "only the owner manages a project; with no owner, anyone who may open it"
  was written twice (changing access, deleting a project); it is now one rule.
  Identity serves its own routes (sign-in, access).
- Browser: the signed-in account and its stored sign-in, signing in and out,
  and signing in again by itself (only where that account signed in before,
  with a stored password). Forty-odd places that read `syncState.account`
  now ask `identity.account()` or `identity.token()`.
- The browser's server address and request helpers moved into Shell, so every
  module calls the server the same way.
- Identity and Models moved from level 1 to level 2, beside Workspace: they need
  Transport and Shell below them.
- Identity's routes are the first module contract
  (`protocol/identity.contract.json`, version 1); a structure test checks that
  the server serves exactly those routes and that nothing outside Identity
  calls them.
- The access file, the account file and the preferences file each have one
  owner; the structure test fails if any other code spells their names.

### v0.1.37: restructure step 6 (Assistant): the agent edits passages, not whole files

The agent has a new tool, `edit_file`: it names exact passages of a file and
what each becomes, and everything else stays exactly as the author wrote it.
Before, every change to an existing file meant the model retyping the whole
file, so a one-line fix to a long character sheet could quietly reword other
lines and took as long as writing the file.

- Each passage must occur exactly once and edits may not overlap; otherwise
  the server tells the model which edit failed and why (several matches, not
  found, overlapping), and it retries. Edits in one turn build on each other.
- The proposal travels as a whole-file update with the text it started from
  and its list of edits, so older tabs still apply it, and the browser places
  it into the file as it is now (the write path): it merges with whatever
  anyone typed meanwhile, and Drop undoes only it.
- The review card shows each edit as the text that goes and the text that
  comes ("1 edit"), not a diff of the whole file.
- The agent is told to prefer `edit_file` for any change smaller than most of
  a file, and always for character files; the manual's character update rules
  say so.
- The agent's tool definitions moved into the server's Assistant module.

### v0.1.36: restructure step 5 (Characters): author's notes and hidden plans

The Characters module now owns what a character file is, what a character
knows, and what it may read, on both ends, with one shared case table.

- **Author's notes.** A `## Author's notes` section holds plans and
  foreshadowing the author has not written yet. The character never sees it:
  it is left out of the character's prompt, out of the summary other
  characters get, and out of the file whenever a character reads it. With
  `notes: hints` in the header the character gets the notes as foreshadowing
  it may let colour a small detail, never as knowledge. The preview shows the
  notes in a collapsed panel that says which applies. The New Character
  template has the section.
- **Files characters cannot read.** A `Plans` folder (any depth) and
  `*.plan.md` files are invisible to characters (not listed, not readable),
  on the server and in a browser that runs the model itself. The agent still
  reads them.
- **The agent's character rules.** How to update a character after new
  writing (change only what the writing changes, keep the author's wording,
  never touch the notes except to retire a plan that happened, say where a
  fact came from, ask when the writing contradicts the sheet), and length
  guidance ("as long as the writing supports", no fixed cap).
- Fixed on the way: the server read character headers with Windows line
  endings left in the body; both ends now read them the same way. The
  character's prompt no longer includes the raw header lines. Twin rules
  without a case table: 3 -> 1.

### v0.1.35: restructure step 4, part 2 (the project in the Workspace module)

The project model and the store holding the open project moved into the
Workspace module in the browser; on the server, the project tree, UTF-16
offsets and the folder storage (with its crash-safe commit) moved into the
server's Workspace module, which CollaborationBroker now calls. No behaviour
change except one fix:

- **Unknown file types on the server.** The browser refuses a file type the
  app does not know, but the server accepted one (for example `notes.txt`)
  through an operation, and every browser receiving it then failed to apply
  it. The server now refuses it on create and rename. Found by the new shared
  case table for operations (`spec/workspace/operations.cases.json`), which
  both ends run.
- Removed on the way: four broker methods that were defined twice (Python used
  the second copy), and a second JavaScript copy of the text-patch rule.
- A reliability test had silently stopped checking anything after the move
  (it watched writes in the old place); it now watches the new place and also
  checks that the changed file was written.

### v0.1.34: the person who asked the agent could lose Keep and Drop

Found by the live test of v0.1.33. An agent batch remembered who asked by the
sync session's client id, which changes whenever the session reconnects (a
network blip, a sleeping laptop, a server restart). After a reconnect the
asker's Keep and Drop buttons were disabled as if someone else had asked. In
the live test the reconnect came from the test itself: its server checks
opened sessions for the same account without a device id, which evicts every
session of that account; browsers always send their device id. The
batch now remembers the browser tab instead, which lasts as long as the tab is
open. `write-path-browser.py` checks that both Drop buttons are usable by the
asker and uses the editor bar's.

### v0.1.33: restructure step 4, part 1 (the one write path)

Every change to a text file now leaves the browser as a patch, which merges
with what other people are typing, instead of a whole-file write that either
overwrote them or was refused. One function in the new Workspace module,
`write()`, is used by everything that writes: the agent's edits, edits made in
a diagram's preview, URL album changes, module maps, Snapshots and Workspace
History restores, and reconnecting after being offline. Typing already sent
patches and is unchanged.

- **The agent is now a collaborator.** Before, any change anywhere in the
  workspace while the agent was working threw its whole batch away, and Drop
  either rewound the whole workspace on the server (`revert-to-revision`) or
  was refused once anyone else had edited. Now each of its edits is fitted into
  the file as it is now; only an edit to a line someone else changed is marked
  stale. Drop undoes only the agent's own changes, newest first, and keeps
  everyone else's.
- **Placing safely.** A change is split into line-level pieces; each must be
  found, with two lines of context, exactly once, or the write is refused and
  nothing changes. The server also refuses any patch whose replaced text does
  not match, so a misplaced edit cannot happen.
- Fixed on the way: restoring the open file from Snapshots sent the change
  twice (once from the editor, once as a whole file).
- Images are still replaced whole; there is nothing to merge in bytes.

### v0.1.32: restructure step 3 (File types)

Every kind of file is now defined once, in `protocol/file-types.json`, which
both ends load: extensions, text or image, label, MIME type, icon, explorer
filters, whether the row expands, and how a new one is created. Before, the
same knowledge was typed into 9 browser files and 2 server files (`.urldb`
alone in 9). The browser and the server answer "what type is this name" the
same way, checked by one shared case table.

- Found while moving it: the Add File dialog's "Supported" line had fallen
  behind and left out `.bmap` and `.skill`. It, the file pickers' accept
  lists and the new-file type picker are now filled from the one list.
- `index.html` no longer names a file type; pages mark what they need and the
  File types module fills it in.
- Legacy type spellings in the code went from 43 to 3 (the image model's
  output formats, which move with the Models step).

### v0.1.31: restructure steps 1 and 2 (guard rails, kernel, Shell, Transport)

The module restructure decided on 2026-10-16 (docs/ARCHITECTURE.md) began.
No feature changes; what users can notice is that the menus are now drawn
by the Shell module from registered commands (same items, same order).

- **Guard rails.** `tests/structure` checks the eight architecture rules;
  today's violations are recorded in a baseline that may only shrink. The
  shared mention table was found to be run by the browser only; the
  server's half now runs it too. `protocol/legacy.contract.json` records
  every operation and event in use and is checked against the code.
- **Kernel** on both ends, **Shell** in the browser (commands, menus,
  the Mod+S shortcut, dialogs, toasts) and **Transport** on the server (the
  route table that replaced 49 if-routes, CORS, JSON responses, errors to
  status codes).
- Fixed on the way: a malformed shortcut ("Mod+") was accepted; a
  `KeyError` in a new-style route would have been reported as 404.

### v0.1.30: the account file is re-read when it changes; a broken one keeps the last good accounts

`server/whitelist.json` was read only at start-up, so adding an account needed
a restart, and a file that failed to parse (a missing comma) turned accounts
off entirely: on 2026-10-13 nobody could sign in for about three minutes. Now
the file is checked at most every 2 s when accounts are used and re-read when
it changes; a file that cannot be parsed keeps the accounts already loaded and
logs one `WARNING` until it is fixed. Removed accounts stop working the same
way, without a restart.

### v0.1.29: GPT 6.1 Sol and Luna in the model picker

The server offered only `gpt-N`, `gpt-N-mini` and `gpt-N-nano`, so the
account's newest models with named tiers never appeared and the picker stayed
on GPT-5.5. It now offers the newest flagship, Sol, Luna and mini within the newest
GPT major version (dated snapshots are skipped), adding the newest mini only
when that leaves a flagship alone. The live account has `gpt-6.1-sol` and
`gpt-6-luna` (no 6.1 Luna yet), so those two are offered. GPT 6 and later are treated
as reasoning models (no `temperature`). The start-up log lists the catalog's
newest GPT ids, so the names can be checked.

GPT 6 models refuse function tools on `/v1/chat/completions` while reasoning
is on, and Sol cannot turn reasoning off, so every agent and character request
failed. GPT 6+ on the server's key now goes through `/v1/responses`: the
request is still built in chat-completions form and translated
(`to_responses_request`, `ResponsesStream`), so the tool loop, streaming and
progress are unchanged for every provider. An own key keeps chat completions.

### v0.1.28: Chats (people and characters, live), a tidier chat panel, and the code split

- **Chats replaces Roleplay.** The panel's second tab is now a small chat app
  for the project: private chats and groups with the people who can open the
  workspace and with its characters, all live. Starting a chat with someone
  reopens the existing private chat; inviting a third person into it starts a
  *new* group, so the private chat is kept (inviting into a group adds to it).
  A character answers every message in a private chat; in groups the
  @mention rule stays. A private chat's details page has a search that jumps to
  the message and a private alias/note per contact that only its owner sees.
  Unread counts show in the list and on the tab.
- **Stored per project in SQLite** (`conversations.sqlite` in the project
  folder, WAL, FTS5 search with a LIKE fallback): hidden from the explorer,
  kept when a project is published over, and backed up daily (last 14) when it
  changed. Live events go only to members (`chat-message`, `chat-typing`,
  `chat-update`), never to everyone on the project stream. Renamed or moved
  character files are followed on the server.
- **Who writes a character's reply.** Normally the server (sign-in, the model
  picked in the compose box), one character at a time per conversation, never
  twice for the same message. With an own key and "Directly from this
  browser", the sender's browser claims the reply, fetches the prompt the
  server builds (`POST /api/chats/prompt`), calls the user's endpoint itself
  (works with a local model such as Ollama) and posts the text back for
  everyone; a claim left by a closed browser is marked interrupted after 60 s.
- **Browser-only workspaces** get character chats kept in IndexedDB, with a
  note that chatting with people needs a cloud workspace. Old Roleplay group
  threads are moved into Chats once.
- **Panel polish.** The model picker and a small status (dot + word, detail on
  hover) moved from the toolbar into the compose card's footer, next to
  `@ File` and Send; the toolbar keeps only the tabs and three buttons. History
  can be searched, and threads renamed or deleted. A new thread lists example
  requests.
- **Renaming a character file** no longer drops `.persona` (the extension was
  read as `.skill`).
- **The code split.** `main.js` was broken into modules (explorer, tabs and
  preview, layout, editor core and its tools, dialogs, cloud browser and
  accounts); the diagram editor, module-map tools, Workspace History,
  Snapshots and the chat panel load the first time they are used.

Sync compatibility moved to `117`: older tabs would keep writing Roleplay group
threads into the shared chat, so they are asked to reload.

### v0.1.27: GPT models, generated images, and sign-in for the server's agent

- **OpenAI as a second provider.** With `OPENAI_API_KEY` in the service
  environment, the server reads the key's model catalog at start-up and offers
  the newest GPT flagship and its mini next to DeepSeek (still the default);
  `MDNOTES_OPENAI_MODELS` / `MDNOTES_OPENAI_IMAGE_MODEL` pin them instead. The
  model picker groups models by provider and the status badge names the
  provider of the selected model. GPT requests never carry DeepSeek's
  `thinking` option, and reasoning models get no `temperature`.
- **Generated images.** When an image model is available, the agent has a
  `generate_image` tool (medium quality, at most 2 per request,
  `MDNOTES_IMAGE_QUALITY` / `MDNOTES_MAX_IMAGES_PER_TURN`). The image is kept on
  the server for 14 days under `server/data/_generated/`, readable only by the
  account that asked for it; the edit card shows it, and applying the edit
  saves it as an image file (uploaded to disk in cloud workspaces). Chat
  history stores only the image id, never its bytes. Roleplay characters never
  get the tool.
- **Sign-in required for the server's keys.** On a server with accounts, the
  agent, Roleplay and Quick Generate refuse requests without a signed-in
  account (previously anyone who could open the site could spend the server's
  DeepSeek key). A user's own key (Settings → Agent) still works without
  signing in, but image generation always needs an account because it spends
  the server's OpenAI key. Signed out, the badge says "Sign in to use the agent"
  and opens the Account settings.

### v0.1.26: the Roleplay tab could be covered by the status badge

Found by the first live test of v0.1.25 with a real model. The live server offers
two models (so the model picker shows) and a long status text; together they
squeezed the tab strip and the badge sat on top of the Roleplay tab, so on
desktop it could not be clicked. The mocked browser test had one model and a
short status, so it never saw this. The tabs now never shrink (the badge and
picker ellipsize instead), and `roleplay-browser.py` mocks the live server's
status and checks that nothing covers a tab.

### v0.1.25: Roleplay (characters in a group chat)

The AI panel only offered an assistant that edits files. Writers, scriptwriters
and game masters also want to ask a *character* how they would react, in that
character's voice. The panel now has two tabs: **Agent** (unchanged) and
**Roleplay**, a group chat with characters the user writes as files.

- A character is `name.persona.skill`: Markdown with an optional `---` header
  (`name`, `avatar`, `color`, `temperature`); the rest is the character sheet,
  sent to the model as written. The file name gives the `@handle`. The sheet is
  re-read before every reply, so editing it changes the character from then on.
  The preview shows a character card; **Create → New Character** and the
  explorer's **New Character** start from a template.
- `@aria …` asks one character; `@all` asks everyone, in cast order, each seeing
  the replies before theirs. A message with no mention is narration and gets no
  reply. Characters never trigger each other, so there are no reply loops.
  **Stop** cancels the current reply and the rest of the queue.
- Characters can read the whole workspace (`list_files`, `read_file`) plus any
  attached files, but cannot change anything: write tools are not offered, and
  the server refuses them if a model calls one anyway. No MCP connections.
- Group chats sync to collaborators like agent threads, so several people can
  play in one shared workspace; each person's messages carry their name.
- The agent's manual documents the format, so "make a character file for X
  from my chapter" works with the existing agent.
- The Roleplay code is its own module, loaded the first time the tab opens,
  so it adds nothing to page start-up.

Sync compatibility moved to `116`: older tabs would drop the new chat fields
(`kind`, `members`, `speaker`) when saving the shared chat, so they are asked
to reload.

### v0.1.24: workspace backups (Workspace History)

There was no way back from "everything was deleted": per-file Snapshots are
mostly taken by hand, a file never snapshotted had no history, and the app
refused to restore a snapshot of a file that no longer existed.

The server now keeps whole-workspace backups, but only for days the workspace
actually changed. A sweep every 15 minutes refreshes that day's single "daily"
backup to the latest state; idle days add nothing. A final sweep runs when the
service stops, so a deploy restart keeps the day's last state (SIGTERM is now a
clean shutdown). Just before anything destructive — deleting files or folders,
replacing the whole project, reverting — a "safety" copy is taken; a burst of
such changes within a minute shares one copy. Retention: every active day for 14
days, then the last active day of each week for 8 weeks and of each month for 6
months; safety and manual copies for 14 days (at most 60). Storage is
content-addressed and refcounted like Snapshots, in its own store
(`data/_backups/…`, outside the project folder), so unchanged files cost nothing
from day to day and neither store can evict the other.

**Edit → Workspace History…** lists the backups, compares one with the
workspace as it is now (deleted / changed / created since), and restores a
single file — including one deleted since — or everything. Restore All backs up
the current state first, so it can itself be undone, then removes what was
created since, brings back what was deleted and puts back what changed. Each
change is confirmed by the server before the browser applies it and chained on
the confirmed revision, so a collaborator's edit stops the restore instead of
being overwritten. Per-file Snapshots can now bring back a deleted file too.

Tests: `tests/workspace-backups.test.py` (10 server cases) and
`tests/workspace-history-browser.py` (real backend + browser, 9 checks).

### v0.1.23: compressed static files, dead code removed

Static files were served uncompressed (~930KB of JavaScript on a first load and
after every release). The backend now gzips text assets of 1KB or more when the
browser accepts it — `main.js` 528KB → ~136KB — honours `q=0`, sends
`Vary: Accept-Encoding`, and caches each compressed file until it changes on disk.
Images, fonts and tiny files go out as before. The service worker installs and
serves the shell normally from compressed responses.

Removed code nothing used: nine functions (four of them leftovers from the
v0.1.22 renderer) and 13 CSS classes left behind by earlier redesigns (the old
"accept" agent buttons, the `editor-measure` helper, `link-button`, and others).
Each was checked by hand, including class names built at runtime such as
`is-${state}` and `bmap-resize-${edge}`, which are kept. 150 lines.

### v0.1.22: typing performance, explorer drift, drag duplicates, template race

Measured on a synthetic workspace the size of the real Novel (23 files, ~290k
characters, one chapter of 90k characters / 2,392 lines), Chromium, the same
2-vCPU host for both builds.

**Typing was ~25× slower than it needed to be.** At ~12 keys/s the median
keystroke reached the screen after 18.7 s (keys queued behind each other); now
0.71 s on the same throttled host, ~25–35 ms when it is not throttled. Causes, all
on every keystroke:

| Cost | Fix |
|---|---|
| The whole editor (2,392 lines, ~18k nodes) was rebuilt, then every line measured for the gutter | Only lines whose HTML changed are replaced; gutter heights are cached and rows patched. A MutationObserver tracks native edits so the cache is never trusted blindly |
| Every later layout read (scroll sync, chat, caret) paid for that rebuild: ~10 forced layouts per key | Typing no longer triggers the app-wide render; explorer, tabs, preview, links and chat catch up 250 ms after typing pauses (at least every 1.5 s) |
| Every line re-highlighted: tens of thousands of strings per key, GC pauses up to ~200 ms | Per-line highlight memo keyed by (text, fence state) |
| The project was `structuredClone`d per key, copying every file's text | Clone shares immutable strings, still an independent object graph |
| Undo kept a full copy of the document per entry (~72 MB at 400 entries on a long chapter) | Undo stores patches; one current copy |
| The whole project serialised to localStorage per render (and per collaborator keystroke) | Debounced (0.8 s, at most 3 s), flushed on pagehide / tab hidden |
| Preview re-rendered even for a different file, or when nothing changed | Skipped when its inputs are unchanged |
| Chat re-rendered markdown for every message on every render — cost grew with conversation length | Memoised per message; scroll only touched when the conversation changes |
| Linked Notes re-parsed every markdown file in the workspace for backlinks | Memoised per file content |
| `text[i]` scans on CJK text (patch diff, overview ruler) allocated a string per character | `charCodeAt` / `indexOf` |
| Sync fingerprinted the whole project after every confirmed patch | Lazy; computed only when a whole-project publish compares it |

Net: allocation 13.2 → 1.7 MB per keystroke; over 30 keystrokes, major GCs 131 → 21
and minor 276 → 48; DOM nodes replaced per keystroke 5,262 → 2 in the editor and
11,481 → ~3,800 (amortised, during pauses only) in the preview.

**Explorer crept up while typing (Chromium).** It was rebuilt on every keystroke,
and Chromium's scroll anchoring re-picked an anchor after each rebuild — 299 → 29 px
over 30 keys in the reproduction. Firefox was unaffected. The tree now skips
rebuilds when nothing it shows changed, preserves its scroll position when it does
rebuild, and sets `overflow-anchor: none`. Either of the last two alone prevents
the drift on real rebuilds (a collaborator adding files).

**A drag in the explorer left a copy.** Moves were never sent to the server; the
server kept the old path and the next reconnect's reconcile — which can only add
what the server lacks — uploaded the file at its new path, so both existed. This is
also why `第七回试写.md` could not be moved out of the root. Added a server
`move-node` operation (validation and ordering mirror the browser's `moveNode`;
both are tested against one shared case table) and the explorer now publishes it,
re-keying any pending text patch first as rename does. Agent-proposed moves, which
the server previously rejected as unsupported, now apply. Also fixed an
off-by-one: a file dropped after the last item of its own folder landed one above
the bottom.

**The first-run template could replace a cloud workspace.** On a fresh browser the
welcome template loads file by file; if the workspace restored first, the template
replaced it on screen inside the synced session, and a reconnect then uploaded the
template files into the cloud workspace (reproduced). The template is now ignored
if a workspace, another project or edits arrived first.

Sync compatibility raised to **115**: older tabs never send `move-node` and would
keep creating duplicates, so they must reload. Checked and found clean: no
accumulation of timers, event streams, DOM nodes or listeners across reconnects
and file switches (an apparent per-switch growth was the test tooling holding
element handles).

Tests: `tests/move-node.test.py`, `tests/move-node.test.mjs` (shared
`move-node-cases.json`), `tests/editor-typing-browser.py` (fails on v0.1.21: 12,050
line elements for 10 keys), `tests/template-race-browser.py` (fails on v0.1.21).

### v0.1.21: mobile keyboard blank-area scrolling

The page now stays the same height as the visible app when the mobile keyboard reduces the viewport. Chromium is asked to resize its layout viewport with the keyboard; root overscroll and scroll chaining from the editor, preview, and explorer are contained. A browser regression reproduces the former 844px document behind a 350px app and verifies the corrected layout.

### v0.1.20: mobile browser caret restoration

The editor saves its caret before a touch on the explorer or another control can clear the browser selection. Blurred editor ranges are ignored so a stale zero-offset range cannot overwrite the saved position. Native typing, programmatic edits, and IME completion also save the restored caret immediately. A mobile Chromium touch regression verifies return through the explorer and reload.

### v0.1.19: editor caret and selection restoration

The browser now remembers each file's source caret or text selection and restores it after switching files, reloading, or returning from a cloud session refresh. Saved offsets are scoped to the workspace and clamped when content changes. Restoring a file does not steal focus from another control; the saved position is applied when the editor receives focus.


### v0.1.18: sleeping-tab recovery and stale presence

An account or PIN session opened by this release renews a 75-second presence lease while its tab is visible. The server expires the token and broadcasts departure when the heartbeat stops, even if a mobile browser leaves a TCP stream apparently open; a tab-close signal removes it immediately when delivered. Returning to a sleeping cloud tab reconnects automatically and keeps the workspace on screen. The no-file view does not offer Resume when the same workspace is already connected or reconnecting. Older tabs remain on their prior stream-close behavior until refreshed.


### v0.1.17: optional in-app MCP read tools

Agent chat can discover owner-configured Streamable HTTP connections, limited to approved teams and declared read-only tools. Connections are loaded or checked only on request; the selection is per account/workspace in the tab. No actual provider is enabled until an owner supplies an endpoint and credential. See [MCP setup](MCP.md).


### v0.1.16: automatic phone/session recovery and working Resume

- Startup failures retry with backoff; returning to the app, browser history
  restoration, or regaining connectivity immediately resumes pending recovery.
  Recovery attempts are serialized, including repeated Resume/foreground events.
- Foreground recovery replaces silently dead streams and refreshes expired account
  sessions using the existing proven-login credentials. A temporary login outage
  retries instead of permanently disconnecting. Replaced streams cannot deliver
  late callbacks into the new connection.
- Resume accepts team-root workspaces (empty relative path), can sign in again,
  and restores the active file even when a connection already appears healthy.
  Local tab/file state survives suspension; if a remembered file is gone, another
  existing file is selected rather than leaving a populated workspace at welcome.
- Failed workspace opens retain the visible draft. Recovery uses the existing
  revision checks and conflict snapshots instead of overwriting newer cloud text.
- Visibility/pagehide saves replace reliance on beforeunload alone. Login/open/
  state/write requests have a 15-second timeout so a stalled request cannot hold
  restoration indefinitely; write timeout remains an ambiguous result, handled by
  existing recovery rather than treated as a confirmed rejection.
- Logout invalidates pending authentication and workspace-open results. Automatic
  restoration does not open the explorer drawer or show an Opened notification.
- Browser regressions cover offline boot, transient workspace-open failures,
  root-path/connected-empty Resume, silent foreground recovery, duplicate events,
  newer cloud text, local view persistence, expired credentials with a login
  outage, and logout during pending reauthentication. Uses isolated mocked data.


### v0.1.15: mobile navigation and writing polish

- Navigation, rename, explorer rows, formatting, Find/Replace, and dialog-close
  controls use larger touch targets. Formatting stays on one scrollable row.
- Expanded app menus scroll within the available screen height. Find/Replace
  controls wrap into a phone-sized layout; dialogs use the visual viewport height.
- Text input, selection, horizontally scrolling content, and the diagram canvas
  own their gestures. Cancelled touches and multitouch restore the original pane;
  reversing a swipe or tapping a pane during animation cannot switch it later.
- Chat collapse and View menu commands now navigate the mobile panes without
  changing saved desktop layout settings. Menu and explorer flyouts are exclusive;
  crossing the desktop breakpoint restores the saved chat visibility.
- Height-only resize events no longer rebuild the source editor, preserving the
  caret when keyboard/browser chrome changes. Width reflow defers during IME input.
- Both public-origin browser suites pass at five mobile/tablet viewport sizes
  with isolated data and mocked chat. Physical-device verification is deferred.


### v0.1.14: chat reliability and mobile interaction

- Agent turns are bound to the originating workspace and connection. Switching
  workspaces cancels the turn, retains partial output, and ignores late responses.
  Delayed delete confirmations cannot affect the next workspace.
- Agent edits use generation-time document revisions and content checks. Changes
  made while the agent works cause its proposal to be marked not applied. Cloud
  operations apply to the requesting browser only after server confirmation.
- Shared chat saves use an independent revision, atomic persistence, and ordered
  broadcasts. Conflicts merge threads/messages by ID; stale full-state saves are
  refused. Selection, composer drafts, and attachments stay local to each device.
- Chat caches use server + workspace identity rather than the shared project ID.
  Private-mode chat never publishes through a lingering cloud connection. The
  last-open workspace's legacy browser cache is migrated without deleting it.
- Attached-file context is read from the submitted message, after the composer
  clears its chips. Interrupted replies and reasoning metadata survive cache reload.
- Mobile Enter adds a newline; composition Enter never submits. Touch controls
  and the composer are larger; the chat input keeps 16px text. Visual viewport
  sizing follows keyboard height. Physical iOS verification remains outstanding.
- Streaming preserves scroll position and existing message DOM/selection. Draft
  typing updates the send control without rebuilding the conversation.

MCP integration is intentionally a separate follow-up. These changes retain the
existing chat provider and security settings. Compatibility floor: 114.


### v0.1.13: concurrent editing and local-save follow-up

- **A — Concurrent text divergence:** deterministic insertion ties on client and
  server; queued typing rebased alongside sent patches; HTTP/SSE confirmations
  share ordered event handling. Ambiguous overlapping replacements recover the
  local draft through Snapshots rather than guessing at a merge.
- **B — Patches across replacements:** whole-file/tree replacement, restore,
  delete/recreate, and file/folder rename act as rebase barriers. Obsolete patches
  receive 409. Removed text must match; invalid/future base revisions are refused.
- **C — False save confirmation:** local writes are serialized and failures
  propagate. Automatic and explicit saves only clear dirty for unchanged content
  and paths in the same workspace. Continued typing remains dirty.
- **Collapsed-folder data loss:** disk persistence walks the complete tree rather
  than the visible explorer rows. Collapsing a folder no longer removes its files.
- Rename saves write new paths before removing old paths; retries tolerate partial
  cleanup and use the last completed disk index. Cloud rename collisions are
  refused. Browser-storage quota errors no longer abort the editor's sync handler.
- Undoing an unsent edit to its original content clears its pending-sync status.

Validation includes two production clients and the Python broker over stdio,
HTTP/SSE ordering, exhaustive short splice pairs, save failure injection, and the
actual UI save handlers. Release v0.1.13 requires sync compatibility 113 because
older clients use the unsafe transform/acknowledgment behavior.


### September 22 follow-up: sync recovery and durable saves

- Reconnect and conflict recovery no longer upload dirty old files with a newly
  fetched revision. Divergent local text (including files deleted upstream) is
  saved as a **Recovery** version in Snapshots before adopting the cloud copy.
  If preservation fails, sync pauses and the local draft stays on screen.
- Reconciliation keeps the original base revision across all files and rechecks
  it after fetching. A peer changing the workspace during recovery cannot grant
  permission to overwrite their content.
- Rejected patches release their in-flight slot, preserve the draft and pull a
  fresh base. Transport failures reconnect cloud sessions. Delayed responses from
  an earlier session cannot modify the new session.
- Patch offsets and OT lengths use UTF-16 units on both sides; the browser diff
  avoids splitting emoji surrogate pairs.
- Stream `ready` revisions detect changes between the initial fetch and the
  subscription. Catch-up buffers events, ignores already included revisions, and
  detects later gaps. The server queues mutation broadcasts in revision order.
- Workspace writes use an fsynced redo journal, atomic file replacements, and
  manifest-last commits. Startup replays interrupted commits. Unchanged text
  files are skipped during ordinary commits. Snapshot blobs/indexes are flushed
  before recovery history is acknowledged. Directory fsync is POSIX-only;
  Windows still uses flushed files and atomic replacement.

Regression coverage: `npm run test:reliability` runs the real browser sync runtime
with fake transport/timers and the Python broker with temporary workspaces and
injected storage failures. It also includes the existing broker regressions.
No localhost listener or live workspace is needed. Deploy frontend and backend
together: app release v0.1.12 uses minimum sync compatibility 112, including full-state
writes, so cached clients with the unsafe recovery path are refused.


### Sync and data loss — the serious cluster

| # | Issue | Why it mattered |
|---|-------|-----------------|
| 1 | **A rejected operation tore down the whole connection** | A single 400 called `disconnect()`. After that `notifyEditorChanged` stopped queueing patches entirely, so editing continued into a dead session — the server revision sat frozen at 36737 for 12+ hours. |
| 2 | **No server-side stale-write protection** | `baseRevision` was read in exactly one place (rebasing patch offsets) and gated nothing. `update-file` and `set_state` overwrote content from any revision. This is how an old tab clobbered newer work. |
| 3 | `set_state` bypassed operation handling entirely | The publish path wiped the workspace directory with zero checks, and was not logged as an operation — which is why it did not appear in the first log search. |
| 4 | Patches rebased against a partial log | When the base predated the log window, edits landed at **wrong offsets** — corruption rather than a clean overwrite. |
| 5 | A dropped connection stopped syncing permanently | Disconnect flipped `workspaceMode` to `"private"`, which silently disabled all patching for the rest of the session. |
| 6 | Pulls discarded unsaved work | `reloadFromServer` and the SSE `state` handler replaced the project wholesale with no merge. |

**Now enforced on the server** (inside the mutation lock), because client-side gating
is inherently incomplete — any missed path, or any old cached build, bypasses it:

- `update-file` must declare `baseRevision`; refused if that path changed later.
- `set_state` must be based on the current revision.
- `patch-file` is refused when its base is too old to rebase faithfully.
- Conflicts return **409** so the client pulls the newer copy instead of diverging.
- `MIN_CLIENT_VERSION` locks out old cached builds at the door.

### Other fixes

- **Agent had no interrupt.** Added a Stop control that preserves partial output.
- **The agent's model id was invalid.** `deepseek-v4-flash` is not a real model —
  every request had been failing at the provider with 502. Now `deepseek-flash`.
- **Snapshots were browser-local** and keyed by a project id most workspaces share
  (`server-project`), so they neither followed devices nor stayed separate between
  workspaces. Rebuilt server-side with migration of existing local history.
- **Font switching appeared to do nothing** — it worked, but 11 of the 12 offered
  fonts were not installed, and the UI gave no hint. Now detects availability.
- **Search kept stale matches across a file switch**, producing phantom highlights
  and navigation into offsets from the previous document.
- bmap: single-line `styles` failed to parse; CJK text did not wrap in SVG/PNG export.
- Mobile: stale pane caption; Snapshots dialog overflowed the viewport.
- Two temporal-dead-zone crashes caught before deploying.

### Regressions introduced during this pass, and corrected

Recorded deliberately — each was caused by a fix:

- Snapshots were first built **client-side** when server-side was expected. Rebuilt.
- "Reconcile when dirty" + "never clear dirty offline" combined to make every stale
  device look like it had unsaved work — **this caused a stale-device clobber**.
  Replaced with revision gating.
- `sourceVersion` was nearly used as the conflict token. It would have **broken
  saving entirely**: the client bumps it on autosave, the server per operation, so
  the counters drift apart permanently. Caught before deploy.
- `saveSettings` on `beforeunload` meant closing one tab could wipe settings changed
  in another. Now a scoped merge.
