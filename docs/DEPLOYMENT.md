# Deployment and releases

The current installation runs `stilomarker.service` behind nginx. The Python
backend serves static files directly from its working checkout: editing that
checkout publishes frontend files immediately, even before the backend restarts.
Prepare and test a release in a separate directory before copying it into place.

## Release numbering

- `v0.1.21`: app release, following `MAJOR.MINOR.PATCH`.
- `SYNC_PROTOCOL_VERSION` / `MIN_CLIENT_VERSION`: numeric sync compatibility.
  Keep the wire field `version` numeric so old clients remain safely rejected.
  Ordinary app releases do not need a protocol increment.
- Document S.E.N labels and workspace revisions are separate and unchanged.

Use `node tools/release-version.mjs 0.1.22` to set the next app release and
`node tools/release-version.mjs --check` to verify all release labels agree.

## Coordinated deployment

1. Run the frontend tests and `python3 -B tests/server-reliability.test.py` and `python3 -B tests/mcp-client.test.py` in
   staging. `npm run test:reliability` runs focused regressions without an HTTP
   listener. The full HTTP smoke test is a separate check.
2. Back up the source release and deployment configuration outside the web root.
   Stop `stilomarker.service`, then copy `server/data` and the legacy session
   state to a private backup directory for a consistent data backup.
3. Copy the tested release files into the service checkout. Preserve runtime
   data, account whitelist, and environment configuration.
4. Start `stilomarker.service`. Check `systemctl is-active stilomarker.service`
   and the public site's `/api/ping`: `appVersion` must match the release and
   `minSyncVersion` must match the intended compatibility floor.
5. Verify public JavaScript assets, the service-worker cache label, and sync in
   a temporary guest workspace. Never use a real writing project for smoke tests.

The service restart briefly disconnects tabs. They reconnect; incompatible old
clients are asked to reload. A conflicting local draft is kept in Snapshots under
“Recovery: local edits before cloud reload” before loading the cloud version.

For rollback, stop the service before restoring a known code release. Keep the
current data unless recovery requires a data restore: restoring the backup also
removes edits made since that backup. Old code cannot replay the new
`.pending-state.json` recovery journal, so complete any pending journal with the
new backend before reverting the backend implementation.

## Verified release: v0.1.12

Deployed on 2026-09-22 at 18:25 UTC. `stilomarker.service` was restarted and
`https://stilomarker.ngantech.net/api/ping` reported `appVersion: 0.1.12` and
`minSyncVersion: 112`. Public frontend assets matched the tested checkout.

Validation: 78 non-network Node tests and 12 Python reliability tests passed
(including the existing broker regression checks). An isolated guest workspace
on the public domain passed SSE, emoji-patch, stale-write, old-client, and
whole-project-write checks. Its stream was closed afterward; no persistent
writing project was opened or modified by these checks.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260922T182556Z-v0.1.12`.
It contains pre-release source/configuration and a stopped-service data backup
with nine validated project manifests. Keep it outside the web root.


## Verified release: v0.1.13

Deployed on 2026-09-22 at 19:23 UTC. Public ping reports app release `0.1.13`
and sync compatibility `113`; eight frontend assets matched the staged release.
Old sync clients must reload because insertion transforms and acknowledgment
handling changed together.

Validation: 101 socket-free Node tests and 19 Python reliability tests passed.
Coverage includes two production clients against the Python broker over stdio,
continued typing behind in-flight patches, both HTTP/SSE acknowledgment orders,
2,025 short splice pairs, storage errors, collapsed folders, and UI save handlers.

A temporary guest workspace on the public domain passed two-client SSE,
same-position insert convergence, complete operation acknowledgments, emoji,
replacement/rename barriers, invalid bases, removed-text validation, and old-client
rejection. Its streams were closed afterward. No persistent writing project was
opened by the smoke test. Browser UI/OPFS behavior was exercised with test adapters,
not a live browser automation session.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260922T192326Z-v0.1.13`.
The service was stopped for the data backup and coordinated code copy; nine
project manifests were validated. Settings and deployment configuration were
preserved.


## Verified release: v0.1.14

Deployed on 2026-09-23 at 05:39 UTC. Public ping reports app release `0.1.14`
and sync compatibility `114`; twelve public assets matched the deployed release.
Existing tabs must reload to use revision-checked chat writes and agent edits.

Validation: 118 socket-free Node tests and 25 Python reliability tests passed.
Chromium browser checks at five mobile/tablet viewport sizes passed against the
public origin with staged assets and isolated, mocked chat requests. Coverage
includes mobile Enter and IME input, attached-file context, thread drafts,
streaming scroll/selection, touch targets, and workspace isolation. Physical iOS
keyboard behavior has not yet been verified.

Public API checks in a temporary guest workspace passed two-client document SSE,
concurrent inserts, emoji offsets, replacement/rename barriers, stale operation
rejection, and old-client rejection. Chat checks confirmed stale saves preserve
messages, both clients receive ordered chat updates, merged retries succeed,
missing revisions and old clients are rejected, and chat revisions are independent
of document revisions. A stale agent delete was rejected. No persistent writing
project was opened or modified by these checks; both guest streams were closed.

Chat history now persists atomically in a separate `chat.json` sidecar for saved
workspaces (and a `.chat.json` sidecar for legacy session storage). Include these
files in backups. Composer drafts, selection, and attachments remain device-local.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260923T053908Z-v0.1.14`.
The service was stopped for the coordinated backup and code copy; nine project
manifests were validated. Existing settings and deployment configuration were
preserved. MCP integration remains a separate follow-up.


## Verified release: v0.1.15

Deployed on 2026-09-25 at 00:54 UTC. Public ping reports app release `0.1.15`
and unchanged sync compatibility `114`; twelve public assets matched the release.
This frontend polish release preserves the chat provider, security preferences,
and sync behavior. Reload open tabs to load the updated shell.

Validation: all 118 socket-free Node tests passed. The existing chat browser suite
and new mobile navigation suite both passed at five viewport sizes with isolated
storage and mocked APIs. Checks include touch sizes, short-screen menus/dialogs,
Find/Replace, editor caret and IME preservation during resize, swipe cancellation,
multitouch, reversal, rapid navigation, diagram/scroll gesture ownership, chat
collapse, and desktop preference preservation. Physical-device testing is deferred.

Public guest checks passed document SSE/convergence and stale-write safeguards,
chat conflict rejection and peer propagation, and stale agent edit rejection.
No persistent writing projects were opened or changed. The service is active with
no traceback logged since deployment.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260925T005422Z-v0.1.15`.
The service was stopped for the backup and coordinated copy; nine project
manifests were validated. The backup includes chat sidecars where present.


## Verified release: v0.1.16

Deployed on 2026-09-30 at 04:42 UTC. Public ping reports app release `0.1.16`
and unchanged sync compatibility `114`; fourteen public frontend assets matched
this release. Reload existing tabs once to load the recovery fixes. Security and
account settings are unchanged; MCP connections remain deferred.

Validation: 129 socket-free JavaScript tests and 25 Python reliability tests
passed. The existing chat and mobile navigation browser suites passed at five
viewport sizes. The new session recovery suite passed against staged assets and
again against the actual deployed frontend, using isolated mocked accounts and
workspace data. It covers offline startup, retry without a Resume click, root-path
Resume, apparently connected empty views, silent stream recovery, duplicate
foreground events, newer cloud text without stale writes, suspension persistence,
expired account sessions plus temporary login failure, and logout during a pending
login. No browser runtime errors were reported.

The public temporary-guest smoke also passed document and chat sync/conflict
checks. Saved writing projects were not opened or changed. The service is active,
with no traceback logged since deployment.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260930T044239Z-v0.1.16`.
The service was stopped for the backup and coordinated copy; nine project
manifests were validated. Chat sidecars were included where present.


## Verified release: v0.1.20

Deployed on 2026-09-30. Mobile browser caret restoration now captures the
selection before touch focus leaves the editor and ignores stale blurred ranges.
App version is `0.1.20`; sync compatibility remains `114`. Settings and security
preferences are unchanged.

Validation: 132 Node tests, 29 Python reliability tests, and 16 MCP tests passed.
Desktop caret, mobile navigation, and the new mobile touch/return/reload browser
regressions passed against staged assets on the public origin with isolated
projects and mocked APIs. The new regression fails against the prior release.
Public post-deployment verification matched 16 frontend assets and passed an
isolated two-client guest smoke covering document sync, chat conflicts, presence,
and stale-write rejection. No persistent writing project was touched. The service
was active after deployment. Physical-phone verification remains useful.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20260930T204116Z-v0.1.20`.
Nine project manifests were validated in the stopped-service data backup.


## Verified release: v0.1.21

Deployed on 2026-10-01. The mobile keyboard no longer leaves a full-height
scrollable page behind the shortened editor. The document follows the visible
app height, Chromium resizes its layout viewport with the keyboard, and inner
scroll areas contain gestures. App version is `0.1.21`; sync compatibility is
unchanged at `114`. Settings and security preferences are unchanged.

The mobile Chromium regression reproduces the old 844px document behind a
350px app and passes with this release. Validation also included 132 Node tests,
29 Python reliability tests, 16 MCP tests, and the mobile chat/caret suites.
The public smoke matched 16 assets and passed isolated two-client document,
chat, and presence checks; no persistent writing project was touched. A physical
keyboard check is still useful because browser emulation cannot display the OS
keyboard.

Private deployment backup:
`/home/laplacengan/backups/stilomarker/20261001T043028Z-v0.1.21`.
Nine project manifests were validated in the stopped-service data backup.


## Verified release: v0.1.22

Deployed on 2026-10-11 at 06:15 UTC. Typing on long documents is incremental
(only changed editor lines are replaced; secondary views catch up when typing
pauses), the explorer no longer drifts in Chromium, explorer drags send a
`move-node` operation instead of leaving a copy after the next reconnect, and the
first-run template can no longer replace a cloud workspace. App version `0.1.22`;
sync compatibility raised to `115`, because older tabs never send `move-node`.
`stilomarker.env` does not override the floor, so the code default applies.

Validation: 140 Node tests, the Python reliability, move-node and MCP suites, the
backend self-test, and eight browser suites (two new: `editor-typing-browser.py`
and `template-race-browser.py`, both failing on v0.1.21). The public smoke matched
10 assets and the `mdnotes-shell-v0.1.22` cache label, and in an ephemeral guest
workspace passed create, emoji patch, `move-node` (one copy, in the folder) and a
426 refusal for a v114 client; no persistent writing project was touched. The
service log showed no errors after the restart.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261011T061517Z-v0.1.22`.
It holds the pre-release source (`head.tar`, changed files under `checkout/`),
the unit file, and a stopped-service data copy: nine project manifests, all
valid, 127/127 files. `stilomarker.env` and `whitelist.json` were not copied;
the update does not touch ignored files.


## Verified release: v0.1.23

Deployed on 2026-10-11 at 07:02 UTC. The backend now gzips text assets of 1KB
or more when the browser accepts it, and dead JavaScript functions and CSS rules
were removed. App version `0.1.23`; sync compatibility unchanged at `115`.

Through nginx, eight checked assets arrive compressed exactly when they are 1KB
or larger: 945KB → 231KB on the wire, each byte-identical to the checkout after
decoding. Clients that do not accept gzip still receive raw files, and the
service-worker cache label is `mdnotes-shell-v0.1.23`. Locally, the service worker
installed and served the whole shell from compressed responses. A guest-session
smoke (create, emoji content, `move-node`) passed; no persistent writing project
was touched. Validation: 140 Node tests, the Python reliability, move-node,
static-compression and MCP suites, the backend self-test, and eight browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261011T070223Z-v0.1.23`.
Nine project manifests valid, 127/127 files; configuration files with secrets
were not copied.


## Verified release: v0.1.24

Deployed on 2026-10-11 at 07:22 UTC. Adds server-side workspace backups (one
per day a workspace changed, plus safety copies before destructive changes) and
**Edit → Workspace History…** to restore one file or everything; per-file
Snapshots can now restore a deleted file. App version `0.1.24`; sync
compatibility unchanged at `115`. Backups live in `server/data/_backups/`; the
first daily backup of each workspace is taken by the sweep within 15 minutes of
it being opened, and a final sweep runs when the service stops.

SIGTERM is now a clean shutdown (verified on a throwaway server: exit code 0
and the final backup contained a file written just before the signal). The stop
for this deploy still ran the previous code, so it took no shutdown backup.

Public checks: ping, five assets byte-identical and gzipped, the
`mdnotes-shell-v0.1.24` cache label, the Workspace History dialog in the served
page, `/api/backups` refusing an invalid login with 403, and a guest-session
create/delete smoke. Backups of real workspaces were not exercised on the live
server (no account credentials are used for smoke tests). Validation: 140 Node
tests, the Python reliability, move-node, static-compression, workspace-backup
and MCP suites, the backend self-test, and nine browser suites including the
new real-backend `workspace-history-browser.py`. Service log clean.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261011T072212Z-v0.1.24`.
Nine project manifests valid, 127/127 files.


## Verified release: v0.1.25

Deployed on 2026-10-12 at 06:03 UTC. Adds the **Roleplay** tab: a group chat
with characters written as `name.persona.skill` files (`@handle` asks one,
`@all` asks everyone in turn, no mention = narration). Characters read the
workspace but cannot change it. App version `0.1.25`; sync compatibility
raised to `116`, because older tabs drop the new chat fields when they save.

Public checks: ping (`0.1.25` / `116`), seven assets byte-identical (six
gzipped; `app/version.js` is under the 1KB threshold) including the new
`app/ui/roleplay-view.js` and `app/services/persona-service.js`, the
`mdnotes-shell-v0.1.25` cache label, the Roleplay tab in the served page, a
persona-mode `/api/chat` request rejected for a blank name before any model
call, and a guest session that saved a group chat (kind, members, speaker
kept), refused the same save from a version-115 tab with 426, and closed
cleanly. No real model call was made. Validation: 149 Node tests, the Python
reliability, move-node, static-compression, workspace-backup, persona-chat and
MCP suites, the backend self-test, and ten browser suites including the new
`roleplay-browser.py`. Service log clean.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261012T060223Z-v0.1.25`.
Nine project manifests valid, 153/153 files (the count now includes
`server/data/_backups`).

Live test after deploy (the `test` account was not used; a local in-browser
workspace on the public site, with the server's real model): the agent read a
chapter and wrote two `.persona.skill` files grounded in it; in Roleplay,
narration sent no request, `@mara-quill` produced one in-character reply (11 s),
and `@all` produced two in cast order (23 s), the second reacting to the first.
No page errors. It also found the tab-overlap bug fixed in v0.1.26.


## Verified release: v0.1.26

Deployed on 2026-10-12 at 06:24 UTC. CSS fix: the chat tabs no longer shrink
under the status badge and model picker (on the live server the Roleplay tab
was covered and could not be clicked on desktop). App version `0.1.26`; sync
compatibility unchanged at `116`.

Public checks: ping, four assets byte-identical, the `mdnotes-shell-v0.1.26`
cache label, and a real mouse click on the Roleplay tab at 1280 px and 375 px
(cast bar shown, no sideways scroll, no page errors). Validation: 149 Node tests
and the updated `roleplay-browser.py`, which fails without the fix.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261012T062420Z-v0.1.26`.
Nine project manifests valid, 153/153 files.


## Verified release: v0.1.27

Deployed on 2026-10-12 at 18:38 UTC. Adds OpenAI as a second chat provider,
agent image generation, and the sign-in requirement for the server's keys.
App version `0.1.27`; sync compatibility unchanged at `116`.

The restart loaded `OPENAI_API_KEY`; the catalog read picked `gpt-5.5` and
`gpt-5.4-mini` for chat and `gpt-image-2` for images (journal:
`[OPENAI] Models ready`). Public checks: ping, `/api/chat/status` listing both
providers with `imageGeneration` and `requiresAccount` true, three assets
byte-identical, `/api/chat` and `/api/generated` refusing a signed-out request
with 403. No real GPT or image request has been made yet (that needs a
signed-in account). Validation: 154 Node tests, the Python suites including the
new `openai-images.test.py`, the backend self-test, and eleven browser suites
including the new `agent-images-browser.py`.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261012T183821Z-v0.1.27`.
Nine project manifests valid, 153/153 files.


## Verified release: v0.1.28

Deployed on 2026-10-13 at 04:52 UTC. Chats replaces Roleplay (private chats
and groups with a project's people and characters, live to members only,
stored per project in `conversations.sqlite`; replies by the server or by a
member's own browser), the chat panel polish (model picker and status in the
compose card, history search/rename/delete), and the code split (on-demand
modules, `main.js` broken up). App version `0.1.28`; sync compatibility raised
to `117`, because older tabs would keep writing Roleplay group threads into the
shared chat. 61 files changed.

Public checks: ping (`0.1.28`, `minSyncVersion` 117), the
`mdnotes-shell-v0.1.28` cache label, seven assets byte-identical (including
the new `chats-view.js` and `direct-model-service.js`), `/api/chats` refusing a
signed-out request with 403, server files answered only by the app shell. The
restart log is clean and OpenAI's models loaded as before. No live chat between
two accounts or real-model character reply has been made yet.
Validation: 166 Node tests, the Python suites including the new
`conversations.test.py` (29 tests), the backend self-test, and twelve browser
suites including the new `chats-browser.py` (real backend, two accounts, fake
streaming model and a browser-run local model) and `chats-local-browser.py`.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261013T045217Z-v0.1.28`.
Nine project manifests valid, 153/153 files.

Live test after deploy (18:01 UTC, accounts `test` and `test1` in two browsers,
throwaway project `blue/chats-live-test-180143`, deleted afterwards): each saw
the other online and the character; a private message arrived live with an
unread badge in 0.2 s and the answer came back live; inviting the character
into the private chat started a new 3-member group and kept the private chat;
`@aria …` showed `test1` the reply being written within 0.2 s and the real
DeepSeek reply (in character) reached both in 3.4 s; a message without a
mention got no reply; no page errors.

Note: `server/whitelist.json` is read only at start-up, and a file that fails to
parse turns accounts off entirely. Adding `test1` needed a restart, and the
first restart found a syntax error in the edited file (no one could sign in
until it was fixed, about three minutes).


## Verified release: v0.1.29

Deployed on 2026-10-14 at 19:16 UTC, with two server-only follow-ups the same
evening. The model picker offers GPT 6.1 Sol and GPT 6 Luna (the account has
no 6.1 Luna yet; the start-up log lists `gpt-6-astra, gpt-6-luna, gpt-6-sol,
gpt-6.1-sol`), and GPT 6+ requests go through the Responses API. App version
`0.1.29`; sync compatibility unchanged at `117`.

Public checks with the `test` account: `/api/chat/status` lists
`deepseek-flash, deepseek-v4-pro, gpt-6.1-sol, gpt-6-luna`; both GPT models
answered a plain request (0.9–1.8 s) and called `read_file` on `welcome.md`
and quoted its heading correctly; DeepSeek unchanged. Before the Responses
change both GPT 6 models failed every tool request ("Function tools with
reasoning_effort are not supported"). Validation: 166 Node tests, the Python
suites (OpenAI suite now 25 tests, including the translation round trip), the
backend self-test.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261014T191602Z-v0.1.29`.
Nine project manifests valid, 165/165 files.


## Verified release: v0.1.30

Deployed on 2026-10-14 at 19:24 UTC. Server only: `server/whitelist.json` is
re-read when it changes (checked at most every 2 s), and a file that cannot be
parsed keeps the accounts already loaded with a logged `WARNING`. App version
`0.1.30`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.30`, accounts on), `test` and `test1` sign in, four
accounts loaded at start. The live account file was not edited to test the
reload (it holds passwords); `server-reliability.test.py` covers adding,
removing and a broken file. Validation: 166 Node tests, the Python suites
(reliability now 30 tests), the backend self-test.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261014T192408Z-v0.1.30`.
Nine project manifests valid, 165/165 files.


## Verified release: v0.1.31

Deployed on 2026-10-16 at 04:49 UTC. Module restructure steps 1 and 2: the
structure guard rails, the kernel on both ends, the Shell module (menus drawn
from commands, the Mod+S shortcut, dialogs) and the Transport module (one route
table for all 49 routes, CORS, JSON, error mapping). No feature changes. App
version `0.1.31`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.31`, accounts on), the `mdnotes-shell-v0.1.31` cache
label, five assets byte-identical (including the kernel and Shell files),
server package files answered only by the app shell, `/api/chats` signed out
403, an unknown POST 404, `test` and `test1` sign in, the journal shows
`kernel: started transport`. In a real browser on the public site the five
menus and the nine File items are drawn by Shell, with no page errors.
Validation: 183 Node tests (new: kernel, Shell, nine structure rules), all
Python suites (new: kernel and Transport, mention parity), the backend
self-test, and thirteen browser suites (new: `shell-browser.py`).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261016T044953Z-v0.1.31`.
Nine project manifests valid, 166/166 files.


## Verified release: v0.1.32

Deployed on 2026-10-16 at 05:24 UTC. Module restructure step 3: File types.
Every file type is defined once in `protocol/file-types.json`, loaded by both
ends; every type check in the browser and on the server asks the File types
module. App version `0.1.32`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.32`), the `mdnotes-shell-v0.1.32` cache label, four
assets byte-identical, `test` and `test1` sign in, journal clean. In a real
browser on the public site the import picker accepts every type plus `.zip`,
the Add File "Supported" line lists all thirteen extensions (it used to miss
`.bmap` and `.skill`), the new-file picker offers the five creatable types,
the menus are unchanged, no page errors. `protocol/file-types.json` is
publicly readable, which is fine: it is the same data the page uses.
Validation: 187 Node tests, all Python suites (new: file-type parity), the
backend self-test, and thirteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261016T052417Z-v0.1.32`.
Nine project manifests valid, 166/166 files.


## Verified releases: v0.1.33 and v0.1.34

v0.1.33 deployed on 2026-10-16 at 18:59 UTC, v0.1.34 at 19:13 UTC. Module
restructure step 4, part 1: the one write path. Every text change leaves the
browser as a patch through the Workspace module's `write()`; the agent's edits
merge with other people's typing and Drop undoes only its own changes. v0.1.34
fixes the asker losing Keep and Drop after a reconnect (found by the live
test). Sync compatibility unchanged at `117`: old tabs still send operations the
server accepts, and handle incoming patches already.

Public checks: ping (`0.1.34`), the `mdnotes-shell-v0.1.34` cache label, the new
module files byte-identical, journal clean. Live test with `test` and `test1`
in a throwaway project (`blue/write-path-live-*`, deleted afterwards), the agent's
reply mocked in the test browser (no model call): an agent edit made before
test1 typed merged with that typing in both browsers and in the server's copy;
Drop (from the editor bar) undid only the agent's line; an agent edit to a line
test1 had changed was refused; a restore went out as a patch; only
`patch-file` operations were sent; two client ids over the whole run (no
reconnects); no page errors. Validation: 192 Node tests (new: the write path),
all Python suites, the backend self-test, fourteen browser suites (new:
`write-path-browser.py`, two accounts on a real backend).

Private deployment backups: `/home/laplacengan/backups/stilomarker/20261016T185936Z-v0.1.33`
and `/home/laplacengan/backups/stilomarker/20261016T191332Z-v0.1.34`.
Nine project manifests valid, 166/166 files each time.


## Verified release: v0.1.35

Deployed on 2026-10-16 at 21:25 UTC. Module restructure step 4, part 2: the
project model and store in the browser's Workspace module; the tree, text
offsets and folder storage (with its crash-safe commit) in the server's
Workspace module, which CollaborationBroker calls. The server now refuses file
types the app does not know, as the browser does. App version `0.1.35`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.35`), the `mdnotes-shell-v0.1.35` cache label, the
journal shows the kernel starting file_types, transport and workspace, no
errors. Existing projects load through the new folder storage (read-only:
open, read, leave): `red/Novel` 27 files, about 300,000 characters, revision
68062; `red/Lyrics` 2 files. The live two-account write-path test (`test`,
`test1`, a throwaway `blue/write-path-live-*`, deleted afterwards) passed all
four checks. Validation: 207 Node tests (new: operations parity), all Python
suites (new: operations parity; the crash-recovery tests now inject failures
in the folder store), the backend self-test, fourteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261016T212510Z-v0.1.35`.
Nine project manifests valid, 166/166 files.


## Verified release: v0.1.36

Deployed on 2026-10-16 at 21:54 UTC. Module restructure step 5: the
Characters module on both ends, with author's notes (hidden unless
`notes: hints`) and files characters cannot read (`Plans/`, `*.plan.md`).
App version `0.1.36`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.36`), the journal shows the kernel starting
characters, no errors. Live test with the real model (deepseek-flash, signed in
as `test`, the project sent with the request, nothing stored): Mara's sheet
had an author's note marked with a code word, and a `Plans/act-two.md` held
another. Asked about her eyes in chapter nine, she listed the files, read
`chapter1.md` and her own character file, and knew nothing of the note (her
read returned the file without it). Asked to read `Plans/act-two.md`, she saw
only `chapter1.md` and her own file and said no such file exists. Neither code
word appeared in any reply. Validation: 212 Node tests (new: character
parity), all Python suites (new: character parity; notes and Plans in persona
turns), the backend self-test, fifteen browser suites (new:
`characters-browser.py`).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261016T215406Z-v0.1.36`.
Nine project manifests valid, 170/170 files.


## Verified release: v0.1.37

Deployed on 2026-10-17 at 02:31 UTC. Module restructure step 6: the
Assistant module on both ends and the agent's `edit_file` tool (exact
passages, one match each, no overlaps). App version `0.1.37`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.37`), the journal shows the kernel starting
assistant, no errors. Live test with the real models (deepseek-flash and
gpt-6.1-sol, signed in as `test`, the project sent with the request, nothing
stored): asked to change Mara's age in her character file and nothing else,
both read the file and called `edit_file` on their own with one edit (the
sentence holding the age). The proposal was an `update-file` whose
`preImage` was the file, whose content differed only in that word, and whose
author's notes were kept byte for byte. Validation: 212 Node tests, all
Python suites (new: `assistant-edits`), the backend self-test, fifteen
browser suites (`write-path-browser.py` gained the `edit_file` card and merge).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T023104Z-v0.1.37`.
Nine project manifests valid, 170/170 files.
