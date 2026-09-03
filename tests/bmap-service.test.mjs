import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";
import { renderBmapToSvg } from "../app/ui/bmap-view.js";

const { bmapService } = await loadModules();

// Extract the plain-text content of each <text> line from an exported SVG.
function svgTextLines(ast) {
  const svg = renderBmapToSvg(ast);
  return [...svg.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
}

test("bmap: default document parses cleanly", () => {
  const defaultBmap = bmapService.createDefaultBmap();
  const parsedBmap = bmapService.parseBmap(defaultBmap);
  assert.equal(parsedBmap.parseErrors.length, 0);
  assert.equal(parsedBmap.nodes.length, 2);
  assert.equal(parsedBmap.connectors.length, 1);
});

test("bmap: rect node normalizes position and dimensions", () => {
  const normalizedRectNode = bmapService.createBmapNode({
    id: "node-test",
    shape: "rect",
    pos: { x: "12.8", y: "-4.2" },
    styles: { width: "199.9px", height: "101.6px" }
  });
  assert.deepEqual(normalizedRectNode.pos, { x: 12, y: -4 });
  assert.deepEqual(bmapService.getBmapNodeDimensions(normalizedRectNode), { width: 199, height: 101 });
});

test("bmap: circle node dimensions", () => {
  const normalizedCircleNode = bmapService.createBmapNode({
    id: "node-circle",
    shape: "circle",
    styles: { width: "144.4px", height: "220px" }
  });
  assert.deepEqual(bmapService.getBmapNodeDimensions(normalizedCircleNode), { width: 144, height: 220 });
});

test("bmap: connector style normalization", () => {
  const normalizedConnector = bmapService.createBmapConnector({
    from: "node-1.side.1",
    to: "node-2.side.3",
    styles: { dashed: "true", thickness: "3.9px", color: "#ff5500", mode: "straight", arrow: "both" }
  });
  assert.equal(normalizedConnector.styles.dashed, true);
  assert.equal(normalizedConnector.styles.thickness, 3);
  assert.equal(normalizedConnector.styles.mode, "straight");
  assert.equal(normalizedConnector.styles.arrow, "both");
});

test("bmap: serialization and filename detection", () => {
  const node = bmapService.createBmapNode({
    id: "node-test",
    shape: "rect",
    styles: { width: "199.9px", height: "101.6px" }
  });
  const connector = bmapService.createBmapConnector({
    from: "node-1.side.1",
    to: "node-2.side.3",
    styles: { thickness: "3.9px" }
  });
  const serializedBmap = bmapService.serializeBmap({ nodes: [node], connectors: [connector] });
  assert.match(serializedBmap, /height: 101/);
  assert.match(serializedBmap, /thickness: 3/);
  assert.equal(bmapService.isBmapFileName("diagram.bmap"), true);
});

test("bmap: SVG export wraps text (CJK, English, long words)", () => {
  // CJK has no spaces — it must still wrap into multiple lines within the node.
  const cjk = svgTextLines({
    nodes: [{
      id: "n", shape: "rect", pos: { x: 0, y: 0 },
      name: "修卡从前半主线继续进入终局",
      text: "不能后期消失他们会发现铁教授一直把人工枝试验当自己的数据源一部分人与卜兴合作",
      styles: { width: "250", height: "200", "font-size": "12" }
    }],
    connectors: []
  });
  assert.ok(cjk.length >= 3, `CJK text should wrap to several lines, got ${cjk.length}`);
  // No exported line should exceed the node's character capacity by much.
  for (const line of cjk) assert.ok([...line].length <= 20, `line too long: "${line}"`);

  // English wraps at spaces into more than one line in a narrow node.
  const en = svgTextLines({
    nodes: [{
      id: "e", shape: "rect", pos: { x: 0, y: 0 }, name: "Alpha",
      text: "The quick brown fox jumps over the lazy dog near the river.",
      styles: { width: "180", height: "200", "font-size": "12" }
    }],
    connectors: []
  });
  assert.ok(en.length >= 3, `English should wrap, got ${en.length}`);

  // An over-long single word hard-breaks instead of overflowing.
  const longWord = svgTextLines({
    nodes: [{
      id: "w", shape: "rect", pos: { x: 0, y: 0 },
      name: "supercalifragilisticexpialidocious", text: "",
      styles: { width: "120", height: "80", "font-size": "12" }
    }],
    connectors: []
  });
  assert.ok(longWord.length >= 2, `long word should hard-break, got ${longWord.length}`);
});

test("bmap: single-line styles parse regardless of delimiter", () => {
  // A style value like "1px solid #hex" contains spaces, so a bare space cannot
  // be the delimiter. Space-separated (what tools often emit), ';'-separated
  // (the preferred HTML style), and multi-line must all yield the same styles.
  const expected = {
    background: "#f0f5ff",
    border: "1px solid #2f54eb",
    "border-radius": "8px",
    width: "250",
    "text-align": "left"
  };
  const bodies = {
    space: "{background: #f0f5ff border: 1px solid #2f54eb border-radius: 8px width: 250 text-align: left}",
    semicolon: "{background: #f0f5ff; border: 1px solid #2f54eb; border-radius: 8px; width: 250; text-align: left}",
    multiline: "{\n    background: #f0f5ff\n    border: 1px solid #2f54eb\n    border-radius: 8px\n    width: 250\n    text-align: left\n  }"
  };
  for (const [label, styles] of Object.entries(bodies)) {
    const src = `.node {\n  id: n1\n  shape: rect\n  pos: {x: 1940, y: 2070}\n  styles: ${styles}\n}`;
    const node = bmapService.parseBmap(src).nodes[0];
    assert.deepEqual(node.pos, { x: 1940, y: 2070 }, `${label}: pos`);
    for (const [k, v] of Object.entries(expected)) {
      assert.equal(node.styles[k], v, `${label}: styles.${k}`);
    }
  }
});
