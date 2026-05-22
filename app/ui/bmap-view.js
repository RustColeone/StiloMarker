/**
 * bmap-view.js
 * SVG + HTML interactive diagram renderer for .bmap files.
 *
 * Usage:
 *   const view = createBmapView({ container, onOpenLinkedFile, resolveFileContent });
 *   view.render(bmapSourceText);
 *
 * Snap side indices: 0=top, 1=right, 2=bottom, 3=left
 */

import { parseBmap } from "../services/bmap-service.js";
import { renderMarkdown } from "../services/markdown-service.js";

const NODE_DEFAULT_WIDTH = 220;
const NODE_DEFAULT_HEIGHT = 80;

/** Outward direction vectors for each side index */
const SNAP_DIR = [
  { x: 0, y: -1 }, // 0 = top
  { x: 1, y: 0 },  // 1 = right
  { x: 0, y: 1 },  // 2 = bottom
  { x: -1, y: 0 }, // 3 = left
];

/**
 * Parse a connector endpoint string like "node-1.side.2".
 * @param {string} str
 * @returns {{ nodeId: string, sideIndex: number }}
 */
function parseEndpoint(str) {
  const s = String(str ?? "").trim();
  // Find the ".side." separator (from the right)
  const sideSep = s.lastIndexOf(".side.");
  if (sideSep < 0) return { nodeId: s, sideIndex: 0 };
  const nodeId = s.slice(0, sideSep);
  const sideIndex = parseInt(s.slice(sideSep + 6), 10);
  return { nodeId, sideIndex: isNaN(sideIndex) ? 0 : sideIndex % 4 };
}

/**
 * Get the style-declared width for a node (used during element creation).
 * @param {object} node
 * @returns {number}
 */
function getNodeWidth(node) {
  return parseInt(node.styles?.width ?? NODE_DEFAULT_WIDTH, 10) || NODE_DEFAULT_WIDTH;
}

/**
 * Get the absolute pixel position of a snap point using MEASURED dimensions.
 * Call this only after the node element has been laid out in the DOM.
 * @param {object} node  – bmap node data (has .pos)
 * @param {number} sideIndex
 * @param {number} measuredWidth   – el.offsetWidth after DOM layout
 * @param {number} measuredHeight  – el.offsetHeight after DOM layout
 * @returns {{ x: number, y: number }}
 */
function getSnapPoint(node, sideIndex, measuredWidth, measuredHeight) {
  const x = node.pos.x;
  const y = node.pos.y;
  const cx = x + measuredWidth / 2;
  const cy = y + measuredHeight / 2;
  switch (sideIndex) {
    case 0: return { x: cx, y };
    case 1: return { x: x + measuredWidth, y: cy };
    case 2: return { x: cx, y: y + measuredHeight };
    case 3: return { x, y: cy };
    default: return { x: cx, y: cy };
  }
}

/**
 * Build a cubic bezier SVG path string between two snap points.
 */
function buildBezierPath(fromPt, fromSide, toPt, toSide) {
  const fromDir = SNAP_DIR[fromSide] ?? SNAP_DIR[1];
  const toDir = SNAP_DIR[toSide] ?? SNAP_DIR[3];
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const offset = Math.max(60, dist * 0.4);
  const cp1x = fromPt.x + fromDir.x * offset;
  const cp1y = fromPt.y + fromDir.y * offset;
  const cp2x = toPt.x + toDir.x * offset;
  const cp2y = toPt.y + toDir.y * offset;
  return `M ${fromPt.x} ${fromPt.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPt.x} ${toPt.y}`;
}

/**
 * Build a straight SVG path string.
 */
function buildStraightPath(fromPt, toPt) {
  return `M ${fromPt.x} ${fromPt.y} L ${toPt.x} ${toPt.y}`;
}

/**
 * Escape text for use inside HTML attributes or textContent via innerHTML.
 */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * CSS property names that are safe to apply from user-defined node styles.
 */
const SAFE_STYLE_PROPS = new Set([
  "background",
  "background-color",
  "border",
  "border-radius",
  "border-color",
  "border-width",
  "border-style",
  "color",
  "font-size",
  "font-weight",
  "padding",
  "opacity",
]);

// ── Singleton floating file-preview popup ────────────────────────────────────
let _bmapPopup = null;
let _bmapPopupClickOff = null;
let _bmapPopupEscOff = null;

function _hideBmapPopup() {
  if (_bmapPopup) _bmapPopup.hidden = true;
  if (_bmapPopupClickOff) {
    document.removeEventListener("click", _bmapPopupClickOff, true);
    _bmapPopupClickOff = null;
  }
  if (_bmapPopupEscOff) {
    document.removeEventListener("keydown", _bmapPopupEscOff);
    _bmapPopupEscOff = null;
  }
}

function showBmapFilePopup(anchorEl, filePath, fileContent) {
  if (!_bmapPopup) {
    _bmapPopup = document.createElement("div");
    _bmapPopup.className = "bmap-file-popup";
    _bmapPopup.hidden = true;
    document.body.append(_bmapPopup);
  }
  _hideBmapPopup();

  const popup = _bmapPopup;
  popup.replaceChildren();

  // Title bar
  const titleBar = document.createElement("div");
  titleBar.className = "bmap-popup-titlebar";
  const titleEl = document.createElement("span");
  titleEl.className = "bmap-popup-title";
  titleEl.textContent = filePath;
  titleEl.title = filePath;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bmap-popup-close";
  closeBtn.textContent = "\xd7";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", _hideBmapPopup);
  titleBar.append(titleEl, closeBtn);
  popup.append(titleBar);

  const body = document.createElement("div");
  body.className = "bmap-popup-body";

  if (fileContent == null) {
    body.className += " bmap-popup-body-msg";
    body.textContent = `File not found: ${filePath}`;
    popup.append(body);
  } else {
    const isImage = fileContent.startsWith("data:image/");
    const contentArea = document.createElement("div");
    contentArea.className = "bmap-popup-content";

    if (isImage) {
      const img = document.createElement("img");
      img.src = fileContent;
      img.style.maxWidth = "100%";
      img.style.display = "block";
      contentArea.append(img);
      body.append(contentArea);
      popup.append(body);
    } else {
      const toggleBar = document.createElement("div");
      toggleBar.className = "bmap-popup-togglebar";
      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "bmap-popup-mode-btn is-active";
      previewBtn.textContent = "Preview";
      const rawBtn = document.createElement("button");
      rawBtn.type = "button";
      rawBtn.className = "bmap-popup-mode-btn";
      rawBtn.textContent = "Raw";

      function showMode(mode) {
        contentArea.replaceChildren();
        if (mode === "preview") {
          contentArea.innerHTML = renderMarkdown(fileContent);
        } else {
          contentArea.innerHTML = `<pre><code>${escapeHtml(fileContent)}</code></pre>`;
        }
        previewBtn.classList.toggle("is-active", mode === "preview");
        rawBtn.classList.toggle("is-active", mode === "raw");
      }

      previewBtn.addEventListener("click", () => showMode("preview"));
      rawBtn.addEventListener("click", () => showMode("raw"));
      showMode("preview");

      toggleBar.append(previewBtn, rawBtn);
      body.append(contentArea);
      popup.append(toggleBar, body);
    }
  }

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  const W = 300;
  const MH = 440;
  let left = rect.right + 8;
  let top = rect.top;
  if (left + W > window.innerWidth - 8) left = rect.left - W - 8;
  if (left < 8) left = 8;
  if (top + MH > window.innerHeight - 8) top = window.innerHeight - MH - 8;
  if (top < 8) top = 8;
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
  popup.hidden = false;

  // Dismiss on outside click or Escape
  setTimeout(() => {
    _bmapPopupClickOff = (e) => { if (!popup.contains(e.target)) _hideBmapPopup(); };
    _bmapPopupEscOff = (e) => { if (e.key === "Escape") _hideBmapPopup(); };
    document.addEventListener("click", _bmapPopupClickOff, true);
    document.addEventListener("keydown", _bmapPopupEscOff);
  }, 0);
}

/**
 * Create and manage a bmap diagram view.
 *
 * @param {{
 *   container: HTMLElement,
 *   onOpenLinkedFile?: (filePath: string) => void,
 *   resolveFileContent?: (filePath: string) => string | null
 * }} options
 * @returns {{ render: (source: string) => void }}
 */
function createBmapView({ container, onOpenLinkedFile, resolveFileContent }) {
  let pan = { x: 40, y: 40 };
  let zoom = 1;
  let isPanning = false;
  let panStart = null;
  let panStartPan = null;
  let innerEl = null;

  function applyTransform() {
    if (innerEl) {
      innerEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    }
  }

  /**
   * Render the diagram from source text into the container.
   * @param {string} source
   */
  function render(source) {
    const diagram = parseBmap(source);
    container.replaceChildren();

    // Root canvas element
    const canvas = document.createElement("div");
    canvas.className = "bmap-canvas";

    // Inner transform group
    const inner = document.createElement("div");
    inner.className = "bmap-inner";
    inner.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    inner.style.transformOrigin = "0 0";
    innerEl = inner;

    // SVG overlay for connectors (rendered beneath nodes via DOM order)
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("bmap-connectors-svg");
    svg.setAttribute("overflow", "visible");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    svg.style.position = "absolute";
    svg.style.top = "0";
    svg.style.left = "0";

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.append(defs);

    // Nodes layer
    const nodesLayer = document.createElement("div");
    nodesLayer.className = "bmap-nodes-layer";

    inner.append(svg, nodesLayer);

    // --- Zoom/pan controls (built before appending canvas) ---
    const controls = document.createElement("div");
    controls.className = "bmap-controls";
    controls.append(
      makeControlButton("+", "Zoom in", () => { zoom = Math.min(3, zoom + 0.15); applyTransform(); }),
      makeControlButton("−", "Zoom out", () => { zoom = Math.max(0.2, zoom - 0.15); applyTransform(); }),
      makeControlButton("⊡", "Reset view", () => { pan = { x: 40, y: 40 }; zoom = 1; applyTransform(); }),
    );

    canvas.append(inner, controls);

    // Wire pan/zoom events before going live
    canvas.addEventListener("pointerdown", (e) => {
      if (e.target !== canvas && e.target !== inner && e.target !== svg) return;
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      panStartPan = { ...pan };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!isPanning) return;
      pan.x = panStartPan.x + (e.clientX - panStart.x);
      pan.y = panStartPan.y + (e.clientY - panStart.y);
      applyTransform();
    });
    canvas.addEventListener("pointerup", () => { isPanning = false; });
    canvas.addEventListener("pointercancel", () => { isPanning = false; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const prevZoom = zoom;
      zoom = Math.min(3, Math.max(0.2, zoom + delta));
      pan.x = mx - (mx - pan.x) * (zoom / prevZoom);
      pan.y = my - (my - pan.y) * (zoom / prevZoom);
      applyTransform();
    }, { passive: false });

    // Attach to live DOM now so offsetHeight reads are accurate
    container.append(canvas);

    // Build node lookup map
    const nodeMap = new Map(diagram.nodes.map((n) => [n.id, n]));

    // ── PASS 1: Build + insert all node elements ──────────────────────────────
    const nodeElMap = new Map(); // nodeId → DOM element

    for (const node of diagram.nodes) {
      const width = getNodeWidth(node);
      const isCircle = node.shape === "circle";

      const el = document.createElement("div");
      el.className = `bmap-node ${isCircle ? "bmap-node-circle" : "bmap-node-rect"}`;
      el.dataset.nodeId = node.id;
      el.style.left = `${node.pos.x}px`;
      el.style.top = `${node.pos.y}px`;
      el.style.width = `${width}px`;
      if (isCircle) {
        el.style.height = `${width}px`;
        el.style.borderRadius = "50%";
      }

      // Apply safe user-defined styles
      for (const [key, val] of Object.entries(node.styles ?? {})) {
        if (key === "width" || key === "height") continue;
        if (SAFE_STYLE_PROPS.has(key)) {
          el.style.setProperty(key, String(val));
        }
      }

      // Snap points (visible on hover via CSS)
      for (let side = 0; side < 4; side++) {
        const snap = document.createElement("div");
        snap.className = `bmap-snap bmap-snap-${side}`;
        el.append(snap);
      }

      // Node header: name + action buttons
      const header = document.createElement("div");
      header.className = "bmap-node-header";

      const nameEl = document.createElement("span");
      nameEl.className = "bmap-node-name";
      nameEl.textContent = node.name;
      header.append(nameEl);

      if (node.file) {
        const actions = document.createElement("div");
        actions.className = "bmap-node-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "bmap-node-action";
        openBtn.title = `Open ${node.file}`;
        openBtn.textContent = "↗";
        openBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onOpenLinkedFile?.(node.file);
        });

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "bmap-node-action";
        previewBtn.title = "Preview file";
        previewBtn.textContent = "⊞";
        previewBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const content = resolveFileContent?.(node.file) ?? null;
          showBmapFilePopup(previewBtn, node.file, content);
        });

        actions.append(openBtn, previewBtn);
        header.append(actions);
      }

      el.append(header);

      // Node body text
      if (node.text) {
        const textEl = document.createElement("div");
        textEl.className = "bmap-node-text";
        textEl.textContent = node.text;
        el.append(textEl);
      }

      nodesLayer.append(el);
      nodeElMap.set(node.id, el);
    }

    // ── PASS 2: Measure actual rendered node sizes ────────────────────────────
    // Reading offsetHeight forces a layout reflow and returns the true rendered
    // height (header + text + padding). We use these to compute accurate snap
    // point positions so connectors land exactly on the node edges.
    const nodeSizeMap = new Map();
    for (const [id, el] of nodeElMap) {
      nodeSizeMap.set(id, { width: el.offsetWidth, height: el.offsetHeight });
    }

    // ── PASS 3: Build connector SVG paths using measured sizes ────────────────
    const markerIds = new Set();
    for (const conn of diagram.connectors) {
      const fromEp = parseEndpoint(conn.from);
      const toEp = parseEndpoint(conn.to);
      const fromNode = nodeMap.get(fromEp.nodeId);
      const toNode = nodeMap.get(toEp.nodeId);
      if (!fromNode || !toNode) continue;

      const fromSize = nodeSizeMap.get(fromEp.nodeId) ?? { width: NODE_DEFAULT_WIDTH, height: NODE_DEFAULT_HEIGHT };
      const toSize = nodeSizeMap.get(toEp.nodeId) ?? { width: NODE_DEFAULT_WIDTH, height: NODE_DEFAULT_HEIGHT };

      const fromPt = getSnapPoint(fromNode, fromEp.sideIndex, fromSize.width, fromSize.height);
      const toPt = getSnapPoint(toNode, toEp.sideIndex, toSize.width, toSize.height);
      const color = conn.styles?.color ?? "#888888";
      const thickness = conn.styles?.thickness ?? 2;
      const dashed = conn.styles?.dashed ?? false;
      const mode = conn.styles?.mode ?? "bezier";
      const arrow = conn.styles?.arrow ?? "end";

      const pathD = mode === "straight"
        ? buildStraightPath(fromPt, toPt)
        : buildBezierPath(fromPt, fromEp.sideIndex, toPt, toEp.sideIndex);

      const colorKey = color.replace(/[^a-zA-Z0-9]/g, "");
      if (arrow === "end" || arrow === "both") {
        const markerId = `bmap-arr-end-${colorKey}`;
        if (!markerIds.has(markerId)) {
          markerIds.add(markerId);
          defs.append(createArrowMarker(markerId, color, false));
        }
      }
      if (arrow === "start" || arrow === "both") {
        const markerId = `bmap-arr-start-${colorKey}`;
        if (!markerIds.has(markerId)) {
          markerIds.add(markerId);
          defs.append(createArrowMarker(markerId, color, true));
        }
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathD);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", String(thickness));
      if (dashed) {
        path.setAttribute("stroke-dasharray", `${Number(thickness) * 3} ${Number(thickness) * 2}`);
      }
      if (arrow === "end" || arrow === "both") {
        path.setAttribute("marker-end", `url(#bmap-arr-end-${colorKey})`);
      }
      if (arrow === "start" || arrow === "both") {
        path.setAttribute("marker-start", `url(#bmap-arr-start-${colorKey})`);
      }
      svg.append(path);
    }
  }

  return { render };
}

/**
 * Create a zoom/pan control button.
 */
function makeControlButton(label, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bmap-control-btn";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * Create an SVG arrowhead marker element.
 * @param {string} id
 * @param {string} color
 * @param {boolean} isStart  true = points left (for marker-start)
 */
function createArrowMarker(id, color, isStart) {
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", id);
  marker.setAttribute("markerWidth", "10");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("refX", isStart ? "0" : "10");
  marker.setAttribute("refY", "3.5");
  marker.setAttribute("orient", "auto");
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  poly.setAttribute("points", isStart ? "10 0, 0 3.5, 10 7" : "0 0, 10 3.5, 0 7");
  poly.setAttribute("fill", color);
  marker.append(poly);
  return marker;
}

export { createBmapView };
