import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";
import {
  TOOLBAR_SPECS,
  buildTableSnippet,
  getEditorToolbarFormat
} from "../app/ui/editor-format-toolbar.js";

const { bmapService, mtreeService, urldbService, markdownService } = await loadModules();

test("toolbar: file extensions map to the correct format", () => {
  assert.equal(getEditorToolbarFormat("notes.md"), "markdown");
  assert.equal(getEditorToolbarFormat("welcome.bmap"), "bmap");
  assert.equal(getEditorToolbarFormat("tree.mtree"), "mtree");
  assert.equal(getEditorToolbarFormat("links.urldb"), "urldb");
  assert.equal(getEditorToolbarFormat("photo.png"), null);
  assert.equal(getEditorToolbarFormat(""), null);
});

test("toolbar: every spec button has a unique id and a valid action kind", () => {
  const validKinds = new Set(["wrap", "prefix", "block", "table", "mtree-child"]);
  const seen = new Set();
  for (const groups of Object.values(TOOLBAR_SPECS)) {
    for (const button of groups.flat()) {
      assert.ok(button.id && !seen.has(button.id), `duplicate or missing id: ${button.id}`);
      seen.add(button.id);
      assert.ok(validKinds.has(button.action.kind), `bad kind: ${button.action.kind}`);
    }
  }
});

test("toolbar: markdown table snippet has valid pipe structure for the requested size", () => {
  const lines = buildTableSnippet({ rows: 3, cols: 2, kind: "markdown" }).trimEnd().split("\n");
  assert.equal(lines.length, 5); // header + separator + 3 body rows
  assert.equal(lines[0], "| Column 1 | Column 2 |");
  assert.equal(lines[1], "| --- | --- |");
  for (const row of lines.slice(2)) {
    assert.equal((row.match(/\|/g) ?? []).length, 3); // 2 columns => 3 pipes
  }
});

test("toolbar: markdown table snippet renders to a table of the requested size", () => {
  const html = markdownService.renderMarkdown(buildTableSnippet({ rows: 3, cols: 2, kind: "markdown" }));
  assert.match(html, /<table>/);
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 2);
  assert.equal((html.match(/<td[ >]/g) ?? []).length, 6); // 3 rows x 2 cols
});

test("toolbar: html table snippet renders through the markdown preview", () => {
  const snippet = buildTableSnippet({ rows: 2, cols: 3, kind: "html" });
  assert.match(snippet, /^<table>/);
  assert.equal((snippet.match(/<th>/g) ?? []).length, 3);
  assert.equal((snippet.match(/<td>/g) ?? []).length, 6);
  assert.equal((snippet.match(/<tr>/g) ?? []).length, 3); // 1 header + 2 body
  // The markdown service passes block-level HTML tables through to the preview.
  assert.match(markdownService.renderMarkdown(snippet), /<table>/);
});

test("toolbar: bmap block snippets parse without errors", () => {
  for (const button of TOOLBAR_SPECS.bmap.flat()) {
    const parsed = bmapService.parseBmap(button.action.snippet);
    assert.equal(parsed.parseErrors.length, 0, `bmap snippet ${button.id} had parse errors`);
  }
});

test("toolbar: mtree block snippets parse without throwing (in context)", () => {
  for (const button of TOOLBAR_SPECS.mtree.flat()) {
    // The child action inserts a one-tab-deeper line beneath the current node;
    // model that here. Other actions carry their snippet directly.
    const inserted = button.action.kind === "mtree-child"
      ? `\t${button.action.text}\n`
      : button.action.snippet;
    // Parse under a root line — mirroring how snippets are inserted in context.
    assert.doesNotThrow(() => mtreeService.parseModuleTree(`Root\n${inserted}`), button.id);
  }
});

test("toolbar: urldb entry snippet parses into one named entry", () => {
  const button = TOOLBAR_SPECS.urldb.flat()[0];
  const entries = urldbService.parseUrlDb(button.action.snippet);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, "Entry Name");
});
