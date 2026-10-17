# Architecture

Stilo Marker is being restructured into a modular monolith on each end (decided
2026-10-16). The full design, with the reasoning, the module map and the order
of work, is in the "Module design" tab of the
[architecture review](https://claude.ai/code/artifact/ea78ba1f-1850-4b76-9642-8cffb14e6c7a).
This file is the short reference that the structure tests enforce.

## The shape

- **A tiny kernel** starts the modules in dependency order and hands each one
  only the public APIs it declared. It holds no state and knows no domain
  (`app/kernel/`, `server/stilo/kernel/`).
- **Modules in one-way levels** (`app/modules/`, `server/stilo/modules/`):

  | Level | Modules |
  | --- | --- |
  | 1 | Shell (browser) / Transport (server), File types |
  | 2 | Workspace, Identity and access, Models |
  | 3 | Editor (browser), Sync, Characters |
  | 4 | History, Comments |
  | 5 | Assistant, Chats |
  | 6 | Extensions (`extensions/<name>/`): the URL album |

- **Inside every module**: its definition (name, level, uses, owns: in a
  browser module the `defineModule({...})` its `index.js` exports, in a server
  module `module.json`), `index` (the public API and events), `model/` (pure
  rules), `service/` (state and use cases), `adapters/` (all input and output:
  views, routes, storage, network). Importing a browser module's `index.js`
  never touches the page; adapters reach the page only once started.
- **Between the ends**: each module's network messages live in
  `protocol/<module>.contract.json` with their own version (Identity's was
  the first, in v0.1.38). Sync's version is the old single sync number (117):
  both ends read it from `protocol/sync.contract.json`, and other modules'
  events ride Sync's stream. What no module has taken yet is in
  `protocol/legacy.contract.json`.
- **Why Identity and Models sit on level 2** (changed 2026-10-17; the design
  had them on level 1): they need the frame below them, Transport for their
  routes on the server and Shell for the server connection and dialogs in the
  browser. Workspace does not need Identity (who may open a project is asked
  by the modules above it), so nothing else moved.
- **Rules in both languages** (the server stays in Python) live only in a
  `model/` and share one case table in `spec/`, run by both test suites.

## Diagrams

### Modules and levels

Arrows are "uses": a module calls only the modules it points at, always on a
lower level. News travels the other way, as events or extension points, so it
needs no arrow. Every module exists (as of v0.1.47) and the URL album is an
extension (v0.1.48); legacy code still wires the modules together. Modules marked *both* have a browser half and a server half that share a
model and a contract.

```mermaid
flowchart TB
  subgraph L6["Level 6 · extensions"]
    UrlAlbum["URL album (browser)"]
  end
  subgraph L5["Level 5 · features"]
    Assistant["Assistant (both)"]
    Chats["Chats (both)"]
  end
  subgraph L4["Level 4 · on top of the editor"]
    History["History (both)"]
    Comments["Comments (both)"]
  end
  subgraph L3["Level 3 · on top of the workspace"]
    Editor["Editor (browser)"]
    Sync["Sync (both)"]
    Characters["Characters (both)"]
  end
  subgraph L2["Level 2 · the workspace and who uses it"]
    Workspace["Workspace (both)"]
    Identity["Identity and access (both)"]
    Models["Models (both)"]
  end
  subgraph L1["Level 1 · the frame"]
    Shell["Shell (browser)"]
    Transport["Transport (server)"]
    FileTypes["File types (both)"]
  end
  Kernel["Kernel (both): starts modules, hands out declared APIs"]

  Assistant --> Editor & Characters & Models
  Chats --> Characters & Identity & Models
  History --> Editor
  Comments --> Editor & Identity
  Editor --> Workspace & FileTypes & Shell
  Characters --> Workspace
  Sync --> Workspace & Identity
  Workspace --> FileTypes
  Identity --> Shell & Transport
  Models --> Shell & Transport
  L1 -.started by.-> Kernel
  L5 ~~~ L4 ~~~ L3 ~~~ L2 ~~~ L1

  classDef built fill:#d8f5dd,stroke:#2e8b47,color:#123;
  class Shell,Transport,FileTypes,Workspace,Identity,Models,Sync,Editor,Characters,History,Comments,Assistant,Chats,Kernel built;
```

### Inside a module

Every module has the same layers. Only the pure `model/` may exist in both
languages (with a shared case table in `spec/`); all input and output lives in
`adapters/`.

```mermaid
flowchart LR
  Others["Other modules (through the kernel)"] --> API
  Driving["Driving adapters: views (browser), routes (server)"] --> API["index: the public API and events"]
  API --> Service["service/: the module's state and use cases"]
  Service --> Model["model/: pure rules, no input or output"]
  Service --> Ports["ports: what it needs from outside"]
  Driven["Driven adapters: storage, network, the page"] -. implement .-> Ports
  Model <-. same cases .-> Spec[("spec/*.cases.json")]
```

### The two ends

The same module names on both ends; the network is just an adapter pair. A
browser-only workspace runs the browser half alone. What both ends must agree
on is data, not code: `protocol/` (shapes, file types, versions) and `spec/`
(the cases every twin rule must pass).

```mermaid
flowchart TB
  subgraph Browser
    BShell["Shell"]
    BTypes["File types"]
    BWork["Workspace"]
    BSync["Sync"]
    BMore["Editor, Characters, History,<br/>Comments, Assistant, Chats"]
  end
  subgraph Shared["Shared data: both ends load it or run it"]
    Protocol[("protocol/<br/>contracts, file types, versions")]
    Spec[("spec/<br/>cases every twin rule passes")]
  end
  subgraph Server["Server (Python)"]
    STrans["Transport"]
    STypes["File types"]
    SWork["Workspace"]
    SSync["Sync"]
    SMore["Characters, History, Comments,<br/>Assistant, Chats, Identity, Models"]
  end
  BSync <==>|"operations and events,<br/>as each module's contract spells them"| STrans
  Protocol -.-> BTypes & STypes
  Spec -.-> BWork & SWork
```

### Legacy code during the move

Code from before the restructure (`app/main.js`, `app/features/`,
`mdnotes_server.py` and the rest) is not a module, so nothing may depend on
it. It may use modules, but only through the APIs the kernel hands back, or
through a module's static export such as `builtinTypes`. Each step moves a
piece across, and the baseline records what is left.

```mermaid
flowchart TB
  subgraph LegacyB["Legacy browser code"]
    Main["main.js and app/features/*"]
    PM["project-model.js<br/>(type helpers ask File types)"]
  end
  subgraph LegacyS["Legacy server code"]
    MS["mdnotes_server.py<br/>(LEGACY_ROUTES)"]
  end
  Main -->|"startModules() then the APIs"| BShell2["Shell"] & BTypes2["File types"]
  PM -->|builtinTypes| BTypes2
  MS -->|"start_server_modules()"| STrans2["Transport"] & STypes2["File types"]
  BShell2 -- never calls --x Main
  Baseline[("tests/structure/baseline.json<br/>may only shrink")] -.records.-> LegacyB & LegacyS
```

### The write path (step 4, done in v0.1.33)

Every change to a file becomes a `patch-file` operation, whoever makes it:
typing, the agent's Keep, preview edits, history restores and reconnects. The
agent stays a special collaborator: its edit arrives as a proposal and merges
like typing. Workspace never calls Sync (Sync sits above it): it emits each
operation as an event, and Sync sends it.

```mermaid
sequenceDiagram
  participant Who as Typing / Keep / restore
  participant WB as Workspace (browser)
  participant S as Sync
  participant T as Transport
  participant WS as Workspace (server)
  Who->>WB: write(path, text, source)
  WB->>WB: diff old and new text into patches, apply locally
  WB-->>S: event: operation (patch-file)
  S->>T: POST /api/operations
  T->>WS: apply, rebase on others' typing, save
  WS-->>S: event to every other tab
```

## The eight rules

`tests/structure/structure.test.mjs` checks each one.

1. Import another module only through its public API (`index.js`, `__init__.py`).
2. Use only modules listed in `uses`, all on a lower level; no cycles.
3. Calls go down, news goes up: call lower APIs; tell higher modules through
   events or extension points.
4. One owner per concept: each state, stored file, registry, network message
   and type name belongs to one module.
5. Input and output only in adapters; `model/` and `service/` never touch the
   DOM, `fetch`, files or SQLite.
6. Code in both languages lives only in a `model/`, with a case table in
   `spec/` (listed in `spec/twins.json`).
7. Each module owns its network messages and their version.
8. Size budgets: the kernel about 300 lines and free of domain words; any file 800.

## Extensions

An extension is a folder under `extensions/` that adds a feature through the
modules' public extension points only. The URL album (step 8) is the first:
deleting `extensions/url-album/` and running `node tools/protocol-sync.mjs`
leaves an app that works without it.

- `extension.json`: `name`, `about`, `browser` (its browser module) and
  `fileTypes` (entries in the shape of `protocol/file-types.json`). Both ends
  merge these types after the built-in ones: the server's File types reads the
  manifests, and `tools/protocol-sync.mjs` writes the browser's copy, the list
  of modules `main.js` starts (`app/extensions.js`) and the files the service
  worker caches (`extensions/offline.js`).
- The browser module is a normal `defineModule` on level 6, above every core
  module. It imports only `app/kernel/index.js` and modules' `index.js`.
- The structure test fails if any code outside the extension's folder (the
  generated copies aside) spells its name or its file types' ids or labels.

## Legacy code

Code from before the restructure is not in a module yet. What it breaks today
is recorded in `tests/structure/baseline.json`: files over the size budget, and
the files that spell a type name the future owner will hold. The baseline may
only shrink. After a cleanup, `node tools/structure-baseline.mjs` lowers it; it
refuses to record anything new.

## Progress

| Step | What | State |
| --- | --- | --- |
| 1 | Guard rails: `tests/structure`, `spec/`, `protocol/legacy.contract.json` | done |
| 2 | Kernel (both ends), Shell (browser: commands, menus, shortcuts, dialogs), Transport (server: route table, CORS, JSON, error mapping) | done |
| 3 | File types: `protocol/file-types.json` on both ends; every type check in the browser and on the server asks it | done |
| 4 | Workspace, part 1: the one write path. Every text change travels as a patch; the agent is a collaborator (its edits merge, Drop undoes only its own) | done |
| 4b | Workspace, part 2: the project model and store (browser) and the tree, text offsets and folder storage (server) move into the module; operations get a shared case table | done |
| 4c | The server's operations (`_apply_operation`) and the sessions/sync parts of CollaborationBroker | done with 7c-1 |
| 5 | Characters on both ends: author's notes (hidden unless `notes: hints`), files characters cannot read (`Plans/`, `*.plan.md`), the agent's update rules and length guidance; every rule in one shared case table | done |
| 6 | Assistant on both ends: `edit_file` (exact passages, one match each, refused precisely so the model retries; proposals travel as an update-file with their edits and merge through the write path), the agent's tool definitions, the edit review card | done |
| 7a | Identity and access on both ends: accounts and the account file, sign-in tokens, who may open a project and in what role (`can(role, action)`), per-account preferences; in the browser the signed-in account and its stored sign-in. Shell gains the server connection. Identity's routes get the first module contract | done |
| 7b | Models: the providers (DeepSeek or another OpenAI-compatible endpoint, OpenAI, a user's own key), which models are offered and what each request carries, both streams (chat completions and the Responses API), image generation and generated images, MCP connections; in the browser a model called straight from the browser and the picker's grouping. A request gets an explicit route instead of provider fields on shared state | done |
| 7c-1 | Sync on the server: sessions and roles, presence, leases, event streams, the rebase log; every change checked against its revision before Workspace applies it. Workspace gains the pure `apply_operation`, the open project (`LiveProject`) and the one-file store. The last uncovered twin (rebasing a text patch) gets its case table. Dead code removed: revert-to-revision with its 40 project copies per workspace, the folder wipe | done |
| 7c-2 | Sync in the browser (the collaboration runtime, split into the runtime, the patch queue and pure rules; its server calls), Sync's routes on the server (Transport gained stream routes and refusals with a status), and `protocol/sync.contract.json` with the sync version both ends read. The backend self-test moved out of `mdnotes_server.py` into `tests/backend-selftest.py` | done |
| 7d | History on both ends: snapshots and backups in one content-addressed store each, their retention rules, the routes and `protocol/history.contract.json`; in the browser this browser's own snapshot store, History's server calls and the line diff (the dialogs stay in `app/features` and call it) | done |
| 7e | Comments on both ends: the rules for a line comment, the comments file it owns, its routes, contract and `comments` event; in the browser keeping a comment on its line (the gutter popover stays in `app/editor`) | done |
| 7f-1 | Chats on the server: the chat store (SQLite per project), who answers, the reply queue, claims for replies written in a member's own browser, its routes; a character's name comes from Characters' header rules (a fourth copy of them went) | done |
| 7f-2 | Chats in the browser (the chats view, this browser's own chat store, the server calls) and `protocol/chats.contract.json` with the chat events | done |
| 7g-1 | Editor (browser): the source editor, split by job into parts that share one editor object (text and DOM, rendering, edits and undo, others' cursors, the toolbar, keys), highlighting, find and replace, autocomplete, links, the formatting toolbar and table picker, and the Markdown renderer as its model. The gutter popover for comments moved into Comments. The URL album entry editing is a port the app provides (it becomes an extension in step 8) | done |
| 7g-2 | The tab strips and panes (and resuming the last view, through a port) and the preview pane with a `previews` extension point: images, Markdown and mind-map trees are built in; URL albums, diagrams and character sheets add theirs from `app/features/previews.js` | done |
| 8 | The URL album as an extension (v0.1.48): `extensions/url-album/` with its file type, model, preview, highlighting, Entry button and entry dialog. The core gained extension points instead of album code: file parts in Workspace (a file's named parts listed, opened, renamed, moved, copied and dropped on their own), highlighters and toolbars in Editor, `shell.form` for dialogs with several fields, and the Create menu drawn from File types. Nothing in the core names the album | done |

### Notes for module authors

- Browser: a command id is `<owner>.<action>`; add it with
  `shell.commands.add({ id, title, run, keys?, menu? })`. Menus are drawn
  from commands, so `index.html` holds no menu items.
- Server: a new route is `transport.add_route(method, path, run)`, where
  `run(request)` returns the JSON payload and raises `PermissionError`,
  `LookupError` or `ValueError` for 403, 404 and 400. `KeyError` and
  `IndexError` stay 500: they are bugs. `LEGACY_ROUTES` in
  `mdnotes_server.py` holds the routes from before the restructure and only
  shrinks.
- File types: never spell an extension. Ask the module (`typeOf`, `is(name,
  id)`, `formatOf`, `extensionOf`, `mimeOf`...; code from before the
  restructure uses `builtinTypes` or the helpers in `project-model.js`). A new
  type is one entry in `protocol/file-types.json`, then
  `node tools/protocol-sync.mjs` writes the browser's copy. Pages mark what
  they need (`data-file-accept`, `data-file-types`, `data-file-type-options`)
  and File types fills it in.
- The server, from the browser: `shell.server.request(path, { method, query,
  body, failure })`. Never build the address yourself; `shell.server.url()`
  is it. Each module's calls live in its `adapters/api.js`.
- The signed-in account: `identity.account()` (`{ token, username, teams }`
  or null) and `identity.token()`; listen to `identity.events.on("account")`.
  Never read the stored password or the sign-in settings: Identity keeps them.
  On the server, `identity.require(token)`, `require_team`, `may_open`,
  `role` and `can(identity, action, team, access)`.
- Calling a model (server): `route = providers.route(model, own_key,
  own_url, own_model)`, then `providers.stream(route, payload, emit)` (or
  `complete`). Build the payload in chat-completions form; Models adds what
  the model needs and translates it for the Responses API. In the agent the
  seam is `ChatProxy._complete(payload, emit)`, which tests fake. From the
  browser to a user's own endpoint: `runDirectReply` (Models).
- Changing a shared workspace (server): `SharedWorkspace.apply_operation(token,
  operation)` (Sync) checks the sender's role and the revision, rebases a
  text patch, then calls Workspace's `apply_operation(project, operation,
  types)`, which only changes the tree. Operation names are Workspace's
  (`PATCH_FILE`, `UPDATE_FILE`, `REPLACE_PROJECT`); the paths an operation
  touches are `touched_paths(operation)`.
- Server routes that answer with their own status: raise
  `transport.Refusal(status, payload)` (Sync's 409 conflicts, 426 out-of-date
  tabs, 503 storage). A server-sent event stream is
  `transport.add_stream_route(method, path, run)`.
- Events of your own on the live stream: the server broadcasts through the
  shared workspace; in the browser, Sync hands every event it does not own to
  the runtime's `onEvent(event, { ownClientId })`.
- A preview for a kind of file: `editor.previews.add({ id, matches(file),
  render(target, project, file, tools), cacheable?, printHtml? })`;
  `tools.markdownHtml(project, file, text)` renders Markdown with the
  project's links and images. A cacheable preview is a pure function of the
  file's text, the project's paths and the connection.
- A file whose text holds named parts (each listed under the file in the
  explorer, opened in the source editor on its own, renamed, deleted, copied,
  dragged between files and dropped into Markdown):
  `workspace.parts.add({ id: <file type id>, list, body, withBody, rename,
  remove, take, insert, linkText?, add? })` (the shapes are in Workspace's
  `index.js`). The explorer, tabs and file actions do the rest.
- Highlighting and toolbar buttons for a format the Editor does not know:
  `editor.highlighters.add({ id: format, line(rawLine, { escape, blank }) })`
  and `editor.toolbars.add({ id: format, groups })` (groups as in
  `TOOLBAR_SPECS`).
- A dialog that asks for several values: `shell.form({ eyebrow, title,
  message, fields: [{ name, label, value, type, multiline, placeholder }] })`
  resolves to `{ name: value }` or null.
- A new kind of file that can be created (New ... in the Create menu and the
  explorer): give its File types entry a `create: { label, name, order }`.
- Deleting a cloud project or folder: `registry.delete_entry` moves it, with
  its history, into History's trash (`history.trash.put`). The trash keeps it
  for `--trash-days` (at most 30) and the backup sweep removes it after
  that. Who may delete or restore is `identity.may_delete(identity, team,
  folder)`. In the browser, `modules.history.trash.open(team, { onChange })`
  shows it.
- A module's network messages: list each route in
  `protocol/<module>.contract.json`. The structure test checks that the
  server half serves exactly those and that nothing outside the module calls
  them.
- Writing a file: never send `update-file` for text and never call
  `controller.updateContent` plus `publishOperation` yourself. Call
  `workspace.write(path, text, { base?, source })`. With `base` (the text you
  started from) your change is fitted into the file as it is now; a
  `StaleWriteError` (`workspace.isStale(error)`) means it no longer fits and
  nothing changed. A restore that chains on the server's confirmation uses
  `workspace.asPatch(operation, revision)`.
