# Stilo Marker — User Manual

Stilo Marker is a browser-based Markdown workspace. It lets you write notes, build module-map diagrams, manage image URL albums, draw brainstorm diagrams, and organize everything in a file explorer—all in a single-page app with no build step.

---

## Table of Contents

1. [Application Layout](#1-application-layout)
2. [Project Model](#2-project-model)
3. [Markdown Files (.md)](#3-markdown-files-md)
4. [Module-Map Files (.mtree)](#4-module-map-files-mtree)
5. [URL Album Files (.urldb)](#5-url-album-files-urldb)
6. [Brainstorm Diagram Files (.bmap)](#6-brainstorm-diagram-files-bmap)
7. [Image Files](#7-image-files)
8. [Explorer](#8-explorer)
9. [Source Pane](#9-source-pane)
10. [Preview Pane](#10-preview-pane)
11. [Saving and Exporting](#11-saving-and-exporting)
12. [Collaboration Backend](#12-collaboration-backend)
13. [Chat Panel](#13-chat-panel)
14. [Settings](#14-settings)
15. [Templates](#15-templates)

---

## 1. Application Layout

```
┌─────────────────────────────────────────────────────────┐
│  Menu bar: File | Create | View | Settings | ...        │
├──────────┬──────────────────────┬────────────┬──────────┤
│ Explorer │   Source pane        │  Preview   │  Chat    │
│          │   (editor)           │  pane      │  panel   │
│          │                      │            │          │
├──────────┴──────────────────────┴────────────┴──────────┤
│  Status bar                                             │
└─────────────────────────────────────────────────────────┘
```

- **Explorer** — tree of folders and files in the current project.
- **Source pane** — text editor for the active file; also shows image previews.
- **Preview pane** — rendered output (HTML for Markdown, SVG tree for MTREE, album grid for URLDB, interactive canvas for BMAP).
- **Chat panel** — AI assistant sidebar wired to the backend chat proxy.
- **Status bar** — shows active file, source/preview mode, and sync status.

Panels can be toggled from the `View` menu.

---

## 2. Project Model

A **project** is an in-memory tree of nodes. Each node is either a **folder** or a **file**.

```
project
  id            string   — unique project identifier
  name          string   — display name shown in the title bar
  sourceMode    string   — "memory" | "opfs" | "directory"
  rootId        string   — ID of the root folder node
  activeFileId  string?  — ID of the currently open file
  nodes         object   — map of nodeId → Node
```

A **node**:

```
node
  id            string   — unique within the project
  kind          "folder" | "file"
  name          string   — filename or folder name (e.g. "notes.md")
  parentId      string?  — null for the root folder
  children      string[] — (folders only) ordered list of child node IDs
  expanded      boolean  — (folders only) whether the folder is open in the explorer
  content       string   — (files only) full text content of the file
  dirty         boolean  — (files only) true if unsaved changes exist
  sourceVersion number   — (files only) monotonically increasing edit counter
```

The file type is determined purely by the file extension (`.md`, `.mtree`, `.urldb`, `.bmap`, or an image extension).

**Source modes:**

| Mode | Description |
|------|-------------|
| `memory` | Entire project lives in browser `localStorage`. |
| `opfs` | Uses the browser Origin Private File System (Chromium). |
| `directory` | Backed by a real directory on disk via the File System Access API (Chromium only). |

---

## 3. Markdown Files (.md)

Standard CommonMark-ish Markdown with a few extensions.

**Supported syntax:**
- Headings `# H1` through `###### H6`
- Bold `**text**`, italic `*text*`, strikethrough `~~text~~`, inline code `` `code` ``
- Fenced code blocks with optional language tag ` ```lang `
- Unordered lists `- item`, ordered lists `1. item`, task lists `- [ ] item`
- Blockquotes `> text`
- Tables `| col | col |`
- Horizontal rules `---`
- Links `[label](url)` and reference-style links
- Images `![alt](url)` and reference-style images
- HTML pass-through (inline tags and comments are preserved)
- Footnotes `[^label]` / `[^label]: text`

**Preview:** The preview pane renders Markdown to HTML with syntax-highlighted code blocks.

**Editing tips:**
- `Enter` on a list item continues the list; `Enter` on an empty item exits.
- `Tab` / `Shift+Tab` indents/unindents list items.
- `Ctrl+S` / `Cmd+S` saves.

---

## 4. Module-Map Files (.mtree)

`.mtree` files describe directed graphs of named modules using an indented outline syntax. They are used to visualize hierarchies, dependency maps, or relationship trees.

### Basic syntax

```
ParentModule
    ChildA
    ChildB; optional inline description
        GrandchildA
```

- **Indentation** defines the parent–child relationship. Use one tab **or** 4 spaces per level. Do not mix tabs and spaces.
- A **semicolon** `;` separates the module name from its description: `Name; Description text`.
- Lines starting with `#` are comments.
- Blank lines reset the current definition block context.

### Pipe continuation `|`

Additional description lines can follow a module using `|`:

```
MyModule; first line of description
| second line
| third line
```

### Definition blocks `[Name]`

A definition block lets you write a multi-line description for a module anywhere in the file:

```
[MyModule]
This is a longer description.
It can span multiple lines.
| Pipe prefix is optional inside definition blocks.
```

### Arrow chains `->`

Use `->` to declare a chain of relationships on a single line:

```
A -> B -> C; description for C
```

This is equivalent to:

```
A
    B
        C; description for C
```

### Continuation token `...`

`...` signals that children declared below should be treated as roots in a separate continuation tree rather than children of the previous module. This is used to split large trees across sections.

```
ParentA
    Child1
    Child2

...

ParentB
    Child3
```

With `...->TargetModule`, the subtree starting at `TargetModule` is injected as a continuation:

```
... -> TargetModule
    ExtraChild
```

### Render flags

The preview renderer accepts two boolean render flags (displayed in the preview pane header):

| Flag | Name | Effect |
|------|------|--------|
| `T` / `F` | Simplify | Collapse single-child chains into one connector |
| `T` / `F` | Split continuations | Render each continuation tree as a separate diagram |

Default flags: `TT`.

### Preview rendering

The MTREE preview renders the graph as an SVG tree diagram. Nodes show their name and (if present) description. Arrows indicate parent→child direction. If a node has multiple parents, it appears in all relevant subtrees.

---

## 5. URL Album Files (.urldb)

`.urldb` files store ordered collections of image URL bookmarks. They are used as lightweight image reference albums.

### File format

```ini
# Comments start with #

[Entry Name]
url = https://example.com/image.jpg
description = Optional human-readable description

[Another Entry]
url = https://example.com/other.png
```

- Each entry starts with a `[Name]` header.
- `url` is required. `description` is optional.
- Entries are ordered as they appear in the file.
- Backslash escapes: `\\` for a literal backslash, `\n` for a newline inside a value.

### Explorer behavior

URL album entries appear as children of the `.urldb` file node in the explorer. Each entry has its own icon. Entries can be:

- Clicked to open an image preview.
- Dragged to reorder within the same album.
- Dragged to a different `.urldb` file to move or copy them.
- Added via the explorer context menu ("Add Album Entry").
- Copied and pasted between albums.

### Preview

The URLDB preview renders all entries as a clickable image grid. Clicking an entry opens a larger preview.

---

## 6. Brainstorm Diagram Files (.bmap)

`.bmap` files store interactive node-and-connector brainstorm diagrams. The format is a CSS-inspired block syntax.

### File format

```
.node {
  id: node1
  name: My Node
  text: Optional body text
  shape: rect
  pos: {x: 120, y: 80}
  file: path/to/linked.md
  styles: {
    background: #fffbe6
    border: 1px solid #e8b339
    border-radius: 8px
    width: 220
    height: 90
  }
}

.connect {
  from: node1.right.0
  to: node2.left.0
  styles: {
    mode: bezier
    arrow: end
    dashed: false
    thickness: 2
    color: #1677ff
  }
}
```

### Node properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique node identifier within the diagram |
| `name` | string | Label shown on the node |
| `text` | string | Optional sub-label or body text (supports `\n`) |
| `shape` | `rect` \| `circle` | Visual shape |
| `pos` | `{x, y}` | Canvas position in pixels |
| `file` | path string | Optional link to another file in the project |
| `styles` | object | Visual overrides (see below) |

**Default styles for `rect`:** yellow background, gold border, 8px radius, 220×90 px.  
**Default styles for `circle`:** green background, green border, 160×160 px.

### Connector properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `from` | `nodeId.side.N` | — | Source snap point |
| `to` | `nodeId.side.N` | — | Target snap point |
| `mode` | `bezier` \| `straight` | `bezier` | Line shape |
| `arrow` | `end` \| `start` \| `both` \| `none` | `end` | Arrow direction |
| `dashed` | `true` \| `false` | `false` | Dashed line |
| `thickness` | integer | `2` | Stroke width in pixels |
| `color` | hex color | `#1677ff` | Stroke color |

**Snap point syntax:** `nodeId.side.N`  
Side indices: `0` = top, `1` = right, `2` = bottom, `3` = left.  
`N` is the snap slot index along that side (for multiple connectors).

### Interactive canvas

In the preview pane the diagram is rendered as an interactive SVG/HTML canvas:
- Drag nodes to reposition them.
- Click a node with a linked `file` to open a popup showing that file's content.
- The canvas auto-saves changes back to the `.bmap` source.

---

## 7. Image Files

Stilo Marker recognizes: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`.

- Image files are read-only in the source pane (shown as a preview).
- The preview pane renders the image full-size.
- In `memory` and `opfs` modes, image content is stored as a base-64 data URL.
- In `directory` mode, images are read from disk and referenced by filename.

---

## 8. Explorer

The explorer shows the project tree as a collapsible file/folder list.

**Actions:**
- **Click** a file to open it in the source pane.
- **Click** a folder arrow to expand/collapse.
- **Double-click** a node label to rename it inline.
- **Right-click** a node for the context menu: Rename, Delete, Export, Copy, Paste, New File, New Folder, Add Album Entry (for `.urldb` files).
- **Drag a file or folder** to reorder it or move it into a folder.
- **Drag a URL album entry** to reorder within its album or move to another album.
- **Drag a file from the Explorer into the Chat compose area** to attach it as context for the AI assistant.

**Tabs and groups:** the editor has two groups side by side, at first Source
on the left and Preview on the right, each with a row of tabs. A tab is a file
shown one way, as Source or as Preview. Right-click a tab for Close, Close
Others, Close to the Right, Close All, Open as Source or Preview (the same
file shown the other way, in the same group), and Copy Path. When a group
holds tabs of both kinds, each tab says which it is. There is one source
editor and one preview: if the other group was showing the one you just
opened, it keeps its tab and says where it went; press **Show here** to take
it back.

**On a phone:** one file shows at a time. The top bar names it; tap the name
for the list of open files (and Rename). The switch next to it shows the same
file in its other view (Source ↔ Preview); it is hidden when the file has only
one. The explorer is a drawer (≡); a file picked there shows in the view on
screen. The chat button opens the Agent and Chats as a drawer from the right,
with the note still showing at its left (it takes the whole width while you
type). Tap the note, drag the drawer to the right, or use its › button to
close it. A swipe that starts a finger's width inside the left or right edge
opens those drawers too (the edge itself is your phone's "back"). The Log
(View → Toggle Log) opens as a sheet over the lower half of the screen; drag
its header up for the full height and down again to shrink or close it, or
tap above it, or use its ×. Opening it on the phone does not change whether
the desktop shows it.

**Copy/paste rules:**
- Files and folders can be copied/pasted into any folder or the root.
- URL album entries can only be pasted into a `.urldb` file.

---

## 9. Source Pane

A plain-text editor for `.md`, `.mtree`, `.urldb`, and `.bmap` files. Image files show a read-only preview.

**Keyboard shortcuts:**
- `Ctrl+S` / `Cmd+S` — Save
- `Tab` / `Shift+Tab` — Indent/unindent (indents selection or inserts a tab)
- `Enter` on a Markdown list item — continue the list
- `Enter` on an empty list item — exit the list
- `Shift+Enter` in the chat input — newline without sending

The source pane header shows the filename, dirty indicator (`•`), and buttons to toggle preview.

---

## 10. Preview Pane

Renders the active file's content in read-only mode.

| File type | Rendered as |
|-----------|-------------|
| `.md` | HTML (Markdown rendered to DOM) |
| `.mtree` | SVG tree diagram |
| `.urldb` | Image grid with clickable entries |
| `.bmap` | Interactive SVG/HTML node-canvas |
| Image | Full-size image |

The preview can be shown or hidden with `View > Toggle Preview` or the `×` button on the preview pane.

---

## 11. Saving and Exporting

### Save

`File > Save` (`Ctrl+S`) — saves to the active storage mode:
- `memory`: persists to `localStorage`.
- `opfs` / `directory`: writes files back to disk.

### Export

`File > Export` — downloads the entire project as a `.zip` archive containing all files in their original formats.

`File > Export Selected` — exports only the files currently selected in the explorer.

`File > Save as PDF` — prints the current Markdown preview to PDF via the browser print dialog.

---

## 12. Collaboration Backend

The Python backend (`server/mdnotes_server.py`) enables real-time multi-user sessions.

### Architecture

```
Browser A ──POST /api/operations──▶ Python server
                                        │
Browser B ──GET /api/events/stream──▶   │ (SSE)
                                        │
                              CollaborationBroker
                              (in-memory + session-state.json)
```

### Session flow

1. Both clients call `POST /api/session/connect` with the shared PIN.
2. Each receives a session token and a client ID.
3. Clients open an SSE stream at `GET /api/events/stream?token=…` to receive live events.
4. File edits are sent as `POST /api/operations` with a typed operation object.
5. The server applies the operation, increments the revision, and broadcasts the event to all other subscribers.

### Operation types

| Type | Description |
|------|-------------|
| `create-folder` | Add a new folder |
| `create-file` | Add a new file with optional initial content |
| `rename-node` | Rename a file or folder |
| `delete-node` | Delete a file or folder (recursive for folders) |
| `update-file` | Replace a file's full content |
| `patch-file` | Apply a text patch (start, end, text) with OT rebase |
| `replace-project` | Replace the entire project tree (master only) |

### Operational Transformation (OT)

`patch-file` operations include a `baseRevision`. If the server has advanced since that revision, it transforms the patch offsets through all intervening operations before applying, so concurrent edits converge correctly.

### PIN roles

| PIN | Role | Permissions |
|-----|------|-------------|
| Session PIN (default `2468`) | `client` | All operations except `replace-project` |
| Master PIN (default `1367`) | `master` | All operations including `replace-project` |

### Chat workspace sync

When a collaboration session is active, the chat thread list is shared across all participants. Any change a participant makes to their chat history is pushed to the server and broadcast to all other connected clients via the `chat-workspace-update` SSE event type.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MDNOTES_HOST` | `0.0.0.0` | Bind address |
| `MDNOTES_PORT` | `8000` | Port |
| `MDNOTES_PIN` | `2468` | Session PIN |
| `MDNOTES_MASTER_PIN` | `1367` | Master PIN |
| `DEEPSEEK_API_KEY` | — | Enable chat proxy |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | Model name |
| `DEEPSEEK_API_URL` | DeepSeek endpoint | Override API URL |
| `MDNOTES_CHAT_API_KEY` | — | Alternative chat API key |
| `MDNOTES_CHAT_MODEL` | — | Alternative model |
| `MDNOTES_CHAT_API_URL` | — | Alternative API URL |
| `MDNOTES_CHAT_ALLOW_REMOTE` | `0` | Allow non-local chat clients |
| `MDNOTES_CHAT_MAX_CONTEXT_CHARS` | `60000` | Context size limit |
| `MDNOTES_CHAT_MAX_MESSAGES` | `24` | Message history limit |
| `MDNOTES_CHAT_TIMEOUT` | `60` | Request timeout (seconds) |
| `DEEPSEEK_ENABLE_THINKING` | `0` | Enable DeepSeek thinking mode |
| `DEEPSEEK_REASONING_EFFORT` | `high` | Reasoning effort level |

---

## 13. Chat Panel

The chat panel provides an AI assistant scoped to the current workspace.

### Opening the panel

`View > Toggle Chat` or the `AI` button in the activity bar.

### Conversations

- Press `+` in the panel toolbar to start a new thread.
- Press `☰` to toggle the history pane showing past threads. The search box at its top filters them by title and text.
- Click a thread in the history pane to switch to it. Hovering a thread shows **Rename** and **Delete**.
- Threads are sorted by most-recently-updated first.
- A new thread shows a few example requests; clicking one puts it in the compose box.

### Attaching context

The agent can answer questions about specific files if you attach them:

- **`@ File` button** (bottom left of the compose box) — attaches the currently open file.
- **Drag a file from the Explorer** onto the compose area to attach it.

Attached files appear as chips above the compose area. Click `×` on a chip to remove a file.

### Sending messages

- Type in the compose area and press `Enter` to send.
- `Shift+Enter` inserts a newline without sending.

### How context is sent

When you send a message, Stilo Marker reads the full content of each attached file from the current project state and sends it to the server along with the conversation history. The server injects this content into the system prompt before forwarding to the LLM. **File content is only ever sent to your own backend server**, not directly to any third-party API from the browser.

### Collaboration sync

When a collaboration session is active, the entire chat workspace (all threads and their messages) is automatically synced across all connected participants via the backend. Changes made by any participant appear in real time on all other clients.

### Storage

Chat threads are stored in browser `localStorage` under the key `mdnotes.chat.v1`. When a collaboration session is active, they are also persisted in the server's in-memory state for the duration of the session.

### Models and signing in

On a server with accounts, the agent, characters in Chats and Quick Generate need you to be signed in (Settings → Collaboration → Account), because they spend the server's API credit. With **My own API key** (Settings → Agent) no sign-in is needed. The model picker sits in the compose box, next to **Send**. When the server has more than one provider it groups the models by provider (DeepSeek, OpenAI); DeepSeek is the default. The dot and word beside it show whether the agent is ready (green), needs attention such as signing in (amber) or is unavailable (red); hover for details, click to check again or fix it.

### Generating images

When the server has an OpenAI key with an image model, the agent can make pictures — concept art, character portraits, maps, scene sketches — and save them to the workspace as image files (`.png`, `.jpg` or `.webp`). Ask for one in the chat ("draw Mara at the lamp, ink wash style"). The picture appears in the edit card for review; **Keep** saves it, **Drop** discards it. At most two images are made per request, at medium quality.

When the user asks you (the agent) for an image:

1. Read the relevant files first, so the picture matches the writing (appearance, setting, period, mood).
2. Call `generate_image` with a detailed visual prompt: subject, setting, composition, lighting, mood and art style. Pick `portrait` for a person, `landscape` for a scene or map, `square` otherwise.
3. Name the file after its subject (e.g. `mara-portrait.png`) and save it next to the notes it belongs with, or in an existing images folder.
4. If the image illustrates a note or a character, also update that note with a relative image link, e.g. `![Mara at the lamp](../art/mara-portrait.png)`, or set `avatar:` in the character's `.persona.skill` header.
5. Make only the number of images the user asked for: each one costs money.

### Chats tab (people and characters)

The panel has two tabs: **Agent** (this assistant) and **Chats**, a small chat app for the project: private chats and group chats with the other people who can open this workspace and with the characters written in it (`.persona.skill` files). It is for any kind of writing done together: talking to a story's characters, rehearsing a script, running a game scene with several players.

- **The list** shows your chats (newest first, with unread counts), then **People** (a dot shows who is online) and **Characters**. Clicking a person or a character opens your private chat with them; if you have one already, that one is reopened. **New group** picks several people and characters. The Chats tab shows the total of unread messages.
- **In a private chat with a character**, the character answers every message.
- **In a group**, `@handle` asks a character to reply and `@all` asks every character in turn. A message without a mention is narration (or talk between the people) and gets no reply. Typing `@` suggests names.
- Everyone in the chat sees new messages, and a character's reply as it is written, live. **Stop** under a reply being written stops it and the replies queued after it.
- **Details** (the `ⓘ` in a chat's header): for a private chat, your own alias and note for that person or character — only you ever see them — and a search of the chat that jumps to the message. **Invite…** in a private chat starts a *new* group with everyone, so the private chat is kept; in a group it adds the people to that group. Groups can also be renamed and left.
- Characters can read every file in the workspace and any attached files, but cannot change anything. A character's file is read again before each reply, so editing it changes how the character speaks from then on. Renaming or moving the file keeps the character in its chats.

Where chats are kept: in a cloud workspace, on the server, in one database per project (`conversations.sqlite` in the project folder, hidden in the explorer, kept when the project is published over, and backed up daily). In a workspace kept in the browser, the Chats tab has characters only, stored in this browser; chatting with people needs a cloud workspace. Older Roleplay group chats are moved into Chats the first time the tab opens.

Who writes characters' replies: normally the server, using its models and the model picked in the compose box (sign-in needed). With **My own API key** and **Characters' replies in Chats → Directly from this browser** (Settings → Agent), your browser calls your API URL itself — this can be a model on your own computer, e.g. Ollama at `http://localhost:11434/v1/chat/completions` (allow this site in `OLLAMA_ORIGINS`; the key can be empty). The server prepares the prompt and passes the reply on to everyone in the chat. If your browser closes while writing, the reply is marked interrupted after a minute.

### Character files (.persona.skill)

A character is a Markdown file whose name ends in `.persona.skill`, e.g. `Characters/aria.persona.skill`. The file name gives the mention handle: `aria.persona.skill` → `@aria` (lower case, spaces become `-`). The optional header between `---` lines sets display details; everything after it is the character sheet, sent to the model as written.

```
---
name: Captain Aria Voss
avatar: portraits/aria.png
color: #b5523b
temperature: 0.9
---
## Who they are
A smuggler captain who owes money to everyone on the coast.

## How they speak
Short, dry sentences. Never apologises. Calls everyone "friend" when she is angry.

## Example lines
> "Friend, the cargo is legal until somebody opens it."

## What they know / don't know
Knows every harbour from here to the capital. Does not know her first mate is an informer.

## Author's notes
- Her first mate sells the routes to the Harrow Company; she finds out in chapter 12.
- Foreshadowing: she always counts the lifeboats when she boards.
```

- `name` — shown in the chat; defaults to the file name.
- `avatar` — an image path relative to this file, or an `https://` URL. Without one, the initials are shown on the character's colour.
- `color` — `#rgb` or `#rrggbb`; otherwise derived from the name.
- `temperature` — 0 to 1.5 (default 0.8). Higher is more surprising.
- `notes` — `hints` lets the character take light hints from its author's notes (see below); otherwise it never sees them.

**Author's notes.** A `## Author's notes` section (it runs to the next `##` heading) holds what the author plans but has not written yet: twists, secrets, foreshadowing. The character never sees it: it is left out of the character's prompt, out of what other characters are told about it, and out of the file when any character reads it. With `notes: hints` in the header, the character is shown the notes as foreshadowing it may let colour a small detail, never as something it knows. The preview shows the notes in a marked panel.

**Files characters cannot read.** Anything in a folder named `Plans` (at any depth) and any file ending in `.plan.md` is invisible to characters: they cannot list or read it. The agent still reads them. Put outlines and plot plans there so a character cannot spoil them. A file attached to a chat message by hand is still sent: attaching it is the author's choice.

When a user asks you (the agent) to make a character file from their writing:

1. Read the relevant files first, then create the file with `create_file`, named `<name>.persona.skill`. Use the folder the user names, or an existing characters folder, or a new `Characters` folder.
2. Ground every detail in the text: their history, wants, fears, relationships, and how they talk (vocabulary, rhythm, habits, things they would never say).
3. Include 2–4 example lines quoted or closely adapted from the writing. Example lines shape the voice more than descriptions do.
4. Write "What they know / don't know" so the character does not reveal secrets they could not know.
5. Make it as long as the writing supports, and no longer: a minor character may need 200 words, a lead 1,500. Never invent details to fill space. Leave `avatar` empty unless an image of the character exists in the workspace.
6. Add an empty `## Author's notes` section at the end for the author's plans.

When a user asks you to update a character file after new writing:

1. Read the character file and the new writing first.
2. Change only what the new writing changes, with `edit_file`: each edit names an exact passage (copied from the file) and what it becomes. Keep the author's wording everywhere else, including the example lines.
3. Never change `## Author's notes`, except to remove a plan once the writing has made it happen; then add the event to the sheet in the past tense, with the chapter it happened in.
4. Write new facts with where they come from, e.g. "(chapter 4)", so a later update can tell writing from inference.
5. When the writing contradicts the sheet, do not choose: leave that point unchanged and ask the author which is true.
6. Keep "What they know / don't know" in step: a character learns something only when the writing shows it.

---

## 14. Settings

`Settings` menu or the settings panel:

- **Server URL** — URL of the collaboration backend, e.g. `http://localhost:8000`.
- **PIN** — Session PIN for the collaboration backend.
- **Display Name** — Your name shown to other participants in the session.
- **Ping Server** — Test connectivity without joining.
- **Connect / Disconnect** — Join or leave the collaboration session.
- **Toggle Log Panel** — Show or hide the debug log panel.
- **Theme** — Switch between light and dark themes.

---

## 15. Templates

On first load, Stilo Marker offers to open the built-in template project, which demonstrates all file types:

| File | Type | Content |
|------|------|---------|
| `welcome.md` | Markdown | Getting-started guide |
| `welcome.bmap` | Brainstorm diagram | Introductory node canvas |
| `MeitanteiCure.mtree` | Module map | Sample relationship tree |
| `Images/LULUKA.urldb` | URL album | Sample image bookmark collection |

The template is defined in `Template/template-manifest.json`.

---

## File Extension Summary

| Extension | Type | Editable | Preview |
|-----------|------|----------|---------|
| `.md` | Markdown | Yes | HTML |
| `.mtree` | Module map | Yes | SVG tree |
| `.urldb` | URL album | Yes | Image grid |
| `.bmap` | Brainstorm diagram | Yes | Interactive canvas |
| `.persona.skill` | Chats character (Markdown) | Yes | Character card + Markdown |
| `.png` `.jpg` `.jpeg` `.gif` `.svg` `.webp` `.bmp` | Image | No | Image viewer |
