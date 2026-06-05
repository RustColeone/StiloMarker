## Plan: MDNotes Current Roadmap

Keep the product as a static HTML, CSS, and ES module workbench that can run on GitHub Pages or through the optional Python backend. Preserve the current architecture split between domain, services, and UI so collaboration, filesystem support, `.mtree`, and `.urldb` behavior can continue evolving without coupling everything into one runtime module.

## Current Implemented Baseline

- Static minimal-JS workbench shell with VS Code-style layout
- Canonical project tree with `.md`, `.mtree`, `.urldb`, and image asset support
- Explorer with context-sensitive actions, quick-add, filtering, image previews, and derived `.urldb` entries
- Source and preview panes with separate tab state and drag-to-reorder for pane tabs
- Lightweight markdown rendering with HTML passthrough, image rendering, MathJax support, and PDF export
- Chromium live-directory open/save plus non-Chromium import/export fallback
- ZIP import/export support
- Offline shell via service worker
- Python-backed collaboration transport with text patch synchronization
- Docked debug panel with filtered tabs and clipboard export
- In-app dialogs for notice, confirm, rename/input, add-file, and bookmark entry creation
- Node-based self-test coverage for the frontend services and shell markers

## Next Phases

### Phase A: Collaboration Hardening
- Review current text-patch synchronization under rapid concurrent edits and identify failure cases that still force full state reloads.
- Decide whether the current ordered patch transport is sufficient or whether the next increment should move toward richer merge semantics.
- Improve collaboration diagnostics so conflicts and reconnect flows are easier to understand from the frontend.

### Phase B: URL Album Model Decision
- Decide whether `.urldb` entries should remain explorer-derived children backed by file transforms or become explicit subnodes in the canonical domain model.
- If they remain derived, tighten the editing and preview experience around that constraint.
- If they become first-class subnodes, redesign persistence and sync so `.urldb` entry operations are explicit rather than file-rewrite-based.

### Phase C: Explorer and Workbench Polish
- Continue refining selection, context-menu, and drag/drop behaviors so the workbench feels predictable across folders, files, images, and `.urldb` entries.
- Evaluate whether multi-select is worth adding or whether it would complicate the minimal-JS interaction model too much.
- Revisit any remaining browser-native flows, especially PDF save, only if the replacement is materially better and browser-compatible.

### Phase D: Backend-Focused Increment
- Shift effort toward the Python backend once the frontend interaction model is stable enough.
- Clarify the backend roadmap for session durability, LAN deployment ergonomics, and collaboration resilience.
- Keep the backend contract aligned with the frontend's current file model, including `.urldb` and image assets.

### Phase E: Frontend Assistant and Context Scoping
- Add an in-browser assistant experience that stays entirely in the frontend and lets the user choose the provider and supply their own API key.
- Keep provider integration behind a service adapter so the UI can support multiple vendors without coupling core app state to any single API.
- Scope assistant context explicitly: selected files only by default, or a bmap plus all files referenced by that bmap when the user asks from a diagram-led workflow.
- Present the assistant in a VS Code-like chat panel with visible context chips, provider/model selection, and clear send/stop controls.
- Preserve project state boundaries so the assistant can suggest or summarize without automatically expanding to the entire workspace.

#### MVP Scope
- Provider picker and BYOK storage in browser local state.
- Manual file selection for context attachment.
- bmap-aware expansion to include the map and referenced files.
- Chat transcript panel with streaming responses when the selected provider supports them.
- Context summary before sending so the user can verify exactly what is included.

#### Suggested Sequence
1. Define the assistant service contract and provider adapter interface.
2. Add context collection helpers for selected files and bmap expansion.
3. Add a docked chat-style assistant panel to the existing shell layout.
4. Wire provider requests and streaming response handling.
5. Add guardrails, error states, and tests for context boundaries.

## Architecture Rules

- Keep domain logic free of DOM and browser APIs.
- Keep filesystem, storage, sync, and `.urldb` transforms behind service adapters.
- Keep UI modules event-driven and avoid hiding core project state inside DOM-only structures.
- Prefer plain browser APIs over external libraries unless the complexity reduction is substantial and justified.

## Active Priorities

- Collaboration correctness under concurrent editing
- Final decision on `.urldb` entry representation
- Continued explorer UX tightening without introducing unnecessary framework complexity
- Frontend assistant scope and context-bound request model
- Maintaining self-test coverage as the frontend and backend continue to evolve

## Open Technical Problem: Wrapped-Line Indentation Visual

### Goal
When a long indented line wraps in the source editor, its continuation rows should visually appear indented to match the leading whitespace of that line (e.g. `\tA...B` wrapping before `B` should display `B` as if it were also under the tab stop, not snapped back to column 0).

### Root Constraint
The source editor uses two sibling layers with identical CSS: a native `<textarea>` (transparent, real caret and input) and a `<pre>` highlight overlay (colours only, no interaction). Both must produce **bit-for-bit identical text flow** — same font, size, line-height, padding, tab-size, white-space, overflow-wrap — so the highlight layer tracks the real caret accurately.

Any CSS that shifts overlay text (`padding-left`, `text-indent`, `margin-left` on `.editor-line`) changes where the browser wraps lines in the overlay **without** changing the textarea. This creates a visual mismatch: the cursor, click targets, and typed characters land in different columns from where the eye expects them.

### Options Analysed

**Option A — Indent guide line (no text shift)**
Draw a thin vertical rule on the highlight overlay at the indentation column position for any line that physically wraps, using an absolutely-positioned pseudo-element. The text is never moved; the guide simply shows the reader where the indent level is. Caret and click placement remain perfectly accurate. This is the VS Code "indent guides" pattern.
- Pro: zero caret mismatch, always-on (no focus-state switching), minimal code.
- Con: continuation text still starts at column 0 visually; the guide is a hint, not a true indent.

**Option B — Per-continuation-row span injection**
Detect how many visual rows each logical source line occupies (by measuring rendered height vs. one line-height), then inject invisible spacer `<span>` elements at the start of each continuation row inside the overlay.
- Pro: continuation rows are visually indented.
- Con: the overlay word-wrap boundary shifts, so carets still misalign. Also means overlay text content diverges from source text, which breaks the offset-mapping used by drag-drop and autocomplete.

**Option C — Switch to `contenteditable`**
Replace the `<textarea>` with a `contenteditable` block, giving full DOM control over per-row CSS and caret placement.
- Pro: true hanging indent with correct caret behavior is achievable.
- Con: significant architectural rewrite; all input, selection, undo, autocomplete, and paste handling must be rebuilt. Deferred under the minimal-JS rule until the collaboration and `.urldb` model work is stable.

### Current Decision
Pursue **Option A** as the pragmatic correct solution given the current architecture. Remove the `inactive`-only fake hanging indent (it breaks on every click), and replace it with an always-visible indent guide line on the overlay. This has no caret mismatch, no focus-state switching complexity, and is visually honest about what the architecture can deliver. Revisit Option C only if the workbench moves toward a richer editing model in a later phase.

---

## Deferred or Optional Work

- Full rich-text editing or WYSIWYG mode
- Heavy parser-based syntax highlighting
- CRDT or OT transport unless collaboration requirements justify the added complexity
- Framework migration away from the current minimal-JS architecture