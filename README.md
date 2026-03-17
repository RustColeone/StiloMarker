# STLIO MARKER

STLIO MARKER is a browser-based Markdown workspace for writing notes, organizing files, previewing content, and managing image URL albums in one page.

It supports:

- Markdown, MTREE, URL album, and image files
- Explorer-based file and folder organization
- Drag and drop for opening, reordering, and moving items
- Source and preview panes
- Local browser storage and directory-backed workspaces in Chromium browsers
- Optional collaboration through the included Python backend
- A built-in log panel for debugging interactions

## Requirements

- Node.js 18+
- Python 3.10+ if you want to run the collaboration backend
- A Chromium-based browser if you want to use `Open Directory`

## Start The App

Install dependencies if needed, then run the static frontend server:

```bash
npm start
```

This serves the app at:

```text
http://localhost:4173
```

## Run The Collaboration Backend

To enable shared sessions, start the backend in a second terminal:

```bash
npm run backend:start
```

Default backend values:

- Host: `0.0.0.0`
- Port: `8000`
- PIN: `2468`

You can also override them with environment variables:

- `MDNOTES_HOST`
- `MDNOTES_PORT`
- `MDNOTES_PIN`

## Available Scripts

```bash
npm start
npm run selftest
npm run backend:start
npm run backend:selftest
```

## How To Use STLIO MARKER

## 1. Create Or Open A Workspace

Use the top menu bar:

- `File > New Project` to start a fresh in-memory workspace
- `File > Open Directory` to work against a real folder on disk
- `File > Import File or Zip` to load existing content

If you use `Open Directory`, changes can be saved back to the selected folder. In non-Chromium browsers, STLIO MARKER falls back to in-browser storage and export.

## 2. Create Content

Use the `Create` menu or the explorer context menu to add:

- New Folder
- New Markdown
- New MTREE
- New URL Album
- Imported local files

Supported file types:

- `.md`
- `.mtree`
- `.urldb`
- `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.bmp`

## 3. Work In The Explorer

The explorer is the main organizer for your workspace.

- Click a file to open it in the source pane
- Click folder arrows to expand or collapse folders
- Right-click items for actions like rename, delete, export, copy, and paste
- Drag files to reorder them or move them into folders
- Drag URL album entries only into other URL albums

Explorer copy/paste rules:

- Files and folders can be copied and pasted into folders or the root
- URL album entries can only be copied and pasted into `.urldb` files

## 4. Write In The Source Pane

The left editor pane is where you write and edit text-based files.

- Markdown files are editable directly
- MTREE files are editable directly
- URL album files are editable directly
- Image files are preview-only in the source pane

Use `Ctrl+S` or `Cmd+S` to save.

## 5. Use The Preview Pane

The preview pane renders supported content:

- Markdown preview
- Image preview
- URL album preview
- Individual URL album entry preview

You can show or hide the preview pane from:

- `View > Toggle Preview`
- The preview close button `×`
- The preview toggle button in the source pane header

## 6. Work With URL Albums

URL albums are `.urldb` files that store image references.

Each entry contains:

- A name
- A URL
- An optional description

What you can do with URL albums:

- Add bookmark entries from the explorer context menu
- Click an entry to preview it
- Drag entries between URL albums
- Reorder entries inside a URL album
- Copy and paste entries between URL albums

Remote image entries are labeled as `IMAGE URL` in the explorer.

## 7. Save And Export

Use the `File` menu to:

- `Save`
- `Save as PDF`
- `Export`
- `Export Selected`

Behavior depends on workspace mode:

- Directory-backed workspace: saves back to disk
- In-memory workspace: keeps data in browser storage and lets you export files manually

## 8. Collaboration

Open `Settings` and fill in:

- Server URL, for example `http://localhost:8000`
- PIN, default `2468`
- Display name

Then:

- Use `Ping Server` to verify connectivity
- Use `Connect` to join the session

The collaboration sidebar shows session status and presence.

## 9. View And Debug

STLIO MARKER includes a built-in log panel.

Use:

- `View > Toggle Log`
- `Settings > Toggle Log Panel`
- The log panel close button `×`

The log panel is useful for checking drag/drop actions, file operations, and interaction flow while testing the app.

## Typical Workflow

1. Start the frontend with `npm start`.
2. Open `http://localhost:4173`.
3. Create a project or open a directory.
4. Add folders and Markdown files from the explorer.
5. Write in the source pane and check the preview pane.
6. Save, export, or connect to the backend for collaboration.

## Notes

- `Open Directory` works best in Chromium-based browsers.
- URL album entries are special explorer items and are treated differently from normal files.
- The app keeps a log panel available for troubleshooting interaction issues.
