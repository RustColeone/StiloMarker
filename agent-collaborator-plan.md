# Agent-as-Collaborator — Implementation Plan & Tracker

> **Feature.** Let the chat agent edit the workspace as another collaborator, with an
> **Accept / Keep / Drop** review flow.
>
> **Status:** ALL PHASES COMPLETE — fully implemented.
> **Last updated:** 2026-06-04 (all 7 phases done)
> **Owner:** _unassigned_

This document is both the design spec **and** the living progress tracker. Update the
status tables and checkboxes as work lands. Each phase has explicit **acceptance
criteria** and **be-cautious** callouts. Do not delete the cautions once resolved —
mark them ✅ and keep the note, because they encode hard-won architectural constraints.

---

## 0. Status At A Glance

| Phase | Title | Status | Depends on | Risk |
|------:|-------|--------|-----------|------|
| 1 | Backend: agentic tool loop | ☑ done | — | Medium |
| 2 | Backend: sole-author revert infra | ☑ done | 1 | High |
| 3 | Client: accept / keep / drop transport | ☑ done | 1 | Medium |
| 4 | Client: chat panel proposal UI | ☑ done | 1 | Low |
| 5 | Client: in-editor decoration | ☑ done | 3 | High |
| 6 | Client: checkpoint / drop per turn | ☑ done | 2, 3 | Medium |
| 7 | Safety, edges, tests | ☑ done | all | Medium |

Status legend: ☐ not started · ◐ in progress · ☑ done · ⚠ blocked.

---

## 1. Glossary

| Term | Meaning |
|------|---------|
| **Proposal** | A single proposed write-operation produced by the agent. Carries a `proposalId`. |
| **Batch** | All proposals from one agent turn. Carries a `batchId`. Accept/keep/drop act per-op **or** per-batch. |
| **Accept** | Apply a proposal/batch through the normal edit pipeline. In a synced session this **broadcasts to peers immediately**. |
| **Keep** | Finalize an already-applied batch. No content change. Clears decorations, resolves the checkpoint. |
| **Drop** | Delete the agent's already-applied contribution. A **forward** operation (revision goes up), implemented as a sole-author revert. |
| **Checkpoint** | A deep-clone snapshot of the project captured immediately **before** an accepted batch is applied, used to power Drop in local/master mode. |
| **Sole-author revert** | Server-enforced rule letting a non-master roll back a revision range they alone authored. |
| **OT** | Operational Transformation — the offset-rebasing logic that makes concurrent `patch-file` edits converge. |
| **clientId** | Per-connection identity minted by the server in `connect()`. **Not stable across reconnects.** |

---

## 2. Mental Model (decided — do not relitigate without a Decision Log entry)

- The agent runs **server-side** in `ChatProxy`, sharing the **same** `CollaborationBroker` instance as human collaborators. It is "just another collaborator."
- Agent write-actions are **proposals** returned in the chat response — **never** auto-applied.
- **Accept = apply now.** Through the normal pipeline (`applySyncOperation` locally / `publishOperation` if synced). In a synced session the edit reaches peers at accept time, before keep/drop.
- **Keep = bookkeeping only.** The file already holds the content; keep writes nothing. It clears decorations and resolves the checkpoint.
- **Drop = delete a collaborator's work.** A forward operation (revision increments). Mechanically a sole-author revert, **not** a rewind.
- **Highlighting decorates real, applied ranges only.** No unapplied phantom overlays — they corrupt the OT / offset / gutter / cursor subsystems (see Phase 5).

### Accept / Keep / Drop — exact semantics

| Action | Local content change? | New revision? | Peers see it? | Local user sees |
|--------|----------------------|---------------|---------------|-----------------|
| **Accept** | Yes (applies agent edit) | Yes (if synced) | Yes — normal remote op | Content changes, lines tinted "pending" |
| **Keep** | No | No | No (already have it) | Tint clears, affordance removed |
| **Drop** | Yes (reverts agent edit) | Yes | Yes — second remote op | Content reverts, agent contribution gone |

> The review prompt is **post-hoc** ("I see what it did — keep it?"), not a pre-commit gate.
> A true pre-commit gate is only coherent in a solo/local session; the instant collaboration
> is involved, deferring the apply reintroduces the unapplied-overlay problem.

---

## 3. Operation Contract (single source of truth)

All proposals reuse the **existing path-based op shapes** already understood by
`applySyncOperation` ([app/domain/project-model.js](app/domain/project-model.js) `function applySyncOperation`, line ~344)
and the server's `_apply_operation` ([server/mdnotes_server.py](server/mdnotes_server.py) line ~441).
**No new op types for writes.** Only Phase 2 adds one new type (`revert-to-revision`).

### Allowed proposal op types

| Type | Required fields | Notes |
|------|-----------------|-------|
| `create-file` | `parentPath` (""=root), `name`, `content` | |
| `update-file` | `path`, `content` | Whole-file replace. Server bumps `sourceVersion`. |
| `rename-node` | `path`, `name` | |
| `delete-node` | `path` | Recursive for folders. Needs extra confirm in UI. |
| `create-folder` | `parentPath` (""=root), `name` | |
| `move-node` | `path`, `parentPath`, `index?` | |

> **Deliberately excluded from the agent:** `patch-file` (offset-based; the agent reasons in
> whole files, not OT offsets) and `replace-project` (master-only, destructive). If the agent
> needs a partial edit, it proposes a full `update-file`.

### Proposal envelope (agent → chat response)

```jsonc
{
  "message": "I added a heading and fixed the link.",
  "model": "deepseek-v4-pro",
  "provider": "DeepSeek",
  "contextPaths": ["notes.md"],          // already exists today
  "proposedOperations": [                 // NEW
    {
      "proposalId": "op-7f3a",
      "type": "update-file",
      "path": "notes.md",
      "content": "# Notes\n\nFixed [link](./a.md).\n",
      "preImage": "# Notes\n\nBroken link.\n"  // server-captured current content, for diff + drop
    }
  ],
  "batchId": "batch-2c19"                  // NEW — one per agent turn
}
```

### Hard rules

1. **Path-based, never ID-based.** The agent reasons in paths; resolve `path → nodeId` via
   `getNodeIdByPath` at **accept** time, not propose time (the user may edit in between).
2. **`preImage` is server-captured.** Used for the diff preview and as the drop fallback in
   local mode. Never trust a client-supplied post-image for a revert (forgery guard, Phase 2).
3. Every op has a `proposalId`; every turn has a `batchId`. Both are required for per-op and
   per-batch accept/keep/drop tracking.

---

## 4. End-To-End Data Flow

```
User sends chat message (with optional context files)
        │
        ▼
Browser ──POST /api/chat──▶ ChatProxy.chat()
                              │  (Phase 1)
                              │  reads CollaborationBroker.project for tree + file reads
                              ▼
                       DeepSeek (tools: [...])
                              │
                       tool_calls? ──yes──▶ read tools execute now;
                              │              write tools collected as proposals
                              │              (loop until finish_reason="stop")
                              ▼
                    returns { message, proposedOperations, batchId }
        ◀─────────────────────┘
        ▼
Browser renders proposal card in assistant bubble  (Phase 4)
        │
   user clicks Accept / Accept all
        ▼
acceptAgentOperations(ops)  (Phase 3)
        │
   capture checkpoint snapshot (Phase 6)
        │
   connected & synced? ──yes──▶ collaboration.publishOperation(op)
        │                          → server applies → SSE broadcast → all peers
        └──no──▶ controller.applySyncOperation(op) + local save
        ▼
   decorate applied ranges in editor  (Phase 5)
        │
   user clicks Keep ──▶ clear decorations, resolve checkpoint (no op)
   user clicks Drop ──▶ revert (Phase 2/6): revert-to-revision (synced non-master)
                          or replaceProject(checkpoint) (local/master)
```

---

## 5. Phase 1 — Backend: Agentic Tool Loop

**File:** [server/mdnotes_server.py](server/mdnotes_server.py) — `ChatProxy.chat()` (line ~150) and `ChatProxy.__init__`.
**Routing:** `do_POST` → `/api/chat` → `_handle_chat()` (line ~757/~862). Response is JSON via `_write_json`.

### Subtasks

- [ ] **1.1** Define tool schemas (`tools` array, OpenAI function-calling format):
      `read_file(path)`, `list_files()`, `create_file(parentPath,name,content)`,
      `update_file(path,content)`, `rename_node(path,name)`, `delete_node(path)`,
      `create_folder(parentPath,name)`, `move_node(path,parentPath,index?)`.
- [ ] **1.2** Give `ChatProxy` a reference to the `CollaborationBroker` (currently it has none).
      Wire it in the `MDNotesRequestHandler.__init__` construction site (line ~716) and the
      server bootstrap that builds the handler partial.
- [ ] **1.3** Add `tools` + `tool_choice:"auto"` to the request `payload` in `chat()`.
- [ ] **1.4** Implement the agentic loop: while the response has `tool_calls`,
      append the assistant tool-call message + each tool result to `messages`, re-call the API.
      - Read tools (`read_file`, `list_files`) execute immediately against `broker.project`
        (use `broker._get_node_id_by_path` / walk `broker.project["nodes"]`).
      - Write tools are **collected into `proposed_operations`, not applied**, and their tool
        result is a synthetic ack like `{"status":"proposed","proposalId":...}` so the model
        knows it "worked" and continues.
- [ ] **1.5** Capture `preImage` for `update_file`/`delete_node`/`rename_node`/`move_node`
      by reading current content from `broker.project` at proposal time.
- [ ] **1.6** Inject the project tree (paths + kinds) into the system prompt, read from
      `broker.project`. Keep it compact (path + kind only, not content).
- [ ] **1.7** Return `proposedOperations` + `batchId` in the response dict alongside the
      existing `message`/`model`/`provider`/`contextPaths`.
- [ ] **1.8** Guard rails: `max_tool_iterations` = **3** (note-taking workload — light loop, not an
      IDE agent; most turns are one shot), `max_ops_per_turn` (e.g. 20), reuse `timeout_seconds`.
      On overflow, stop looping and return what's collected with a note. **No streaming for v1.**

### Be cautious ⚠

- **⚠ Variable shadowing bug already in `chat()`.** In the `except HTTPError` block, a local
  `payload = json.loads(detail)` **shadows** the outer request `payload`. Harmless today, but if
  you add ret/loop logic that references `payload` after the try, this will bite. Rename the local
  to `error_payload` while you're in there.
- **⚠ Per-message content truncation.** `chat()` truncates each message to `content[:16000]` and
  context to `max_context_chars` (default 60000). A multi-iteration tool loop accumulates tool
  results into the message list — make sure tool-result messages are counted against the budget or
  you can blow the context window. Consider trimming old tool results.
- **⚠ DeepSeek tool-calling support.** Confirm the configured model/endpoint actually supports
  OpenAI-style `tools`/`tool_calls`. If `MDNOTES_CHAT_API_URL` points at a provider that doesn't,
  the loop never triggers. Add a capability check / graceful fallback to "text-only, no proposals."
- **⚠ Thread-safety.** `chat()` runs on a `ThreadingHTTPServer` worker thread. Reading
  `broker.project` must happen under `broker.lock` (snapshot a deepcopy) to avoid tearing while a
  human op is mid-apply.
- **⚠ Don't apply inside the loop.** The whole point is that writes are proposals. Applying here
  would bypass the entire Accept/Keep/Drop review and the checkpoint capture.

### Acceptance criteria

- A chat request that asks for an edit returns a non-empty `proposedOperations` array with valid
  path-based ops and `preImage`s, and the assistant `message` summarizes them.
- A pure question returns `proposedOperations: []` and behaves exactly as today.
- Read tools let the agent inspect files it wasn't given as context.

---

## 6. Phase 2 — Backend: Sole-Author Revert Infrastructure

**File:** [server/mdnotes_server.py](server/mdnotes_server.py) — `CollaborationBroker` (line ~241),
`apply_operation` (line ~616), `_apply_operation` (line ~441), `connect` (line ~556), `master_tokens` set.

### The permission rule (precise)

> Reverting from current revision `R_now` to target `R_target` is allowed for a **non-master**
> iff **every** revision in the range `(R_target, R_now]` was authored by the **requesting
> client's `clientId`**. Master role always allowed. Offline/local always allowed (no server).

This only ever discards the requester's **own** recent work. Everything at or before `R_target`
(including other people's earlier edits) is preserved. Worked example:

```
rev 3:  Y creates y.md
rev 4:  X edits x.md   ┐ range X wants to drop
rev 5:  X edits x.md   │ (X is sole author of 4–8)
rev 6:  X edits x.md   │
rev 7:  X edits x.md   │
rev 8:  X edits x.md   ┘  ← R_now
X drops to rev 3 → range (3,8] all authored by X → ALLOWED.
y.md (rev 3) preserved; X's 4–8 discarded.
If Y had edited at rev 6, range contains a foreign author → REJECTED (master-only).
```

### Subtasks

- [ ] **2.1** Add `self.revision_authors: dict[int, str]` — in `apply_operation`, after
      `self.revision += 1`, record `self.revision_authors[self.revision] = client_id`.
- [ ] **2.2** Add `self.snapshot_history: list[tuple[int, dict]]` — append
      `(self.revision, copy.deepcopy(self.project))` after each apply+persist; trim to a **floor of
      N = 40 revisions** (see Decision Log / Q4), but **never trim below the oldest un-resolved
      agent batch's `baseRevision`** so a pending Drop can't age out (see retention rule below).
      N counts **revisions (committed, coalesced ops) — not characters or keystrokes**, and the
      counter advances for **every** author, not just the agent.

      > **Retention rule (units & multi-author safety).** A *revision* is one committed operation.
      > Text typing is debounced/coalesced (250 ms window, [collaboration-service.js](app/services/collaboration-service.js) ~L133),
      > so a whole typed sentence is **one** `patch-file` op = **one** revision — N = 40 is ~40
      > save-points, not 40 characters. But `snapshot_history` is bumped by `apply_operation` for
      > **all** collaborators, so in a busy session other people's edits could push the agent's
      > `baseRevision` out of a flat 40-window before the user clicks Drop. Therefore retain
      > `max(40, oldest-unresolved-agent-batch baseRevision)`: pin snapshots back to any agent
      > batch that is still neither Kept nor Dropped; resume normal trimming once all batches
      > resolve. Local/master Drop doesn't depend on this (it uses the client checkpoint keyed by
      > `batchId`, Phase 6) — only the synced non-master Drop path reads `snapshot_history`.
- [ ] **2.3** Add op type `revert-to-revision` carrying only `{ "targetRevision": int }`.
- [ ] **2.4** In `apply_operation`, before applying, branch:
      `if op_type == "revert-to-revision" and token not in self.master_tokens:
      self._authorize_sole_author_revert(token, target)`.
- [ ] **2.5** Implement `_authorize_sole_author_revert(token, target)`:
      resolve `client_id = self.tokens[token]`; for `rev in range(target+1, self.revision+1)`,
      require `self.revision_authors.get(rev) == client_id` else raise `PermissionError`;
      also require `target` to be present in `snapshot_history` (else "outside history window").
- [ ] **2.6** Apply the revert by **reconstructing `self.project` from `snapshot_history`**,
      `copy.deepcopy` the stored snapshot. **Never** read project content from the request body.
- [ ] **2.7** Bump revision, persist, broadcast as a normal `state` event so peers converge
      (reuse the existing state-broadcast path, e.g. via `set_state`'s event shape).
- [ ] **2.8** Mirror everything into `session-state.json` persistence as needed (revision_authors
      and snapshot_history are in-memory only — that's fine; they reset on server restart).

### Be cautious ⚠

- **⚠ FORGERY GUARD (most important).** The authorship check only validates the range
  `(R_target, R_now]`. A `replace-project`-style body could pass that check while silently
  deleting *older* nodes authored by others. **The server must reconstruct the target from its own
  `snapshot_history`** and ignore any project payload in the request. The client sends only the
  target revision **number**.
- **⚠ clientId is not stable across reconnects.** `connect()` mints
  `client_id = f"client-{uuid.uuid4().hex[:12]}"` every time. After a reconnect, X's pre-reconnect
  edits are attributed to the old id, so X loses drop rights for them. Acceptable for v1 — document
  in the UI ("drop available within this session"). Proper fix (deferred): persist a stable
  per-browser id in `localStorage` and have the server reuse it on reconnect with the same PIN.
- **⚠ History window bounds the reach.** N caps both memory and how far back a drop can go. If the
  target fell out of `snapshot_history`, reject cleanly with a clear message.
- **⚠ Atomicity.** All of validate-then-apply runs under `self.lock`, so no human op can interleave
  between the authorship check and the revert. Keep it that way; do not release the lock mid-revert.
- **⚠ Memory of snapshots.** Deep-copying the whole project per revision is simple but heavy for
  large workspaces. N=50 is a starting point; revisit if projects get big. (Alternative: store
  inverse ops instead of full snapshots — more complex, deferred.)

### Acceptance criteria

- A non-master who solely authored revs `(t, now]` can `revert-to-revision t`; a non-master with a
  foreign author in that range is rejected with `PermissionError` (HTTP 403).
- Master can always revert. Forged project payloads are ignored; only server snapshots are used.
- After a revert, all peers receive a `state` event and converge to the reconstructed project.

---

## 7. Phase 3 — Client: Accept / Keep / Drop Transport

**Files:** [app/main.js](app/main.js), [app/domain/project-service.js](app/domain/project-service.js),
[app/services/collaboration-service.js](app/services/collaboration-service.js),
[app/services/chat-api-service.js](app/services/chat-api-service.js).

### Subtasks

- [ ] **3.1** `sendChatRequest` already returns parsed JSON
      ([chat-api-service.js](app/services/chat-api-service.js) line ~36) — `proposedOperations` /
      `batchId` arrive for free. No transport change needed for the request itself.
- [ ] **3.2** `acceptAgentOperations(operations, { batchId })`:
      - capture checkpoint first (Phase 6),
      - for each op: resolve `path → nodeId` via `getNodeIdByPath`; if unresolved, mark op
        "stale" and skip,
      - branch: `collaboration.isConnected() && workspaceMode === "synced"`
        → `collaboration.publishOperation(op)`; else → `controller.applySyncOperation(op)` +
        local save (the same storage path the editor uses).
- [ ] **3.3** `keepAgentBatch(batchId)` — set batch state `kept`, clear decorations; no op.
- [ ] **3.4** `dropAgentBatch(batchId)`:
      - synced non-master → send `revert-to-revision` with the batch's captured `baseRevision`,
      - offline or master → `controller.replaceProject(checkpointSnapshot)` + save.
- [ ] **3.5** Record, per batch, the `baseRevision` (the server revision *before* the batch was
      applied) so Phase 2's range is well-defined.
- [ ] **3.6** Persist proposal/batch state into the chat workspace so reloads & peers see outcomes
      (see Phase 4 caution about `normalizeChatMessage`).
- [ ] **3.7** **Attribution.** Tag accepted ops with `origin:"agent"` and the accepting user's id,
      so presence/log can show "Agent edit accepted by X" (Decision: Q3). Thread the tag through
      `publishOperation` (synced) and the local-apply path.

### Be cautious ⚠

- **⚠ Resolve paths at accept time.** The user (or a peer) may have edited/renamed between
  proposal and accept. Re-resolve; if the path is gone, surface "stale — re-run".
- **⚠ Offline persistence.** The synced branch persists server-side automatically; the local
  branch must explicitly save (localStorage/opfs/directory) or accepted edits vanish on reload.
- **⚠ `workspaceMode` matters, not just `isConnected()`.** Existing manual-edit code already gates
  on `collaboration.isConnected() && workspaceMode === "synced"` (main.js lines ~1695, ~5274).
  Match that exact condition so agent edits behave identically to manual edits.
- **⚠ Drop role gating.** Disable Drop in synced mode when the batch is no longer sole-authored
  (Phase 6 tracks this). Don't offer an action the server will reject.

### Acceptance criteria

- Accept applies in both local and synced modes; peers see synced accepts.
- Keep changes nothing but clears the affordance. Drop removes the agent's edit in all three modes
  (local, master-synced, sole-author-non-master-synced).

---

## 8. Phase 4 — Client: Chat Panel Proposal UI

**Files:** [app/main.js](app/main.js) chat render (`elements.chatMessageList.innerHTML`, line ~451),
[app/styles.css](app/styles.css), [app/services/chat-storage-service.js](app/services/chat-storage-service.js).

### Subtasks

- [ ] **4.1** Store `proposedOperations`, `batchId`, `baseRevision`, and `proposalState`
      (`pending`/`accepted`/`kept`/`dropped`, plus per-op `stale`) on the **assistant message**,
      via the existing `createChatMessage(role, content, extra)` extra-field pattern (same as
      `contextPaths` rides on user messages).
- [ ] **4.2** Render a **proposal card** in the assistant bubble: one row per op with an icon by
      type (`update`/`create`/`rename`/`delete`/`move`), the target path, and an expandable diff.
- [ ] **4.3** Diff preview from `preImage` vs `content` (reuse the common prefix/suffix logic in
      `buildPatchOp`, [collaboration-service.js](app/services/collaboration-service.js) line ~167,
      to compute line hunks). `create` shows new content; `rename`/`delete` show path + warning.
- [ ] **4.4** Buttons: per-op ✓/✗, batch **Accept all** / **Drop all**, and post-accept
      **Keep** / **Drop**. The chat panel's "accept everything" requirement = **Accept all**.
- [ ] **4.5** Terminal states render read-only (kept / dropped / stale) so a reloaded thread shows
      the historical decision.

### Be cautious ⚠ (this one is a real trap)

- **⚠⚠ `normalizeChatMessage` STRIPS unknown fields.** In
  [chat-storage-service.js](app/services/chat-storage-service.js) (`function normalizeChatMessage`,
  line ~25) the returned object is an **allowlist**: `{ id, role, content, createdAt, error }`.
  It already **drops `contextPaths` on assistant messages** today, and it will silently drop
  `proposedOperations` / `batchId` / `proposalState` on every save→load and on every
  collaboration sync round-trip. **You must extend `normalizeChatMessage` (and the thread
  normalizer) to preserve these fields**, or proposals evaporate when the thread is reloaded or
  synced to a peer. This is the single most likely thing to "mysteriously not work."
- **⚠ Originator-only controls (DECIDED).** Proposals travel inside the chat workspace, which
  broadcasts via the `chat-workspace-update` SSE event. Peers may see the turn but **accept / keep /
  drop controls must be disabled for everyone except the originating user** (Decision: Q1). Stamp
  each batch with the originator's id and gate the buttons on `batch.originatorId === myClientId`.
  Note the clientId-reconnect caveat (Q5) means originator identity is per-session.
- **⚠ Escaping.** Diff content must go through the existing escape helpers (`escapeHtmlAttribute` /
  the markdown renderer's escaping) — proposed file content can contain `<`, `>`, backticks, etc.

### Acceptance criteria

- A turn with proposals shows a card with working per-op and batch controls.
- After reload (and after a peer sync), the card and its resolved state are intact (proves the
  `normalizeChatMessage` fix).

---

## 9. Phase 5 — Client: In-Editor Decoration (Applied Ranges Only)

**File:** [app/main.js](app/main.js) — `renderEditorContent` (line ~2748), gutter rebuild,
offset maps `domPositionToTextOffset` (line ~1495) / `textOffsetToDomPosition` (line ~1470).

### Subtasks

- [ ] **5.1** Maintain a per-file map (keyed by **path**) of "agent-edited, pending keep/drop"
      line ranges.
- [ ] **5.2** Re-derive and inject decorations **inside** `renderEditorContent` so they survive the
      per-keystroke `innerHTML` rebuild. Decorate via line `class` + gutter marker — **not** by
      inserting new text nodes.
- [ ] **5.3** "Jump to change" from the card: open the file (`setActiveSourceFile`) and scroll to
      the first decorated line.
- [ ] **5.4** Clear decorations on keep / drop / batch-resolve / and re-apply on file switch
      (every switch is a full re-render).
- [ ] **5.5** If true side-by-side (old vs new) diff is wanted, render it in a **separate read-only
      surface** modeled on `mtreeOutputHighlight` (main.js line ~2218) — never inside the live
      contenteditable.

### Be cautious ⚠ (why apply-first is mandatory)

- **⚠ Full rebuild every keystroke.** `renderEditorContent` does
  `elements.editorContent.innerHTML = highlightMarkup`. Plain text is the source of truth; the DOM
  is throwaway. Any decoration must be re-derived on every render.
- **⚠ Phantom nodes corrupt offsets.** `domPositionToTextOffset` / `textOffsetToDomPosition` sum
  `.editor-line` text content. Inserting phantom "to-be-added" lines makes every offset past them
  wrong → corrupts cursor math, `getEditorSelection`, and the OT `buildPatchOp` diff, which would
  then **broadcast phantom content to peers and save it to disk**.
- **⚠ Many enumeration sites.** Lines that walk `:scope > .editor-line` (≈775, 800, 1438, 1472,
  1506) and the gutter builder all assume lines == real text lines. Don't add nodes they'd miscount.
- **⚠ Gutter & remote cursors are coordinate-locked.** Gutter heights are measured per real line;
  remote cursors overlay by line/offset. Phantom lines desync both.
- **⚠ Editing a "to-be-removed" line.** With apply-first there is no such line (the change is
  already applied), which is exactly why apply-first avoids this whole class of conflict.

### Acceptance criteria

- Accepted edits show a gutter marker + line tint on the real, applied lines; typing elsewhere does
  not corrupt cursor position; offsets/OT/gutter/remote-cursors remain correct.
- Decorations clear on keep/drop and reappear correctly after switching away and back.

---

## 10. Phase 6 — Client: Checkpoint / Drop Affordance Per Turn

**Files:** [app/main.js](app/main.js), [app/services/collaboration-service.js](app/services/collaboration-service.js) (SSE `event.clientId`, `getRole`, `isConnected`).

### Subtasks

- [ ] **6.1** Capture a checkpoint (deep clone of the project + the `baseRevision`) **before**
      applying each accepted batch.
- [ ] **6.2** Add a **Drop** control on each agent turn that applied edits.
- [ ] **6.3** Enable Drop when `!collaboration.isConnected() || collaboration.getRole() === "master"
      || checkpoint.soleAuthored`.
- [ ] **6.4** Track `soleAuthored` live: in the SSE handler, when an `operation`/`state` event
      arrives with a **foreign** `event.clientId`, set `soleAuthored = false` on every open
      checkpoint. (The client already receives `event.clientId` for every op.)
- [ ] **6.5** Cap checkpoint history (e.g. last 10 turns) to bound browser memory.

### Be cautious ⚠

- **⚠ UI gate is advisory; server is authoritative.** Always also handle the server rejecting a
  drop (403) gracefully — defense in depth. The UI gate just avoids offering doomed actions.
- **⚠ Deep clone cost.** Snapshots are whole-project clones; cap history and consider structural
  sharing later if needed.
- **⚠ Checkpoint ↔ batch identity.** Key checkpoints by `batchId` so per-turn Drop maps to the
  right snapshot and `baseRevision`.

### Acceptance criteria

- Drop is enabled for local/master always, and for sole-author non-master until a peer edits, then
  disables live. Dropping restores the pre-batch state for everyone (synced) or locally (offline).

---

## 11. Phase 7 — Safety, Edges, Tests

### Edge cases

- [ ] Stale proposal — target path deleted / renamed / changed before accept → mark stale, block
      accept, hint "re-run".
- [ ] Explicit secondary confirm for `delete-node` proposals.
- [ ] Block text ops on image nodes (`isImageFileName`) — agent must not propose `update-file` on
      a `.png` etc.
- [ ] Concurrent edit to a target file before accept → re-diff against current content or warn.
- [ ] Empty proposal list → render no card, behave as plain chat.
- [ ] Loop produced zero valid ops (all stale/invalid) → show message, no card.
- [ ] Chat disabled / server unconfigured → feature degrades to current behavior.
- [ ] clientId-reconnect caveat surfaced in the UI.

### Test matrix

| Area | Test |
|------|------|
| Server tool loop | Mock DeepSeek returning `tool_calls`; assert proposals collected, reads executed, writes not applied. |
| Server proposals | `preImage` captured; project tree injected; guard rails enforced. |
| Server revert | Sole-author allowed; foreign-author rejected; master bypass; **forged body ignored**; out-of-window rejected. |
| Client transport | `acceptAgentOperations` both branches (local vs synced); path re-resolution; stale handling. |
| Client persistence | `normalizeChatMessage` preserves `proposedOperations`/`batchId`/`proposalState` across reload **and** sync. |
| Client checkpoint | Capture → drop → restore round-trip (local/master/sole-author). |
| Editor decoration | Offsets/gutter/remote-cursors uncorrupted with decorations active. |
| Selftest | Extend [tools/selftest.mjs](tools/selftest.mjs) with accept/keep/drop against an in-memory project. |

---

## 12. Suggested Build Order

1. **Phase 1** — tool loop + proposals returned. Verify end-to-end with a temporary
   "Accept all → apply locally" stub (no UI polish).
2. **Phase 4** — chat card UI (**fix `normalizeChatMessage` first**).
3. **Phase 3** — real accept transport, both branches.
4. **Phase 2 + 6** — sole-author revert + per-turn drop.
5. **Phase 5** — editor decorations (most net-new UI risk; do last).
6. **Phase 7** — interleave throughout.

Phases 1–4 give a working accept loop in local mode quickly; 2/6 add safe collaborative drop; 5 is
the polish with the most architectural care.

---

## 13. Key Code References

| Concern | Location |
|---|---|
| Path-based op sink (client) | [app/domain/project-model.js](app/domain/project-model.js) → `applySyncOperation` (~L344) |
| Path-based op sink (server) | [server/mdnotes_server.py](server/mdnotes_server.py) → `_apply_operation` (~L441) |
| Project controller | [app/domain/project-service.js](app/domain/project-service.js) (`applySyncOperation`, `replaceProject`, `getActiveFile`) |
| Transport / OT / roles | [app/services/collaboration-service.js](app/services/collaboration-service.js) (`publishOperation`, `isConnected`, `getRole`, `transformOffset`, SSE `event.clientId`) |
| Apply + author + broadcast | [server/mdnotes_server.py](server/mdnotes_server.py) → `apply_operation` (~L616), `connect` (~L556), `master_tokens` |
| Chat proxy | [server/mdnotes_server.py](server/mdnotes_server.py) → `ChatProxy.chat()` (~L150), `__init__`, `_handle_chat` (~L862) |
| Chat request (client) | [app/services/chat-api-service.js](app/services/chat-api-service.js) → `sendChatRequest` (~L36) |
| **Chat message normalizer (STRIPS fields!)** | [app/services/chat-storage-service.js](app/services/chat-storage-service.js) → `normalizeChatMessage` (~L25), `createChatMessage` (~L15) |
| Chat render | [app/main.js](app/main.js) → `renderChatPanel` (~L406), message list (~L451) |
| Editor render (full rebuild per keystroke) | [app/main.js](app/main.js) → `renderEditorContent` (~L2748) |
| Editor offset maps | [app/main.js](app/main.js) → `domPositionToTextOffset` (~L1495) / `textOffsetToDomPosition` (~L1470) |
| Read-only highlight surface precedent | [app/main.js](app/main.js) → `mtreeOutputHighlight` (~L2218) |
| Manual-edit sync gate (match this condition) | [app/main.js](app/main.js) (~L1695, ~L5274) |

---

## 14. Risk Register

| # | Risk | Impact | Likelihood | Mitigation |
|---|------|--------|-----------|------------|
| R1 | `normalizeChatMessage` drops proposal fields | Proposals vanish on reload/sync | High | Extend normalizer allowlist (Phase 4.1 first). |
| R2 | Phantom diff nodes corrupt editor offsets/OT | Data corruption, bad broadcasts | High if attempted | Apply-first; decorate real ranges only (Phase 5). |
| R3 | Forged revert payload deletes others' work | Security / data loss | Medium | Server reconstructs from own snapshots (Phase 2.6). |
| R4 | clientId unstable across reconnect | User loses drop rights | Medium | Document v1; stable-id fix deferred. |
| R5 | DeepSeek endpoint lacks tool-calling | Feature silently inert | Medium | Capability check + text-only fallback (Phase 1). |
| R6 | Context window overflow in tool loop | API errors / truncation | Medium | Budget tool results; trim history (Phase 1.8). |
| R7 | Snapshot memory for large projects | Browser/server memory | Low-Med | Cap N; consider inverse-ops later. |
| R8 | Variable shadowing in `chat()` except block | Latent bug | Low | Rename local to `error_payload` (Phase 1). |

---

## 15. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-04 | Agent edits are proposals, not auto-applied | User must review agent (collaborator) changes. |
| 2026-06-04 | Accept applies immediately; Keep/Drop are post-hoc | Pre-commit gate is incoherent once collaboration is involved. |
| 2026-06-04 | Drop = forward sole-author revert, not rewind | Reframed as "delete the agent collaborator's work" — fits the model. |
| 2026-06-04 | Non-master may revert ranges they alone authored | Safe generalization of master-only `replace-project`. |
| 2026-06-04 | Server owns revert snapshots (no client body) | Forgery guard against deleting others' older work. |
| 2026-06-04 | Highlight applied ranges only; no phantom overlay | Avoids corrupting OT/offset/gutter/cursor subsystems. |
| 2026-06-04 | Agent excluded from `patch-file` / `replace-project` | Agent reasons in whole files; replace is master-only/destructive. |
| 2026-06-04 | **Only the originator** can accept/keep/drop a proposal | Shared accept rights would quickly become a mess; originator owns their agent turn. |
| 2026-06-04 | **Single response, lightweight loop** (cap ≈3 iterations) | Note-taking workload; not an IDE. A few loops are nice for read-then-edit, but keep it minimal. No streaming for v1. |
| 2026-06-04 | **Attribute accepted agent edits** (`origin:"agent"`, acceptor recorded) | Collaborators should see "Agent edit accepted by X" in presence/log. |
| 2026-06-04 | **Snapshot history window N = 40** | Drop only needs to reach recent agent turns; 40 is generous for note-taking. Revisit only if deeper drop is needed. |
| 2026-06-04 | **N counts revisions, not characters; retention pins to pending agent batches** | A *revision* is one coalesced committed op (typed sentence = 1 rev), and the counter advances for all authors — so a flat window could expire the agent's `baseRevision` mid-session. Retain `max(40, oldest-unresolved-batch baseRevision)` so a pending Drop never ages out. |
| 2026-06-04 | **Defer stable per-browser clientId** | A persistent id would interfere with current testing procedure; reconnect-loses-drop caveat accepted for v1. |

---

## 16. Resolved Questions

- [x] **Q1 — Pending-proposal visibility.** **Only the originator acts.** Peers may *see* a turn
      exists (it rides in the synced chat workspace) but accept/keep/drop controls are disabled for
      everyone except the user who made the request. Rationale: shared accept rights become a mess.
- [x] **Q2 — Streaming / loop depth.** **Single response, no streaming for v1.** Keep a *light*
      tool loop (cap ≈3 iterations) so the agent can read-then-edit, but nothing as extensive as an
      IDE agent. Most turns will be one shot. Lower `max_tool_iterations` from 8 → **3**.
- [x] **Q3 — Attribution.** **Yes.** Tag accepted agent ops with `origin:"agent"` and record the
      accepting user, so presence/log can show "Agent edit accepted by X."
- [x] **Q4 — History window N.** **N = 40.** N is how many recent project snapshots the server
      keeps for Drop to rewind to; older ones are discarded to bound memory. 40 comfortably covers
      "undo the last few agent turns" for a note-taking workload. (See Phase 2.2 / R7.)

      > **Units clarified.** N counts **revisions, not characters**. A revision is one *committed,
      > coalesced* operation — typing a whole sentence emits a single debounced `patch-file` op, so
      > 40 revisions ≈ 40 save-points (hours of work), not 40 characters. Caveat: `snapshot_history`
      > advances for **every** collaborator, so the retention floor is `max(40, oldest-unresolved
      > agent-batch baseRevision)` to guarantee a pending Drop never ages out (Phase 2.2).
- [x] **Q5 — Stable clientId.** **Deferred.** A persistent per-browser id would interfere with the
      current testing procedure. Accept the reconnect-loses-drop caveat for v1; surface it in the UI.
