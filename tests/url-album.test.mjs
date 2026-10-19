// The URL album extension: its text format, the parts it offers Workspace,
// and its Entry snippet. (In the page: url-album-browser.py.)
import test from "node:test";
import assert from "node:assert/strict";

import album, { ENTRY_SNIPPET } from "../extensions/url-album/browser/index.js";
import { albumParts, entryBody, nextEntryName, parseAlbum, parseEntryBody, serializeAlbum } from "../extensions/url-album/browser/model/album.js";
import { startModules } from "../app/kernel/index.js";
import fileTypes from "../app/modules/file-types/index.js";
import workspace from "../app/modules/workspace/index.js";
import editor from "../app/modules/editor/index.js";
import { highlightAlbumLine } from "../extensions/url-album/browser/adapters/highlight.js";

const TEXT = "[Castle]\nurl = https://img.example/castle.jpg\ndescription = Old keep\n\n[River]\nurl = https://img.example/river.jpg";

test("an album round-trips, and an entry's body reads back", () => {
  const entries = parseAlbum(TEXT);
  assert.deepEqual(entries.map((e) => [e.id, e.name, e.url, e.description]),
    [["entry-1", "Castle", "https://img.example/castle.jpg", "Old keep"], ["entry-2", "River", "https://img.example/river.jpg", ""]]);
  assert.equal(serializeAlbum(entries), TEXT);
  assert.deepEqual(parseEntryBody(entryBody(entries[0])), { url: "https://img.example/castle.jpg", description: "Old keep" });
  const multiline = serializeAlbum([{ name: "A", url: "u", description: "two\nlines \\ slash" }]);
  assert.equal(parseAlbum(multiline)[0].description, "two\nlines \\ slash");
  assert.equal(nextEntryName(TEXT), "reference image 1");
  assert.equal(parseAlbum(ENTRY_SNIPPET)[0].name, "Entry Name", "the toolbar's Entry snippet is one entry");
});

test("the album's parts list, edit, move and refuse clashes", () => {
  const p = albumParts;
  assert.deepEqual(p.list(TEXT).map((part) => part.name), ["Castle", "River"]);
  assert.equal(p.list(TEXT)[0].title, "Castle\nhttps://img.example/castle.jpg\nOld keep");
  assert.equal(p.body(TEXT, "entry-2"), "url = https://img.example/river.jpg");
  assert.match(p.withBody(TEXT, "entry-2", "url = https://x/y.jpg\ndescription = new"), /\[River\]\nurl = https:\/\/x\/y\.jpg\ndescription = new/);
  assert.match(p.rename(TEXT, "entry-1", "Keep"), /^\[Keep\]/);
  assert.throws(() => p.rename(TEXT, "entry-1", "river"), /already exists/);
  const castle = p.take(TEXT, "entry-1");
  assert.deepEqual(castle, { name: "Castle", url: "https://img.example/castle.jpg", description: "Old keep" });
  const moved = p.insert(p.remove(TEXT, "entry-1"), castle, 1);
  assert.deepEqual(p.list(moved).map((part) => part.name), ["River", "Castle"]);
  assert.throws(() => p.insert(TEXT, castle, null), /already exists/);
  assert.throws(() => p.remove(TEXT, "entry-9"), /no longer exists/);
  assert.equal(p.linkText(castle), "![Castle](https://img.example/castle.jpg)");
});

test("the extension registers into the core's extension points only", async () => {
  const shell = { name: "shell", level: 1, uses: [], owns: {}, start: () => ({ form: async () => null, notify() {}, settings: { on() {} }, settingsDialog: { fields: { add() {} }, onOpen() {} }, statusBar: { add: () => ({ set() {} }) }, commands: { add() {} }, events: { on() {} }, render() {}, holdRendering() {} }) };
  const identity = { name: "identity", level: 2, uses: ["shell"], owns: {}, start: () => ({}) };
  const modules = await startModules([shell, fileTypes, workspace, identity, editor, album]);
  const parts = modules.workspace.parts.of("refs.urldb");
  assert.ok(parts && parts.add.label);
  assert.equal(modules.workspace.parts.of("notes.md"), null);
  assert.ok(modules.editor.previews.all().some((preview) => preview.matches({ name: "a.urldb" })));
  assert.equal(modules.editor.toolbars.get("urldb").groups[0][0].action.snippet, ENTRY_SNIPPET);
  const tools = { escape: (v) => v, blank: () => "<div></div>" };
  assert.match(modules.editor.highlighters.get("urldb").line("[Castle]", tools), /token-urldb-name">Castle/);
  assert.equal(highlightAlbumLine("  ", tools), "<div></div>");
});
