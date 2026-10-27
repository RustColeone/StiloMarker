# Extensions: the API, version 1

New features come as extensions wherever they can. An extension is a
folder under `extensions/<name>/` that adds a feature through what this page
lists, and nothing else. Delete the folder, run `node tools/protocol-sync.mjs`,
and the app runs without it.

What is listed here is `protocol/extension-api.json` (version 1).
`tests/extension-api.test.mjs` holds both sides to it:

- every extension declares `"api": 1`;
- it uses only what is listed: its static imports, the modules it uses, their
  members, and the members of what `editor.parts()` and `workspace.project()`
  return (under whatever name the code keeps them: another variable, a
  getter, destructured, over several lines); a use the test cannot read (a
  module's API or the module context reached by brackets, all of a module
  imported, or a module imported when it runs) is refused;
- everything listed still exists in the modules;
- this page names all of it.

Adding to the list is not a new version. Removing or changing anything listed
is: the version goes up, and every extension is brought to it and declares it.
An extension written for another version is refused when the browser's copies
are written (`node tools/protocol-sync.mjs` stops and says so), and the server
leaves its file types out (with a warning in its log).

The extensions in the repository are working examples (the
[architecture page](https://rustcoleone.github.io/StiloMarker/docs/architecture/#/guide/extensions) shows how one goes
in, with each example's code):

| Extension | What it shows |
|---|---|
| `url-album` | a file type whose file holds named parts; a preview; a toolbar button; a form |
| `bmap-diagram` | an editor in the preview, edits written back; settings; file menus; completions |
| `mermaid` | a file type, and code blocks of a language drawn in Markdown previews |
| `data-table` | a file type edited in its own editor (in the preview), every edit through the one write path; new files' first content; source highlighting |
| `theme-pack` | data only: themes contributed from its manifest, no code |
| `html-page` | a sandboxed preview; images resolved inside the workspace |
| `module-map` | a dialog and commands on another type's files |

## The folder

```
extensions/<name>/
  extension.json          the manifest
  browser/index.js        the browser module (if the extension has code)
  browser/...             its other files: adapters/, model/, its .css
  browser/vendor/...      libraries it ships (kept across the app's versions)
```

`node tools/protocol-sync.mjs` reads every manifest and writes the browser's
copies: the file types, the list of modules to start (`app/extensions.js`), the
contributed settings and themes, and the files the service worker keeps for
offline use (`extensions/offline.js`; every `.js`, `.css`, `.svg` and `.png` in
the folder). Run it after adding or changing an extension; the structure test
fails while a copy is stale.

## The manifest: `extension.json`

| Field | |
|---|---|
| `name` | the extension's name, the folder's |
| `about` | what it is, for whoever reads the folder |
| `api` | the API version it is written for: `1` |
| `browser` | its browser module, relative to the folder (`browser/index.js`); none for data only |
| `fileTypes` | file types it adds, in the shape of `protocol/file-types.json`'s entries: `{ id, label, kind: "text" \| "image", format, extensions: { ".ext": mime }, icon, filters, expandable?, create?: { label, name, order } }`. Both ends read them: the server's File types, and the browser's copy |
| `contributes.settings` | settings it keeps: `{ key, default, field?: { page, id, order, label, control: "select" \| "checkbox", options? } }`; Shell knows their defaults and shows their fields before any code runs |
| `contributes.themes` | themes: `{ id, label, base: "light" \| "dark", colors: { token: value } }` (the tokens are in `app/modules/shell/model/themes.js`) |

A file type's `id` and `label`, and the extension's `name`, are its own: no
code outside its folder may spell them. A type's id must not be a word the
core uses (the check reads every core file, inline SVG icons included: `csv`
matched `%3Csvg`, so the tables' type is `datatable`).

## The browser module

```js
import { defineModule } from "../../../app/kernel/index.js";

export default defineModule({
  name: "my-extension",
  level: 6,                                  // above every core module
  uses: ["shell", "editor", "workspace"],    // the modules it uses, from the table below
  owns: { names: ["the thing it owns"], data: ["extensions/my-extension/extension.json"] },
  start(ctx) {
    const shell = ctx.use("shell"), editor = ctx.use("editor"), workspace = ctx.use("workspace");
    // register into the extension points; return its own API ({} when none)
    return {};
  }
});
```

- **Imports**: only `app/kernel/index.js` and a module's `index.js`, and of
  those only the names listed below.
- **The context** (`ctx`): `ctx.use(module)` (a module named in `uses`) and
  `ctx.log(message)` (a line in the app's log).
- **Names**: an extension's code calls each module's API by the module's alias
  (`shell`, `types`, `workspace`, `editor`, `explorer`, `identity`, `sync`,
  `assistant`), also in its adapters (pass them as `{ editor, shell }`), and
  gives no other variable those names. The check reads members by these names.
- **Styles**: its own stylesheet, linked when it starts:

  ```js
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = new URL("./my-extension.css", import.meta.url).href;
  document.head.append(style);
  ```

  Use the theme's tokens (`var(--accent)`, `var(--border)`, the
  `--syntax-*` colours), so every theme fits.
- **Rules** it shares with the core (the structure test): files under 800
  lines; no `catch` that swallows an error without a word (`ignore(error, why)`
  from the kernel says why).

## The kernel

| Name | |
|---|---|
| `defineModule(definition)` | a module: `{ name, level, uses, owns, start(ctx) }` |
| `ignore(error, why)` | an error deliberately set aside, with the reason (it goes to the trace) |

## Shell (`shell`)

| Member | |
|---|---|
| `commands` | `commands.add({ id: "owner.action", title, run, keys?: ["Mod+S"], menu?: { id, group?, order? }, enabled?, keywords? })`: a command in the menus, the command line and shortcuts |
| `menus` | `menus.add({ id, label, order })`: a menu of the menu bar |
| `notice` | `notice(message, title?)`: a message the person dismisses |
| `notify` | `notify(message)`: the same, shorter |
| `confirm` | `confirm({ title?, message, acceptLabel?, danger? }) -> Promise<boolean>` |
| `input` | `input({ title, message?, label, value, submitLabel }) -> Promise<string \| null>` |
| `form` | `form({ eyebrow?, title, message?, fields: [{ name, label, value?, type?: "text" \| "url" \| "password", multiline?, placeholder? }], submitLabel? }) -> Promise<{ name: value } \| null>` (a password as typed, the rest trimmed) |
| `toast` | `toast(message, { duration? })`: a short note that goes by itself |
| `copyText` | `copyText(text)`: to the clipboard |
| `render` | `render(project)`: ask for the app to be drawn again |
| `settings` | the settings, read (`settings.<key>`: the extension's own contributed keys, and `serverUrl`); `settings.change({ key: value }, why)` for its own keys; `settings.on(listener(view, changedKeys))` |
| `pages` | pages in the areas' tab hosts (`left`: the left window, its icons in the activity bar; `side`: the right panel; `bottom`) and the Explorer's sections (`explorer`): `pages.add({ host, id, label, title?, icon?, order?, body, toolbar?, shown?(visible) })` (`icon`: an SVG's markup, the page's icon in the activity bar; without one, its label's first letter), `pages.show(host, id)`, `pages.open(id)` (brought on screen wherever the user moved it), `pages.available(host, id, yes)` |
| `settingsDialog` | `settingsDialog.addPage({ id, label, order, body })` (body: a `.settings-tab-panel` placed in `.settings-tab-panels`), `settingsDialog.fields.add(...)`, `settingsDialog.open(page?)` |
| `statusBar` | `statusBar.add({ id, order, title?, action?, dot?, grow?, hidden? }) -> { set({ text, tone, title, hidden }) }` (`dot`: a coloured dot before the text, in the item's tone; `grow`: it takes the spare width; `hidden`: not shown until `set({ hidden: false })`) |

## File types (`types`)

Read what kind each file is (the built-in types and every extension's):

| Member | |
|---|---|
| `typeOf(name)` | the type entry, or null |
| `is(name, id)` | whether a name is of that type (`types.is(file.name, "datatable")`) |
| `isKnown(name)`, `isText(name)`, `isImage(name)` | |
| `formatOf(name)`, `extensionOf(name)`, `baseName(name)`, `mimeOf(name)` | |
| `extensionsOf(id)` | a type's extensions |
| `all()` | every type |

Static: `builtinTypes`, the same answers for code with no module context (a
view loaded later): every type declared in a manifest.

## Workspace (`workspace`)

| Member | |
|---|---|
| `write(path, text, { base?, source? }) -> Promise<{ changed, text }>` | the one way to change a file's text: a patch that merges with other people's edits and is synced. With `base` (the text the change was made on), the change is placed into the file as it is now; where it no longer fits, nothing changes and it throws |
| `fits(path, text, base)` | whether such a write would fit now |
| `isStale(error)` | whether a write failed because the file changed where the edit was |
| `project()` | the project store: `getProject()` (the tree: `{ rootId, nodes }`), `getActiveFile()`, `subscribe(listener)` (any change), `createFile(parentId, name, content)` (a new file here; then `sync.publish({ type: "create-file", parentPath, name, content })` so a shared workspace has it too) |
| `parts` | `parts.add(provider)`: a file type whose file holds named parts, each listed under the file, opened, renamed, moved and copied on its own (below) |
| `events` | `events.on("written", ({ path, source }) => …)`, `events.on("saved", …)` |
| `location` | where the open project lives: `resolveAsset(project, fromNodeId, url)` (an image's address from a file's relative link) |

Static: `getPath(project, nodeId)`, `getNode(project, nodeId)`,
`getNodeIdByPath(project, path)`, `findChildByName(project, parentId, name)`,
`isImageFileName(name)`, `fileBaseName(name)`, `fileTypeExtension(typeId)`,
`downloadBlob(blob, fileName)`.

**A parts provider**: `{ id: typeId, list(text) -> [{ id, name, title?, image? }], body(text, id), withBody(text, id, body), rename(text, id, name), remove(text, id), take(text, id) -> part, insert(text, part, index | null), linkText?(part), add?: { label, run(file) -> Promise<part | null> } }`. Each works on the file's text and returns new text, and throws to refuse.

## Editor (`editor`)

| Member | |
|---|---|
| `previews` | `previews.add({ id, matches(file), render(target, project, file, tools) -> { shouldTypeset, content }, cacheable?, showOnOpen?, printHtml?(project, file, tools), viewState?() })`: how a kind of file is shown in the preview pane (below) |
| `codeBlocks` | `codeBlocks.add({ id, languages: ["mermaid"], render(block, code, tools) })`: code blocks of a language drawn in Markdown previews |
| `highlighters` | `highlighters.add({ id: format, line(rawLine, { escape, blank }) -> html })`: the source's colours, a line at a time (one `<div class="editor-line">` per line; `blank(rawLine)` for an empty one) |
| `toolbars` | `toolbars.add({ id: format, groups: [[{ id, html, title, action }]] })`: formatting-toolbar buttons; an action is `{ kind: "wrap", before, after, placeholder }`, `{ kind: "prefix", prefix }`, `{ kind: "block", snippet, caret }` |
| `completions` | `completions.add({ id: format, find({ text, cursor, force }) -> context \| null, items(context, { project, file, projectFiles(kind) }) -> [{ label, detail, insertText }], label(context) })` |
| `paneViews` | `paneViews.add({ id, element, tab() -> { label, title, iconText, iconClass } \| null, show({ fresh }), close() })`: a tab in the preview pane that is not a file |
| `view` | what the editor shows: `view.get()` (`previewFileId`, `previewPart`, the tabs) |
| `parts()` | the source editor's and preview's functions an extension may call: `getViewState(fileId)`, `openFileFromExplorer(nodeId)`, `updateFileContentFromPreview(fileId, text, reason)` (an edit made in a preview, written back), `setActiveSourceFile(nodeId)`, `setPreviewFile(nodeId)`, `typesetPreview(content, target?)` (formulas typeset), `highlightMarkdownSource(text)`, `handleIndentKeydown(event)` (Tab and Shift+Tab in a source editor of its own) |

**A preview's render**: draw into `target` (emptied before; a preview that
keeps its own element appends it again and keeps its state). `tools` has
`markdownHtml(project, file, text)` (Markdown with the workspace's links and
images), `part` (the one part of a file with parts to show, or null) and
`secondary` (true in a group's second preview). `cacheable`: drawn again only
when the file's text, the tree or the connection changed. `showOnOpen`:
opening such a file shows it in the preview too (an editor that lives there).
While the keyboard is inside a preview, the pane does not draw it again for
the same file; an editor there follows the file itself
(`workspace.project().subscribe`).

Static: `renderMarkdown(text, { resolveUrl?, resolveLink? })`,
`escapeHtmlAttribute(value)`, `getRelativeProjectPath(from, to)`,
`normalizePath(path)`.

## Explorer (`explorer`)

| Member | |
|---|---|
| `fileMenus` | `fileMenus.add({ id: typeId, entries: [[label, action] \| [label, null, [[label, action]]]], run(action, nodeId) })`: a file type's own entries in the tree's context menu |
| `rootMenus` | `rootMenus.add({ id, entries() -> [[label, action]], run(action) })`: entries on the project root's menu |
| `newFiles` | `newFiles.add({ id: typeId, content(name) })`: a new file's first content |

Static: `suggestUniqueFileName(project, parentId, name)`.

## Identity (`identity`)

| Member | |
|---|---|
| `account()` | `{ token, username, teams, admin }` or null |
| `token()` | the signed-in account's token, or null |
| `events` | `events.on("account", ({ account }) => …)`: signed in, out, or dropped |

## Sync (`sync`)

| Member | |
|---|---|
| `publish(operation)` | send a structural change to the shared workspace (`{ type: "create-file", parentPath, name, content }` and the other operations of `protocol/sync.contract.json`); a text change goes through `workspace.write` instead |
| `status` | the session, read only: `status.status` (`"connected"`, `"offline"`…), `status.role` |
| `events` | `events.on("status", ({ next, previous }) => …)` |

## Assistant (`assistant`)

Static: `sendGenerationRequest(serverUrl, payload)`: ask the server's agent
for text (a diagram's Quick Generate).

## Adding an extension

1. Make the folder and its `extension.json` (with `"api": 1`).
2. Write `browser/index.js` with `defineModule`, using only what is listed here.
3. Run `node tools/protocol-sync.mjs`.
4. Add its tests (a Node test for its model, a browser test for its page), and
   run the suites (`tests/README.md`).

Needing something this page does not list is a request to the core: add it to
`protocol/extension-api.json` and here (a new member is not a new version),
with the module's own tests.
