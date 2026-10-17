# Known Issues

Findings from the September 2026 reliability pass. Split into what is **still
open** (needs a decision) and what is **already fixed and deployed**, with
confidence stated — some items are confirmed, some are suspicions that could not
be proven.

Last updated: 2026-10-17 · release `v0.1.46` (deployed; public verification passed)

---

## Open

### 1. Restart recovery can require a fresh cloud snapshot
**Confidence:** confirmed, intended · **Severity:** informational

The OT rebase log is in-memory and capped at 2,000 entries, so it is empty after a
restart. Patches based on an older revision are now **refused** rather than applied
at wrong offsets (which silently corrupted text before). Recovery automatically fetches
the current cloud snapshot and preserves conflicting local text in Snapshots.

### 2. Residual risk in the snapshot migration
**Confidence:** theoretical · **Severity:** low

Legacy browser-local snapshots were filed under the shared `server-project` key.
Migration only adopts files whose paths exist in the workspace being opened, so if
two workspaces contain a **same-named file**, a snapshot could migrate to the wrong
one. Affects only pre-existing local history.

### 3. Deleting a project keeps its history
**Confidence:** confirmed, intended so far · **Severity:** low (a decision)

Snapshots and backups live outside the project folder (so publishing over a
project never erases them), and deleting a project leaves them in
`data/_snapshots` and `data/_backups`. That keeps a way back after deleting
the wrong project, but nothing lists or removes them later. Decide whether a
delete should remove them, keep them for a while, or offer them for restore.

---

## Fixed

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
