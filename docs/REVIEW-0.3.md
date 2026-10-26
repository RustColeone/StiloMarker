# Code review: v0.3.2 – v0.3.11

A walkthrough of every change from v0.3.2 to v0.3.11, written as a code
review for a developer who has never opened this repository. Read §0 first:
it explains the handful of ideas the rest relies on. §1 covers the largest
and riskiest change, a source editor in each editor group (v0.3.11), in
depth. §2–§10 review the smaller changes, newest first.

Each change is reviewed the same way: what the user sees, the files, how it
works, review notes (what is subtle, what could break), and the tests that
hold it.

Names in `code` are real: functions, files, CSS selectors and settings, so
you can search for them. Line numbers are left out on purpose (they drift);
search for the function name instead.

---

## 0. Orientation

### 0.1 The repository in one page

| Path | What it is |
|---|---|
| `index.html`, `app/styles.css` | The single page and its one stylesheet. No build step: the browser loads ES modules as they are. |
| `app/main.js` | Only starts the modules (`startModules`). Nothing else lives here. |
| `app/kernel/` | The small core every module uses: `defineModule`, state with a trace (`createState`), registries, logging. |
| `app/modules/<name>/` | One feature area each (Shell, Workspace, Editor, Explorer, Sync, Cloud, Comments, …). Inside: `index.js` (the module definition and its API), `model/` (pure functions, unit-tested in Node), `service/` (state and rules), `adapters/` (the page: DOM, events). |
| `server/` | The Python server (collaboration, cloud workspaces, accounts, the agent proxy). `server/stilo/modules/` mirrors the browser's modules. `server/MANUAL.md` is the user manual the in-app agent reads; `tools/protocol-sync.mjs` copies it to `app/modules/assistant/adapters/manual.js`. |
| `desktop/` | The Electron app: the same web app in a window of its own (`app.mjs` main process, `preload.cjs` the bridge, `policy.mjs` its pure rules). |
| `extensions/` | Optional features (diagrams, Mermaid, album, themes…) written against the extension API (`docs/EXTENSIONS.md`). |
| `tests/` | `*.test.mjs` (Node), `*.test.py` (Python), `*-browser.py` (Playwright, a real Chromium against this checkout with every server call mocked). `tests/README.md` lists what each one holds. |
| `docs/` | `ARCHITECTURE.md` (the rules and the history of each step), `ISSUES.md` (open, accepted and fixed issues per release), `DEPLOYMENT.md`, `EXTENSIONS.md`, this file. |

### 0.2 Modules, levels and the rules

Every browser module is a `defineModule({ name, level, uses, owns, start(ctx) })`.
A module may only `ctx.use()` modules of a lower level that it lists in
`uses`. The levels and other architecture rules are checked by
`tests/structure/structure.test.mjs`. If you break one, that test names the
rule. Shell is level 1, Workspace 2, the Editor 3, Explorer and Comments 4,
Cloud and the Assistant 5.

Shared state is owned by exactly one module. It is made with
`ctx.state(initial)`; everyone else reads it through `get()`/`on()`, and it
changes only through the owner's named actions. Each change lands in the
trace (Shell's log panel, the "Trace" tab) under that action's name. When
you wonder "who changed this?", the trace answers.

### 0.3 How drawing works

1. Something changes the project (a key, a remote edit, a file opened). The
   project lives in Workspace's store: `workspace.project()` returns it, with
   `getProject()`, `getActiveFile()`, `setActiveFile(id)`,
   `updateContent(id, text)`, `subscribe(fn)`, and so on.
2. The store tells its subscribers. One of them (in `workspace/index.js`)
   calls `shell.render(project)`.
3. Shell emits a `"render"` event (`shell/adapters/render.js`), and each
   module draws its own part: the Explorer its tree, the Editor its tabs,
   groups, editors and preview.
4. While a key is being applied, the full redraw waits
   (`shell.holdRendering(() => app.isTyping())`): the editor has already
   drawn the key itself. The redraw catches up 250 ms after the last key,
   or every 1.5 s during a long burst. Keep this in mind: in the middle of
   typing, the rest of the app is briefly behind on purpose.
   `render(project, { only: "status" })` never waits.

### 0.4 The Editor module and its shared context

`app/modules/editor/` draws the editor groups (two panes, "left" and
"right"), each with a tab strip, the source editors, the preview, find and
replace, completions, links, and the Markdown renderer.

`adapters/surface.js` builds the Editor in a page. All its parts share one
object called `app` (the Editor's shared context, a holdover from when it
all lived in `main.js`). Each part is a function like
`createFindReplace(app)` that returns functions. `surface.js` adds those
onto `app` with `add()`, which throws if two parts define the same name.
Parts call each other through `app.someFunction()`. Other modules reach a
frozen copy of `app`'s functions through `editor.parts()`.

What the editor shows is the **view**, a piece of state owned by the Editor
(`service/view.js`, pure, unit-tested in `tests/editor-view.test.mjs`):

| Field | Meaning |
|---|---|
| `groups` | `[{ id: "left" \| "right", tabs: [{ fileId, view }], active }]`. A **tab** is a file shown one way: `view` is `"source"` or `"preview"`. |
| `hosts` | `{ source, preview }`. `hosts.preview` is the group the preview's body is in. `hosts.source` is **the active editor's group** (since v0.3.11, see §1). |
| `previewFileId`, `previewPart` | What the preview shows. |
| `sourcePart`, `groupParts` | The **part** each editor shows (see below). |
| `selectionNodeId` | The node highlighted in the explorer. |

A **part** is one entry of a file that has entries (today: a URL album,
`.urldb`, whose entries can be opened alone). Workspace's `parts` registry
knows how: `workspace.parts.of(name)` returns
`{ list(content), body(content, id), withBody(content, id, text), … }`.
When an editor shows a part, it shows only that entry's body, and typing
writes it back into the whole file with `withBody`.

The **project's active file** (`project.activeFileId`) is "the open file":
the explorer highlights it, Linked Notes and the status bar describe it,
and the server keeps it with a cloud workspace's open tabs.

A **pane view** is a tab that is not a file (today, History's diff). It
always shows in the preview's body.

---

## 1. v0.3.11: a source editor in each group

### 1.1 What the user sees

Each editor group has its own source editor, so two files, or the same
file twice, can be edited side by side. Before, there was one source
editor: if the other group's tab wanted it, that group showed a
placeholder ("a.md is open as Source in the other group", with "Show
here").

- **The active editor.** The editor last worked in is the active one: its
  file is the project's active file. The find bar, completions, Linked
  Notes, the character count and comments follow it. Working in an editor
  means focusing it, clicking its gutter, dropping on it, or typing a key in
  it.
- **The same file in both.** Typing in one shows up in the other. Each
  editor draws the other's caret like a collaborator's, labelled "Left
  editor" / "Right editor". The other caret stays where it was in the text,
  shifting when text is typed before it.
- **Undo belongs to the file.** Ctrl+Z in either editor undoes the file's
  last change, whichever editor made it (as VS Code does). A file's history
  survives switching tabs while the file is open.
- **On a phone** only the active editor shows.

### 1.2 The idea in one paragraph

The source editor used to be one object built against the shared `app`.
Now `adapters/editors.js` builds two **editor contexts**, one per group.
Each is `Object.create(app)`: it reads everything through to the shared
context, but has its own elements, render cache, shown file, undo history
and its own idea of "the active file" (the file *it* shows). The editor's
core functions are installed on each context, so inside an editor
`app.getEditorText()` means *this* editor's text. On the shared `app`,
those same names forward to the **active** editor, and the shared
context's `elements`, `editorRenderCache`, `shown` and `editorHistory` are
getters onto the active editor's. So the shared parts (find, completions,
links, resume, tabs, comments) keep working unchanged: they act on the
active editor.

### 1.3 The picture

```
                      surface.js: app (the Editor's shared context)
                      ├─ shared state: searchState, autocompleteState, editorDragState,
                      │                remoteCursorsByClient, view, settings, workspace…
                      ├─ shared parts: find, autocomplete, links, tabs, groups, resume,
                      │                preview, char count, debug trace…
                      ├─ getters  elements / editorRenderCache / shown / editorHistory
                      │           ──► the ACTIVE editor's
                      └─ forwards EDITOR_API names (getEditorText, setEditorSelection, …)
                                  ──► the ACTIVE editor's functions
                                            │
                     ┌──────────────────────┴──────────────────────┐
     left editor = Object.create(app)                right editor = Object.create(app)
     own: group "left", elements (#source-body…),     own: group "right", elements (copy, no ids),
          editorRenderCache, shown {fileId, partId},       editorRenderCache, shown,
          editorHistory ─► histories["fileId#part"],       editorHistory ─► same store,
          controller (getActiveFile = its file),           controller (its file),
          kept caret, the core, showFile, events           kept caret, the core, showFile, events
                     └──────────── active one = view.hosts.source ─────────────┘
```

### 1.4 Vocabulary used below

- **Active editor**: the context of the group `view.hosts.source`
  (`editors.active()`). It shows `project.activeFileId`.
- **The other editor**: shows its group's active tab when that tab is a
  source tab; otherwise its body is hidden and it is not drawn.
- **Kept caret** (`keptSelection()`): an editor's selection saved as text
  offsets. It is needed because the page has only *one* DOM selection,
  which belongs to the focused editor. The other editor's caret exists only
  as these offsets.
- **Follow**: bring an editor's text up to date with the file after a
  change made elsewhere, without touching the page's selection
  (`followText`).
- **Peers**: the other editor's caret, drawn as a collaborator's
  (`localPeers()`).

### 1.5 File-by-file review

#### `app/modules/editor/adapters/editors.js` (new): the heart of it

- **`createEditors(app, composing, shared)`** is called by `surface.js`
  right after `app` is made. `shared` holds the page's shared elements
  (`findElements()`).
- **`secondBody(first)`** makes the right editor's body: a deep copy of
  `#source-body` *as the page has it at start*. That is why the copy is
  taken before anything is installed on the left. The copy has every `id`
  removed (ids are unique: tests and older code reach the left editor by
  `#editor-content`, which stays the left one's), and its find bar,
  completions popup and welcome card removed (one each, moved to whichever
  editor needs it). The copy goes into the right group, right after its
  `.group-placeholder`.
- **`make(group, body)`** builds one editor context:
  - `Object.create(app)`, then own properties via `Object.defineProperties`:
    - `group`;
    - `elements`: `Object.create(shared)` plus this editor's own elements
      from `editorElements(body)`, so shared elements like `findInput`
      still resolve;
    - a fresh `editorRenderCache`;
    - `shown: { fileId, partId }`;
    - `editorHistory` (a getter onto the history store, keyed
      `"fileId#partId"`);
    - `controller` (a getter: the project store via `Object.create`, with
      only `getActiveFile` overridden to return *this* editor's file; the
      store's methods are closures, so this is safe).
  - `isActiveEditor`, `keptSelection` / `keepSelection`, `localPeers`, and
    its own `redrawRemoteCursors`.
  - Then `createEditorCore(editor)`, `createShowFile(editor)` and
    `installEditorEvents(editor)` installed on it; its gutter's click
    listener; `attachSelectionChangeListener()`.
- **`fileOf(editor)`** is what "the active file" means inside an editor:
  - for the active editor, `project.activeFileId`;
  - for the other, its group's active tab if that tab is a source tab,
    else none.
- **`activateEditor(group)`** makes a group's editor the active one. It
  returns early if the editor already is, or if the group's active tab is
  not a source tab. Otherwise it:
  1. applies a pending follow for it first (see "Review notes");
  2. saves each editor's scroll and caret, the outgoing one's among them
     (`captureViewState`);
  3. calls `view.activate(group, tab)` and `view.select(fileId)`;
  4. sets the project's active file (or asks for a status redraw if
     unchanged);
  5. schedules saving the open tabs.

  The caller is any "worked in" event: focus, focusin on the body, a key
  or an edit (`claim`), the gutter's click, a drop.
- **`typedIn(editor)`** is called by `notifyEditorChanged` after every edit
  in an editor. Other editors showing the same file are queued and
  **followed** after `FOLLOW_IDLE` (90 ms) without keys, or every
  `FOLLOW_MAX` (400 ms) during a burst. This is the same cadence the typing
  editor uses to draw its own lines (`drawTypedSoon` in `editor-events.js`).
  It is not per key on purpose: following a 20,000-line file on every key
  forced a layout of the whole page each time (~200 ms per key on the dev
  VM; paced, ~30 ms).
- **`peersOf(editor)`** returns the other editors showing the same file
  *and part* that are on screen, as cursor objects (`clientId:
  "editor-left"`, `displayName: "Left editor"`). The focused editor's
  caret is read live from the page; the other's is its kept caret.
- **`peersMoved({ all })`** redraws peer carets once a frame, and only in
  editors that share a file with another, so a key costs nothing extra
  when the files differ. `all` (after each render) redraws every editor,
  so a caret of an editor that moved on to another file is cleared.
- **`placeTools()`** moves the find bar and the completions popup into the
  active editor's `.editor-surface`, clears the old editor's search
  highlights, and runs the search again on the new text. It runs on every
  render.
- **`showFiles(project)`** is called on every render (as
  `app.showActiveFile`):
  - each editor on screen shows its file (`editor.showFile`); the active
    one always does, as before, because it holds the welcome page when no
    file is open;
  - each body's `data-active` is set (CSS uses it on the phone);
  - the tools are placed, and peers redrawn;
  - histories of files no longer open in any group, and not shown by any
    editor, are dropped.

#### `app/modules/editor/adapters/surface.js`

- Builds the editors first (`createEditors(app, composing, findElements())`).
- Defines `app.elements`, `app.editorRenderCache`, `app.shown` and
  `app.editorHistory` as getters onto `editors.active()`.
- Defines forwarders for every name in `EDITOR_API` (plus `getSelectedPart`
  and `fileContentFromEditor`): `app[name] = (...a) => editors.active()[name](...a)`.
- `isTyping` / `isRendering` mean "any editor". The render hold must see
  typing in either.
- `redrawRemoteCursors`, settings changes (font, wrap, spellcheck,
  toolbar), marks, resize and `forgetMeasurements` are sent to **every**
  editor (`each`).
- `showActiveFile`, `activateEditor`, `editorOf`, `eachEditor`,
  `editorTyped` and `peersMoved` are on `app` for the parts that need them.
- The API (`editor.parts()`) gains `editorElements()` (the active editor's
  gutter and text, for Comments' popover) and `redrawLineNotes()`
  (every editor's gutter redrawn with carets kept).
- The old `app.editorHistory` / `editorRenderCache` / `shown` literals are
  gone. If you add state that is per editor, it belongs in `make()`, not
  in the `app` literal.

#### `app/modules/editor/adapters/elements.js`

- `findElements()` now returns only shared elements: find bar and its
  controls, completions, tab strips, preview.
- `editorElements(body)` finds one editor's elements **by class** inside
  its body (`.editor-content`, `.editor-gutter`, `.editor-scroll`,
  `.editor-surface`, …). It throws when one is missing, so markup and code
  can't drift silently.

#### `app/modules/editor/adapters/editor-core.js`

- `API` is now exported as `EDITOR_API` (the names the shared context
  forwards).
- `diffEditorTexts` was added to it (`followText` needs it).
- Nothing else changed: the core parts already called each other through
  their private `ed` object and reached the outside world through `app`.
  That is what made this refactor feasible.

#### `app/modules/editor/adapters/show-file.js` (now one editor's)

- **`getSelectedPart(project)`** reads this editor's part: `partOf(view,
  group)`. It only uses that part while the editor shows the part's file.
  A group can move on to another file while its kept part points at the
  old one; without the check, an editor could show file F's entry over
  file G, and typing would write F's entry into G. `tests/two-editors-browser.py`
  holds this.
- **`showFile(project)`** is the old `showActiveFile` body, for this
  editor's file:
  - **No file:** the welcome card (`.welcome-card`) is moved into this
    editor's empty state.
  - **Another file or part than shown:** it loads, with the file's saved
    caret and scroll.
  - **Same file, text changed elsewhere:**
    - focused: as before, the DOM selection kept and the history fenced,
      but only if the history does not already hold the text (the other
      editor's typing is this file's history too). If the page's
      selection is not inside this editor yet (it is being focused), its
      kept caret is used instead of reading `{0,0}`;
    - **not focused: `followText`**. Before, this branch called
      `loadEditorContent(text)`, which put the caret at 0. That bit
      single-editor users too, e.g. a collaborator's edit landing while
      the user was in the chat.
- **`followText(nextText)`**: the kept caret is moved by the change
  (`diffEditorTexts`, then `transformEditorSelection`) and the text is
  re-rendered incrementally with the scroll kept. The history is reset
  only if it does not already hold the new text. It never touches the
  page's selection.

#### `app/modules/editor/adapters/editor-history.js`

- **The history store.** Each editor's `app.editorHistory` is a getter
  onto a store keyed by file and part. Two editors showing the same file
  share one history object. It holds patches, not snapshots (see the
  comment on `pushEditorHistoryState`).
- **`loadEditorContent(text, …)`** keeps the history when it already holds
  exactly this text. That is how undo survives switching back to a file,
  or opening it in the other editor. It also sets the editor's kept caret.
- **`notifyEditorChanged`** ends with `app.editorTyped?.(app)`: here `app`
  is the editor's own context, so the other editors know who typed.
- **Undo/redo** need no change. They apply the shared history's patch in
  *this* editor and notify, and the other editor then follows. The undone
  selection is the one recorded with the entry, possibly the other
  editor's caret position; VS Code does the same.

#### `app/modules/editor/adapters/editor-cursors.js`

- **`renderRemoteCursors(remote)`** and the overview ruler add
  `app.localPeers()` to the collaborators' cursors.
- **The `selectionchange` listener** (one per editor, page-wide) behaves
  differently depending on focus:
  - when this editor has the focus: remembers the caret per file (as
    before), keeps it as this editor's kept caret, and asks for peers to be
    redrawn;
  - **only the active editor** reports the caret to collaborators
    (`presence.setOwn`). Without this guard, the other editor would report
    `{0,0}`, as a selection outside it reads.
- The overview ruler draws search hits only in the active editor. Find's
  matches are offsets into the active editor's text.

#### `app/modules/editor/adapters/editor-window.js` (lazy rendering)

- **`updateWindow`** re-applies a held selection only when this editor has
  the focus (`if (held && focused)`).
- **Review rule.** Any code that writes the page's selection
  (`setBaseAndExtent`, `addRange`, `focus()`) must check that its editor
  is focused. Otherwise it takes the caret from the other editor.
  - `setEditorSelection` already refuses when not focused.
  - `applyEditorRender` already leaves the focus where it is when another
    element has it (its `elsewhere` check).
  - `caretIntoView` only acts when focused.

#### `app/modules/editor/adapters/editor-events.js`

Split in two:

- **`installEditorEvents(app, composing)`**, per editor. Typing, IME,
  `beforeinput`, focus, scroll, keys, links under the mouse, drag and drop,
  wheel, resize.
  - `focusin` on its body and `focus` on its text call
    `app.activateEditor(app.group)`. On focus, the editor's kept caret
    (or, failing that, the file's saved one) is restored.
  - **`claim`** runs on `keydown` and `beforeinput`, in the capture phase:
    a key in an editor that has the focus but is not the active one
    activates it first. This happens after a drop elsewhere left the focus
    here, or when the groups are restored while typing. Without it, find,
    completions and presence would act on the other editor's file.
  - A drop focuses the editor dropped on, then activates it.
  - Dragged text carries its `fileId`. Dropped in another file, it is
    always copied, never moved (`explorer/adapters/adding.js`,
    `moveOrInsertDraggedSelection`).
  - Listeners call shared functions through arrows
    (`() => app.hideEditorAutocomplete()`), never by reference. The editors
    are built before those parts exist.
- **`installSharedEditorEvents(app)`**, once: the find bar's controls and
  the previews' links.

#### `app/modules/editor/service/view.js`

- **`hosts.source` changed meaning.** It used to be "the group holding the
  one source body". It is now "the active editor's group". Every action
  that moves it goes through **`sourceTo(state, group, fileId)`**:
  - the outgoing editor's `sourcePart` is kept in `groupParts[old]`;
  - the incoming editor gets its own kept part back, if it is of the file
    it will show.

  The callers: `activate` (a source tab), `switchView` (to source),
  `moveToGroup` (a source tab), `closeGroup`.
- **`partOf(state, group)`** returns the part a group's editor shows.
- **`groupsFromSaved(saved, idOf, activeId)`**: `activeId` makes the group
  that shows the active file as Source the active one. Without it,
  `keepTabs` would overwrite the left group's tab with the active file.
- **`keepTabs` is unchanged.** It still makes the active editor's group
  show `activeFileId` as Source, and with no active file it drops that
  group's source tabs. That is why `tabs.closeGroupIfEmpty` now hands the
  active file on when the active editor moves groups (below).

#### `app/modules/editor/adapters/tabs.js`

- **`activateTab`** now calls `view.activate` before `view.pick`. `pick`
  writes the part for `hosts.source`, so the order decides which editor's
  part it clears.
- **`handOn(group, project, { show })`** (written here in v0.3.11, moved
  to `editors.js` in v0.3.14 with `handOnWhenGone`, below; `tabs.js` calls
  `app.handOn`) decides who gets the active file when the active editor's
  file leaves it (its tab closed, or turned Preview), in this order:
  1. the group's last source tab;
  2. the other group's shown source tab (its editor becomes the active
     one), else that group's last source tab;
  3. no file.

  `show: false` (a tab turned Preview) leaves the group showing that
  preview, as v0.3.3 did.
- **`handOnWhenGone(project)`** (v0.3.14, O10): a render that finds no
  active file (it was deleted) while the other group's editor shows a file
  makes that editor the active one. It runs right after the render
  (`queueMicrotask`), because handing on draws again.
- **`closeGroupIfEmpty`.** When a group closes and the active editor moves
  to the other group, the project's active file becomes that group's shown
  source tab, before the redraw. Otherwise `keepTabs` would drop that
  group's source tabs if the active file had been deleted.
- **`setActiveSourcePart(fileId, partId, group)`** and `openPartInPane(…,
  group)`: an album entry dropped on a group opens in that group's editor.

#### `app/modules/editor/adapters/groups.js`

- **`drawGroups`.** Each group shows its own editor's body for a source
  tab. The preview's body still moves to `hosts.preview`'s group.
  - An empty group shows the active editor (and so the welcome page) if it
    is the active one, else the preview if it holds it.
  - The placeholder ("open as … in the other group", Show here) now
    appears only for a pane view whose body is the preview elsewhere.

#### Other files

- **`resume.js`** (v0.3.16): a file's saved view state holds the file's
  latest place (`editorSelection`, `editorScroll`) and each editor's own
  (`byEditor.left`, `byEditor.right`).
  - `getViewState(fileId, group)` gives the group's own place over the
    file's; with no group, the file's. `show-file.js` and the focus handler
    pass the editor's group.
  - `captureViewState` saves every editor on screen. It skips a hidden one,
    which would read scroll 0. It saves the active one last, so the file's
    latest is that one's.
  - `rememberEditorSelection` saves the caret of the editor with the
    focus. Before v0.3.16 it read the active editor only. It also sets that
    editor's kept caret. A phone may deliver no `selectionchange` before
    another control takes the focus. The pointer-down's call is then the
    last word, and `captureViewState` reads the kept caret of an editor
    without the focus (`mobile-caret-browser.py` caught this).
  - `tabs.js` calls `forgetEditorPlace` when a source tab closes (after a
    capture). It calls `carryEditorPlace` and `forgetEditorPlace` when a
    tab moves to the other group: a moved tab carries its place, an
    "Open to the Side" copies it.
  - A file back under a new id (O9) starts from its path's state, the
    editors' places included.
- **`links.js`**: `handleEditorLinkHover`, `openLinkFromEditor` and
  `resolveEditorLinkHref` take the file the link is in. The other
  editor's links resolve from its own folder.
- **`together.js`**: collaborators' carets (`other-caret`, `carets-kept`)
  update the shared map and redraw **every** editor. The write path
  (`workspace.editing`) writes through the editor that shows the file whole
  (since v0.3.15 the other one too, when the active one doesn't; see §1.11).
  Another editor showing that file follows on the render.
- **`frame-parts.js`**: settings, splitter moves and layout changes go to
  every editor. A hidden editor is not re-rendered on a splitter move: it
  would measure zero widths. The phone's source pane is the active
  editor's body.
- **`debug-trace.js`**: each trace line names the active editor's group
  (`editor=left|right`).
- **Comments** (`app/modules/comments/`):
  - the gutter and text elements are getters on the active editor
    (`editor.parts().editorElements()`);
  - notes are given for any file an editor shows (`commentsForFile`);
  - a comment change redraws every editor (`redrawLineNotes`);
  - the popover finds its row by `data-line`. It used to find it by
    position, which was wrong in a long, lazily rendered file.
- **`app/styles.css`**:
  - `#editor-content` rules became `.editor-content` (17 rules; nothing
    else on the page has that class);
  - on the phone, `.editor-group > .source-body:not([data-active="true"])`
    is hidden.

### 1.6 Invariants: what must stay true

1. **At most one editor writes the page's selection: the focused one.**
   Check focus before setting a selection or focusing.
2. **The focused editor is the active one** whenever the user acts in it
   (focus, key, edit, drop, gutter). Tools act on the active editor, so a
   mismatch makes them act on the wrong file.
3. **The active editor shows `project.activeFileId`.** The other shows its
   group's source tab, or is hidden.
4. **Two editors sharing a history hold the same text** for that file and
   part, up to one follow interval while typing. `followText` and the
   fence (`resetEditorHistory` only when `history.text` differs) keep it so.
5. **A part is used only on its own file** (`getSelectedPart`'s check).
6. **Per-editor state lives in `make()`.** Nothing assigns `app.x = …` from
   inside an editor's part. That would create an own property on that
   editor only, or worse, on the shared context.
7. **Only the active editor reports presence.**

### 1.7 Flows, step by step

**Typing in the left editor while the right one shows the same file**

1. The browser inserts the character (native typing, one line).
2. The `input` listener runs in the left context: `pushEditorHistoryState`
   then `notifyEditorChanged`.
3. `notifyEditorChanged` runs: `updateContent` → store → `shell.render`
   (held, typing) → `workspace.typed` → Sync sends the patch if shared →
   `app.editorTyped(left)`.
4. `typedIn(left)` queues the right editor; after 90 ms without keys, it
   calls `right.showFile(project)`.
5. In the right editor's `showFile`, it is the same file, the text differs
   and it is not focused, so `followText` runs: the kept caret moves by
   the diff and the text re-renders, without touching the selection.
6. `peersMoved` → each editor redraws the other's caret.

**Clicking into the right editor**

1. `focus` → `activateEditor("right")`.
2. A pending follow is applied first (the text is current).
3. `view.activate` → `hosts.source = "right"`; `setActiveFile` → render,
   synchronous since nothing is typing.
4. `showFiles`: both editors show their files. Nothing reloads, because
   `shown` matches. `placeTools` moves the find bar into the right editor.
5. Back in the `focus` handler, the right editor's kept caret is restored.
   The click then places the caret where it landed.

**Ctrl+Z in the right editor after typing in the left**

The shared history's last entry is the left's typing. `editorUndo`
reverses it in the *right* editor (`applyEditorRender` with the entry's
selection) and notifies; the left editor follows.

**A collaborator edits the file shown in both**

1. Sync applies the operation to the store and Workspace announces
   `remote-change`.
2. `together.js` queues a transformed selection for the active editor if
   it is focused.
3. The render runs `showFiles`:
   - the focused editor re-renders, keeping its selection;
   - the other follows, keeping its kept caret.
4. Collaborators' carets redraw in both.

### 1.8 Review notes: what bites

- **One page selection.** This is the root of most subtle bugs. An editor
  without focus has no DOM selection: `getEditorSelection()` returns
  `{0,0}` for it. Never read an unfocused editor's selection from the
  page; use `keptSelection()`.
- **Re-entrant renders.** Activation happens inside `focus` and inside
  `keydown` (capture). It triggers a synchronous render. That render must
  find nothing to reload under the user's caret. This is why
  `activateEditor` applies a pending follow first, and why `showFile`
  falls back to the kept caret when the page's selection isn't in the
  editor yet.
- **`Object.create` contexts.** Reading `app.x` inside an editor finds the
  editor's own `x` first, then the shared one. If you add a function to a
  core part, add its name to `EDITOR_API` if shared code must call it on
  the active editor. Don't capture shared functions by reference at
  install time: the editors are built before the shared parts.
- **Hidden editors.** An editor whose group shows a preview has
  `display: none`. Rendering it measures zero, which pollutes the
  render cache's heights. `showFiles` skips it, and so does the splitter
  redraw.
- **Performance.** Anything that runs per key in both editors costs a
  layout. Pace it like `typedIn` does, or limit it to editors sharing a
  file, like `peersMoved`.
- **The highlighter memo is shared** (`highlight.js`). Two editors with
  different highlight kinds (say Markdown and JSON) make it re-highlight
  more often on all-editor redraws. This is correct, only slower; worth
  knowing if a profile shows `highlightEditorLinesMemo`.

### 1.9 Debugging

- **The log panel** (View → Toggle Log): the "Trace" tab lists every view
  change by action name (`show source tab`, `open tab to the side`, …).
  Editor trace lines (spaces, Enter) carry `editor=left|right`.
- **Caret lines.** "followed a change elsewhere (not focused): kept sel=…"
  marks an editor that followed. "setEditorSelection SKIPPED (editor not
  focused…)" is normal for the other editor.
- **In tests**, `tests/helpers/app_hook.py` exposes `editor.parts()` on
  `window`. `two-editors-browser.py` shows how to reach each editor's DOM
  (`.source-body[data-group="right"] .editor-content`) and the view
  (`modules.editor.view`).

### 1.10 Tests

- **`tests/two-editors-browser.py`** (new) covers:
  - "Open to the Side" from the tab menu: the file in both editors, no
    placeholder;
  - typing mirrored; peer carets labelled;
  - the other editor's kept caret shifted, checked by focusing without a
    click;
  - shared undo and redo;
  - two files: activation by working in an editor, the count, the find bar
    opening and searching in the editor worked in;
  - closing the active editor's last source tab;
  - a part kept per editor and only on its own file;
  - a key claiming a focused editor;
  - the phone.

  Two mutation checks were run by hand: removing the caret shift in
  `followText`, or the file check in `getSelectedPart`, makes it fail.
- **`tests/editor-view.test.mjs`**: the active editor moving between
  groups with parts kept per group, `closeGroup` handing it over, and
  `groupsFromSaved` with the active file.
- **Updated for the new behaviour:**
  - `editor-groups-browser.py`: Move to Other Group shows the file in the
    right editor, and the left keeps its own;
  - `groups-resume-browser.py`: the restored active file shows in the right
    editor, which is the active one;
  - `tab-menu-browser.py`: docstring only.
- **Every other browser test** still uses the left editor by
  `#editor-content` and passes unchanged.
- **`tests/pane-places-browser.py`** (v0.3.16): the same file in both
  editors, each at its own caret and scroll (the right one scrolled without
  the focus), comes back so after a reload. It also checks that a closed tab
  forgets its group's place and that Open to the Side starts where the first
  editor is. It fails before v0.3.16.

### 1.11 Known limits and next steps

- **The write path** (the agent's edits, Find in Files' replace) goes
  through whichever editor shows the file whole (the active one first:
  `writerFor` / `applyWrite` in `editors.js`, since v0.3.15), so it joins the
  file's undo history from either editor. A file shown only as a part is
  written directly, and its editors follow (with a history fence).
- **Resume** (since v0.3.16) keeps each editor's own caret and scroll per
  file, and the file's latest (`mdnotes.viewstate.v1`, see `resume.js` under
  "Other files" in §1.5). An editor's place is kept only while the file is
  open in it, so a pane that shows a file again after closing it starts
  where the file was last left.
- **The other editor's caret in the active one** can lag one follow
  interval (90–400 ms) while typing.
- **O9** (the caret jumping to the top after a reconnect) was fixed in
  v0.3.13: a reconnect's reload keeps each editor's caret and scroll by path
  (`keptCarets` / `carryCarets` / `giveCaretsBack` in `editors.js`, called by
  `together.js`), and `resume.js` finds a file's saved caret by its path when
  its id is new (the server gives every new file its own id).

---

## 2. v0.3.10: the Agent's status says "Ready" only once it is

**What the user sees.** Settings → Agent says "Checking the server…" while
the server is being asked. It used to say "Ready — using your own API key,
through this server." before any answer. An answer that arrives late no
longer overwrites a newer one.

**Files.**
- `app/modules/models/model/agent-status.js` (`settingsLine`);
- `app/modules/models/adapters/agent.js` (`refresh`);
- `app/modules/models/adapters/settings-section.js`.

**How it works.**
- `settingsLine(state, settings)` returns `{ text, ok }`. `ok: null` means
  neither success nor error. It returns the checking line when
  `state.status === "checking"`, after the cases that need no server
  (running in the browser; no key entered).
- `refresh()` numbers each asking (`asked`). Only the latest one may set
  the state.
- The settings section colours the line only for `ok === true` or
  `ok === false`.

**Review notes.**
- Several modules ask the agent again: the Settings dialog opening, a
  setting changing, Sync joining or leaving a session (`assistant/index.js`).
  Overlap is normal, and the counter makes it safe.
- Found by `agent-here-browser.py` failing once under load. That test now
  reads the line in the same step that sees it (`wait_for_function`
  returning the text).

**Tests.** `tests/models.test.mjs`: the line while checking, and a late
answer dropped. Both failed before the fix.

---

## 3. v0.3.9: the desktop app has one bar

**What the user sees.** The desktop window has no system title bar. The
app's top bar is the title bar: drag it to move the window. The system's
window buttons are drawn over its right end (on a Mac, the traffic lights
on its left), in the theme's colours.

**Files.**
- `desktop/app.mjs` (`openWindow`, `drawButtons`, IPC `stilo:frame`);
- `desktop/policy.mjs` (`frameLook`, `overlayOf`, `DEFAULT_FRAME`);
- `desktop/preload.cjs` (`stiloDesktop.frame.set`);
- `app/modules/shell/adapters/desktop.js` (`joinTitleBar`, `hexColor`);
- `app/styles.css` (`:root[data-window-frame="overlay"] .topbar`).

**How it works.**
- **The window.** It is created with `titleBarStyle: "hidden"` and
  `titleBarOverlay`: Electron's Window Controls Overlay draws the system's
  buttons over the page.
- **The page side.** When the overlay is visible
  (`navigator.windowControlsOverlay.visible`), `joinTitleBar` sets
  `<html data-window-frame="overlay">`. The CSS then:
  - makes `.topbar` a drag region (`-webkit-app-region: drag`);
  - excludes its buttons, inputs, menus and popovers (`no-drag`);
  - pads both ends by the room the buttons take
    (`env(titlebar-area-x)` / `env(titlebar-area-width)`).
- **The colours.** `joinTitleBar` reads the bar's computed background, text
  colour and height. It sends them through the bridge whenever the theme
  (attributes on `<html>`) or the bar's size changes.
- **The main process.** It validates them (`frameLook`: `#rrggbb` colours,
  an integer height of 24–120 px) and calls `win.setTitleBarOverlay` with
  the height times the zoom (`overlayOf`). It keeps them in `window.json`
  for the next start (on Windows and Linux; a Mac's buttons keep their
  own colours).

**Review notes.**
- **The drag region is the whole bar.** Any new interactive element in
  `.topbar` must match the `no-drag` selector (`button, a, input, select,
  .menu-popover, .mobile-file-list`), or clicks on it will move the window
  instead.
- **Full screen.** The overlay hides and `data-window-frame` becomes
  `system` (on `geometrychange`), so the padding goes too.
- **Not verified by hand on macOS.** Electron 44 on Linux, under the
  test's virtual display, reports the overlay visible, and the user checked
  the v0.3.15 build on Windows (2026-10-26). A Mac's look
  (`trafficLightPosition`) has not been seen.

**Tests.**
- `tests/desktop.test.mjs`: what the page may tell, the buttons' height
  with the zoom, and the colour conversion.
- `tests/desktop-browser.py` (Electron, phase "first"): the bar a drag
  region and its controls not, the room kept, and the dark theme's colours
  kept in `window.json`.

---

## 4. v0.3.8: the desktop app zooms

**What the user sees.**
- Ctrl+= (or +), Ctrl+- and Ctrl+0 (Cmd on a Mac; the number pad too)
  and Ctrl+wheel zoom the window, through a browser's steps from 50% to
  300%.
- View has Zoom In, Zoom Out and Reset Zoom.
- The status bar shows the zoom while it is not 100%; clicking it resets.
- The zoom is kept for the next start.

**Why it was missing.** The app draws its own menus, so it sets no
Electron application menu on Windows or Linux (`Menu.setApplicationMenu(null)`).
Electron's default zoom shortcuts come from that default menu, so they
went with it.

**Files.**
- `desktop/policy.mjs`: `ZOOM_STEPS`, `zoomStep`, `zoomKey`, `keptZoom`,
  all pure;
- `desktop/app.mjs`: `before-input-event` for the keys, `zoom-changed` for
  the wheel, the zoom applied on each load, `window.json`;
- `desktop/preload.cjs`: `stiloDesktop.zoom`;
- `app/modules/shell/adapters/desktop.js`: `addZoom`, the commands and the
  status item.

**Review notes.**
- **The keys are taken in the main process** (`before-input-event`,
  `event.preventDefault()`), so the page never sees them. The page's
  commands list the same keys only for the menu's labels.
- **The wheel** is limited to one step per 100 ms. A touchpad can send
  many events at once, and Electron's synthetic wheel sends a begin and an
  end event.
- **Chromium keeps zoom per origin**, but not across restarts, which is
  why the app keeps it in `window.json`.

**Tests.**
- `tests/desktop.test.mjs`: the steps, the keys (and Cmd on a Mac), and
  the page's commands and item, with stand-ins.
- `tests/desktop-browser.py`:
  - the keys in Electron, checked not to reach the page;
  - Ctrl+wheel;
  - the status bar;
  - the zoom kept over a restart, and Ctrl+0.

---

## 5. v0.3.7: the left window has tabs

**What the user sees.**
- The left area is a window of tabs. The activity bar holds their icons:
  the Explorer first, then Search (Find in Files, a tab of its own), then
  any page dragged there. An icon shows its page; the icon of the page
  showing hides the window.
- Linked Notes and Session stay as sections under the Explorer's tree.
- The right panel's toggle is a button at the right end of the top bar.
- On a phone, the left drawer shows the icons in a row at its top.

**Files.**
- `app/modules/shell/adapters/pages.js` (most of it);
- `app/modules/shell/adapters/frame/areas.js` and `frame/index.js`;
- `index.html`;
- `app/styles.css`;
- the pages' owners, which add icons and change hosts:
  `editor/adapters/search-files.js`, `editor/adapters/surface.js`,
  `explorer/adapters/surface.js`, `sync/adapters/session-view.js`,
  `assistant/index.js`, `chats/adapters/page.js`.

**How it works.** Shell's pages system has two kinds of host:

- **A tab host** (`[data-tab-host="<id>"]`) shows one page at a time with
  a strip of tabs: `left`, `side` (the right panel), `bottom`, `settings`.
- **A section host** (`[data-section-host]`) stacks collapsible sections.
  `explorer`, under the tree, is the only one now.

The rest of the mechanism:

- **Several strips per host.** The left host has two: the activity bar
  (`data-tab-style="icons"`, which draws each page's `icon`, or its
  label's first letter, and `data-tab-toggles="area"`) and the phone's row.
- **The Explorer page** is `movable: false` (no Move to… menu, not
  draggable) and `ownHeader: true`: its body has its own header.
- **The title row.** Other pages get the host's title row
  (`[data-tab-host-header]`, with `[data-tab-host-title]`, the "+" and the
  toolbar slot).
- **Explorer sections** count as visible only while the left window shows
  the Explorer page (`hostShown`).
- **`pages.open(id)`** brings a page on screen wherever the user moved it.
  Commands use it instead of knowing hosts (Find in Files, Show Log).
- **Drop zones.** `[data-page-drop="left"]` is on the left window and on
  the activity bar. A page dropped on either becomes a left tab. Move to…
  offers Explorer / Left / Right / Bottom.

**Review notes.**
- **Pages moved to "left" before** (when it was a section host) are left
  tabs now. That's intended, and it is kept in `settings.pageHosts`.
- **A tab click only toggles the window from the activity bar.** On the
  phone the row is inside the open drawer, and toggling there would close
  it.
- **Fixed on the way:** Find in Files' rows ran past the window's edge
  (its grid column now `minmax(0, 1fr)`). On a phone its box was squeezed
  to a sliver, because it took the phone grid meant for the editor's find
  bar. That rule is now scoped to `#editor-find-bar`.

**Tests.**
- `tests/area-pages-browser.py` (rewritten): the icons, hiding, menus,
  moves, drags, the title row, reload, and moving back.
- `tests/search-files-browser.py`: Ctrl+Shift+F shows the Search tab; on a
  phone, the box is wide and the rows fit.

---

## 6. v0.3.6: a search box for file names above the tree

**What the user sees.**
- A box under the Explorer's header filters the tree by file and folder
  name (any case); the folders holding matches show open.
- "No file names match." when nothing does.
- Enter opens the first file found; Escape clears the box.

**Files.**
- `app/modules/explorer/model/filter.js` (new, pure: `rowsMatching`,
  `firstFileMatching`);
- `explorer/adapters/tree.js` (`getNameQuery`, the signature includes the
  query);
- `explorer/adapters/events.js`;
- `index.html` (`#explorer-name-filter`);
- `app/styles.css`.

**Review notes.**
- **Folders' own open/closed state is never changed.** Matches are shown
  open only while the query lasts (`open` on the row).
- **Grid rows.** The tree's grid needed a fourth row
  (`auto auto minmax(0, 1fr) auto`): without it, the box took the tree's
  stretching row.
- **The app shell.** `service-worker.js` must list every new module, or
  the installed app fails offline. A Node test enforces it.

**Tests.**
- `tests/explorer-filter.test.mjs`;
- `tests/explorer-filter-browser.py`, which includes the tree keeping its
  height under the box.

---

## 7. v0.3.5: a project's tree is headed by its name; section headers alike

**What the user sees.**
- A team project's tree root shows the project's name instead of
  "Workspace".
- Linked Notes' header looks like the other sections' headers.

**Files.**
- `server/stilo/modules/cloud/service/cloud.py` (`create_project` names
  the new project);
- `server/stilo/modules/workspace/adapters/folder_store.py` (`load()`
  names the project and its root after its folder);
- `app/modules/editor/adapters/surface.js` (no `headerClass` for Linked
  Notes);
- `app/styles.css`.

**Review notes.**
- **Naming on load.** Projects made before this keep "Workspace" in their
  manifest, but are named on every load. Paths never include the root's
  name (`path_of` skips the root), so renaming it moves no file.
- **Only team projects use `FolderStore`.** It is reached only through
  Sync's directory. A PIN session keeps its own state file, so a random
  folder name never shows up as a project name.

**Tests.**
- `tests/cloud.test.py`: a new project is named, and one from before is
  named on load;
- `tests/area-pages-browser.py`: every section header alike. Both failed
  before.

---

## 8. v0.3.4: the tab strips

**What the user sees.**
- The tab in use is the darker one in every theme.
- The pane label has a border before the tabs.
- A full strip no longer shows a scrollbar that made one pane header
  taller than the other; the wheel scrolls it sideways.

**Files.**
- `app/styles.css`:
  - `:root:not([data-theme="dark"]) .editor-tab.is-active`;
  - `.pane-label` `border-right`;
  - `.tab-strip` `scrollbar-width: none` and the WebKit scrollbar hidden;
- `editor/adapters/tabs.js` (the wheel listener).

**Tests.** `tests/tab-strip-browser.py`. It checks the computed
`scrollbarWidth`, because headless Chromium hides scrollbars anyway and a
plain visual check would pass on the old code.

---

## 9. v0.3.3: a pane's label switches its tab where it is

**What the user sees.** Choosing Source or Preview from a pane's label (▾)
switches the tab in use in place. It used to open a second tab.

**Files.**
- `editor/service/view.js` (`switchView`);
- `editor/adapters/tabs.js` (`switchTabView`, now with `handOn(…, { show: false })`);
- `editor/adapters/tab-menu.js` (`openViewMenu`).

**Review notes.**
- **No duplicate tab.** `switchView` replaces the tab in its place, and
  folds in a tab of the same file and view if one is already there.
- **Handing on.** When the active editor's shown tab turns Preview, the
  active file moves on as closing that tab would. The group keeps showing
  the switched tab.
- **The preview moving on.** When a group's preview turns Source, the
  preview moves on to that group's other preview tab, or to none, so no
  preview tab comes back by itself.

**Tests.** `tests/editor-view.test.mjs`, `tests/tab-menu-browser.py`.

---

## 10. v0.3.2: a project opens only with Open

**What the user sees.** In Open Project, a double-click on a project only
selects it; it opens with the Open button. A double-click on a team or a
folder still enters it.

**File.** `app/modules/cloud/adapters/browser.js`: the `dblclick` listener
acts only on `team` and `folder` entries.

**Why it happened.** Two quick clicks (one to select, one more as the list
redraws) counted as a double-click.

**Tests.** `tests/trash-browser.py`: the Open Project check fails before.

---

## Appendix: working on this code

- **Where to work.**
  - Work in the dev checkout, branch `dev`. The live server serves files
    straight from its own checkout, so never edit there.
  - Release by setting the version (`node tools/release-version.mjs X.Y.Z`,
    which writes every label and the service worker's cache name), then run
    `node tools/protocol-sync.mjs` (generated copies, such as the manual)
    and the tests.
- **Running the tests.**
  - `node --test tests/` runs all Node tests.
  - `python3 -B tests/<name>.test.py` runs one Python suite.
  - `python3 tests/<name>-browser.py` runs one browser test. It needs
    Playwright with Chromium (`STILO_BROWSER` names a Chromium if needed);
    `tests/desktop-browser.py` also needs Electron (`STILO_ELECTRON`) and
    `xvfb-run`.
  - On a small machine, run the browser tests one at a time. They are
    timing-sensitive under memory pressure; a failure that passes alone is
    noted, never hidden.
- **Before committing**, every suite should pass. `docs/ISSUES.md` gets an
  entry per release (what was found, what changed, which tests hold it),
  and `tests/README.md` a row per new test.
