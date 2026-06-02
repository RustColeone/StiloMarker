# Pending Plan

This file captures deferred feature work that should be revisited after the upcoming brainstorming roadmap proposal is finalized.

## Status

- State: Pending
- Priority: High (deferred until roadmap alignment)
- Owner: Product/Engineering planning pass

## Deferred Feature Set

### 1. Linked Notes and Backlinks Panel

[Link Text](Nothing.md)

Goal:
- Add outgoing links, backlinks, and missing-link detection for markdown notes.

Initial scope:
- Parse markdown links in all .md files.
- Show outgoing links from active note.
- Show backlinks to active note.
- Flag unresolved links.

Integration notes:
- Must align with project path rules and explorer behaviors.
- Should cooperate with preview and editor tab workflow.

### 2. Session Snapshots and Time Travel

Goal:
- Allow manual snapshots of workspace state, with restore and compare flow.

Initial scope:
- Create named snapshot from current project state.
- List snapshots by timestamp/name.
- Restore selected snapshot safely.
- Provide basic diff/compare summary before restore.

Integration notes:
- Must align with collaboration revision model.
- Must respect local-storage and filesystem-backed workspaces.

### 3. Smart Writing Assistant for Markdown Workflows

Goal:
- Add context-aware editor actions for repetitive markdown and structure tasks.

Initial scope:
- Insert/update table of contents.
- Normalize heading levels.
- Convert selected links/images into .urldb entries.
- Generate module-map-friendly sections from selected content.

Integration notes:
- Must reuse existing markdown/mtree/urldb services where possible.
- Should fit current command/menu architecture without adding framework complexity.

## Cross-Feature Alignment Requirements

These three features should be designed together, not independently:
- Shared command surface for discoverability.
- Shared data contracts for links, snapshots, and transformations.
- Shared UX language across source pane, preview pane, and explorer.
- Collaboration-safe behavior for concurrent users.

## Revisit Trigger

Resume implementation after the larger brainstorming roadmap proposal is documented and approved.

Roadmap reference:
- roadmap_brainstorm.md

## Next Planning Pass Checklist

- Confirm roadmap dependencies and sequencing.
- Define MVP boundaries across all three features.
- Identify shared service layer changes first.
- Draft UI wireflow for integrated user journey.
- Break into implementation milestones.
