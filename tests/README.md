# Tests

Unit tests for the mdnotes / StlioMarker workspace. They run on the built-in
[Node.js test runner](https://nodejs.org/api/test.html) — **no dependencies to
install**.

## Run everything (the easy way)

| Platform | Command |
|----------|---------|
| Windows  | `tests\run-tests.bat` (or double-click it) |
| Linux/macOS | `./tests/run-tests.sh` |

Both scripts run the Node.js suite, Python backend self-test, and storage-failure regressions.

## Other entry points

```bash
npm run test:reliability # Sync recovery + broker/storage regressions, no HTTP listener
npm test                 # Node.js unit tests only (node --test tests/)
npm run selftest         # same suite via tools/selftest.mjs (prints "Self-test passed.")
npm run backend:selftest # Python backend self-test only
npm run test:all         # Node self-test + Python backend self-test
node --test tests/       # raw test runner
```

## Layout

| File | Covers |
|------|--------|
| `helpers/mocks.mjs` | Shared module loader + in-memory File System Access mocks (not a test file). |
| `helpers/chat_hook.py` | For browser tests: exposes the on-demand chat panel's internals (`window.__chatInternals`) and the matching getters for a test's hook object. |
| `project-model.test.mjs` | Project tree, file/folder ops, sync operations. |
| `rendering.test.mjs` | Markdown rendering + mtree module map. |
| `bmap-service.test.mjs` | `.bmap` node/connector parsing, normalization, serialization. |
| `url-album.test.mjs` | The URL album extension: its text format, the parts it offers Workspace, and what it registers. |
| `url-album-browser.py` | The URL album in the page, end to end, and the app running without the extension. |
| `zip-fs.test.mjs` | ZIP import/export and File System Access persistence; a folder or ZIP opened leaves out its own files at the top and text files over 5 MB, and says which. |
| `collaboration-runtime.test.mjs` | Production sync runtime: reconnect conflicts, recovery snapshots, request races, patch rejection, join gaps, Unicode; a PIN or hosted session's resume leaves its stream open and renews its lease (a refused lease is a session lost, a deliberate leave is not); an out-of-date tab stays so. |
| `collaboration-broker.test.mjs` | Two real clients + the Python broker over stdio, both send/ack orders. |
| `text-patch.test.mjs` | Exhaustive short splice-pair convergence and overlap rejection. |
| `explorer-filter.test.mjs` | The Explorer's name search (`explorer/model/filter.js`): the names holding the query in any case and the folders holding them, open, in the tree's order; nothing typed leaves the tree as it is; nothing found is no rows; the file Enter opens. |
| `explorer-filter-browser.py` | The name search in the page: the box above the tree (the tree keeps its height), typed it leaves the matching names with their folders open, nothing found said, Enter opens the first file found, Escape clears it and the folders keep their own state. |
| `cloud.test.py` | Cloud on the server: a team's project made (named by its folder, as is one opened from before, once called "Workspace"), deleted into the trash only by its owner, copied out with its images and brought in under a free name. |
| `area-pages-browser.py` | The areas' pages: the left window's icons (one shows its page, the one showing hides the window; the Explorer stays, no menu); every section's header in the Explorer drawn alike; a page moved by its menu or dragged onto another area (to a tab host a tab, its toolbar in the header or the left window's title row; to the Explorer a section; dropped on the left window or the activity bar a tab there); an emptied area says how to fill it; the moves kept over a reload and undone by moving back. |
| `tab-strip-browser.py` | The editor's tab strips: the tab in use is the darker one in a light and a dark theme; the pane's label set apart from its tabs by a border; a full strip shows no scrollbar (both headers one height) and the wheel scrolls it sideways. |
| `editor-view.test.mjs` | The Editor's view (tabs, what each pane shows, the selection): changed only through named actions, each traced; reset, pick and select, tabs opened once, closed (the preview falls back), moved, switched to the other view where it is (one already there folds in; the source editor and the preview move on as on closing), the diff tab, keeping tabs after the project changed. |
| `shell-settings.test.mjs` | Shell's settings: read-only to everyone (an assignment throws), changed through `settings.change`, each change traced with where it came from and secrets hidden, saved key by key without overwriting another tab's changes, the sync revision saved only with its workspace. |
| `sync-mode.test.mjs` | Sync's mode (sharing keeps the local project aside once, leaving hands it back, forgetKept, restore after a failed open) and the session's status (the session's reports change it, an out-of-date tab only learns that, read-only to others). |
| `project-save.test.mjs` | Queued writes, errors, typing during saves, collapsed folders, rename retries, UI save handlers. |
| `server-reliability.test.py` | Production broker: UTF-16, disk-failure recovery, ordered events, a lease refused once its stream is gone, and existing broker regressions. |
| `sync-service.test.mjs` | Collaboration transport against a mock HTTP server. |
| `agent-collaborator.test.mjs` | Agent proposal round-trips + agent-feature wiring. |
| `project-structure.test.mjs` | Required files, `index.html` ids, and source-symbol wiring. |
| `move-node.test.py` / `move-node.test.mjs` | Moves on the server (disk, ordering, refusals, patch barriers) and in the browser; both read `spec/workspace/move-node.cases.json` so peers and server order a moved file identically. |
| `static-compression.test.py` | Static files are gzipped only when accepted (q=0 honoured), small/binary files untouched, `Vary` sent, never stale after a file changes. |
| `workspace-backups.test.py` | Workspace backups: a backup only on days the workspace changed, one per day refreshed to its latest state, a safety copy before deletes/replacements (a burst shares one), retention with blob cleanup, images, permissions, and a final backup on shutdown. |
| `workspace-history-browser.py` | Browser + real backend (throwaway server): back up, delete everything from another account, restore one file, restore everything (backing up first), recover a deleted file via Snapshots. |
| `persona-service.test.mjs` | Roleplay character files: header parsing (quotes, comments, CRLF, bad colour/temperature), handles, @mentions (order, `@all`, e-mails, unknown names), summaries, the template. |
| `persona-chat.test.py` | Roleplay replies on the server: prompt holds the sheet and the other characters (not the app manual), read-only tools with writes refused, transcript mapping/merging and size budget, temperature limits, stale tabs refused. |
| `openai-images.test.py` | OpenAI as a second provider: models picked from the account's catalog (newest flagship + mini, newest image model; overrides), GPT requests routed to OpenAI without unsupported options while DeepSeek stays default, own keys never replaced, sign-in gate for the server's keys (agent, Roleplay, Quick Generate), image tool (only when signed in, max 2 per request, stored by id with owner-only access and expiry, errors without secrets). |
| `conversations.test.py` | Chats on the server (SQLite per project): a pair is reused, inviting into a pair starts a new group and keeps the pair, members only (non-members get nothing, live or stored), unread counts, paging, full-text search and its fallback, private notes, characters follow renamed/moved files, the database survives a publish and gets a daily backup only when it changed. Replies: a private character chat answers every message, in a group only the mentioned characters reply in order, never queued twice, Stop keeps partial text, failures are visible; a browser can claim and write a reply itself, an abandoned claim is closed, and the browser's prompt needs no server key. |
| `mention-parity.test.mjs` + `mention-parity.test.py` | The browser and the server parse @mentions and character handles the same way: both run `spec/characters/mentions.cases.json`. (Before 2026-10-16 only the browser half existed.) |
| `kernel.test.mjs` / `kernel.test.py` | The kernel on both ends (app/kernel, server/stilo/kernel): start order by level, only declared uses, refusals (undeclared, missing, same level, duplicate), a failed start stops the start, registries and emitters. The Python file also covers Transport: exact routes beat prefixes, data-route errors become 403/404/400 and bugs 500 (KeyError is a bug, not "not found"), CORS per route, every legacy route registered once. |
| `shell-module.test.mjs` | The Shell module's pure parts: shortcut parsing and matching (Mod = Ctrl or Cmd; Shift only when named; malformed shortcuts refused), menu layout order and live titles, command rules. |
| `file-types.test.mjs` / `file-types.test.py` | The File types module on both ends: both run `spec/file-types/type-of.cases.json` (longest extension wins, case, names that are only an extension); MIME types, accept lists and the Create order come from the one list; a new type is let in, a taken extension refused. Names kept at a workspace's top (`reserved`), and (server) that list covers every bookkeeping file a module keeps in a project's folder that is a known type. |
| `workspace-write.test.mjs` | The one write path: the line diff gives the target text for 500 random edits; an edit lands beside other people's changes and refuses to guess (same line changed, context not unique); `write()` commits patches, merges when the file moved on, is stale without changing anything when it cannot fit, replaces images whole; undo is the same write backwards; `asPatch` for restores; undo steps for the agent's creates, renames, moves and deletes. |
| `operations-parity.test.mjs` / `operations-parity.test.py` | Applying operations on both ends (the server half runs Workspace's pure `apply_operation`): both run `spec/workspace/operations.cases.json` (create, duplicate and missing-parent refusals, rename with contents, delete, update, text patches in UTF-16 units, mismatched patches refused, move, unknown file types refused on create and rename). It found the server accepting file types the browser refuses. A reserved name is refused at the top (created, renamed, moved there) and fine in a folder. |
| `characters-parity.test.mjs` / `characters-parity.test.py` | Character files on both ends: both run `spec/characters/sheets.cases.json` (headers with CRLF, BOM, quotes and comments; summaries; author's notes sections, also inside code fences and repeated; notes modes; a file without its notes; which paths characters cannot see). The browser half also checks `charactersView`. |
| `assistant-edits.test.py` | The agent's `edit_file`: exact passages change and the rest stays byte for byte; refusals name the edit and the reason (several matches, not found, empty, overlapping, too many); all or nothing; edits in one turn build on each other and carry their base and edits; missing files and images refused; the agent offers it and characters cannot use it. |
| `characters-browser.py` | Browser: a character's preview shows the sheet, and the author's notes only in a collapsed panel saying the character never sees them, or that `notes: hints` allows hints. |
| `write-path-browser.py` | Browser + real backend, two accounts, the agent's reply mocked: Bob types while Anna's agent edits the same file and both edits end up in both browsers and on disk; Drop undoes only the agent's line; an agent edit to a line Bob changed is refused; a restore goes out as a patch; nothing sends a whole-file update for text. |
| `identity.test.py` / `identity.test.mjs` | Identity and access. Server: who may open a project (team, whitelist, blacklist), roles and what each may do, only the owner changes access and the first setter becomes owner, sign-in tokens with team changes applied at once, sign-out, remembered workspace, a project from before access files keeps its members, and the module's routes over HTTP. Browser: signing in by itself only where that account signed in before with its token kept, sign-in (the token kept, never the password), drop, restore with the token (no password sent), sign-out (ended on the server too; the username stays), a cancelled sign-in stores nothing, a page from before v0.3.1 signing in once with its kept password and then keeping the token only, an ended token forgotten, access calls carry the token. |
| `models.test.py` / `models.test.mjs` | Models. Server: each model goes to its provider (DeepSeek, OpenAI, GPT 6 through the Responses API), unknown ones get the default, a user's own key goes where they say; a chat stream shows reasoning, text and tool-writing progress and returns the whole reply (with the model's options and the organization header); GPT 6 in Responses form without temperature; a request without streaming. Browser: a streamed reply put back together, the picker's grouping and choice, a reply from the user's own endpoint answering tool calls from the browser (and the refusal for others), and clear errors for a refusal, an unreachable endpoint or no URL. |
| `sync.test.py` / `sync-rebase.test.mjs` | Sync. Both run `spec/sync/rebase.cases.json` (rebasing a text patch over an earlier one, conflicts included). Server: the rebase log's barriers (a rename, a move covering everything under a folder, a reset after a restart) and its size; a shared workspace over a store faked in memory: concurrent typing merges and everyone hears the rebased place, stale writes are refused and change nothing, roles decide who may write and replace (a dropped stream keeps its role), hooks hear destructive changes and moves, a failed commit is undone before anything else. |
| `backend-selftest.py` | The backend end to end over HTTP and the event stream (PIN sessions, patches and their rebase, stale writes refused, accounts, team workspaces, access and readers, backups, snapshots, publishing). It was `mdnotes_server.py --selftest` until v0.1.41; `server-reliability.test.py` also runs its broker part. |
| `history.test.py` / `history.test.mjs` | History. Server: file keys, which snapshots go when over budget, when a backup is skipped (nothing changed, a burst), retention (two weeks, then weeks, then months; old safety copies go), the content-addressed store (kept once, deleted with its last reference), snapshots (dedupe, import with its time, per-file cap, delete) and backups (text and images captured, skipped when unchanged, one daily per day) over a workspace faked in memory. Browser: the line diff, and History's calls (token, project, failures). |
| `comments.test.py` / `comments.test.mjs` | Comments. Server: adding, editing (which may move it), moving and deleting a line comment, its refusals, and the service keeping them in the project folder and telling the live workspace (and not when nothing changed). Browser: a comment follows its line by the line's text to the nearest match, a saved comment replaces its old copy in line order, and the save call. |
| `comments-browser.py` | Browser + real backend, two accounts: a comment made from the gutter reaches the other browser at once and the server keeps it; a line added above moves it with its line in both browsers and on the server; deleting it removes it for everyone. |
| `identity-browser.py` | Browser + real backend, two accounts: a wrong password shows the server's refusal; signing in shows the account and its team and stores the sign-in; a reload signs in again by itself, also after the server restarted (the same token); the access dialog reads and saves a project's lists on the server; someone who is not the owner is refused; a page from before v0.3.1 that kept a password signs in with it once and keeps a token instead; signing out ends the token on the server, keeps the username and stays signed out after a reload. |
| `shell-browser.py` | Browser, the first modules in the page: File types fills the file inputs' accept lists, the supported-types text and the new-file type picker; the Shell module: five menus drawn from commands, one open at a time, live titles, a menu item runs its command, Ctrl+S runs Save, rename keeps the extension, menus and commands added after start-up appear, the phone menu panel. |
| `command-line.test.mjs` / `log-commands-browser.py` | The Log's command line and Reload Window (Shell). Node: finding a command by words, keywords, id or letters in order, nothing typed lists all (Reload Window first, then the recent), commands needing arguments never offered; Reload Window's steps in order, a problem or a hung step asks, staying reloads nothing. Browser: F1 opens the line; suggestions narrow; Enter, arrows, Tab, Escape; help and unknown commands; a plain reload asks "Leave site?", Reload Window doesn't and brings back the edit, the file and the caret; the phone's sheet. |
| `themes.test.mjs` / `themes-browser.py` | Themes (Shell's, and the theme-pack extension's). Node: the tokens a theme may set, Light and Dark equal to styles.css's values, a theme refused for an unknown token or a value that is not a colour, System and unknown themes falling back, every contributed theme usable, every theme's contrast (text, links, syntax colours, status bar, buttons), applying one and keeping it. Browser: Change Theme… and the cards, a theme applied at once and kept across a reload, shown by the early script with the app's code blocked, System following the device. |
| `markdown-syntax.test.mjs` | Markdown in the preview and the source highlighting: lists (`-`, `*`, `+`, numbered from their first number, nested by indent, tasks, continued and ended), rules, fences indented under an item, strikethrough, footnotes numbered as first referred to; every highlighted line shows exactly its text (spaces after a list marker included). |
| `dialogs.test.mjs` | Shell's small dialogs asked with only their text: the first sentence is the title (a dot inside a name is no end), the rest the message; a sentence too long for a title stays the message. |
| `browser-copy-browser.py` | This browser's copies of workspaces (IndexedDB, one per workspace): v0.2.19's copy and journal moved over once, the old database removed, and an older localStorage copy too; a workspace past 5 MB saved and reloaded; a failing write said (a notice, a red status item) and its files kept marked; what changed journaled as the page goes and there on the next load; saving again said; a new project is a copy of its own and the next load opens it; Reset and Empty Everything leave no older copy, and another open window follows them, writing nothing back. `helpers/browser_copy.py` reads the stored copies for other tests. |
| `agent-here-browser.py` | The Agent with the user's own key and no server: every /api/ request refused, a stand-in model on another origin; ready from this browser, a turn reads a file, proposes an edit and answers (streamed), Keep keeps it, the server never asked; through an unreachable server the status says so and how to work without it; Chats in the same browser-only workspace: a character's reply from the same endpoint, its request built in the browser (sheet, never author's notes; read-only tools). |
| `agent-tools.test.mjs` | The agent this browser runs: `spec/assistant/tools.cases.json` (its tools) and `spec/assistant/request.cases.json` (its first request, as the server's), a whole turn with tools, the context budget, stopping and an empty answer. |
| `reply-request.test.mjs` | A character's request as the browser builds it for a reply it writes with the user's own endpoint: `spec/characters/reply-request.cases.json` (the server's half is `persona-chat.test.py`). |
| `linked-windows-browser.py` | This browser's windows on one workspace, linked live: alone a window starts nothing; typing in either shows in the other, both typing in one file converge, a file made in one appears in the other; only the first window writes this browser's copy (with the other's typing) and the other's marks clear; the status bar says "2 windows"; the first closes and the other takes over and saves; a third and a reloaded window join; an edit in each, then a new window, has both (experiment E2). |
| `tab-link.test.mjs` | The link between windows (`sync/adapters/tabs.js`) with two production sync runtimes over a real BroadcastChannel and a stand-in for Web Locks: typing both ways, converging, a new file, counting each other; the leading window crashes, the other takes over, a third joins it. |
| `sync-broker.test.mjs` | The broker that orders the linked windows' edits: concurrent patches put in order, what it refuses (409/400), a follower's copy taking over in the same state, touched paths; the browser's rebase log answers a scenario as the server's RebaseLog does (run in Python). |
| `desktop.test.mjs` | The desktop app's rules (`desktop/policy.mjs`): what the window may load (and what never: the server's code, dotfiles, paths outside), the no-server answer, where links go, which releases are newer, that the build carries exactly the allowed files at the app's version, the bridge's calls (no others) in an isolated, sandboxed window; Shell's release watcher; the zoom's steps and keys (Cmd on a Mac), and the page's Zoom In / Out / Reset and its status bar item; the right-click menu (suggestions, Add to Dictionary, Select All as the page's own Ctrl+A). |
| `desktop-server.test.mjs` | The desktop app's server (`desktop/server-policy.mjs`, `server.mjs`): the kept choice made whole, where `/api/` requests go and with which headers, the server's command line, which Python; the server started with this computer's Python, answering, stopped (its port closes); a taken port moves on; no Python said. Its accounts: the tool's command line, the count; the first admin made by the real tool (hashed, owner-only, a short password refused, a second refused). |
| `parent-watch.test.py` | The server ends with the program that runs it (`stilo/kernel/parent.py`, `--parent-pid`): a running process told from an ended one, stop called once it is gone, and the server itself stopping when its parent ends. |
| `desktop-browser.py` | The desktop app in Electron (`STILO_ELECTRON`, or `npm install` in `desktop/`; skipped without it) on a virtual display, through `desktop-smoke.mjs`: loads from `app://stilo/`, no server and nothing else served, no service worker; a formula and a diagram; links and a navigation away open outside; a newer release shown and opened; the zoom's keys (never reaching the page) and Ctrl+wheel, said in the status bar; closing with unsaved work asks (Stay, then Leave); reopened, the work and the zoom are there, Ctrl+0 resets it; a second start hands over. Its server (Settings → Server): run here, reached through the app, shared on, and someone else joining with its PIN finds the typing; reopened, it starts again and the app is back on its session by itself; quit, it stops; another server reached and joined; none, offline. Accounts: off, turned on from Settings → Server, the first admin hashed and signed in, Settings → Accounts shown. |
| `pwa-browser.py` | The app as an installed web app, served for real (a copy over HTTP, its service worker running): the manifest and its icons at the sizes it says; served first as 0.2.24, it is replaced by this version at once; a formula and a Mermaid diagram from the libraries served with it, and both again offline; a new version waits (the tab keeps its own and says Update ready), Reload Window starts it, another open window follows into it, and right after a reload (the version kept) Reload Window still starts it; nothing from a CDN. |
| `vendor.test.mjs` | The libraries served with the app (`vendor/`): each file is the one `vendor/README.md` lists (version folder, SHA-256, licence beside it), and the code loads exactly those, never a CDN. |
| `offline-merge-browser.py` | What a tab does while it can't reach a cloud workspace, merged when it is back (a real backend): edits on different lines of one file and in other files both land, a file made away is made, nothing to Snapshots; the same line changed by both: the other's stands, hers kept in Snapshots and said; a reload while the server can't be reached. |
| `offline-merge.test.mjs` | The merge after being away (`sync/service/offline-merge.js`) against a stand-in server: only here, both (merged or kept), renamed and edited, deletions only of what nobody changed, unchanged (text first), a failing connection and a refusal. |
| `sync-merge.test.mjs` | The line-by-line three-way merge (`sync/model/merge.js`): what it keeps, what it refuses, long texts, and its line diff rebuilding every small pair of texts. |
| `own-workspace-browser.py` | This browser's own workspace is never lost to a shared one (a real backend): a PIN session joined as a guest leaves the own copy untouched beside the shared one; typing in the shared workspace reaches the server and only the shared copy; switching back brings the own workspace back, and after a reload too (the pointer names it), again after another reload. |
| `structure/structure.test.mjs` | The eight architecture rules in docs/ARCHITECTURE.md: module imports and levels, one owner per type name, no I/O in model/service code, twin rules with shared cases, the network contract against the code, size budgets. Legacy violations are in `structure/baseline.json` and may only shrink (`node tools/structure-baseline.mjs`). |
| `agent-images.test.mjs` | Saving a generated image: fetched for the signed-in account, saved as a data URL locally, uploaded (not sent in the operation) in a directory-backed cloud workspace, refused with a reason when expired or signed out; the agent still cannot write image bytes itself. |
| `agent-images-browser.py` | Browser: signed out the agent asks for a sign-in and sends nothing; signed in the model picker groups DeepSeek/OpenAI, the GPT model and account token are sent, a generated image is shown in the edit card and saved as a file, chat history keeps only the image id. |
| `local-chats.test.mjs` | Chats in a browser-only workspace: pair reuse, a character answers every private message, group mentions in order with earlier replies visible, invite into a pair starts a group, Stop keeps partial text, unread / search / notes, old Roleplay threads imported, renamed character files followed. |
| `chats-browser.py` | Browser + real backend + a fake streaming model, two accounts: live private message with unread badge, read clears it, private alias, search and jump, invite into a pair starts a new group (pair kept), group @mention reply watched live by both, narration gets none, private character chat, a reply written by a member's own browser from a local model (CORS fake) reaching everyone live, phone width. |
| `chats-local-browser.py` | Browser, mocked API, browser-only workspace: characters only (with a note), old Roleplay chat moved into Chats, private character chat, group mention suggestions and @all order, Stop, rename of a character file, kept after reload, tabs never covered, phone width. |
| `search-files-browser.py` | Find in Files: Ctrl+Shift+F shows the left window's Search tab (not the find bar; on a phone, in the drawer, its box wide and its rows inside it); results across files grouped with lines and totals, Chinese too; match case, whole word, regular expressions and an invalid one; a click opens a match on line 15,001 of a long file, in view; an edit searches again; Replace All asks and replaces everywhere, Undo puts it back, and leaves a file changed since; an album left out of Replace, and said; 20,000+ results said, Replace asking with the true count; typing just before Replace kept; a selected word as the query. |
| `editor-search.test.mjs` | Searching text (`editor/model/search.js`, the find bar's and Find in Files'): patterns and options, matches (an empty match moves on, a limit), lines and columns, snippets cut with …, replacing (plain literal, a regular expression's `$1` in context); whole words in any script, `^` and `$` a line's, an emoji one character, a regular expression for the older rules; one match replaced where it is (the find bar). |
| `data-table-browser.py` | Plain text, JSON and tables: `.txt`/`.log` with no Markdown colours or toolbar and a plain preview; `.json` coloured, its preview valid and formatted or where it is not; a 20,000-row `.csv` in the table editor (a few hundred cells drawn, the header found and kept in view, a column summed up, row 15,001 drawn quickly); typed over (that record alone changes, quoted as needed), Enter, Tab, F2, Escape, Ctrl+Z and Ctrl+Shift+Z; an input method's text; the blank row at the end; a block copied as tab-separated text and pasted; rows and columns inserted and deleted by a right click; someone else's edit shown at once, an edit begun before rows came in above landing on its row, the same row changed meanwhile said; undo putting back only the grid's own change, a step that no longer fits kept; the menu saying how many rows it inserts; a cell over lines in a CRLF file left as it was; a semicolon table staying one, read by tabs once renamed `.tsv`; a `.tsv` by tabs, the source's column colours. |
| `desktop-follow-browser.py` | A live PIN session is not joined again by itself (a stand-in for the desktop bridge): a resume (the network back) and a change of the desktop server's state make no second join (which dropped the session and, after Share This Workspace, took the server's copy over unsent typing). |
| `spellcheck-browser.py` | The spelling check setting: off at first; Settings → Appearance turns the browser's check on in the source editor; kept over a reload; off again. |
| `accounts-browser.py` | Settings → Accounts on a real backend whose file keeps passwords as typed: an ordinary account sees no page; the admin's list (never a password); an account added signs in; a password set (the old one fails) and teams changed; a removed account signed out at once; a short password refused with the server's reason; the last admin kept until another is made. |
| `accounts.test.py` | Accounts (Identity): salted scrypt hashes (plaintext from before still signs in), the rules shared by the admin page and `server/accounts.py` (the last admin stays), the file written whole and private, the command line (convert, add, password, admin, remove, list), the admin operations (admins only; a removed account signed out). |
| `shaky-connection-browser.py` | A shaky connection is said: a PIN session's first drop rejoins quietly; a second soon after says the connection keeps dropping (words typed just before a drop may not reach the others). Leaving on purpose and a drop while the tab is hidden do not count; back to the tab, the stream stays open and the lease is renewed; a refused lease is a drop. |
| `sync-shaky.test.mjs` | When drops are shaky (`sync/model/shaky.js`): two within ten minutes said, at most once in a while; drops far apart not. |
| `extension-api.test.mjs` | The extension API (`protocol/extension-api.json`, `docs/EXTENSIONS.md`): every extension declares its version and only the manifest fields the API reads; it imports, uses and calls only what is listed (also what `editor.parts()` and `workspace.project()` return); everything listed exists in the modules; the page names all of it; one written for another version is refused (`protocol-sync`) and left out by the server (`file-types.test.py`). A probe of made-up files shows the test reads a module's API under another name, destructured, over lines, kept in a getter or function, the context destructured, and refuses brackets and namespace or dynamic imports of the app. |
| `account-security.test.py` | An account loses what it may no longer have: removed, given a new password or taken out of a team (on the admin page, by the command line or by hand), its sign-ins and its sessions in the team projects end (its own password change keeps its page signed in); sign-ins kept on disk as hashes (a restart ends none, the file signs no one in, signing out and a new password end them for good, 30 days unused ends one, each use keeps it; signing in again and out over HTTP); wrong passwords make a name wait a minute; a name with no account is checked as long; the file read only as it should be; one that does not read is never written over; account names with nothing invisible or look-alike, team names that are folder names, spelled one way; the account file never served under any spelling or name; a password from standard input as UTF-8. |
| `path-safety.test.py` | Nothing reaches outside a workspace's folder: names that walk out refused by every operation; a whole project that does refused; the folder store never writing, replaying or deleting outside; the server's own file under another spelling on disk; uploads only by editors, only images; only the workspace's own files served; a folder inside a project is no project. |
| `data-table.test.mjs` | A delimited table (`extensions/data-table/browser/model/table.js`): records as written (quotes, doubled quotes, line breaks in quotes, CRLF, tabs, a semicolon `.csv`), a cell set rewriting its record only, rows and columns added and removed (blank lines among rows left blank), new rows ending as the file's lines do, the delimiter guessed past quotes, a pasted block and the clipboard's form (a last empty row a row), the numbers in a block, a header guessed, column names, 20,000 rows. |
| `editor-json.test.mjs` | JSON files (`editor/model/json.js`): a line's colours, valid (formatted) or where it stops (`errorAt`: trailing commas, missing colons, leading zeros, raw control characters, bad escapes, single quotes; nesting 200,000 deep), a value in a few words. |
| `editor-lazy-browser.py` | A very long file (20,000 lines, ~470 KB, a ``` fence in the middle; lazy rendering): a few hundred lines in the page; a key's work and time to the screen; scrolled to the middle and the end, the lines and numbers shown are the model's; the fence highlighted across the page's edge; a caret out of view comes back with the key; Select All keeps the page small, copies the whole text, is typed over and undone; an 8,900-line Shift-click selection deletes exactly that range; find near the end; someone else's edit keeps the view; word wrap off. |
| `editor-typing-browser.py` | Browser: a long chapter stays correct and incremental while typing (DOM/gutter/caret/highlight per edit, incremental == full render, churn budget, undo/redo, no explorer drift); on an 89 KB chapter a keystroke's own work stays under 40 ms and the editor is drawn right on a pause. |
| `template-race-browser.py` | Browser: the first-run template never replaces a cloud workspace that restored first. |

## Adding a test

Create `tests/<name>.test.mjs` and import shared helpers:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadModules } from "./helpers/mocks.mjs";

const { projectModel } = await loadModules();

test("describes the behavior", () => {
  assert.equal(1 + 1, 2);
});
```

The runner auto-discovers any file matching `*.test.mjs`.


## Chat and mobile regression checks

- `chat-sync.test.mjs`: simultaneous chat saves, conflict merging, late responses,
  local drafts/selection, cache metadata, IME input, viewport resizing, and wire compatibility.
- `chat-turn.test.mjs`: the production turn handlers under workspace changes,
  transport cancellation, stale proposals, and delayed delete confirmation.
- `mobile-chat-browser.py`: optional Playwright browser test using the public
  origin, isolated browser storage, staged static responses, and mocked chat APIs.
  Checks five viewport sizes, composing/sending, attachments, draft switching,
  scroll/selection preservation, and cloud chat isolation. It makes no paid model
  calls and does not open a real user's cloud project.

With Python Playwright and a Chromium browser installed:

```bash
python3 tests/mobile-chat-browser.py
```

Set `STILO_BROWSER` to an existing Chromium executable if needed. Set
`STILO_TEST_URL` to another deployed public origin; no localhost listener is needed.
This emulates mobile Chromium. Physical iOS keyboard behavior still needs a device check.

- `mobile-navigation-browser.py`: optional Playwright checks for reachable menus,
  Find/Replace layout, 44px touch controls, caret/IME resize preservation, swipe
  cancellation/reversal, rapid navigation, canvas gesture ownership, flyout state,
  chat collapse, keyboard-height document containment, and preservation of desktop layout preferences. Uses the same
  public-origin overlay and isolated/mocked API setup as `mobile-chat-browser.py`.
  Run with `python3 tests/mobile-navigation-browser.py` after installing Playwright;
  set `STILO_BROWSER` to an existing Chromium executable when needed.


## Session recovery regressions

- `session-recovery.test.mjs`: root/legacy paths, automatic retries, foreground
  wake-up, serialized attempts, and cancellation/auth rejection.
- `workspace-restore.test.mjs`: production UI handlers preserve drafts on failed
  opens and refuse late login results after logout.
- `collaboration-runtime.test.mjs`: foreground reconnection, conflicting drafts,
  concurrent wake-ups, superseded opens, and callbacks from replaced streams.
- `session-recovery-browser.py`: public-origin mobile browser regression with
  staged assets and mocked accounts/workspaces; exercises offline startup,
  Resume, foreground recovery, a reload signing in again with the kept token
  (the password sent once, by a page from before v0.3.1; a moment offline
  retried), and logout while signing in again. Run like the other
  optional Playwright scripts, with `STILO_BROWSER` when using existing Chromium.

Set `STILO_LIVE_ASSETS=1` for `session-recovery-browser.py` to exercise the deployed
frontend instead of staged files; all account/workspace endpoints remain mocked.

Optional MCP regressions: `python3 -B tests/mcp-client.test.py` (socket-free) and `python3 tests/mcp-browser.py` (public origin with mocked APIs and staged assets; requires Playwright).

The session recovery browser check also simulates a sleeping tab, foreground reconnection, and pagehide close signaling. Presence lease expiry is exercised socket-free by `server-reliability.test.py`.

`tests/caret-restore-browser.py` checks source caret and selection restoration across file switches and reloads, including focus retention and stale-offset clamping. It uses isolated browser storage and the public origin with staged assets.

`tests/mobile-caret-browser.py` checks caret capture before touch blur, return through the mobile explorer, and reload using mobile Chromium emulation on the public origin. It delays `selectionchange` and clears the range on outside touch to cover the browser event ordering that lost the caret. Assets and APIs are isolated from user workspaces.
