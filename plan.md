## Plan: MDNotes Minimal-JS Implementation

Build the product as a static HTML, CSS, and ES module application first so it can ship directly on GitHub Pages with minimal runtime overhead. Keep the architecture split into domain, services, and UI layers so the optional Python sync server and future `.mtree` compiler can be added without rewriting the frontend.

## Implementation Phases

### Phase 1: Static App Shell and Core Domain
- Create a dependency-light static app entry point with a VS Code-inspired shell.
- Define the canonical in-memory project tree and file operation rules.
- Add a local cache adapter and browser capability detection.
- Leave self-test entry points for core domain behavior.

### Phase 2: Explorer, Editor, and Preview
- Implement the left explorer tree with context-menu-based create, rename, delete, and export actions.
- Implement a Markdown source editor with live preview.
- Support `.md` and `.mtree` files only.
- Persist editor/theme/session state locally.

### Phase 3: Browser File Access and Export
- Add Chromium directory open/save support through the File System Access API.
- Add non-Chromium single-file import and in-browser editing fallback.
- Add single-file export and zip export for folders/projects.
- Keep zip import as a later increment if needed.

### Phase 4: Offline App and Sync Boundaries
- Add service-worker-based offline shell support.
- Introduce a thin sync adapter boundary for a future Python LAN backend.
- Leave clear extension points for event-based collaboration and `.mtree` actions.

## Architecture Rules
- Keep domain logic free of DOM and browser APIs.
- Keep filesystem and storage behind service adapters.
- Keep UI modules thin and event-driven.
- Prefer plain browser APIs over external libraries unless complexity justifies otherwise.

## Initial Deliverables
- Static app shell
- Project tree domain model
- Explorer UI
- Source editor and preview
- Theme settings
- Single-file export and zip export
- Node-based self-test script

## Deferred Items
- Zip import
- Full LAN sync server
- `.mtree` compilation
- Advanced explorer behaviors like drag-and-drop reorder and multi-select