# Known Issues

Findings from the September 2026 reliability pass. Split into what is **still
open** (needs a decision) and what is **already fixed and deployed**, with
confidence stated — some items are confirmed, some are suspicions that could not
be proven.

Last updated: 2026-09-18 · app build `mdnotes-shell-v102`

---

## Open

### 1. Long-open tabs must reload after a server restart
**Confidence:** confirmed, intended · **Severity:** informational

The OT rebase log is in-memory and capped at 2,000 entries, so it is empty after a
restart. Patches based on an older revision are now **refused** rather than applied
at wrong offsets (which silently corrupted text before). The cost is a forced reload.

### 2. Residual risk in the snapshot migration
**Confidence:** theoretical · **Severity:** low

Legacy browser-local snapshots were filed under the shared `server-project` key.
Migration only adopts files whose paths exist in the workspace being opened, so if
two workspaces contain a **same-named file**, a snapshot could migrate to the wrong
one. Affects only pre-existing local history.

---

## Fixed

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
