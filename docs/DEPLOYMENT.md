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

Accounts (from v0.2.35): the account file may keep its passwords as typed
until it is converted; the server still signs them in and logs how many
remain. Convert once, as the service's user, in the service checkout (the
running server reads the file again within seconds; back the file up first,
privately):

    python3 server/accounts.py convert --admin <name>

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

## Verified release: v0.1.38

Deployed on 2026-10-17 at 04:08 UTC. Module restructure step 7a: Identity
and access on both ends (accounts, sign-in tokens, project access and roles,
per-account preferences; in the browser the signed-in account and its
stored sign-in), Shell's server connection, and Identity's contract. App
version `0.1.38`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.38`, accounts on), the journal shows the kernel
starting identity, no errors. Over HTTP as `test`: a wrong password is
refused (403), signing in returns the teams (red, blue) and the remembered
workspace, the team browses, a project's access record reads, and a request
without a token is refused. In a headless browser on the public site:
signing in through Settings shows "Logged in as test · teams: red, blue", a
reload signs in again by itself, and signing out shows the sign-in fields.
Validation: 215 Node tests (new: Identity in the browser, the module contract
check), all Python suites (new: `identity`), the backend self-test, sixteen
browser suites (new: `identity-browser.py`).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T040757Z-v0.1.38`.
Nine project manifests valid, 170/170 files.

## Verified release: v0.1.39

Deployed on 2026-10-17 at 06:02 UTC. Module restructure step 7b: Models on
both ends (providers, routes per request, both streams, generated images,
MCP; in the browser the direct runner and the picker), and a fix: a
session keeps its role when its event stream drops and comes back. App
version `0.1.39`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.39`), the journal shows the kernel starting
models and the OpenAI catalog ready (gpt-6.1-sol, gpt-6-luna, gpt-image-2),
no errors. The status lists DeepSeek and OpenAI models with images on. Live
with the real models, signed in as `test`: the agent on deepseek-flash and on
gpt-6.1-sol (through the Responses API) each streamed and proposed one
`edit_file` edit, with the right provider in the reply; a character turn on
each answered in character; Quick Generate (no streaming) returned a
document from deepseek-flash. Validation: 219 Node tests (new: Models in the
browser), all Python suites (new: `models`; a regression test for the role
fix), the backend self-test, sixteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T060232Z-v0.1.39`.
Nine project manifests valid, 170/170 files.

## Verified release: v0.1.40

Deployed on 2026-10-17 at 07:18 UTC. Module restructure step 7c-1: Sync on
the server (sessions and roles, presence, leases, event streams, the rebase
log, one path for every change) and Workspace's pure operations and open
project; revert-to-revision removed. App version `0.1.40`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.40`), the journal shows the kernel starting sync,
no errors. Live, with `test` and `test1` in a throwaway project in team red
(deleted afterwards): both opened it, `test` created a note, both patched it
from the same revision (one at the start, one at the end); the text merged
to ">> hello world!", `test1`'s patch was rebased to offset 14, and `test1`'s
event stream received ready, then both operations in revision order. A
whole-file write from the older revision was refused (409). The real
red/Novel project opened with all 27 files (about 300,000 characters).
Validation: 220 Node tests (new: the shared rebase cases), all Python suites
(new: `sync`), the backend self-test, sixteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T071809Z-v0.1.40`.
Nine project manifests valid, 170/170 files.

## Verified release: v0.1.41

Deployed on 2026-10-17 at 07:47 UTC. Module restructure step 7c-2: Sync in
the browser (the runtime split into runtime, patch queue and pure rules),
Sync's routes on the server (Transport stream routes and refusals), and
`protocol/sync.contract.json` with the sync version both ends read; the
backend self-test moved to `tests/backend-selftest.py`. App version
`0.1.41`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.41`, minSyncVersion 117 from Sync), the journal
shows the kernel starting sync, no errors. Live, in a throwaway project in
team red (deleted afterwards): a workspace open claiming sync 116 was refused
with 426; `test1` (over HTTP) created a note; a headless browser signed in as
`test` opened the project, and text it wrote reached the server through
Sync's routes; a patch `test1` sent then arrived in the browser over the
event stream (through nginx) and merged with the browser's text, with no page
errors. `test`'s remembered workspace was set back to red/Novel afterwards.
Validation: 220 Node tests, all Python suites, the backend self-test (now
`tests/backend-selftest.py`), sixteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T074709Z-v0.1.41`.
Nine project manifests valid, 171/171 files.

## Verified release: v0.1.42

Deployed on 2026-10-17 at 08:10 UTC. Module restructure step 7d: History on
both ends (snapshots and backups in one blob store implementation, retention
rules, History's routes and contract; in the browser the local snapshot
store, History's calls and the line diff). App version `0.1.42`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.42`), the journal shows the kernel starting history,
no errors. Live, as `test`, reading red/Novel's existing history through the
new routes: its 3 daily backups listed, the newest (27 files) read back a
file; its snapshots (14 files, about 600 KB) listed and one read back. In a
throwaway project (deleted afterwards): a snapshot was made (with its S.E.N
baseline), a manual backup taken, and a deletion right after it added no
second copy (the burst rule); the snapshot was deleted. `test`'s remembered
workspace was set back to red/Novel. Validation: 222 Node tests (new:
History in the browser), all Python suites (new: `history`), the backend
self-test, sixteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T081005Z-v0.1.42`.
Nine project manifests valid, 171/171 files.

## Verified release: v0.1.43

Deployed on 2026-10-17 at 08:33 UTC. Module restructure step 7e: Comments on
both ends (the rules, the comments file, routes, contract and event; in the
browser keeping a comment on its line). App version `0.1.43`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.43`), the journal shows the kernel starting
comments, no errors. Live in a throwaway project in team red (deleted
afterwards): `test` saved a comment on `第一卷/a.md`, `test1` listed it,
`test` moved it and deleted it, and `test1`'s event stream received the
three `comments` events (one comment, one comment, none); a request without
a valid token was refused (403). Validation: 225 Node tests (new: Comments in
the browser), all Python suites (new: `comments`), the backend self-test,
seventeen browser suites (new: `comments-browser.py`).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T083347Z-v0.1.43`.
Nine project manifests valid, 174/174 files.

## Verified release: v0.1.44

Deployed on 2026-10-17 at 08:51 UTC. Module restructure step 7f-1: Chats on
the server (the chat store, who answers, the reply queue and claims, Chats'
routes); `conversations.py` removed. App version `0.1.44`; sync
compatibility unchanged at `117`.

A slip: one Node test was failing when this was deployed, because the
release command printed the counts and went on. It was the structure test's
"the baseline lists nothing already fixed" check (the server file had shrunk
again since the baseline was lowered); nothing at run time. The baseline was
lowered right after (225 of 225 pass), and the release command now stops
unless the Node run reports no failures.

Public checks: ping (`0.1.44`), the journal shows the kernel starting chats,
no errors. Live, with `test` and `test1` in a throwaway project in team red
(deleted afterwards) holding one character file: the contacts listed the
team's people and "Mara Quill" (her name read through Characters); `test`
started a private chat with `test1` and `test1` read the message; `test1`
invited Mara, which started a new group (the pair kept); asked "@mara how
old are you?" on deepseek-flash, Mara answered in character, and `test1`'s
event stream showed her reply being written and then the message.
Validation: 225 Node tests (after the baseline fix), all Python suites, the
backend self-test, seventeen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T085158Z-v0.1.44`.
Nine project manifests valid, 171/171 files.

## Verified release: v0.1.45

Deployed on 2026-10-17 at 12:24 UTC. Module restructure step 7f-2: Chats in
the browser (the view, the cloud store, this browser's own store) and
`protocol/chats.contract.json`. App version `0.1.45`; sync compatibility
unchanged at `117`.

Public checks: ping (`0.1.45`), no errors in the journal. Live, in a headless
browser signed in as `test`, in a throwaway project in team red holding one
character file (deleted afterwards): the Chats tab listed the team's people
and "Mara Quill"; a private chat with her opened, and a question got an
in-character answer from deepseek-flash, shown in the view; no page errors.
Validation: 225 Node tests (the release now stops unless they all pass), all
Python suites, the backend self-test, seventeen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T122456Z-v0.1.45`.
Nine project manifests valid, 171/171 files.

## Verified release: v0.1.46

Deployed on 2026-10-17 at 12:45 UTC. Module restructure step 7g-1: the
Editor module (the source editor split into six parts sharing one editor
object; highlighting, find and replace, autocomplete, links, the formatting
toolbar, table picker and Markdown renderer); the comments popover moved
into Comments. App version `0.1.46`; sync compatibility unchanged at `117`.

Public checks: ping (`0.1.46`), no errors in the journal. Live, in a headless
browser signed in as `test`, in a throwaway project in team red (deleted
afterwards): text typed with the keyboard at the end of a line reached the
server; Ctrl+Z took back the last character; with the editor focused,
Ctrl+F opened the find bar and found the one match; no page errors.
Validation: 225 Node tests, all Python suites, the backend self-test,
seventeen browser suites (including typing, caret and mobile-caret, whose
per-key churn budget still holds).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T124522Z-v0.1.46`.
Nine project manifests valid, 171/171 files.

## Verified release: v0.1.47

Deployed on 2026-10-17 at 13:09 UTC. Module restructure step 7g-2: the tab
strips, panes and preview pane in the Editor, with a previews extension
point (URL albums, diagrams and character sheets register theirs). This
completes step 7. App version `0.1.47`; sync compatibility unchanged at `117`.

The deployment backup counted 10 projects: one was a throwaway project of
mine (`EditorCheck…`) left by an earlier verification run that crashed
before cleaning up. It was deleted through the app as its owner; later
probes clean up in a `finally`.

Public checks: ping (`0.1.47`), no errors in the journal. Live, in a headless
browser signed in as `test`, in a throwaway project in team red (deleted
afterwards) holding a character file, a Markdown note and a URL album: each
previewed through its registered or built-in preview (the card "Mara Quill",
the heading "Heading Here", the album row "Gull"); no page errors.
Validation: 225 Node tests, all Python suites, the backend self-test,
seventeen browser suites (`session-recovery-browser.py` caught a left-behind
import in the split before release).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T130909Z-v0.1.47`.
Ten project manifests valid (one of them the leftover above), 177/177 files.

## Verified release: v0.1.48

Deployed on 2026-10-17 at 20:39 UTC. Module restructure step 8: the URL album
as an extension (`extensions/url-album/`), reaching the app only through
public extension points. App version `0.1.48`; sync compatibility unchanged
at `117`.

Public checks: ping (`0.1.48`), no errors in the journal. The live check, as
`test` in a throwaway project in team red (deleted afterwards), listed the
entries under their albums, opened an entry in the source and the preview,
and saved an edit and a new entry (through the new form dialog) to the
server. A drag of an entry into the other album did not reach the server.
That bug is older than this release; v0.1.49 fixes it. Validation: 225 Node
tests, all Python suites, the backend self-test, eighteen browser suites
(`url-album-browser.py` new, written against the old code first).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T203904Z-v0.1.48`.
173/173 data files, every JSON file valid.

## Verified release: v0.1.49

Deployed on 2026-10-17 at 21:17 UTC. Dragging a file part (an album entry)
between files, or within one, now goes through the write path; before, it
changed only the dragging browser. App version `0.1.49`; sync compatibility
unchanged at `117`.

Public checks: ping (`0.1.49`), no errors in the journal. The same live
check, rerun, passed: the edit, the new entry and the dragged entry were all
in the server's copies of both albums. Throwaway project deleted. Validation:
225 Node tests, all Python suites, the backend self-test, eighteen browser
suites (`write-path-browser.py` now drags an entry between albums with two
browsers; it passed three runs in a row after a wait in the test was fixed).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T211653Z-v0.1.49`.
173/173 data files, every JSON file valid.

## Verified release: v0.1.50

Deployed on 2026-10-17 at 22:54 UTC. Deleted cloud projects and folders go
to their team's Trash for 30 days, with their history, and their owner can
restore them (decides ISSUES item 3). App version `0.1.50`; sync
compatibility unchanged at `117`.

Public checks: ping (`0.1.50`), no errors in the journal. As `test`, through
the API, in team red: a throwaway project with a file was deleted, found in
the trash (30 days, restorable), restored with its text, deleted again and
removed for good. Nothing was left in the project list or the trash. The live
Trash dialog opened, but a toolbar timing issue with its button was found:
fixed in v0.1.51. Validation: 225 Node tests, all Python suites, the backend
self-test, nineteen browser suites (`trash-browser.py` new).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261017T225441Z-v0.1.50`.
173/173 data files, every JSON file valid.

## Verified release: v0.1.51

Deployed on 2026-10-18 at 00:10 UTC. The Trash button stays hidden until its
folder has loaded. App version `0.1.51`; sync compatibility unchanged at
`117`.

Public checks: ping (`0.1.51`), no errors in the journal. The sweep had moved
the history of `EditorCheck1792241197` into red's trash: that project was a
leftover from my own probe, deleted on 2026-10-17 before the trash existed.
The live Trash dialog showed it as "History only · 30 days left", with no
Restore. I then removed it, so red's trash is empty. Validation: 225 Node
tests, all Python suites, the backend self-test, nineteen browser suites.
The first gate run failed once in `url-album-browser.py`. Tracing that found
a caret jump under heavy load, older than this work, now open ISSUES item 3.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261018T001038Z-v0.1.51`.
174/174 data files, every JSON file valid.

## Verified release: v0.1.88

Deployed on 2026-10-19 at 09:50 UTC, with every release since v0.1.60
(v0.1.61–v0.1.88): the browser's restructure steps S3d to S4e (`main.js`
only starts the modules) and the server's S4s-1 to S4s-6 (the server's
entry only starts the modules). App version `0.1.88`; sync compatibility
unchanged at `117`. The service's command line and environment file are
unchanged.

Public checks: ping (`0.1.88`, accounts on, hosting on), the service worker's
cache label `mdnotes-shell-v0.1.88`, the new scripts served (`app/main.js`,
an extension), the server's own files refused (`server/mdnotes_server.py`,
`server/whitelist.json` answer as the app's page), and a clean journal
(4 accounts loaded, the agent's providers ready). Sync in a throwaway session
hosted for guests (in memory only): create, an emoji-safe patch, an old tab
refused (426), a guest joining by PIN, both leaving, the session gone. One
finding, older than these releases (since v0.1.41): a request with a session
token that is no longer valid, on the state and change routes, is answered
503 ("storage unavailable") instead of 403; fixed in v0.1.89 on `dev`.

Validation: 245 Node tests, all 22 Python suites (the backend self-test
among them), nineteen browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261019T094954Z-v0.1.88`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.1.95

Deployed on 2026-10-19 at 18:07 UTC, with every release since v0.1.88
(v0.1.89–v0.1.95): an ended or unknown session token answered 403 instead of
503 (v0.1.89), the first visit's empty preview (v0.1.90), and step 5's first
parts: on the phone, one file's two views (v0.1.91), the chat as a drawer from
the right (v0.1.93), the Log as a sheet from the bottom (v0.1.94, v0.1.95)
and drawer swipes that start just inside the screen edge (v0.1.95); on the
desktop, a tab's menu (v0.1.92). App version `0.1.95`; sync compatibility
unchanged at `117`. The service's command line and environment file are
unchanged.

Public checks: ping (`0.1.95`, accounts on, hosting on), the service worker's
cache label `mdnotes-shell-v0.1.95`, the new scripts served
(`frame/drawer.js`, `frame/sheet.js`, `tab-menu.js`), the server's own files
refused (`server/mdnotes_server.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session token
on the state route answered 403 (v0.1.88 answered 503), and a clean journal
(accounts loaded, the agent's providers ready, no errors).

Validation: 245 Node tests, all 22 Python suites (the backend self-test
among them), 23 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261019T180656Z-v0.1.95`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.1.99

Deployed on 2026-10-19 at 21:57 UTC, with every release since v0.1.95
(v0.1.96–v0.1.99): editor groups, stage 1. The model (v0.1.96), Open as in
the same group with the placeholder and Show here (v0.1.97), Move to Other
Group, Open to the Side and a group closing with its last tab (v0.1.98), and
the groups kept with a cloud workspace's open tabs, on the server and in the
browser (v0.1.99, a server change: Projects' `user-state.json` gains
`groups`). App version `0.1.99`; sync compatibility unchanged at `117`. The
service's command line and environment file are unchanged.

Public checks: ping (`0.1.99`, accounts on, hosting on), the service worker's
cache label `mdnotes-shell-v0.1.99`, the new scripts served (`groups.js`, the
view with `groupsFromSaved`), the server's own files refused
(`server/mdnotes_server.py`, `server/whitelist.json`, `server/stilomarker.env`,
a module's Python file answer as the app's page), an unknown token answered
403 on the session state and on the user state (with `groups` in the body),
and a clean journal (no errors).

Validation: 249 Node tests, all 22 Python suites (the backend self-test
among them), 25 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261019T215738Z-v0.1.99`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.0

Deployed on 2026-10-20 at 01:20 UTC, with every release since v0.1.99
(v0.1.100–v0.2.0): the areas as hosts (v0.1.100, the bottom area's header
one row), pages moving between the areas with Move to… (v0.1.101), and
Source and Preview half and half until dragged (v0.2.0, a new minor version
for the restructure and step 5). App version `0.2.0`; sync compatibility
unchanged at `117`. The service's command line and environment file are
unchanged.

Public checks: ping (`0.2.0`, accounts on, hosting on), the service worker's
cache label `mdnotes-shell-v0.2.0`, the new scripts and styles served
(`shell/adapters/pages.js`, `frame/sheet.js`, the even split in
`styles.css`), the server's own files refused (`server/mdnotes_server.py`,
`server/whitelist.json`, `server/stilomarker.env` answer as the app's page),
an unknown session token answered 403, and a clean journal (no errors).

Validation: 249 Node tests, all 22 Python suites (the backend self-test
among them), 27 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261020T012024Z-v0.2.0`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.7

Deployed on 2026-10-20 at 10:06 UTC, with every release since v0.2.0
(v0.2.1–v0.2.7): Mermaid diagrams (v0.2.1), static HTML pages and every
workspace file served sandboxed (v0.2.2, a server change), settings an
extension contributes (v0.2.3), Diagrams wholly an extension with Quick
Generate's named overview (v0.2.4, a server change), panels dragged between
areas (v0.2.5), two previews side by side (v0.2.6), and the open issues:
the URL album's caret jump, an unreadable access file locking its project,
unreadable comments and History index files set aside (v0.2.7, a server
change). App version `0.2.7`; sync compatibility unchanged at `117`. The
service's command line and environment file are unchanged.

Public checks: ping (`0.2.7`, accounts on, hosting on), the service worker's
cache label `mdnotes-shell-v0.2.7`, the new files served (Mermaid's and the
HTML page's modules, the Diagram's own stylesheet, the contributed
settings), the server's own files refused (`server/mdnotes_server.py`,
`server/whitelist.json`, `server/stilomarker.env` answer as the app's page),
an unknown session token answered 403, and a clean journal (no errors). The
sandbox headers on a workspace file's reply are covered by the HTTP test in
`sync.test.py` (a page and an SVG), not checked live (that needs a session
and a file).

Validation: 256 Node tests, all 22 Python suites (the backend self-test
among them), 29 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261020T100550Z-v0.2.7`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.13

Deployed on 2026-10-20 at 21:37 UTC, with every release since v0.2.7
(v0.2.8–v0.2.13): the Log's command line and Reload Window (v0.2.8), themes
with the theme-pack extension and readable syntax colours in Light (v0.2.9),
Markdown's missing syntax and spaces kept after a list marker (v0.2.10), the
frame's chrome (v0.2.11), the Settings dialog (v0.2.12), and a group's label
switching its view (v0.2.13). Browser only: the server's code is unchanged.
App version `0.2.13`; sync compatibility unchanged at `117`. The service's
command line and environment file are unchanged; it was down 7 seconds.

Public checks: ping (`0.2.13`, accounts on, hosting on), the service
worker's cache label `mdnotes-shell-v0.2.13`, the new files served
(`app/boot-theme.js`, which the page loads in its head, the command line,
Reload Window, the theme model, the contributed themes, the theme picker,
the command search), the server's own files refused
(`server/mdnotes_server.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session
token answered 403, and a clean journal (no errors). A fresh browser on the
public site (no account, no workspace) showed `v0.2.13` with no page errors;
F1 and "change theme" found Change Theme…, which showed the seven theme
cards.

Validation: 275 Node tests, all 22 Python suites (the backend self-test
among them), 31 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261020T213733Z-v0.2.13`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.16

Deployed on 2026-10-21 at 02:20 UTC, with every release since v0.2.13
(v0.2.14–v0.2.16): small things that were wrong (readable toasts, the
active tab kept in view, a diagram fitted to its pane, v0.2.14), dialogs
that say what they ask, with Rename Selected keeping the extension out
(v0.2.15), and menus and tabs (v0.2.16). Browser only: the server's code is
unchanged. App version `0.2.16`; sync compatibility unchanged at `117`. The
service's command line and environment file are unchanged; it was down 2
seconds.

Public checks: ping (`0.2.16`, accounts on, hosting on), the service
worker's cache label `mdnotes-shell-v0.2.16`, the new files served
(`app/modules/shell/model/dialog-text.js`, the Diagram's
`browser/model/fit.js`, listed in `extensions/offline.js`), the server's own
files refused (`server/mdnotes_server.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session token
answered 403, and a clean journal (no errors). A fresh browser on the public
site (no account, no workspace) showed `v0.2.16` with no page errors; F1 and
"change theme" found Change Theme…, which showed the seven theme cards.

Validation: 277 Node tests, all 22 Python suites (the backend self-test
among them), 31 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261021T021959Z-v0.2.16`.
172/172 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.19

Deployed on 2026-10-21 at 08:39 UTC, with every release since v0.2.16
(v0.2.17–v0.2.19): file icons, a quieter status bar and a diagram click that
no longer rewrites the file (v0.2.17), the diagram's floating inspector
(v0.2.18), and this browser's copy of the workspace in IndexedDB with a
failing save said (v0.2.19). Browser only: the server's code is unchanged.
App version `0.2.19`; sync compatibility unchanged at `117`. The service's
command line and environment file are unchanged; it was down 1 second.

v0.2.19 moves each browser's copy from localStorage to IndexedDB on its first
load of the new version. A tab left open from before the update keeps saving
the old way until it is reloaded.

Public checks: ping (`0.2.19`, accounts on, hosting on), the service
worker's cache label `mdnotes-shell-v0.2.19`, the new files served
(`workspace/adapters/browser-copy.js`, the Diagram's `model/fit.js`, the
file types with the image icon), the server's own files refused
(`server/mdnotes_server.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session token
answered 403, and a clean journal (no errors). A fresh browser on the public
site with an old-style copy seeded in localStorage (a throwaway project, no
real data) opened it at `v0.2.19`, moved it to IndexedDB (the old key gone),
kept it across a reload, and showed the file icons; no page errors.

Validation: 277 Node tests, all 22 Python suites (the backend self-test
among them), 32 browser suites.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261021T083909Z-v0.2.19`.
173/173 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.27

Deployed on 2026-10-21 at 22:54 UTC, with every release since v0.2.19
(v0.2.20–v0.2.27, the stability review's fixes): a copy per workspace
(v0.2.20), two windows live (v0.2.21), the Agent and Chats with the user's
own key and no server (v0.2.22), offline edits merged per file (v0.2.23),
typing in a long chapter (v0.2.24), the app as an installed web app with
updates that wait and its libraries served with it (v0.2.25), the desktop
app (v0.2.26, in the repository; nothing changes for the web), and tabs of
older versions still taking the new one (v0.2.27). App version `0.2.27`;
sync compatibility unchanged at `117`. The service's command line and
environment file are unchanged; it was down 1 second.

The server's code changed: `/api/chat/prompt` is gone (v0.2.22; a tab
left open from before needs a reload for direct Chats replies), and its
JSON replies say `Cache-Control: no-store` (v0.2.25). Tabs running
v0.2.19 get v0.2.27 at once (they expected that); from v0.2.25 on, a new
version waits for Reload Window. A browser downloads MathJax and Mermaid
(about 5 MB) once, when it installs the new version.

Public checks: ping (`0.2.27`, accounts on, hosting on), a JSON reply's
`Cache-Control: no-store`, the service worker's cache label
`mdnotes-shell-v0.2.27`, the new files served (`manifest.webmanifest` as
`application/manifest+json`, the icons, Sync's `adapters/tabs.js` and
`model/merge.js`, Shell's `adapters/desktop.js`), MathJax and Mermaid
served with their listed SHA-256, the server's own files refused
(`server/mdnotes_server.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session
token answered 403, and a clean journal. A fresh browser on the public site
(its own welcome workspace, no real data) was controlled by `0.2.27`, kept
both libraries in `mdnotes-vendor`, opened offline, fetched nothing from a
CDN, and had no page errors.

Validation: 342 Node tests, all 22 Python suites, 38 browser suites (the
desktop app's among them, in Electron 44).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261021T225411Z-v0.2.27`.
173/173 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.2.29

Deployed on 2026-10-22 at 09:02 UTC, with v0.2.28: a very long file types
like a short one (v0.2.28: only the lines in view are in the page), and the
desktop app's server (v0.2.29; in the repository, nothing changes for the
web but Settings → Server existing only in the desktop app). App version
`0.2.29`; sync compatibility unchanged at `117`. The service's command
line and environment file are unchanged (the server's new `--parent-pid`
is not used here); it was down under a second.

Public checks: ping (`0.2.29`, accounts on, hosting on), a JSON reply's
`Cache-Control: no-store`, the service worker's cache label
`mdnotes-shell-v0.2.29`, the new files served (the Editor's
`adapters/editor-window.js`, Cloud's `adapters/desktop-server.js`), the
server's own files refused (`server/mdnotes_server.py`,
`server/stilo/kernel/parent.py`, `server/whitelist.json`,
`server/stilomarker.env` answer as the app's page), an unknown session
token answered 403, and a clean journal. A fresh browser on the public site
(its own welcome workspace, no real data) was controlled by `0.2.29`, kept
both libraries, opened offline, fetched nothing from a CDN, and had no page
errors.

Validation: 349 Node tests, all 23 Python suites, 39 browser suites (the
desktop app's in Electron 44, with its server).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261022T090204Z-v0.2.29`.
173/173 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.3.0 (stable)

Deployed on 2026-10-23 at 11:11 UTC: the stable version, v0.2.30-v0.2.42
(Find in Files, plain text and tables, spellcheck, hashed accounts and the
admin page, the shaky-connection warning, the extension API, accounts in
the desktop app; then what the review before calling it stable found:
paths, accounts, PIN sessions, Find in Files and tables). App version
`0.3.0`, tag `v0.3.0`; sync compatibility unchanged at `117`. The
service's command line and environment file are unchanged; it was down
4 seconds.

Before: every live project (4) loaded whole with the new server and passed
its path checks, and the account file read under the new rules, on a
private copy (removed after).

Accounts: the account file was converted once
(`python3 server/accounts.py convert --admin leoyan01`): 4 passwords
hashed, `leoyan01` the first admin, the file readable by its owner only
(it was readable by all users of the machine). Converting counts as a new
password for each account, so their sign-ins ended once (a browser signs in
again by itself).

Public checks: ping (`0.3.0`, accounts on, hosting on), a JSON reply's
`Cache-Control: no-store`, the service worker's cache label
`mdnotes-shell-v0.3.0`, new files served (`editor/model/search.js`,
`extensions/data-table/browser/model/table.js`), the server's own files
refused under any spelling (`server/whitelist.json`,
`server/stilomarker.env`, `server/mdnotes_server.py`,
`SERVER/whitelist.json`, `Server/accounts.py`, `data/...` answer as the
app's page), an unknown session token answered 403, and a clean journal
(only the expected note about passwords kept as typed, before the
conversion). A fresh browser on the public site (its own welcome
workspace, no real data) was controlled by `0.3.0`, opened offline,
fetched nothing from a CDN, and had no page errors.

Validation: 405 Node tests, all 25 Python suites, 45 browser suites (the
desktop app's in Electron 44, with its server).

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261023T111131Z-v0.3.0`.
173/173 data files (taken with the service stopped), every JSON file valid;
the account file and the environment file as they were.

## Verified release: v0.3.1

Deployed on 2026-10-24: a browser keeps a sign-in, not a password (the
server keeps its sign-ins in `server/data/sign-ins.json`, fingerprints
only; a sign-in ends when it signs out, its account gets a new password or
goes, or after 30 days unused). App version `0.3.1`; sync compatibility
unchanged at `117`. The service's command line and environment file are
unchanged; it was down under 4 seconds. Sign-ins from before (kept in
memory) ended with the restart, one last time; browsers that kept a
password sign in with it once more and keep a token from then on.

Public checks: ping (`0.3.1`), the service worker's cache label
`mdnotes-shell-v0.3.1`, the new browser code served, `/api/auth/me`
refusing an unknown or missing token (403), `/api/auth/logout` answering,
the sign-ins file and the server's own files refused under any path
(`server/data/sign-ins.json`, `data/sign-ins.json`, `sign-ins.json`,
`server/whitelist.json`, `SERVER/stilomarker.env`, the new adapter's
source answer as the app's page), an unknown session token answered 403,
`Cache-Control: no-store` on a JSON reply, and a clean journal. A fresh
browser on the public site (its own welcome workspace, no real data) was
controlled by `0.3.1`, opened offline, fetched nothing from a CDN, and had
no page errors.

Validation: 406 Node tests, all 25 Python suites, the browser suites (42 of
45 in the full run: one rewritten for the new sign-in and passing, two
timing checks passing alone), the desktop app's in Electron 44.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261024T042233Z-v0.3.1`.
173/173 data files (taken with the service stopped), every JSON file valid.

## Verified release: v0.3.11

Deployed on 2026-10-25 at 02:56 UTC: v0.3.2 – v0.3.11 together (Open
Project opens only with Open; the pane label switches in place; the tab
strips; a project's tree named for it; the file-name search; the left
window's tabs; the desktop app's zoom and one bar; the Agent's status; a
source editor in each group), with `docs/REVIEW-0.3.md`. App version
`0.3.11`; sync compatibility unchanged at `117`. The service's command line
and environment file are unchanged; it was down about 2 seconds. No server
data changed format.

Public checks: ping (`0.3.11`), the service worker's cache label
`mdnotes-shell-v0.3.11`, the new code served (`editors.js`), the account
file, the environment file, the sign-ins file, the server's code and the
tests answered with the app's page (refused) under any spelling, an unknown
token answered 403 (`/api/auth/me`, `/api/session/state`),
`Cache-Control: no-store` on a JSON reply, and a clean journal. The machine
rebooted at 11:30 UTC; the service came back by itself on `0.3.11`. A fresh
browser on the public site afterwards (its own welcome workspace, no real
data) was controlled by `0.3.11`, had both source editors, opened offline,
fetched nothing from a CDN, and had no page errors.

Validation: 415 Node tests, all 25 Python suites, all 48 browser suites
(the new `two-editors-browser.py` among them) and the desktop app's in
Electron 44.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261025T025620Z-v0.3.11`.
185/185 data files (taken with the service stopped), every JSON file valid;
the account file and the environment file as they were.

## Verified release: v0.3.12

Deployed on 2026-10-25 at 22:13 UTC: documents only (the README, the
welcome page and the in-app manual describe the two editors;
`docs/HISTORY.md` records the decisions they superseded). App version
`0.3.12` (the in-app manual changed, and an installed app keeps its files
until a new version); sync compatibility unchanged at `117`. The service's
command line and environment file are unchanged; it was down about a second.

Public checks: ping (`0.3.12`), the service worker's cache label
`mdnotes-shell-v0.3.12`, the new manual and status document served, the
account file, the environment file, the sign-ins file and the server's code
answered with the app's page (refused), an unknown token answered 403,
`Cache-Control: no-store` on a JSON reply, and a clean journal. A fresh
browser on the public site (its own welcome workspace, no real data) was
controlled by `0.3.12`, had both source editors, opened offline, fetched
nothing from a CDN, and had no page errors.

Validation: 415 Node tests, all 25 Python suites, all 48 browser suites and
the desktop app's in Electron 44.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261025T221339Z-v0.3.12`.
185/185 data files (taken with the service stopped), every JSON file valid;
the account file and the environment file as they were.

## Desktop release drafted: v0.3.15

2026-10-26: `dev` pushed to GitHub's `main` (a fast-forward from v0.3.12)
and tagged `v0.3.15`. The release workflow (`.github/workflows/release.yml`)
passed the tests, built the portable files (an AppImage, a portable Windows
`.exe`, the Mac app zipped for Apple Silicon and Intel) and drafted the
release with `docs/releases/v0.3.15.md` and `SHA256SUMS.txt`. Not published.

Checked here: the Linux AppImage's checksum matches `SHA256SUMS.txt`, and
extracted it carries version `0.3.15` and the new editor code, and no
account file or server data. Not launched; the Windows and macOS builds not
tried. The new title bar (v0.3.9) has only been seen on Linux: try the
builds on Windows and macOS before publishing.

The server was not part of the draft: it still ran v0.3.12, and its live
checkout's `main` was behind GitHub's until v0.3.13 – v0.3.15 were deployed
there (below), so a `git push` from it was refused as behind; nothing was
lost, and nothing there needed pushing (it had no commits of its own).

## Verified release: v0.3.15

Deployed on 2026-10-26 at 07:26 UTC: v0.3.13 – v0.3.15 together (the caret
kept across a reconnect's reload, O9; deleting the active file hands it to
the other editor, O10; the write path through whichever editor shows the
file), all browser code, no server change. The live checkout fast-forwarded
to GitHub's `main`, so it is level with it again. App version `0.3.15`; sync
compatibility unchanged at `117`. The service's command line and
environment file are unchanged; it was down about a second.

Public checks: ping (`0.3.15`), the service worker's cache label
`mdnotes-shell-v0.3.15`, the new code served (`editors.js`), the account
file, the environment file, the sign-ins file, the server's code and the
tests answered with the app's page (refused), an unknown token answered
403, `Cache-Control: no-store` on a JSON reply, and a clean journal. A fresh
browser on the public site (its own welcome workspace, no real data) was
controlled by `0.3.15`, had both source editors, opened offline, fetched
nothing from a CDN, and had no page errors.

Validation: 415 Node tests, all 25 Python suites, the browser suites (47 of
49 in the full run on the loaded machine; the two that failed, chats-browser
and the desktop app's serve phase, passed run alone: the latter is accepted
issue A3 set off by the load), the desktop app's in Electron 44.

Private deployment backup: `/home/laplacengan/backups/stilomarker/20261026T061213Z-v0.3.15`.
185/185 data files (taken with the service stopped), every JSON file valid;
the account file and the environment file as they were.

