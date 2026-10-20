// Markdown in the preview (the Editor's renderer: lists, rules, indented
// fences, strikethrough, footnotes) and in the source editor's highlighting,
// which must draw every line exactly as typed.
import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../app/modules/editor/model/markdown.js";
import { createHighlighter } from "../app/modules/editor/adapters/highlight.js";

const render = (text) => renderMarkdown(text).replace(/\n/g, "");

test("lists: bulleted with -, * or +, numbered from their first number, nested by indent", () => {
  assert.equal(render("- a\n* b\n+ c"), "<ul><li>a</li><li>b</li><li>c</li></ul>");
  assert.equal(render("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(render("3) three\n4) four"), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(render("- a\n  - b\n    - c\n- d"), "<ul><li>a<ul><li>b<ul><li>c</li></ul></li></ul></li><li>d</li></ul>");
  assert.equal(render("1. step\n   - detail\n2. next"), "<ol><li>step<ul><li>detail</li></ul></li><li>next</li></ol>");
  assert.equal(render("- a\n1. b"), "<ul><li>a</li></ul><ol><li>b</li></ol>", "another kind starts another list");
  assert.equal(render("\t- tabbed\n- top"), "<ul><li>tabbed</li></ul><ul><li>top</li></ul>");
});

test("lists: a blank line between items keeps the list, an indented line continues an item, a paragraph ends it", () => {
  assert.equal(render("- a\n\n- b\nafter"), "<ul><li>a</li><li>b</li></ul><p>after</p>");
  assert.equal(render("- a long\n  item\n- b"), "<ul><li>a long item</li><li>b</li></ul>");
  assert.equal(render("- **bold** and [link](x.md)"), '<ul><li><strong>bold</strong> and <a href="x.md">link</a></li></ul>');
});

test("lists: [ ] and [x] are tasks; not every dash or number is a list", () => {
  assert.equal(render("- [ ] todo\n- [x] done\n- plain"),
    '<ul class="task-list"><li class="task-item"><input type="checkbox" disabled> todo</li>' +
    '<li class="task-item"><input type="checkbox" disabled checked> done</li><li>plain</li></ul>');
  assert.equal(render("-no space"), "<p>-no space</p>");
  assert.equal(render("1.5 apples"), "<p>1.5 apples</p>");
  assert.equal(render("**bold** start"), "<p><strong>bold</strong> start</p>");
});

test("rules and fences: ---, *** and ___ are rules; a fence may be indented under an item", () => {
  assert.equal(render("a\n\n---\n\n* * *\n___"), "<p>a</p><hr><hr><hr>");
  assert.equal(render("| a |\n| --- |\n| 1 |"), "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>");
  const fenced = render("- item\n  ```js\n  x = 1\n    y\n  ```\npara");
  assert.match(fenced, /^<ul><li>item<\/li><\/ul><div class="md-code-block" data-lang="js">/);
  assert.match(fenced, /<pre><code>x = 1  y<\/code><\/pre><\/div><p>para<\/p>$/, "the fence's own indent is taken off its lines");
});

test("strikethrough, and footnotes numbered as first referred to, listed at the end", () => {
  assert.equal(render("~~gone~~ stays"), "<p><del>gone</del> stays</p>");
  const html = render("A[^one], B[^two], A again[^one], unknown[^x].\n\n[^one]: The **first**.\n[^two]: Second.\n\n`[^one]`");
  assert.equal(html, '<p>A<sup class="footnote-ref" title="The **first**.">1</sup>, B<sup class="footnote-ref" title="Second.">2</sup>, ' +
    'A again<sup class="footnote-ref" title="The **first**.">1</sup>, unknown[^x].</p><p><code>[^one]</code></p>' +
    '<section class="footnotes"><ol><li>The <strong>first</strong>.</li><li>Second.</li></ol></section>');
  assert.equal(render("No notes.\n\n[^unused]: Never referred to."), "<p>No notes.</p>", "a note nobody refers to is not listed");
});

// The text a highlighted line shows, as the editor reads it back.
const shown = (html) => html.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");

test("highlighting draws every line exactly as typed (list spacing included)", () => {
  const { highlightEditorLinesMemo } = createHighlighter({});
  const lines = ["- one", "-   three spaces", "-\ttab", "  - nested", "* star", "+ plus", "1. one", "12)  two", "- [ ] task", "- [x]  done",
    "#  Heading", "> quote", ">no space", "**bold** and *em* and `code`", "[link](a b.md)", "a < b & c > d", "1.5 apples", "-no list",
    "```js", "  - inside a fence", "```", "- after"];
  const out = highlightEditorLinesMemo("markdown", lines);
  lines.forEach((line, index) => assert.equal(shown(out[index].html), line, `line ${index + 1}: ${JSON.stringify(line)}`));
  assert.match(out[1].html, /<span class="token-list-mark">-<\/span> {3}three spaces/);
  assert.match(out[6].html, /<span class="token-list-mark">1\.<\/span>/);
  assert.match(out[8].html, /<span class="token-list-mark">\[ \]<\/span>/);
});
