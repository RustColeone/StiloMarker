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

## Architecture Rules

- Keep domain logic free of DOM and browser APIs.
- Keep filesystem, storage, sync, and `.urldb` transforms behind service adapters.
- Keep UI modules event-driven and avoid hiding core project state inside DOM-only structures.
- Prefer plain browser APIs over external libraries unless the complexity reduction is substantial and justified.

## Active Priorities

- Collaboration correctness under concurrent editing
- Final decision on `.urldb` entry representation
- Continued explorer UX tightening without introducing unnecessary framework complexity
- Maintaining self-test coverage as the frontend and backend continue to evolve

## Deferred or Optional Work

- Full rich-text editing or WYSIWYG mode
- Heavy parser-based syntax highlighting
- CRDT or OT transport unless collaboration requirements justify the added complexity
- Framework migration away from the current minimal-JS architecture