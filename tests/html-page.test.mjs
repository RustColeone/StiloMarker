// The HTML page extension's parts that need no page: the source highlighting,
// which addresses are the page's own (relative: the preview embeds those),
// the snippets and a new page's first content.
import test from "node:test";
import assert from "node:assert/strict";

import { SNIPPETS, STARTER, highlightHtmlLine, isRelative } from "../extensions/html-page/browser/model/html.js";
import { SANDBOX } from "../extensions/html-page/browser/adapters/frame.js";

const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const blank = () => '<div class="editor-line"><br></div>';

test("the source highlighting: tags, attributes, values, comments, the doctype, entities", () => {
  const line = (text) => highlightHtmlLine(text, { escape, blank });
  assert.equal(line('<a href="x.html">Go &amp; see</a>'),
    '<div class="editor-line"><span class="token-html-tag">&lt;a</span> <span class="token-html-attribute">href</span>=<span class="token-html-string">"x.html"</span><span class="token-html-tag">&gt;</span>Go <span class="token-html-entity">&amp;amp;</span> see<span class="token-html-tag">&lt;/a</span><span class="token-html-tag">&gt;</span></div>');
  assert.equal(line("<!-- note -->"), '<div class="editor-line"><span class="token-html-comment">&lt;!-- note --&gt;</span></div>');
  assert.equal(line("<!doctype html>"), '<div class="editor-line"><span class="token-html-doctype">&lt;!doctype html&gt;</span></div>');
  assert.equal(line("plain text"), '<div class="editor-line">plain text</div>');
  assert.equal(line("  "), blank());
});

test("a page's own addresses are the relative ones; a web address, data, an anchor or a root path is not", () => {
  for (const url of ["image.png", "pics/a.png", "../b.jpg", "./c.svg"]) assert.equal(isRelative(url), true, url);
  for (const url of ["https://x.org/a.png", "//cdn.x/a.png", "data:image/png;base64,AA", "#top", "/abs.png", "mailto:a@b", "", null]) {
    assert.equal(isRelative(url), false, String(url));
  }
});

test("scripts run in the frame, but never with the app's origin", () => {
  assert.equal(SANDBOX, "allow-scripts");
  assert.ok(!/allow-same-origin|allow-top-navigation|allow-popups/.test(SANDBOX));
  assert.match(STARTER, /^<!doctype html>/);
  assert.ok(SNIPPETS.every((s) => s.id.startsWith("html-") && s.snippet.endsWith("\n")));
});
