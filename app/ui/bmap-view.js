/**
 * bmap-view.js
 * Interactive preview editor for .bmap brainstorm diagrams.
 */

import {
  BMAP_DEFAULT_CIRCLE_SIZE,
  BMAP_DEFAULT_RECT_HEIGHT,
  BMAP_DEFAULT_RECT_WIDTH,
  createBmapConnector,
  createBmapNode,
  getBmapNodeDimensions,
  normalizeBmapAst,
  parseBmap,
  serializeBmap,
} from "../services/bmap-service.js";
import { renderMarkdown } from "../services/markdown-service.js";

const GRID_BASE = 5;
const GRID_MIN_SCREEN_STEP = 4;
const MIN_NODE_SIZE = 48;
const MIN_SNAP_STEP = 10;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.15;
const SNAP_STEP_OPTIONS = [10, 20, 25, 50, 100];

const SNAP_DIR = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

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
  "opacity",
]);

let popupEl = null;
let popupClickOff = null;
let popupEscOff = null;
let popupZoom = 1;

const POPUP_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeInteractionMode(value) {
  return String(value ?? "edit").trim().toLowerCase() === "readonly" ? "readonly" : "edit";
}

function normalizeSnapStep(value) {
  const parsed = Number.parseInt(String(value ?? MIN_SNAP_STEP), 10);
  if (!Number.isFinite(parsed)) {
    return MIN_SNAP_STEP;
  }
  return Math.max(MIN_SNAP_STEP, parsed);
}

function snapValue(value, step) {
  return Math.round(Number(value ?? 0) / step) * step;
}

function snapSizeValue(value, step, minimum = MIN_NODE_SIZE) {
  const snappedMinimum = Math.ceil(minimum / step) * step;
  return Math.max(snappedMinimum, snapValue(value, step));
}

function snapPoint(point, step) {
  return {
    x: snapValue(point?.x ?? 0, step),
    y: snapValue(point?.y ?? 0, step),
  };
}

function positiveModulo(value, divisor) {
  if (!Number.isFinite(divisor) || divisor === 0) {
    return 0;
  }
  return ((value % divisor) + divisor) % divisor;
}

function normalizeSideIndex(sideIndex) {
  const parsed = Number.parseInt(String(sideIndex ?? 0), 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return ((parsed % 4) + 4) % 4;
}

function parseEndpoint(rawValue) {
  const value = String(rawValue ?? "").trim();
  const separator = value.lastIndexOf(".side.");
  if (separator < 0) {
    return { nodeId: value, sideIndex: 0 };
  }
  return {
    nodeId: value.slice(0, separator),
    sideIndex: normalizeSideIndex(value.slice(separator + 6))
  };
}

function formatEndpoint(nodeId, sideIndex) {
  return `${nodeId}.side.${normalizeSideIndex(sideIndex)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getNodeRect(node) {
  const { width, height } = getBmapNodeDimensions(node);
  return {
    x: node.pos?.x ?? 0,
    y: node.pos?.y ?? 0,
    width,
    height,
  };
}

function getSnapPoint(node, sideIndex) {
  const rect = getNodeRect(node);
  const centerX = rect.x + (rect.width / 2);
  const centerY = rect.y + (rect.height / 2);
  switch (normalizeSideIndex(sideIndex)) {
    case 0:
      return { x: centerX, y: rect.y };
    case 1:
      return { x: rect.x + rect.width, y: centerY };
    case 2:
      return { x: centerX, y: rect.y + rect.height };
    case 3:
      return { x: rect.x, y: centerY };
    default:
      return { x: centerX, y: centerY };
  }
}

function buildBezierPath(fromPoint, fromSide, toPoint, toSide) {
  const fromDir = SNAP_DIR[normalizeSideIndex(fromSide)] ?? SNAP_DIR[1];
  const toDir = SNAP_DIR[normalizeSideIndex(toSide)] ?? SNAP_DIR[3];
  const distance = Math.hypot(toPoint.x - fromPoint.x, toPoint.y - fromPoint.y);
  const offset = Math.max(40, distance * 0.35);
  const cp1x = fromPoint.x + (fromDir.x * offset);
  const cp1y = fromPoint.y + (fromDir.y * offset);
  const cp2x = toPoint.x + (toDir.x * offset);
  const cp2y = toPoint.y + (toDir.y * offset);
  return `M ${fromPoint.x} ${fromPoint.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${toPoint.x} ${toPoint.y}`;
}

function buildStraightPath(fromPoint, toPoint) {
  return `M ${fromPoint.x} ${fromPoint.y} L ${toPoint.x} ${toPoint.y}`;
}

function inferTargetSide(fromPoint, toPoint) {
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 3 : 1;
  }
  return dy >= 0 ? 0 : 2;
}

function buildConnectorPath(connector, nodeMap, previewPointer = null) {
  const fromEndpoint = parseEndpoint(connector.from);
  const fromNode = nodeMap.get(fromEndpoint.nodeId);
  if (!fromNode) {
    return null;
  }

  const fromPoint = getSnapPoint(fromNode, fromEndpoint.sideIndex);
  const styleMode = String(connector.styles?.mode ?? "bezier").trim();

  if (previewPointer) {
    const toSide = inferTargetSide(fromPoint, previewPointer);
    return styleMode === "straight"
      ? buildStraightPath(fromPoint, previewPointer)
      : buildBezierPath(fromPoint, fromEndpoint.sideIndex, previewPointer, toSide);
  }

  const toEndpoint = parseEndpoint(connector.to);
  const toNode = nodeMap.get(toEndpoint.nodeId);
  if (!toNode) {
    return null;
  }

  const toPoint = getSnapPoint(toNode, toEndpoint.sideIndex);
  return styleMode === "straight"
    ? buildStraightPath(fromPoint, toPoint)
    : buildBezierPath(fromPoint, fromEndpoint.sideIndex, toPoint, toEndpoint.sideIndex);
}

function getNodeStyleValue(node, key, fallback = "") {
  return String(node?.styles?.[key] ?? fallback ?? "");
}

function getPixelStyleValue(node, key, fallback) {
  const rawValue = getNodeStyleValue(node, key, "");
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setPopupHidden() {
  if (popupEl) {
    popupEl.hidden = true;
  }
  if (popupClickOff) {
    document.removeEventListener("click", popupClickOff, true);
    popupClickOff = null;
  }
  if (popupEscOff) {
    document.removeEventListener("keydown", popupEscOff);
    popupEscOff = null;
  }
}

function showBmapFilePopup(anchorElement, filePath, fileContent) {
  if (!popupEl) {
    popupEl = document.createElement("div");
    popupEl.className = "bmap-file-popup";
    popupEl.hidden = true;
    document.body.append(popupEl);
  }

  setPopupHidden();
  popupEl.replaceChildren();

  const titleBar = document.createElement("div");
  titleBar.className = "bmap-popup-titlebar";
  const titleEl = document.createElement("span");
  titleEl.className = "bmap-popup-title";
  titleEl.textContent = filePath;
  titleEl.title = filePath;

  const zoomLabel = document.createElement("span");
  zoomLabel.className = "bmap-popup-zoom-label";
  zoomLabel.textContent = `${Math.round(popupZoom * 100)}%`;

  function applyZoom(contentArea) {
    contentArea.style.zoom = popupZoom;
    zoomLabel.textContent = `${Math.round(popupZoom * 100)}%`;
  }

  let contentAreaRef = null;

  const zoomOutBtn = document.createElement("button");
  zoomOutBtn.type = "button";
  zoomOutBtn.className = "bmap-popup-zoom-btn";
  zoomOutBtn.textContent = "−";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = POPUP_ZOOM_STEPS.indexOf(popupZoom);
    if (idx > 0) {
      popupZoom = POPUP_ZOOM_STEPS[idx - 1];
      if (contentAreaRef) applyZoom(contentAreaRef);
    }
  });

  const zoomInBtn = document.createElement("button");
  zoomInBtn.type = "button";
  zoomInBtn.className = "bmap-popup-zoom-btn";
  zoomInBtn.textContent = "+";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = POPUP_ZOOM_STEPS.indexOf(popupZoom);
    if (idx < POPUP_ZOOM_STEPS.length - 1) {
      popupZoom = POPUP_ZOOM_STEPS[idx + 1];
      if (contentAreaRef) applyZoom(contentAreaRef);
    }
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "bmap-popup-close";
  closeBtn.textContent = "×";
  closeBtn.title = "Close";
  closeBtn.addEventListener("click", setPopupHidden);
  titleBar.append(titleEl, zoomOutBtn, zoomLabel, zoomInBtn, closeBtn);

  let dragOffset = null;
  titleBar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    const rect = popupEl.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    titleBar.setPointerCapture(e.pointerId);
  });
  titleBar.addEventListener("pointermove", (e) => {
    if (!dragOffset) return;
    popupEl.style.left = `${e.clientX - dragOffset.x}px`;
    popupEl.style.top = `${e.clientY - dragOffset.y}px`;
  });
  titleBar.addEventListener("pointerup", () => { dragOffset = null; });
  titleBar.addEventListener("pointercancel", () => { dragOffset = null; });

  popupEl.append(titleBar);

  const body = document.createElement("div");
  body.className = "bmap-popup-body";

  if (fileContent == null) {
    body.className += " bmap-popup-body-msg";
    body.textContent = `File not found: ${filePath}`;
    popupEl.append(body);
  } else if (fileContent.startsWith("data:image/")) {
    const contentArea = document.createElement("div");
    contentArea.className = "bmap-popup-content";
    contentAreaRef = contentArea;
    applyZoom(contentArea);
    const image = document.createElement("img");
    image.src = fileContent;
    image.style.maxWidth = "100%";
    image.style.display = "block";
    contentArea.append(image);
    body.append(contentArea);
    popupEl.append(body);
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
    const contentArea = document.createElement("div");
    contentArea.className = "bmap-popup-content";
    contentAreaRef = contentArea;
    applyZoom(contentArea);

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
    popupEl.append(toggleBar, body);
  }

  const rect = anchorElement.getBoundingClientRect();
  const popupWidth = 300;
  const popupHeight = 440;
  let left = rect.right + 8;
  let top = rect.top;
  if (left + popupWidth > window.innerWidth - 8) {
    left = rect.left - popupWidth - 8;
  }
  if (left < 8) {
    left = 8;
  }
  if (top + popupHeight > window.innerHeight - 8) {
    top = window.innerHeight - popupHeight - 8;
  }
  if (top < 8) {
    top = 8;
  }
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;
  popupEl.hidden = false;

  window.setTimeout(() => {
    popupClickOff = (event) => {
      if (!popupEl.contains(event.target)) {
        setPopupHidden();
      }
    };
    popupEscOff = (event) => {
      if (event.key === "Escape") {
        setPopupHidden();
      }
    };
    document.addEventListener("click", popupClickOff, true);
    document.addEventListener("keydown", popupEscOff);
  }, 0);
}

function createBmapView({ container, ...defaultOptions } = {}) {
  let sourceText = "";
  let ast = normalizeBmapAst({ nodes: [], connectors: [], parseErrors: [] });
  let selected = null;
  let nodeClipboard = null;
  let pan = { x: 40, y: 40 };
  let zoom = 1;
  let gesture = null;
  let connectPreview = null;
  let currentDocumentKey = null;
  let interactionMode = "edit";
  let inspectorCollapsed = false;
  let snapStep = MIN_SNAP_STEP;
  let activeOptions = {
    onCommit: null,
    onOpenLinkedFile: null,
    resolveFileContent: null,
    listProjectFiles: () => [],
    resolveRelativeFilePath: () => null,
    logDebug: null,
    ...defaultOptions,
  };

  let canvasEl = null;
  let innerEl = null;

  function setActiveOptions(nextOptions = {}) {
    activeOptions = {
      ...activeOptions,
      ...nextOptions,
      listProjectFiles: typeof nextOptions.listProjectFiles === "function"
        ? nextOptions.listProjectFiles
        : activeOptions.listProjectFiles,
      resolveRelativeFilePath: typeof nextOptions.resolveRelativeFilePath === "function"
        ? nextOptions.resolveRelativeFilePath
        : activeOptions.resolveRelativeFilePath,
    };
  }

  function getNodeById(nodeId) {
    return ast.nodes.find((node) => node.id === nodeId) ?? null;
  }

  function isEditingEnabled() {
    return interactionMode === "edit";
  }

  function setInteractionMode(nextMode) {
    const normalizedMode = normalizeInteractionMode(nextMode);
    if (interactionMode === normalizedMode) {
      return;
    }
    interactionMode = normalizedMode;
    if (!isEditingEnabled()) {
      stopGesture(false);
    }
    renderScene();
  }

  function toggleInspectorCollapsed() {
    inspectorCollapsed = !inspectorCollapsed;
    renderScene();
  }

  function setSnapStep(nextStep) {
    const normalizedStep = normalizeSnapStep(nextStep);
    if (snapStep === normalizedStep) {
      return;
    }
    snapStep = normalizedStep;
    renderScene();
  }

  function getSelectedNode() {
    return selected?.type === "node" ? getNodeById(selected.id) : null;
  }

  function getSelectedConnector() {
    return selected?.type === "connector" ? ast.connectors[selected.index] ?? null : null;
  }

  function ensureSelectionStillExists() {
    if (selected?.type === "node" && !getNodeById(selected.id)) {
      selected = null;
      return;
    }
    if (selected?.type === "connector" && !ast.connectors[selected.index]) {
      selected = null;
    }
  }

  function commitAst(reason) {
    const nextSource = serializeBmap(ast);
    if (nextSource === sourceText) {
      return;
    }
    sourceText = nextSource;
    activeOptions.onCommit?.(nextSource, { reason, selection: selected });
  }

  function setSelection(nextSelection) {
    selected = nextSelection;
    renderScene();
  }

  function getViewportCenterWorld() {
    if (!canvasEl) {
      return { x: 120, y: 120 };
    }
    const rect = canvasEl.getBoundingClientRect();
    return clientToWorld(rect.left + (rect.width / 2), rect.top + (rect.height / 2));
  }

  function nextNodeId() {
    const used = new Set(ast.nodes.map((node) => node.id));
    let counter = 1;
    while (used.has(`node-${counter}`)) {
      counter += 1;
    }
    return `node-${counter}`;
  }

  function clientToWorld(clientX, clientY) {
    if (!canvasEl) {
      return { x: 0, y: 0 };
    }
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - pan.x) / zoom),
      y: Math.round((clientY - rect.top - pan.y) / zoom),
    };
  }

  function applyViewportTransform() {
    if (!innerEl || !canvasEl) {
      return;
    }
    innerEl.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    canvasEl.style.setProperty("--bmap-inv-zoom", 1 / zoom);

    let minor = Math.max(GRID_BASE, snapStep);
    while ((minor * zoom) < GRID_MIN_SCREEN_STEP) {
      minor *= 5;
    }
    const major = minor * 5;
    const minorScreen = minor * zoom;
    const majorScreen = major * zoom;
    const minorOffsetX = positiveModulo(pan.x, minorScreen);
    const minorOffsetY = positiveModulo(pan.y, minorScreen);
    const majorOffsetX = positiveModulo(pan.x, majorScreen);
    const majorOffsetY = positiveModulo(pan.y, majorScreen);
    canvasEl.style.backgroundImage = [
      "radial-gradient(circle at 0% 0%, rgba(255,255,255,0.09) 1px, transparent 1.2px)",
      "radial-gradient(circle at 0% 0%, rgba(255,255,255,0.22) 1.4px, transparent 1.8px)"
    ].join(",");
    canvasEl.style.backgroundSize = `${minorScreen}px ${minorScreen}px, ${majorScreen}px ${majorScreen}px`;
    canvasEl.style.backgroundPosition = `${minorOffsetX}px ${minorOffsetY}px, ${majorOffsetX}px ${majorOffsetY}px`;
  }

  function addNode(shape) {
    if (!isEditingEnabled()) {
      return;
    }
    const center = getViewportCenterWorld();
    const defaults = shape === "circle"
      ? { width: BMAP_DEFAULT_CIRCLE_SIZE, height: 100 }
      : { width: BMAP_DEFAULT_RECT_WIDTH, height: BMAP_DEFAULT_RECT_HEIGHT };
    const snappedSize = {
      width: snapSizeValue(defaults.width, snapStep),
      height: snapSizeValue(defaults.height, snapStep)
    };
    const snappedPosition = snapPoint({
      x: center.x - (snappedSize.width / 2),
      y: center.y - (snappedSize.height / 2)
    }, snapStep);
    const node = createBmapNode({
      id: nextNodeId(),
      name: shape === "circle" ? "Oval Node" : "New Node",
      text: "",
      shape,
      pos: {
        x: snappedPosition.x,
        y: snappedPosition.y
      },
      styles: {
        width: String(snappedSize.width),
        height: String(snappedSize.height)
      }
    });
    ast.nodes.push(node);
    selected = { type: "node", id: node.id };
    renderScene();
    commitAst("bmap:add-node");
  }

  function deleteSelected() {
    if (!isEditingEnabled()) {
      return;
    }
    if (selected?.type === "node") {
      const nodeId = selected.id;
      ast.nodes = ast.nodes.filter((node) => node.id !== nodeId);
      ast.connectors = ast.connectors.filter((connector) => {
        const from = parseEndpoint(connector.from);
        const to = parseEndpoint(connector.to);
        return from.nodeId !== nodeId && to.nodeId !== nodeId;
      });
      selected = null;
      renderScene();
      commitAst("bmap:delete-node");
      return;
    }
    if (selected?.type === "connector") {
      ast.connectors.splice(selected.index, 1);
      selected = null;
      renderScene();
      commitAst("bmap:delete-connector");
    }
  }

  function handleCanvasKeydown(event) {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selected) {
        deleteSelected();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "c") {
      const node = getSelectedNode();
      if (node) {
        nodeClipboard = JSON.parse(JSON.stringify(node));
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "v") {
      if (!isEditingEnabled() || !nodeClipboard) {
        return;
      }
      const existingIds = new Set(ast.nodes.map((n) => n.id));
      let newId = `${nodeClipboard.id}-copy`;
      let counter = 1;
      while (existingIds.has(newId)) {
        newId = `${nodeClipboard.id}-copy-${counter++}`;
      }
      const newNode = createBmapNode({
        ...nodeClipboard,
        id: newId,
        pos: {
          x: snapValue(nodeClipboard.pos.x + snapStep * 2, snapStep),
          y: snapValue(nodeClipboard.pos.y + snapStep * 2, snapStep),
        },
      });
      ast.nodes.push(newNode);
      selected = { type: "node", id: newNode.id };
      renderScene();
      commitAst("bmap:paste-node");
    }
  }

  function startGesture(nextGesture) {
    stopGesture(false);
    gesture = nextGesture;
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerCancel);
  }

  function stopGesture(shouldRender = true) {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
    gesture = null;
    connectPreview = null;
    if (shouldRender) {
      renderScene();
    }
  }

  function resizeDraftRect(rect, edge, deltaX, deltaY, shape) {
    let nextX = rect.x;
    let nextY = rect.y;
    let nextWidth = rect.width;
    let nextHeight = rect.height;

    if (edge.includes("e")) {
      nextWidth = Math.max(MIN_NODE_SIZE, rect.width + deltaX);
    }
    if (edge.includes("s")) {
      nextHeight = Math.max(MIN_NODE_SIZE, rect.height + deltaY);
    }
    if (edge.includes("w")) {
      nextWidth = Math.max(MIN_NODE_SIZE, rect.width - deltaX);
      nextX = rect.x + (rect.width - nextWidth);
    }
    if (edge.includes("n")) {
      nextHeight = Math.max(MIN_NODE_SIZE, rect.height - deltaY);
      nextY = rect.y + (rect.height - nextHeight);
    }

    if (edge.includes("w") || edge.includes("e")) {
      nextWidth = snapSizeValue(nextWidth, snapStep);
    }
    if (edge.includes("n")) {
      nextY = snapValue(nextY, snapStep);
    }
    if (edge.includes("w")) {
      nextX = snapValue(nextX, snapStep);
    }
    if (edge.includes("n") || edge.includes("s")) {
      nextHeight = snapSizeValue(nextHeight, snapStep);
    }

    return {
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: Math.round(nextWidth),
      height: Math.round(nextHeight),
    };
  }

  function handlePointerMove(event) {
    if (!gesture) {
      return;
    }

    if (gesture.kind === "pan") {
      pan = {
        x: gesture.startPan.x + (event.clientX - gesture.startClient.x),
        y: gesture.startPan.y + (event.clientY - gesture.startClient.y),
      };
      applyViewportTransform();
      return;
    }

    if (gesture.kind === "move-node") {
      const node = getNodeById(gesture.nodeId);
      if (!node) {
        return;
      }
      const deltaX = (event.clientX - gesture.startClient.x) / zoom;
      const deltaY = (event.clientY - gesture.startClient.y) / zoom;
      node.pos.x = snapValue(gesture.startPos.x + deltaX, snapStep);
      node.pos.y = snapValue(gesture.startPos.y + deltaY, snapStep);
      renderScene();
      return;
    }

    if (gesture.kind === "resize-node") {
      const node = getNodeById(gesture.nodeId);
      if (!node) {
        return;
      }
      const deltaX = (event.clientX - gesture.startClient.x) / zoom;
      const deltaY = (event.clientY - gesture.startClient.y) / zoom;
      const nextRect = resizeDraftRect(gesture.startRect, gesture.edge, deltaX, deltaY, node.shape);
      const nextNode = createBmapNode({
        ...node,
        pos: { x: nextRect.x, y: nextRect.y },
        styles: {
          ...node.styles,
          width: String(nextRect.width),
          height: String(nextRect.height)
        }
      });
      const index = ast.nodes.findIndex((item) => item.id === node.id);
      if (index >= 0) {
        ast.nodes[index] = nextNode;
      }
      renderScene();
      return;
    }

    if (gesture.kind === "connect") {
      connectPreview = {
        fromId: gesture.fromId,
        fromSide: gesture.fromSide,
        pointer: clientToWorld(event.clientX, event.clientY)
      };
      renderScene();
    }
  }

  function handlePointerUp(event) {
    if (!gesture) {
      return;
    }
    const finishedGesture = gesture;
    stopGesture(false);

    if (finishedGesture.kind === "move-node") {
      renderScene();
      commitAst("bmap:move-node");
      return;
    }

    if (finishedGesture.kind === "resize-node") {
      renderScene();
      commitAst("bmap:resize-node");
      return;
    }

    if (finishedGesture.kind === "connect") {
      const snapEl = event.target.closest?.(".bmap-snap[data-node-id][data-side-index]");
      if (snapEl) {
        const toNodeId = snapEl.dataset.nodeId;
        const toSideIndex = normalizeSideIndex(snapEl.dataset.sideIndex);
        const nextConnector = createBmapConnector({
          from: formatEndpoint(finishedGesture.fromId, finishedGesture.fromSide),
          to: formatEndpoint(toNodeId, toSideIndex)
        });
        if (nextConnector.from !== nextConnector.to) {
          ast.connectors.push(nextConnector);
          selected = { type: "connector", index: ast.connectors.length - 1 };
          renderScene();
          commitAst("bmap:add-connector");
          return;
        }
      }
      renderScene();
    }
  }

  function handlePointerCancel() {
    stopGesture(true);
  }

  function startPan(event) {
    startGesture({
      kind: "pan",
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...pan }
    });
  }

  function startNodeMove(nodeId, event) {
    if (!isEditingEnabled()) {
      return;
    }
    const node = getNodeById(nodeId);
    if (!node) {
      return;
    }
    selected = { type: "node", id: nodeId };
    startGesture({
      kind: "move-node",
      nodeId,
      startClient: { x: event.clientX, y: event.clientY },
      startPos: { ...node.pos }
    });
    renderScene();
  }

  function startNodeResize(nodeId, edge, event) {
    if (!isEditingEnabled()) {
      return;
    }
    const node = getNodeById(nodeId);
    if (!node) {
      return;
    }
    selected = { type: "node", id: nodeId };
    startGesture({
      kind: "resize-node",
      nodeId,
      edge,
      startClient: { x: event.clientX, y: event.clientY },
      startRect: getNodeRect(node)
    });
    renderScene();
  }

  function startConnector(nodeId, sideIndex, event) {
    if (!isEditingEnabled()) {
      return;
    }
    selected = { type: "node", id: nodeId };
    connectPreview = {
      fromId: nodeId,
      fromSide: sideIndex,
      pointer: clientToWorld(event.clientX, event.clientY)
    };
    startGesture({
      kind: "connect",
      fromId: nodeId,
      fromSide: sideIndex
    });
    renderScene();
  }

  function createArrowMarker(id, color) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("viewBox", "0 0 12 12");
    marker.setAttribute("refX", "11");
    marker.setAttribute("refY", "6");
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "8");
    marker.setAttribute("markerUnits", "strokeWidth");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L 12 6 L 0 12 z");
    path.setAttribute("fill", color);
    marker.append(path);
    return marker;
  }

  function buildToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "bmap-toolbar";

    const left = document.createElement("div");
    left.className = "bmap-toolbar-group";
    left.append(
      makeToolbarButton("Add Rect", "Add a rectangular node", () => addNode("rect"), !isEditingEnabled()),
      makeToolbarButton("Add Oval", "Add an oval node", () => addNode("circle"), !isEditingEnabled()),
      makeToolbarButton("Delete", "Delete selected node or connector", deleteSelected, !selected || !isEditingEnabled()),
    );

    const snapField = document.createElement("label");
    snapField.className = "bmap-toolbar-field";
    const snapLabel = document.createElement("span");
    snapLabel.textContent = "Snap";
    const snapSelect = document.createElement("select");
    snapSelect.className = "bmap-toolbar-select";
    SNAP_STEP_OPTIONS.forEach((option) => {
      const optionEl = document.createElement("option");
      optionEl.value = String(option);
      optionEl.textContent = `${option} px`;
      optionEl.selected = option === snapStep;
      snapSelect.append(optionEl);
    });
    snapSelect.addEventListener("change", () => {
      setSnapStep(snapSelect.value);
    });
    snapField.append(snapLabel, snapSelect);

    const status = document.createElement("div");
    status.className = "bmap-toolbar-status";
    status.textContent = selected?.type === "node"
      ? `Selected node: ${selected.id}`
      : selected?.type === "connector"
        ? `Selected connector ${selected.index + 1}`
        : `Snap ${snapStep}\u00D7${snapStep}`;

    toolbar.append(left, snapField, status);
    return toolbar;
  }

  function buildNodeInspector(node) {
    const availableFiles = activeOptions.listProjectFiles?.() ?? [];
    const { width, height } = getBmapNodeDimensions(node);
    const isReadOnly = !isEditingEnabled();
    const minSize = snapSizeValue(MIN_NODE_SIZE, snapStep);
    const fileOptions = [
      '<option value="">No linked file</option>',
      ...availableFiles.map((entry) => {
        const isSelected = entry.path === node.file;
        const prefix = entry.kind === "image" ? "[Image] " : "";
        return `<option value="${escapeHtml(entry.path)}"${isSelected ? " selected" : ""}>${escapeHtml(prefix + entry.label)}</option>`;
      })
    ].join("");

    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    const snappedWidth = snapSizeValue(width, snapStep);
    const snappedHeight = snapSizeValue(height, snapStep);
    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>Node</h3>
        <div class="subtle-label">${escapeHtml(node.id)}</div>
      </div>
      ${isReadOnly ? '<div class="bmap-inspector-note">Read-only mode is on. Switch back to editing to modify this node.</div>' : ""}
      <form class="bmap-inspector-form" novalidate>
        <fieldset class="bmap-inspector-fieldset"${isReadOnly ? " disabled" : ""}>
        <label class="bmap-field">
          <span>Name</span>
          <input name="name" type="text" value="${escapeHtml(node.name)}">
        </label>
        <label class="bmap-field">
          <span>Text</span>
          <textarea name="text" rows="4">${escapeHtml(node.text)}</textarea>
        </label>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Shape</span>
            <select name="shape">
              <option value="rect"${node.shape === "rect" ? " selected" : ""}>Rectangle</option>
              <option value="circle"${node.shape === "circle" ? " selected" : ""}>Oval</option>
            </select>
          </label>
          <label class="bmap-field">
            <span>Linked file</span>
            <select name="file">${fileOptions}</select>
          </label>
        </div>
        <div class="bmap-field">
          <span>Link via drop</span>
          <div class="bmap-file-dropzone${node.file ? " has-file" : ""}"${node.file ? ` title="${escapeHtml(node.file)}"` : ""}>
            <span class="bmap-file-dropzone-label">${node.file ? escapeHtml(node.file) : "Drag a file here from the Explorer"}</span>
            ${node.file ? '<button type="button" class="bmap-file-dropzone-clear" aria-label="Clear linked file">\u2715</button>' : ''}
          </div>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>X</span>
            <input name="x" type="number" step="${snapStep}" value="${node.pos.x}">
          </label>
          <label class="bmap-field">
            <span>Y</span>
            <input name="y" type="number" step="${snapStep}" value="${node.pos.y}">
          </label>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Width</span>
            <input name="width" type="number" step="${snapStep}" min="${minSize}" value="${snappedWidth}">
          </label>
          <label class="bmap-field">
            <span>Height</span>
            <input name="height" type="number" step="${snapStep}" min="${minSize}" value="${snappedHeight}">
          </label>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Background</span>
            <input name="background" type="text" value="${escapeHtml(getNodeStyleValue(node, "background", ""))}">
          </label>
          <label class="bmap-field">
            <span>Border</span>
            <input name="border" type="text" value="${escapeHtml(getNodeStyleValue(node, "border", ""))}">
          </label>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Text color</span>
            <input name="color" type="text" value="${escapeHtml(getNodeStyleValue(node, "color", ""))}">
          </label>
          <label class="bmap-field">
            <span>Opacity</span>
            <input name="opacity" type="text" value="${escapeHtml(getNodeStyleValue(node, "opacity", ""))}">
          </label>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Radius</span>
            <input name="borderRadius" type="number" step="1" min="0" value="${getPixelStyleValue(node, "border-radius", node.shape === "circle" ? Math.round(Math.min(width, height) / 2) : 8)}">
          </label>
          <label class="bmap-field">
            <span>Font size</span>
            <input name="fontSize" type="number" step="1" min="8" value="${getPixelStyleValue(node, "font-size", 12)}">
          </label>
        </div>
        <label class="bmap-field">
          <span>Font weight</span>
          <select name="fontWeight">
            <option value="normal"${getNodeStyleValue(node, "font-weight", "normal") === "normal" ? " selected" : ""}>Normal</option>
            <option value="600"${getNodeStyleValue(node, "font-weight", "normal") === "600" ? " selected" : ""}>600</option>
            <option value="bold"${getNodeStyleValue(node, "font-weight", "normal") === "bold" ? " selected" : ""}>Bold</option>
          </select>
        </label>
        <div class="bmap-inspector-actions">
          <button type="button" data-action="delete" class="bmap-danger-btn">Delete Node</button>
        </div>
        </fieldset>
      </form>
    `;

    const form = inspector.querySelector("form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isEditingEnabled()) {
        return;
      }
      const formData = new FormData(form);
      const nextShape = formData.get("shape");
      const nextPosition = snapPoint({
        x: formData.get("x"),
        y: formData.get("y"),
      }, snapStep);
      const nextWidth = snapSizeValue(formData.get("width") ?? width, snapStep);
      const nextHeight = snapSizeValue(formData.get("height") ?? height, snapStep);
      const nextNode = createBmapNode({
        ...node,
        name: formData.get("name"),
        text: formData.get("text"),
        shape: nextShape,
        pos: {
          x: nextPosition.x,
          y: nextPosition.y,
        },
        file: formData.get("file") || null,
        styles: {
          ...node.styles,
          width: String(nextWidth),
          height: String(nextHeight),
          background: formData.get("background") ?? "",
          border: formData.get("border") ?? "",
          color: formData.get("color") ?? "",
          opacity: formData.get("opacity") ?? "",
          "border-radius": `${Math.max(0, Number.parseInt(String(formData.get("borderRadius") ?? 0), 10) || 0)}px`,
          "font-size": `${Math.max(8, Number.parseInt(String(formData.get("fontSize") ?? 12), 10) || 12)}px`,
          "font-weight": formData.get("fontWeight") ?? "normal",
        }
      });
      const index = ast.nodes.findIndex((item) => item.id === node.id);
      if (index >= 0) {
        ast.nodes[index] = nextNode;
      }
      selected = { type: "node", id: nextNode.id };
      renderScene();
      commitAst("bmap:update-node-from-inspector");
    });

    form.addEventListener("change", () => {
      if (isEditingEnabled()) {
        form.requestSubmit();
      }
    });

    if (!isReadOnly) {
      const fileDropzone = inspector.querySelector(".bmap-file-dropzone");
      const fileSelectEl = inspector.querySelector("[name='file']");

      const refreshDropzoneDisplay = (path) => {
        const label = fileDropzone.querySelector(".bmap-file-dropzone-label");
        if (path) {
          label.textContent = path;
          fileDropzone.title = path;
          fileDropzone.classList.add("has-file");
          if (!fileDropzone.querySelector(".bmap-file-dropzone-clear")) {
            const clearBtn = document.createElement("button");
            clearBtn.type = "button";
            clearBtn.className = "bmap-file-dropzone-clear";
            clearBtn.setAttribute("aria-label", "Clear linked file");
            clearBtn.textContent = "\u2715";
            clearBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              fileSelectEl.value = "";
              fileSelectEl.dispatchEvent(new Event("change", { bubbles: true }));
              refreshDropzoneDisplay("");
            });
            fileDropzone.append(clearBtn);
          }
        } else {
          label.textContent = "Drag a file here from the Explorer";
          fileDropzone.title = "";
          fileDropzone.classList.remove("has-file");
          fileDropzone.querySelector(".bmap-file-dropzone-clear")?.remove();
        }
      };

      fileDropzone.querySelector(".bmap-file-dropzone-clear")?.addEventListener("click", (e) => {
        e.stopPropagation();
        fileSelectEl.value = "";
        fileSelectEl.dispatchEvent(new Event("change", { bubbles: true }));
        refreshDropzoneDisplay("");
      });

      fileDropzone.addEventListener("dragover", (event) => {
        if (!event.dataTransfer?.types.includes("text/mdnotes-file-id")) {
          return;
        }
        event.preventDefault();
        fileDropzone.classList.add("is-drag-over");
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "link";
        }
      });

      fileDropzone.addEventListener("dragleave", () => {
        fileDropzone.classList.remove("is-drag-over");
      });

      fileDropzone.addEventListener("drop", (event) => {
        fileDropzone.classList.remove("is-drag-over");
        if (!event.dataTransfer?.types.includes("text/mdnotes-file-id")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const fileId = event.dataTransfer.getData("text/mdnotes-file-id");
        if (!fileId) {
          return;
        }
        const relativePath = activeOptions.resolveRelativeFilePath?.(fileId);
        if (!relativePath) {
          return;
        }
        const existingOpt = Array.from(fileSelectEl.options).find((o) => o.value === relativePath);
        if (!existingOpt) {
          const newOpt = document.createElement("option");
          newOpt.value = relativePath;
          newOpt.textContent = relativePath;
          fileSelectEl.append(newOpt);
        }
        fileSelectEl.value = relativePath;
        fileSelectEl.dispatchEvent(new Event("change", { bubbles: true }));
        refreshDropzoneDisplay(relativePath);
      });
    }

    inspector.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        deleteSelected();
      }
    });

    return inspector;
  }

  function buildConnectorInspector(connector, index) {
    const isReadOnly = !isEditingEnabled();
    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>Connector</h3>
        <div class="subtle-label">${escapeHtml(connector.from)} → ${escapeHtml(connector.to)}</div>
      </div>
      ${isReadOnly ? '<div class="bmap-inspector-note">Read-only mode is on. Switch back to editing to modify this connector.</div>' : ""}
      <form class="bmap-inspector-form" novalidate>
        <fieldset class="bmap-inspector-fieldset"${isReadOnly ? " disabled" : ""}>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Mode</span>
            <select name="mode">
              <option value="bezier"${connector.styles?.mode === "bezier" ? " selected" : ""}>Bezier</option>
              <option value="straight"${connector.styles?.mode === "straight" ? " selected" : ""}>Straight</option>
            </select>
          </label>
          <label class="bmap-field">
            <span>Arrow</span>
            <select name="arrow">
              <option value="end"${connector.styles?.arrow === "end" ? " selected" : ""}>End</option>
              <option value="start"${connector.styles?.arrow === "start" ? " selected" : ""}>Start</option>
              <option value="both"${connector.styles?.arrow === "both" ? " selected" : ""}>Both</option>
              <option value="none"${connector.styles?.arrow === "none" ? " selected" : ""}>None</option>
            </select>
          </label>
        </div>
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Thickness</span>
            <input name="thickness" type="number" min="1" step="1" value="${Number.parseInt(String(connector.styles?.thickness ?? 2), 10) || 2}">
          </label>
          <label class="bmap-field">
            <span>Color</span>
            <input name="color" type="text" value="${escapeHtml(String(connector.styles?.color ?? "#1677ff"))}">
          </label>
        </div>
        <label class="bmap-field bmap-checkbox-field">
          <input name="dashed" type="checkbox"${connector.styles?.dashed ? " checked" : ""}>
          <span>Dashed</span>
        </label>
        <div class="bmap-inspector-actions">
          <button type="button" data-action="delete" class="bmap-danger-btn">Delete Connector</button>
        </div>
        </fieldset>
      </form>
    `;

    const form = inspector.querySelector("form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!isEditingEnabled()) {
        return;
      }
      const formData = new FormData(form);
      ast.connectors[index] = createBmapConnector({
        ...connector,
        styles: {
          ...connector.styles,
          mode: formData.get("mode"),
          arrow: formData.get("arrow"),
          thickness: formData.get("thickness"),
          color: formData.get("color"),
          dashed: formData.get("dashed") === "on",
        }
      });
      selected = { type: "connector", index };
      renderScene();
      commitAst("bmap:update-connector-from-inspector");
    });

    form.addEventListener("change", () => {
      if (isEditingEnabled()) {
        form.requestSubmit();
      }
    });

    inspector.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        deleteSelected();
      }
    });

    return inspector;
  }

  function buildEmptyInspector() {
    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>${isEditingEnabled() ? "Edit Mode" : "Read Only"}</h3>
      </div>
      <div class="bmap-inspector-empty">
        <p>${isEditingEnabled() ? "Select a node or connector to edit it here." : "Selection details stay visible here, but editing is disabled until you switch back to Editing mode."}</p>
        <ul>
          <li>${isEditingEnabled() ? `Drag a node to move it on the ${snapStep}x${snapStep} grid.` : "Pan and zoom the canvas without changing the diagram."}</li>
          <li>${isEditingEnabled() ? "Drag an edge handle to resize it." : `The current snap grid is ${snapStep}x${snapStep}.`}</li>
          <li>${isEditingEnabled() ? "Drag from a snap point to create a connection." : "Use the toolbar toggle to return to editing mode."}</li>
          <li>${isEditingEnabled() ? "Drop a file from Explorer onto a node to link it." : "Linked files can still be opened from the node actions."}</li>
        </ul>
      </div>
    `;
    if (ast.parseErrors.length > 0) {
      const errorBox = document.createElement("div");
      errorBox.className = "bmap-parse-errors";
      errorBox.innerHTML = ast.parseErrors
        .map((error) => `<div class="bmap-parse-error">${escapeHtml(error)}</div>`)
        .join("");
      inspector.append(errorBox);
    }
    return inspector;
  }

  function buildInspector() {
    let inspector;
    const selectedNode = getSelectedNode();
    if (selectedNode) {
      inspector = buildNodeInspector(selectedNode);
    } else {
      const selectedConnector = getSelectedConnector();
      if (selectedConnector) {
        inspector = buildConnectorInspector(selectedConnector, selected.index);
      } else {
        inspector = buildEmptyInspector();
      }
    }

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "bmap-inspector-collapse-btn";
    collapseBtn.title = inspectorCollapsed ? "Show inspector" : "Collapse inspector";
    collapseBtn.textContent = inspectorCollapsed ? "\u2039" : "\u203A";
    collapseBtn.setAttribute("aria-expanded", String(!inspectorCollapsed));
    collapseBtn.addEventListener("click", toggleInspectorCollapsed);

    const body = document.createElement("div");
    body.className = "bmap-inspector-body";
    while (inspector.firstChild) {
      body.append(inspector.firstChild);
    }

    inspector.append(collapseBtn, body);
    inspector.classList.toggle("is-collapsed", inspectorCollapsed);
    return inspector;
  }

  function makeToolbarButton(label, title, onClick, disabled = false, active = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bmap-toolbar-btn";
    button.textContent = label;
    button.title = title;
    button.disabled = disabled;
    button.classList.toggle("is-active", active);
    button.addEventListener("click", onClick);
    return button;
  }

  function makeControlButton(label, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bmap-control-btn";
    button.textContent = label;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  function renderScene() {
    ensureSelectionStillExists();
    container.replaceChildren();

    const root = document.createElement("div");
    root.className = "bmap-editor";
    root.classList.toggle("is-readonly", !isEditingEnabled());

    const toolbar = buildToolbar();
    const workspace = document.createElement("div");
    workspace.className = "bmap-workspace";
    workspace.classList.toggle("is-inspector-collapsed", inspectorCollapsed);

    const stage = document.createElement("div");
    stage.className = "bmap-stage";

    const canvas = document.createElement("div");
    canvas.className = "bmap-canvas";
    canvas.tabIndex = 0;
    canvasEl = canvas;

    const inner = document.createElement("div");
    inner.className = "bmap-inner";
    innerEl = inner;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("bmap-connectors-svg");
    svg.setAttribute("overflow", "visible");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.append(defs);

    const nodesLayer = document.createElement("div");
    nodesLayer.className = "bmap-nodes-layer";

    inner.append(svg, nodesLayer);

    const controls = document.createElement("div");
    controls.className = "bmap-controls";
    const penBtn = makeControlButton("✏", isEditingEnabled() ? "Switch to read-only mode" : "Switch to editing mode", () => {
      setInteractionMode(isEditingEnabled() ? "readonly" : "edit");
    });
    if (isEditingEnabled()) {
      penBtn.classList.add("is-active");
    }
    controls.append(
      penBtn,
      makeControlButton("+", "Zoom in", () => {
        zoom = clamp(zoom + ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
        applyViewportTransform();
      }),
      makeControlButton("−", "Zoom out", () => {
        zoom = clamp(zoom - ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
        applyViewportTransform();
      }),
      makeControlButton("⊡", "Reset view", () => {
        pan = { x: 40, y: 40 };
        zoom = 1;
        applyViewportTransform();
      }),
    );

    const nodeMap = new Map(ast.nodes.map((node) => [node.id, node]));
    const markerIds = new Set();

    ast.connectors.forEach((connector, index) => {
      const pathData = buildConnectorPath(connector, nodeMap);
      if (!pathData) {
        return;
      }
      const color = String(connector.styles?.color ?? "#1677ff");
      const thickness = Math.max(1, Number.parseInt(String(connector.styles?.thickness ?? 2), 10) || 2);
      const dashed = Boolean(connector.styles?.dashed);
      const arrow = String(connector.styles?.arrow ?? "end");
      const markerId = `bmap-arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
      if (!markerIds.has(markerId)) {
        markerIds.add(markerId);
        defs.append(createArrowMarker(markerId, color));
      }

      const visiblePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      visiblePath.setAttribute("d", pathData);
      visiblePath.setAttribute("fill", "none");
      visiblePath.setAttribute("stroke", color);
      visiblePath.setAttribute("stroke-width", String(thickness));
      visiblePath.setAttribute("stroke-linecap", "round");
      visiblePath.classList.add("bmap-connector-path");
      if (dashed) {
        visiblePath.setAttribute("stroke-dasharray", `${thickness * 3} ${thickness * 2}`);
      }
      if (arrow === "end" || arrow === "both") {
        visiblePath.setAttribute("marker-end", `url(#${markerId})`);
      }
      if (arrow === "start" || arrow === "both") {
        visiblePath.setAttribute("marker-start", `url(#${markerId})`);
      }
      if (selected?.type === "connector" && selected.index === index) {
        visiblePath.classList.add("is-selected");
      }

      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.setAttribute("d", pathData);
      hitPath.setAttribute("fill", "none");
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", String(Math.max(thickness + 10, 14)));
      hitPath.classList.add("bmap-connector-hit");
      hitPath.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelection({ type: "connector", index });
      });

      svg.append(visiblePath, hitPath);
    });

    if (connectPreview) {
      const previewConnector = createBmapConnector({
        from: formatEndpoint(connectPreview.fromId, connectPreview.fromSide),
        to: formatEndpoint(connectPreview.fromId, connectPreview.fromSide)
      });
      const previewPath = buildConnectorPath(previewConnector, nodeMap, connectPreview.pointer);
      if (previewPath) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", previewPath);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "var(--accent)");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-dasharray", "8 6");
        path.classList.add("bmap-connector-preview");
        svg.append(path);
      }
    }

    ast.nodes.forEach((node) => {
      const { width, height } = getBmapNodeDimensions(node);
      const nodeEl = document.createElement("div");
      nodeEl.className = `bmap-node bmap-node-${node.shape === "circle" ? "circle" : "rect"}`;
      if (selected?.type === "node" && selected.id === node.id) {
        nodeEl.classList.add("is-selected");
      }
      nodeEl.dataset.nodeId = node.id;
      nodeEl.style.left = `${node.pos.x}px`;
      nodeEl.style.top = `${node.pos.y}px`;
      nodeEl.style.width = `${width}px`;
      nodeEl.style.height = `${height}px`;

      for (const [key, value] of Object.entries(node.styles ?? {})) {
        if ((key === "width") || (key === "height")) {
          continue;
        }
        if (SAFE_STYLE_PROPS.has(key)) {
          nodeEl.style.setProperty(key, String(value));
        }
      }
      if (node.shape === "circle") {
        nodeEl.style.borderRadius = "50%";
      }

      nodeEl.addEventListener("click", (event) => {
        event.stopPropagation();
        setSelection({ type: "node", id: node.id });
      });

      nodeEl.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
          return;
        }
        if (!isEditingEnabled()) {
          return;
        }
        if (event.target.closest(".bmap-node-action, .bmap-resize-handle, .bmap-snap")) {
          return;
        }
        event.stopPropagation();
        startNodeMove(node.id, event);
      });

      nodeEl.addEventListener("dragover", (event) => {
        if (!isEditingEnabled()) {
          return;
        }
        const types = event.dataTransfer?.types ?? [];
        if (!types.includes("text/mdnotes-file-id")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        nodeEl.classList.add("is-link-drop");
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "copy";
        }
      });
      nodeEl.addEventListener("dragleave", () => {
        nodeEl.classList.remove("is-link-drop");
      });
      nodeEl.addEventListener("drop", (event) => {
        if (!isEditingEnabled()) {
          return;
        }
        nodeEl.classList.remove("is-link-drop");
        const fileId = event.dataTransfer?.getData("text/mdnotes-file-id");
        if (!fileId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const relativePath = activeOptions.resolveRelativeFilePath?.(fileId);
        if (!relativePath) {
          return;
        }
        const index = ast.nodes.findIndex((item) => item.id === node.id);
        if (index < 0) {
          return;
        }
        ast.nodes[index] = createBmapNode({
          ...node,
          file: relativePath,
        });
        selected = { type: "node", id: node.id };
        renderScene();
        commitAst("bmap:link-file-drop");
      });

      if (isEditingEnabled()) {
        for (let sideIndex = 0; sideIndex < 4; sideIndex += 1) {
          const snap = document.createElement("button");
          snap.type = "button";
          snap.className = `bmap-snap bmap-snap-${sideIndex}`;
          snap.dataset.nodeId = node.id;
          snap.dataset.sideIndex = String(sideIndex);
          snap.title = `Drag to create connection (${snapStep} px snap)`;
          snap.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            startConnector(node.id, sideIndex, event);
          });
          nodeEl.append(snap);
        }
      }

      if (isEditingEnabled()) {
        ["nw", "ne", "sw", "se"].forEach((edge) => {
          const handle = document.createElement("div");
          handle.className = `bmap-resize-handle bmap-resize-${edge}`;
          handle.dataset.edge = edge;
          handle.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            startNodeResize(node.id, edge, event);
          });
          nodeEl.append(handle);
        });
      }

      const header = document.createElement("div");
      header.className = "bmap-node-header";
      const nameEl = document.createElement("span");
      nameEl.className = "bmap-node-name";
      nameEl.textContent = node.name || node.id;
      header.append(nameEl);

      if (node.file) {
        const fileChip = document.createElement("span");
        fileChip.className = "bmap-node-link-chip";
        fileChip.textContent = node.file;
        fileChip.title = node.file;
        header.append(fileChip);
      }

      const actions = document.createElement("div");
      actions.className = "bmap-node-actions";
      if (node.file) {
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "bmap-node-action";
        openBtn.title = `Open ${node.file}`;
        openBtn.textContent = "↗";
        openBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          activeOptions.onOpenLinkedFile?.(node.file);
        });

        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "bmap-node-action";
        previewBtn.title = "Preview linked file";
        previewBtn.textContent = "⊞";
        previewBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const content = activeOptions.resolveFileContent?.(node.file) ?? null;
          showBmapFilePopup(previewBtn, node.file, content);
        });

        actions.append(openBtn, previewBtn);
      }
      header.append(actions);

      const contentEl = document.createElement("div");
      contentEl.className = "bmap-node-content";
      contentEl.append(header);

      const textEl = document.createElement("div");
      textEl.className = "bmap-node-text";
      textEl.textContent = node.text;
      contentEl.append(textEl);

      nodeEl.append(contentEl);
      nodesLayer.append(nodeEl);
    });

    canvas.append(inner, controls);
    stage.append(canvas);
    workspace.append(stage, buildInspector());
    root.append(toolbar, workspace);
    container.append(root);

    canvas.addEventListener("click", (event) => {
      if (event.target === canvas || event.target === inner || event.target === svg || event.target === nodesLayer) {
        setSelection(null);
      }
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target !== canvas && event.target !== inner && event.target !== svg && event.target !== nodesLayer) {
        return;
      }
      startPan(event);
    });

    workspace.addEventListener("keydown", (event) => {
      if (event.target.closest("form")) {
        return;
      }
      handleCanvasKeydown(event);
    });

    canvas.addEventListener("wheel", (event) => {
      const previousZoom = zoom;
      zoom = clamp(zoom + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP), MIN_ZOOM, MAX_ZOOM);
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      pan.x = mouseX - ((mouseX - pan.x) * (zoom / previousZoom));
      pan.y = mouseY - ((mouseY - pan.y) * (zoom / previousZoom));
      applyViewportTransform();
    }, { passive: false });

    applyViewportTransform();
  }

  function render(sourceOrOptions = "") {
    if (typeof sourceOrOptions === "string") {
      setActiveOptions(defaultOptions);
      sourceText = sourceOrOptions;
    } else {
      setActiveOptions(sourceOrOptions);
      const nextDocumentKey = sourceOrOptions.documentKey ?? null;
      if (nextDocumentKey !== currentDocumentKey) {
        currentDocumentKey = nextDocumentKey;
        selected = null;
        connectPreview = null;
        stopGesture(false);
        pan = { x: 40, y: 40 };
        zoom = 1;
        setPopupHidden();
      }
      sourceText = String(sourceOrOptions.source ?? "");
    }
    ast = normalizeBmapAst(parseBmap(sourceText));
    ensureSelectionStillExists();
    renderScene();
  }

  return { render };
}

export { createBmapView };
