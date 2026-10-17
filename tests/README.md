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
| `urldb-service.test.mjs` | `.urldb` serialize/parse/update/remove round-trips. |
| `zip-fs.test.mjs` | ZIP import/export and File System Access persistence. |
| `collaboration-runtime.test.mjs` | Production sync runtime: reconnect conflicts, recovery snapshots, request races, patch rejection, join gaps, Unicode. |
| `collaboration-broker.test.mjs` | Two real clients + the Python broker over stdio, both send/ack orders. |
| `text-patch.test.mjs` | Exhaustive short splice-pair convergence and overlap rejection. |
| `project-save.test.mjs` | Queued writes, errors, typing during saves, collapsed folders, rename retries, UI save handlers. |
| `server-reliability.test.py` | Production broker: UTF-16, disk-failure recovery, ordered events, and existing broker regressions. |
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
| `file-types.test.mjs` / `file-types.test.py` | The File types module on both ends: both run `spec/file-types/type-of.cases.json` (longest extension wins, case, names that are only an extension); MIME types, accept lists and the Create order come from the one list; a new type is let in, a taken extension refused. |
| `workspace-write.test.mjs` | The one write path: the line diff gives the target text for 500 random edits; an edit lands beside other people's changes and refuses to guess (same line changed, context not unique); `write()` commits patches, merges when the file moved on, is stale without changing anything when it cannot fit, replaces images whole; undo is the same write backwards; `asPatch` for restores; undo steps for the agent's creates, renames, moves and deletes. |
| `operations-parity.test.mjs` / `operations-parity.test.py` | Applying operations on both ends: both run `spec/workspace/operations.cases.json` (create, duplicate and missing-parent refusals, rename with contents, delete, update, text patches in UTF-16 units, mismatched patches refused, move, unknown file types refused on create and rename). It found the server accepting file types the browser refuses. |
| `characters-parity.test.mjs` / `characters-parity.test.py` | Character files on both ends: both run `spec/characters/sheets.cases.json` (headers with CRLF, BOM, quotes and comments; summaries; author's notes sections, also inside code fences and repeated; notes modes; a file without its notes; which paths characters cannot see). The browser half also checks `charactersView`. |
| `assistant-edits.test.py` | The agent's `edit_file`: exact passages change and the rest stays byte for byte; refusals name the edit and the reason (several matches, not found, empty, overlapping, too many); all or nothing; edits in one turn build on each other and carry their base and edits; missing files and images refused; the agent offers it and characters cannot use it. |
| `characters-browser.py` | Browser: a character's preview shows the sheet, and the author's notes only in a collapsed panel saying the character never sees them, or that `notes: hints` allows hints. |
| `write-path-browser.py` | Browser + real backend, two accounts, the agent's reply mocked: Bob types while Anna's agent edits the same file and both edits end up in both browsers and on disk; Drop undoes only the agent's line; an agent edit to a line Bob changed is refused; a restore goes out as a patch; nothing sends a whole-file update for text. |
| `identity.test.py` / `identity.test.mjs` | Identity and access. Server: who may open a project (team, whitelist, blacklist), roles and what each may do, only the owner changes access and the first setter becomes owner, sign-in tokens with team changes applied at once, sign-out, remembered workspace, a project from before access files keeps its members, and the module's routes over HTTP. Browser: signing in by itself only where that account signed in before with a stored password, sign-in, drop, restore, sign-out (the username stays), a cancelled sign-in stores nothing, access calls carry the token. |
| `models.test.py` / `models.test.mjs` | Models. Server: each model goes to its provider (DeepSeek, OpenAI, GPT 6 through the Responses API), unknown ones get the default, a user's own key goes where they say; a chat stream shows reasoning, text and tool-writing progress and returns the whole reply (with the model's options and the organization header); GPT 6 in Responses form without temperature; a request without streaming. Browser: a streamed reply put back together, the picker's grouping and choice, a reply from the user's own endpoint answering tool calls from the browser (and the refusal for others), and clear errors for a refusal, an unreachable endpoint or no URL. |
| `identity-browser.py` | Browser + real backend, two accounts: a wrong password shows the server's refusal; signing in shows the account and its team and stores the sign-in; a reload signs in again by itself; the access dialog reads and saves a project's lists on the server; someone who is not the owner is refused; signing out forgets the password, keeps the username and stays signed out after a reload. |
| `shell-browser.py` | Browser, the first modules in the page: File types fills the file inputs' accept lists, the supported-types text and the new-file type picker; the Shell module: five menus drawn from commands, one open at a time, live titles, a menu item runs its command, Ctrl+S runs Save, rename keeps the extension, menus and commands added after start-up appear, the phone menu panel. |
| `structure/structure.test.mjs` | The eight architecture rules in docs/ARCHITECTURE.md: module imports and levels, one owner per type name, no I/O in model/service code, twin rules with shared cases, the network contract against the code, size budgets. Legacy violations are in `structure/baseline.json` and may only shrink (`node tools/structure-baseline.mjs`). |
| `agent-images.test.mjs` | Saving a generated image: fetched for the signed-in account, saved as a data URL locally, uploaded (not sent in the operation) in a directory-backed cloud workspace, refused with a reason when expired or signed out; the agent still cannot write image bytes itself. |
| `agent-images-browser.py` | Browser: signed out the agent asks for a sign-in and sends nothing; signed in the model picker groups DeepSeek/OpenAI, the GPT model and account token are sent, a generated image is shown in the edit card and saved as a file, chat history keeps only the image id. |
| `local-chats.test.mjs` | Chats in a browser-only workspace: pair reuse, a character answers every private message, group mentions in order with earlier replies visible, invite into a pair starts a group, Stop keeps partial text, unread / search / notes, old Roleplay threads imported, renamed character files followed. |
| `chats-browser.py` | Browser + real backend + a fake streaming model, two accounts: live private message with unread badge, read clears it, private alias, search and jump, invite into a pair starts a new group (pair kept), group @mention reply watched live by both, narration gets none, private character chat, a reply written by a member's own browser from a local model (CORS fake) reaching everyone live, phone width. |
| `chats-local-browser.py` | Browser, mocked API, browser-only workspace: characters only (with a note), old Roleplay chat moved into Chats, private character chat, group mention suggestions and @all order, Stop, rename of a character file, kept after reload, tabs never covered, phone width. |
| `editor-typing-browser.py` | Browser: a long chapter stays correct and incremental while typing (DOM/gutter/caret/highlight per edit, incremental == full render, churn budget, undo/redo, no explorer drift). |
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
  Resume, foreground recovery, session expiry, and logout. Run like the other
  optional Playwright scripts, with `STILO_BROWSER` when using existing Chromium.

Set `STILO_LIVE_ASSETS=1` for `session-recovery-browser.py` to exercise the deployed
frontend instead of staged files; all account/workspace endpoints remain mocked.

Optional MCP regressions: `python3 -B tests/mcp-client.test.py` (socket-free) and `python3 tests/mcp-browser.py` (public origin with mocked APIs and staged assets; requires Playwright).

The session recovery browser check also simulates a sleeping tab, foreground reconnection, and pagehide close signaling. Presence lease expiry is exercised socket-free by `server-reliability.test.py`.

`tests/caret-restore-browser.py` checks source caret and selection restoration across file switches and reloads, including focus retention and stale-offset clamping. It uses isolated browser storage and the public origin with staged assets.

`tests/mobile-caret-browser.py` checks caret capture before touch blur, return through the mobile explorer, and reload using mobile Chromium emulation on the public origin. It delays `selectionchange` and clears the range on outside touch to cover the browser event ordering that lost the caret. Assets and APIs are isolated from user workspaces.
