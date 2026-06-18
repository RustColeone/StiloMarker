import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";

const { markdownService, mtreeService } = await loadModules();

test("markdown: headings, lists, and bold", () => {
  const html = markdownService.renderMarkdown("# Title\n\n- item\n\n**bold**");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>item<\/li><\/ul>/);
  assert.match(html, /<strong>bold<\/strong>/);
});

test("markdown: GFM pipe table renders thead/tbody with inline formatting", () => {
  const html = markdownService.renderMarkdown(
    "| Name | Note |\n| --- | --- |\n| **Bo** | a |\n| Cy | b |"
  );
  assert.match(html, /<table><thead><tr><th>Name<\/th><th>Note<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody>.*<td><strong>Bo<\/strong><\/td>.*<\/tbody>/s);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3); // 1 header + 2 body
});

test("markdown: table delimiter alignment maps to text-align", () => {
  const html = markdownService.renderMarkdown(
    "| L | C | R |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"
  );
  assert.match(html, /<th style="text-align:left">L<\/th>/);
  assert.match(html, /<th style="text-align:center">C<\/th>/);
  assert.match(html, /<th style="text-align:right">R<\/th>/);
});

test("markdown: pipes without a delimiter row stay a paragraph", () => {
  const html = markdownService.renderMarkdown("a | b | c");
  assert.match(html, /<p>a \| b \| c<\/p>/);
  assert.doesNotMatch(html, /<table>/);
});

test("markdown: image url resolution", () => {
  const htmlWithImage = markdownService.renderMarkdown("![Sketch](./diagram.png)", {
    resolveUrl(url) {
      return `resolved:${url}`;
    }
  });
  assert.match(htmlWithImage, /<img src="resolved:\.\/diagram\.png" alt="Sketch">/);
});

test("markdown: preserves trusted raw markup", () => {
  const htmlWithRawMarkup = markdownService.renderMarkdown(
    "Inline <sup>2</sup>\n\n<!-- MODULE_MAP_END -->\n<div class=\"callout\">Block HTML</div>"
  );
  assert.match(htmlWithRawMarkup, /<p>Inline <sup>2<\/sup><\/p>/);
  assert.ok(!htmlWithRawMarkup.includes("&lt;!-- MODULE_MAP_END --&gt;"));
  assert.match(htmlWithRawMarkup, /<!-- MODULE_MAP_END -->/);
  assert.match(htmlWithRawMarkup, /<div class="callout">Block HTML<\/div>/);
});

test("mtree: builds and injects module map section", () => {
  const moduleMap = mtreeService.buildModuleMapSection("Core; Root module\n\tChild; Child module\n");
  assert.match(moduleMap.section, /## Module Map/);
  assert.match(moduleMap.section, /Core/);
  assert.match(moduleMap.section, /Child/);
  assert.equal(moduleMap.warnings.length, 0);

  const updatedMarkdown = mtreeService.replaceOrAppendModuleMap("# Notes\n", moduleMap.section);
  assert.match(updatedMarkdown, /MODULE_MAP_START/);
  assert.match(updatedMarkdown, /## Module Map/);
});
