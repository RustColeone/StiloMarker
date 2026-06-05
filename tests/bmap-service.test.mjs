import test from "node:test";
import assert from "node:assert/strict";

import { loadModules } from "./helpers/mocks.mjs";

const { bmapService } = await loadModules();

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
