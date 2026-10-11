# Known Issues

Findings from the September 2026 reliability pass. Split into what is **still
open** (needs a decision) and what is **already fixed and deployed**, with
confidence stated — some items are confirmed, some are suspicions that could not
be proven.

Last updated: 2026-10-11 · release `v0.1.22` (prepared on branch `perf-and-fixes`; not yet deployed)

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

---

## Fixed

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
