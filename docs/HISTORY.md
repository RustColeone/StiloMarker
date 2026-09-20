# Project History and Design Decisions

Consolidated from five planning documents that were superseded once the work they
described shipped. They are replaced by this single record; the originals remain in
git history if the full text is ever needed.

| Original | Written | Outcome |
|----------|---------|---------|
| `implementation-log.md` | Mar 2026 | Phase 1–2 build log — shipped |
| `pending_plan.md` | May 2026 | Three deferred features — all since shipped |
| `roadmap_brainstorm.md` | Jun 2026 | `.bmap` diagram format proposal — shipped |
| `plan.md` | Jun 2026 | Roadmap A–E — shipped; its open problem is now **obsolete** |
| `agent-collaborator-plan.md` | Jun 2026 | Agent-as-collaborator, 7 phases — all ☑ done |

---

## Architecture rules (still current)

These outlived the plans that contained them and still govern the codebase:

- Keep domain logic free of DOM and browser APIs.
- Keep filesystem, storage, sync and `.urldb` transforms behind service adapters.
- Keep UI modules event-driven; do not hide core project state in DOM-only structures.
- Prefer plain browser APIs over external libraries unless the complexity reduction
  is substantial and justified. There is no build step and no runtime dependencies.

---

## What was planned, and what happened

### Diagram workspace (`roadmap_brainstorm.md`)
Proposed a visual flow-diagram format where each node links to a markdown file for
detail editing. **Shipped** as `.bmap`: `bmap-service.js` (parser/serializer),
`bmap-view.js` (canvas editor and SVG/PNG/JPG export), with nodes, connectors,
styles and per-node file links.

### Deferred features (`pending_plan.md`)
All three have since shipped:
- *Linked notes and backlinks panel* → the links panel (`renderLinksPanel`).
- *Session snapshots and time travel* → per-file snapshots with a diff view; now
  server-side, content-addressed and deduplicated.
- *Smart writing assistant* → the chat agent.

### Agent as collaborator (`agent-collaborator-plan.md`)
All seven phases completed: backend agentic tool loop, sole-author revert
infrastructure, the Accept / Keep / Drop transport, the chat proposal UI, in-editor
decorations, per-turn checkpoints, and the safety/edge test pass. The decided
semantics (proposals apply immediately so they can be read in context, then Kept or
Dropped) still describe current behaviour.

### Roadmap phases (`plan.md`)
Phases A–E — collaboration hardening, `.urldb` model, explorer polish, backend
increment, assistant scoping — are all delivered or overtaken. Collaboration
hardening in particular went far beyond the original scope; see
[ISSUES.md](ISSUES.md).

---

## Superseded decisions — do not follow these

### The editor is no longer a textarea + overlay
`plan.md` carried a long analysis of *"Open Technical Problem: Wrapped-Line
Indentation Visual"*, weighing three options against an editor built from a
transparent `<textarea>` plus a `<pre>` highlight overlay. It concluded that
**Option C (switch to `contenteditable`) was too large a rewrite** and recommended
Option A (indent guides).

**That premise no longer holds.** The editor is now a `contenteditable` element
(`#editor-content`) with `.editor-line` children and a separate gutter — Option C
was effectively taken. Any reasoning in that document about caret/overlay mismatch
describes an architecture that no longer exists.

Whether wrapped continuation rows *should* be visually indented is still an open
product question, but it must be re-analysed against the current editor.

### "No CRDT or OT transport"
`plan.md` listed operational transform under "deferred or optional". **Operational
transform was implemented**: the server rebases concurrent `patch-file` offsets
through its operation log (`_rebase_patch` / `_apply_text_patch`), which is what
makes concurrent editing of the same file converge.

---

## Notable decisions made since

- **Snapshots are server-side.** Browser-local IndexedDB was tried first and was
  wrong: history did not follow the user across devices, and the key fell back to a
  project id most workspaces share. Storage borrows git's model — SHA-256
  content-addressed, gzip-compressed, refcounted blobs — kept *outside* the project
  directory because publishing wipes that directory.
- **Line comments are metadata, never content.** Stored in a `comments.json` sidecar
  beside the project, shared with everyone who can open it, preserved across a
  publish, and hidden from the file browser. They follow the text: each stores its
  line's own content and is re-anchored by searching outward after edits — including
  edits made by collaborators.
- **Write safety is enforced on the server, not the client.** Client-side gating was
  tried and proved incomplete: any missed path, or any old cached build, bypassed it.
  Preconditions now live inside the server's mutation lock, and conflicts return 409
  so clients pull rather than diverge.
