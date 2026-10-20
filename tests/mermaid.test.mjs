// The Mermaid extension's parts that need no page: a Markdown fence keeps its
// language for the Editor's codeBlocks, the source highlighting, and the
// library loader (pinned, tried again after a failed import, its leftovers
// removed).
import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../app/modules/editor/model/markdown.js";
import { highlightMermaidLine, SNIPPETS, STARTER } from "../extensions/mermaid/browser/model/mermaid.js";
import { MERMAID_URL, createMermaid } from "../extensions/mermaid/browser/adapters/library.js";

const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const blank = () => '<div class="editor-line"><br></div>';

test("a fence keeps its language (lowercased); one without stays plain", () => {
  const html = renderMarkdown("```Mermaid\nA --> B\n```\n\n```\nplain\n```");
  assert.match(html, /<div class="md-code-block" data-lang="mermaid">/);
  assert.match(html, /A --&gt; B/, "the code is escaped as before");
  assert.match(html, /<div class="md-code-block"><button/, "no language, no data-lang");
  assert.doesNotMatch(renderMarkdown('```"><script>\nx\n```'), /<script>/, "an odd info string cannot break out");
});

test("the source highlighting: diagrams, keywords, links, labels, strings, comments", () => {
  const line = (text) => highlightMermaidLine(text, { escape, blank });
  assert.equal(line("flowchart LR"), '<div class="editor-line"><span class="token-mermaid-diagram">flowchart</span> <span class="token-mermaid-keyword">LR</span></div>');
  assert.equal(line('  B -->|Yes| C["Done <b>"]'),
    '<div class="editor-line">  B <span class="token-mermaid-link">--&gt;</span><span class="token-mermaid-label">|Yes|</span> C[<span class="token-mermaid-string">"Done &lt;b&gt;"</span>]</div>');
  assert.equal(line("%% note"), '<div class="editor-line"><span class="token-mermaid-comment">%% note</span></div>');
  assert.equal(line("  A->>B: hi"), '<div class="editor-line">  A<span class="token-mermaid-link">-&gt;&gt;</span>B: hi</div>');
  assert.equal(line("graphical endpoint"), '<div class="editor-line">graphical endpoint</div>', "words that only start like a keyword");
  assert.equal(line("   "), blank());
  assert.ok(SNIPPETS.every((s) => s.snippet.endsWith("\n") && s.id.startsWith("mermaid-")));
  assert.match(STARTER, /^flowchart/);
});

test("the library: pinned, imported once, tried again after a failed import, its leftovers removed", async () => {
  assert.match(MERMAID_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@\d+\.\d+\.\d+\//, "an exact version");
  const removed = [];
  const doc = { documentElement: { dataset: { theme: "dark" } }, getElementById: (id) => ({ remove: () => removed.push(id) }) };
  let imports = 0, fail = true;
  const initialized = [];
  const fake = {
    initialize: (options) => initialized.push(options),
    render: async (id, code) => { if (code === "bad") throw new Error("Parse error on line 1"); return { svg: `<svg id="${id}"></svg>` }; }
  };
  const mermaid = createMermaid({ doc, importer: async (url) => { imports += 1; assert.equal(url, MERMAID_URL); if (fail) throw new Error("offline"); return { default: fake }; } });
  await assert.rejects(mermaid.draw("A-->B"), /could not be loaded \(offline\)/);
  fail = false;
  assert.equal(await mermaid.draw("A-->B"), '<svg id="stilo-mermaid-1"></svg>', "tried again: the network is back");
  assert.equal(await mermaid.draw("B-->C"), '<svg id="stilo-mermaid-2"></svg>');
  assert.equal(imports, 2, "imported once it worked");
  assert.deepEqual(initialized, [{ startOnLoad: false, securityLevel: "strict", theme: "dark" }], "strict, themed, set once");
  await assert.rejects(mermaid.draw("bad"), /Parse error/);
  assert.deepEqual(removed, ["dstilo-mermaid-1", "dstilo-mermaid-2", "dstilo-mermaid-3"], "what each render leaves is removed");
});
