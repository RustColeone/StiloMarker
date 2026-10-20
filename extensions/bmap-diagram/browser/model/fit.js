// A diagram fitted to its pane: the zoom and pan that show every node,
// centred, zoomed out only as far as it needs (never in past 100%, never out
// past minZoom: a huge diagram starts readable, at its top-left part).
// boxes: the nodes' rectangles ({ x, y, width, height }, in the diagram's
// units); view: the pane's { width, height } in pixels. Pure.
export function fitView(boxes, view, { margin = 32, minZoom = 0.5 } = {}) {
  if (!boxes.length || view.width <= 0 || view.height <= 0) return null;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const width = Math.max(...boxes.map((box) => box.x + box.width)) - left;
  const height = Math.max(...boxes.map((box) => box.y + box.height)) - top;
  const room = { width: view.width - (2 * margin), height: view.height - (2 * margin) };
  const zoom = Math.max(minZoom, Math.min(1, room.width / width, room.height / height));
  // Centred along an axis where it fits; else from its start, a margin in.
  const place = (size, roomSize, viewSize, start) => (size * zoom <= roomSize ? (viewSize - (size * zoom)) / 2 : margin) - (start * zoom);
  return { zoom, pan: { x: place(width, room.width, view.width, left), y: place(height, room.height, view.height, top) } };
}
