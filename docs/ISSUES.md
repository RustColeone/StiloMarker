# Known Issues

Findings from the September 2026 reliability pass. Split into what is **still
open** (needs a decision) and what is **already fixed and deployed**, with
confidence stated — some items are confirmed, some are suspicions that could not
be proven.

Last updated: 2026-10-21 · release `v0.2.19` (deployed with v0.2.17–v0.2.18; public checks passed)

---

## Open

From the stability review of 2026-10-21 (the app as a PWA, in Electron, with
the user's own key and no server; each found by an experiment). Being fixed in
this order (O7 with O1); the storage limit (O0) was fixed in v0.2.19.

### O1. Two windows on one in-browser workspace overwrite each other

Confirmed (two windows, an edit in each): the later save wins, the other
window's edit is lost, and neither window sees the other's. Decided: both
windows live, as two devices on a cloud workspace (one window brokers the
edits for the others, through the browser).

### O7. Joining a shared session, then reloading, loses the in-browser workspace

Confirmed (an in-browser workspace, a PIN session joined, a reload, the
session left): the browser keeps one copy, which after joining is the shared
workspace's; the one kept aside to come back on leaving lives only in memory,
so after a reload leaving shows an empty workspace and the in-browser one is
gone. Joining warns that the host's workspace replaces the current one, but
also keeps it aside as if it were safe. To be fixed with O1: a copy per
workspace (an in-browser workspace is never overwritten by another's).

### O2. Typing slows with the size of the file

Measured on the server (2 slow cores): about 0.25 s a key at 22 KB, 1 s at
89 KB, 1.3–4.3 s at 450 KB. A long chapter kept in one file lags.

### O3. The agent with the user's own key needs the server

Confirmed (no server, a stand-in model): the Agent sends its request and the
key through the server's `/api/chat` ("Failed to fetch", the model never
called, though its status said ready); Chats' "in this browser" replies still
ask the server for the prompt first.

### O4. Offline edits to a cloud workspace are not merged on reconnect

By design so far: pushed only if nobody changed the workspace meanwhile;
otherwise the server's version opens and the offline edits are kept in
Snapshots, even when they touched other files. To be merged per file.

### O5. Not installable as a PWA; updates mix versions; libraries from a CDN

No web app manifest or icons. A new service worker takes over open tabs at
once while parts of the app load later (a tab can mix versions). MathJax
(unpinned `@3`) and Mermaid load from a CDN, so they fail offline.

### O6. Electron

Not packaged yet. Known needs: a fixed custom scheme (not `file://`, not a
random port), the leave-page question handled by the main process (it
silently blocks closing), links opened outside, a no-server mode, and an
update channel (a desktop build can't update itself as the web does).

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

---

## Fixed

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
