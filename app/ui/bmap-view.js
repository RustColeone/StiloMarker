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

// Default ink for node name/body text. Node boxes are always light, so this is a
// fixed neutral near-black (not a theme variable) shared by the live preview,
// the SVG export, and the inspector's color-picker defaults so they all agree.
const BMAP_DEFAULT_INK = "#1a1a1a";

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

/** Parse a CSS border shorthand ("1px dashed #e8b339") into width/style/color. */
function parseBmapBorder(border, fallbackColor = "#cccccc") {
  const value = String(border ?? "");
  const widthMatch = value.match(/(\d+(?:\.\d+)?)px/);
  const colorMatch = value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/);
  const styleMatch = value.match(/\b(solid|dashed|dotted|double|none)\b/i);
  const style = styleMatch ? styleMatch[1].toLowerCase() : "solid";
  const explicitlyNone = style === "none" || /\bnone\b/i.test(value);
  return {
    width: explicitlyNone ? 0 : (widthMatch ? Number(widthMatch[1]) : 1),
    color: colorMatch ? colorMatch[0] : fallbackColor,
    style,
  };
}

/** Compose a border shorthand from structured parts (or "none" when disabled). */
function composeBmapBorder({ enabled = true, width = 1, style = "solid", color = "#cccccc" }) {
  if (!enabled || style === "none") {
    return "none";
  }
  return `${Math.max(1, Number(width) || 1)}px ${style} ${color}`;
}

/**
 * Tokenize a single line of text into inline-markdown segments. Supports
 * **bold**, *italic* / _italic_, and `code`. Returns [{ text, bold, italic,
 * code }]. Shared by the SVG exporter; the live preview reuses renderMarkdown.
 */
function parseInlineSegments(text) {
  const segments = [];
  const pattern = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|`([^`]+)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), bold: false, italic: false, code: false });
    }
    if (match[2] !== undefined || match[3] !== undefined) {
      segments.push({ text: match[2] ?? match[3], bold: true, italic: false, code: false });
    } else if (match[4] !== undefined || match[5] !== undefined) {
      segments.push({ text: match[4] ?? match[5], bold: false, italic: true, code: false });
    } else if (match[6] !== undefined) {
      segments.push({ text: match[6], bold: false, italic: false, code: true });
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), bold: false, italic: false, code: false });
  }
  return segments;
}

/** Word-wrap inline-markdown text into lines of styled word-tokens for SVG. */
function wrapStyledText(text, maxChars) {
  const lines = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    const words = [];
    for (const seg of parseInlineSegments(paragraph)) {
      for (const piece of seg.text.split(/(\s+)/)) {
        if (piece === "") continue;
        words.push({ text: piece, bold: seg.bold, italic: seg.italic, code: seg.code, space: /^\s+$/.test(piece) });
      }
    }
    let line = [];
    let len = 0;
    for (const word of words) {
      if (word.space && len === 0) continue; // drop leading space
      if (!word.space && len + word.text.length > maxChars && len > 0) {
        while (line.length && line[line.length - 1].space) len -= line.pop().text.length;
        lines.push(line);
        line = [];
        len = 0;
      }
      line.push(word);
      len += word.text.length;
    }
    while (line.length && line[line.length - 1].space) line.pop();
    if (line.length) lines.push(line);
  }
  return lines;
}

/** Serialize one wrapped line (array of styled word-tokens) to SVG <tspan>s. */
function styledLineToTspans(line) {
  return line
    .map((word) => {
      const attrs = [];
      if (word.bold) attrs.push('font-weight="700"');
      if (word.italic) attrs.push('font-style="italic"');
      if (word.code) attrs.push('font-family="ui-monospace, SFMono-Regular, monospace"', 'fill="#b91c1c"');
      const prefix = attrs.length ? " " + attrs.join(" ") : "";
      return `<tspan${prefix}>${escapeHtml(word.text)}</tspan>`;
    })
    .join("");
}

/** Naive word-wrap for SVG <text> (no native wrapping). Honors explicit
 *  newlines, then greedily wraps each paragraph to maxChars per line. */
function wrapSvgText(text, maxChars) {
  const lines = [];
  for (const paragraph of String(text ?? "").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      continue;
    }
    let line = "";
    for (const word of words) {
      if (!line) {
        line = word;
      } else if ((line + " " + word).length <= maxChars) {
        line += " " + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Render a .bmap AST to a standalone, self-contained SVG string.
 *
 * The live editor draws nodes as HTML divs over an SVG connector overlay, so the
 * on-screen DOM can't be serialized directly. This re-renders the same geometry
 * (shared helpers: getNodeRect / buildConnectorPath) as pure SVG so it can be
 * saved as .svg or rasterized to PNG/JPG. No background is drawn — callers add
 * one when a non-transparent format (JPG) needs it.
 */
function renderBmapToSvg(ast, { padding = 60 } = {}) {
  const nodes = ast?.nodes ?? [];
  const connectors = ast?.connectors ?? [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const rect = getNodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 200;
    maxY = 120;
  }
  const offsetX = padding - minX;
  const offsetY = padding - minY;
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY - minY + padding * 2);

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  // One arrow marker per distinct connector color.
  const markers = new Map();
  for (const connector of connectors) {
    const color = String(connector.styles?.color ?? "#1677ff");
    markers.set(`arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`, color);
  }
  out.push("<defs>");
  for (const [id, color] of markers) {
    out.push(`<marker id="${id}" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="8" markerHeight="8" markerUnits="strokeWidth" orient="auto-start-reverse"><path d="M 0 0 L 12 6 L 0 12 z" fill="${color}"/></marker>`);
  }
  out.push("</defs>");

  out.push(`<g transform="translate(${offsetX} ${offsetY})">`);

  for (const connector of connectors) {
    const pathData = buildConnectorPath(connector, nodeMap);
    if (!pathData) {
      continue;
    }
    const color = String(connector.styles?.color ?? "#1677ff");
    const thickness = Math.max(1, Number.parseInt(String(connector.styles?.thickness ?? 2), 10) || 2);
    const markerId = `arrow-${color.replace(/[^a-zA-Z0-9]/g, "")}`;
    const arrow = String(connector.styles?.arrow ?? "end");
    const dash = connector.styles?.dashed ? ` stroke-dasharray="${thickness * 3} ${thickness * 2}"` : "";
    const markerEnd = arrow === "end" || arrow === "both" ? ` marker-end="url(#${markerId})"` : "";
    const markerStart = arrow === "start" || arrow === "both" ? ` marker-start="url(#${markerId})"` : "";
    out.push(`<path d="${pathData}" fill="none" stroke="${color}" stroke-width="${thickness}" stroke-linecap="round"${dash}${markerEnd}${markerStart}/>`);
  }

  const FONT_FAMILY = "system-ui, -apple-system, sans-serif";
  for (const node of nodes) {
    const rect = getNodeRect(node);
    const styles = node.styles ?? {};
    const isCircle = node.shape === "circle";
    const background = String(styles.background ?? styles["background-color"] ?? (isCircle ? "#f0fff4" : "#fffbe6"));
    const border = parseBmapBorder(styles.border, isCircle ? "#3dba72" : "#e8b339");
    const textColor = String(styles.color ?? BMAP_DEFAULT_INK);
    const nameColor = String(styles["name-color"] ?? BMAP_DEFAULT_INK);
    const opacity = styles.opacity ? ` opacity="${escapeHtml(String(styles.opacity))}"` : "";

    // Border: honor width/style (dashed/dotted) — the on-screen node uses a CSS
    // border, so the export must mirror it or it "won't match the bmap file".
    let strokeAttrs = `stroke="none"`;
    if (border.width > 0 && border.style !== "none") {
      strokeAttrs = `stroke="${border.color}" stroke-width="${border.width}"`;
      if (border.style === "dashed") strokeAttrs += ` stroke-dasharray="${border.width * 3} ${border.width * 2}"`;
      else if (border.style === "dotted") strokeAttrs += ` stroke-dasharray="${border.width} ${border.width * 2}" stroke-linecap="round"`;
    }

    out.push(`<g transform="translate(${rect.x} ${rect.y})"${opacity}>`);
    if (isCircle) {
      out.push(`<ellipse cx="${rect.width / 2}" cy="${rect.height / 2}" rx="${rect.width / 2}" ry="${rect.height / 2}" fill="${background}" ${strokeAttrs}/>`);
    } else {
      const radius = Number.parseInt(String(styles["border-radius"] ?? "8"), 10) || 0;
      out.push(`<rect width="${rect.width}" height="${rect.height}" rx="${radius}" ry="${radius}" fill="${background}" ${strokeAttrs}/>`);
    }

    const padX = 12;
    let cursorY = 22;
    const nameSize = 13;
    const bodySize = Number.parseInt(String(styles["font-size"] ?? "12"), 10) || 12;
    // Mirror the node's chosen text alignment (defaults by shape).
    const align = getBmapTextAlign(node);
    let textX = padX;
    let anchorAttr = "";
    if (align === "center") {
      textX = rect.width / 2;
      anchorAttr = ` text-anchor="middle"`;
    } else if (align === "right") {
      textX = rect.width - padX;
      anchorAttr = ` text-anchor="end"`;
    }
    const nameChars = Math.max(6, Math.floor((rect.width - padX * 2) / (nameSize * 0.55)));
    for (const line of wrapSvgText(node.name || node.id, nameChars)) {
      out.push(`<text x="${textX}" y="${cursorY}"${anchorAttr} font-family="${FONT_FAMILY}" font-size="${nameSize}" font-weight="600" fill="${nameColor}">${escapeHtml(line)}</text>`);
      cursorY += nameSize + 4;
    }
    if (node.file) {
      out.push(`<text x="${textX}" y="${cursorY}"${anchorAttr} font-family="${FONT_FAMILY}" font-size="10" fill="#6b7280">${escapeHtml(node.file)}</text>`);
      cursorY += 14;
    }
    if (node.text) {
      cursorY += 4;
      const bodyChars = Math.max(6, Math.floor((rect.width - padX * 2) / (bodySize * 0.55)));
      for (const line of wrapStyledText(node.text, bodyChars)) {
        if (cursorY > rect.height - 6) {
          break;
        }
        out.push(`<text x="${textX}" y="${cursorY}"${anchorAttr} xml:space="preserve" font-family="${FONT_FAMILY}" font-size="${bodySize}" fill="${textColor}">${styledLineToTspans(line)}</text>`);
        cursorY += bodySize + 3;
      }
    }
    out.push("</g>");
  }

  out.push("</g></svg>");
  return out.join("");
}

function getNodeStyleValue(node, key, fallback = "") {
  return String(node?.styles?.[key] ?? fallback ?? "");
}

/**
 * Effective text alignment for a node's name/body. Honors an explicit
 * `text-align` style; otherwise defaults by shape (circles center, rectangles
 * left) so existing diagrams keep looking the same until the user overrides it.
 */
function getBmapTextAlign(node) {
  const value = String(node?.styles?.["text-align"] ?? "").toLowerCase();
  if (value === "left" || value === "center" || value === "right") {
    return value;
  }
  return node?.shape === "circle" ? "center" : "left";
}

function getPixelStyleValue(node, key, fallback) {
  const rawValue = getNodeStyleValue(node, key, "");
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Coerce any color string to a 6-digit hex for an <input type="color">. */
function toHexColor(value, fallback = "#000000") {
  const v = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(v)) return ("#" + v.slice(1).split("").map((c) => c + c).join("")).toLowerCase();
  return fallback;
}

/**
 * Reusable color field: a native picker that doubles as a live swatch preview,
 * paired with a hex text input (the form value). Used for every color-related
 * field across the node and connector inspectors so they stay coherent.
 */
function colorFieldHtml({ label, name, value, fallback = "#000000" }) {
  const hex = toHexColor(value, fallback);
  // A <div> (not <label>) so only the picker itself opens the color dialog —
  // clicking the caption text must not trigger it. The picker carries the form
  // name and doubles as the live swatch preview; its change event bubbles to the
  // form, which re-submits.
  return `
    <div class="bmap-field bmap-color-field">
      <span>${escapeHtml(label)}</span>
      <span class="bmap-color-control">
        <input type="color" name="${name}" class="bmap-color-swatch" value="${hex}" aria-label="${escapeHtml(label)}">
      </span>
    </div>`;
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
  let interactionMode = "readonly";
  let inspectorCollapsed = false;
  let snapStep = MIN_SNAP_STEP;
  let activeOptions = {
    onCommit: null,
    onOpenLinkedFile: null,
    onQuickGenerate: null,
    resolveFileContent: null,
    listProjectFiles: () => [],
    resolveRelativeFilePath: () => null,
    generateScope: "connected",
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

  const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;

  function getConnectedNodeIds(nodeId) {
    const ids = new Set();
    for (const connector of ast.connectors) {
      const from = parseEndpoint(connector.from);
      const to = parseEndpoint(connector.to);
      if (from.nodeId === nodeId && to.nodeId && to.nodeId !== nodeId) {
        ids.add(to.nodeId);
      } else if (to.nodeId === nodeId && from.nodeId && from.nodeId !== nodeId) {
        ids.add(from.nodeId);
      }
    }
    return ids;
  }

  function buildBmapOverview() {
    const lines = ["Nodes:"];
    for (const node of ast.nodes) {
      const parts = [`- [${node.id}]`];
      if (node.name) {
        parts.push(node.name);
      }
      if (node.file) {
        parts.push(`(file: ${node.file})`);
      }
      lines.push(parts.join(" "));
      if (node.text) {
        lines.push(`    ${node.text.replace(/\n/g, " ")}`);
      }
    }
    if (ast.connectors.length > 0) {
      lines.push("", "Connections:");
      for (const connector of ast.connectors) {
        const from = parseEndpoint(connector.from);
        const to = parseEndpoint(connector.to);
        lines.push(`- ${from.nodeId} -> ${to.nodeId}`);
      }
    }
    return lines.join("\n");
  }

  function collectGenerationContextFiles(node) {
    const scope = String(activeOptions.generateScope ?? "connected").trim().toLowerCase() === "all"
      ? "all"
      : "connected";
    const connectedIds = scope === "connected" ? getConnectedNodeIds(node.id) : null;
    const sourceNodes = scope === "all"
      ? ast.nodes
      : ast.nodes.filter((candidate) => connectedIds.has(candidate.id));

    const seen = new Set();
    const files = [];
    for (const candidate of sourceNodes) {
      const filePath = candidate.file;
      if (!filePath || seen.has(filePath)) {
        continue;
      }
      seen.add(filePath);
      const isImage = IMAGE_EXT_RE.test(filePath);
      const content = isImage ? "" : (activeOptions.resolveFileContent?.(filePath) ?? null);
      if (!isImage && content == null) {
        continue;
      }
      files.push({ path: filePath, kind: isImage ? "image" : "text", content: content ?? "" });
    }
    return files;
  }

  function requestQuickGenerate(node, btn) {
    if (typeof activeOptions.onQuickGenerate !== "function") {
      return;
    }
    const subjectParts = [];
    if (node.name) {
      subjectParts.push(node.name);
    }
    if (node.text) {
      subjectParts.push(node.text);
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating\u2026";
    }
    const promise = activeOptions.onQuickGenerate({
      nodeId: node.id,
      nodeName: node.name,
      nodeText: node.text,
      subject: subjectParts.join("\n\n").trim(),
      bmapOverview: buildBmapOverview(),
      contextFiles: collectGenerationContextFiles(node),
    });
    if (btn && promise instanceof Promise) {
      promise.finally(() => {
        btn.disabled = false;
        btn.textContent = "Quick Generate File";
      });
    }
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
    const rawBorder = getNodeStyleValue(node, "border", "");
    const borderParts = parseBmapBorder(rawBorder, node.shape === "circle" ? "#3dba72" : "#e8b339");
    const borderEnabled = rawBorder ? (borderParts.width > 0 && borderParts.style !== "none") : true;
    const textAlign = getBmapTextAlign(node);
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
          ${colorFieldHtml({ label: "Background", name: "background", value: getNodeStyleValue(node, "background", ""), fallback: node.shape === "circle" ? "#f0fff4" : "#fffbe6" })}
          ${colorFieldHtml({ label: "Text color", name: "color", value: getNodeStyleValue(node, "color", ""), fallback: BMAP_DEFAULT_INK })}
        </div>
        <div class="bmap-field-row">
          ${colorFieldHtml({ label: "Name color", name: "nameColor", value: getNodeStyleValue(node, "name-color", ""), fallback: BMAP_DEFAULT_INK })}
          <label class="bmap-field">
            <span>Opacity</span>
            <input name="opacity" type="number" min="0" max="1" step="0.1" value="${escapeHtml(getNodeStyleValue(node, "opacity", ""))}" placeholder="1">
          </label>
        </div>
        <div class="bmap-style-group">
          <label class="bmap-field bmap-checkbox-field">
            <input name="borderEnabled" type="checkbox"${borderEnabled ? " checked" : ""}>
            <span>Border</span>
          </label>
          <div class="bmap-border-options"${borderEnabled ? "" : " hidden"}>
            ${colorFieldHtml({ label: "Color", name: "borderColor", value: borderParts.color, fallback: node.shape === "circle" ? "#3dba72" : "#e8b339" })}
            <div class="bmap-field-row">
              <label class="bmap-field">
                <span>Thickness</span>
                <input name="borderWidth" type="number" min="1" step="1" value="${Math.max(1, borderParts.width || 1)}">
              </label>
              <label class="bmap-field">
                <span>Style</span>
                <select name="borderStyle">
                  <option value="solid"${borderParts.style === "solid" ? " selected" : ""}>Solid</option>
                  <option value="dashed"${borderParts.style === "dashed" ? " selected" : ""}>Dashed</option>
                  <option value="dotted"${borderParts.style === "dotted" ? " selected" : ""}>Dotted</option>
                </select>
              </label>
            </div>
          </div>
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
        <div class="bmap-field-row">
          <label class="bmap-field">
            <span>Font weight</span>
            <select name="fontWeight">
              <option value="normal"${getNodeStyleValue(node, "font-weight", "normal") === "normal" ? " selected" : ""}>Normal</option>
              <option value="600"${getNodeStyleValue(node, "font-weight", "normal") === "600" ? " selected" : ""}>600</option>
              <option value="bold"${getNodeStyleValue(node, "font-weight", "normal") === "bold" ? " selected" : ""}>Bold</option>
            </select>
          </label>
          <label class="bmap-field">
            <span>Text align</span>
            <select name="textAlign">
              <option value="left"${textAlign === "left" ? " selected" : ""}>Left</option>
              <option value="center"${textAlign === "center" ? " selected" : ""}>Center</option>
              <option value="right"${textAlign === "right" ? " selected" : ""}>Right</option>
            </select>
          </label>
        </div>
        <div class="bmap-inspector-actions">
          <button type="button" data-action="quick-generate" class="bmap-generate-btn">Quick Generate File</button>
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
          border: composeBmapBorder({
            enabled: formData.get("borderEnabled") === "on",
            width: formData.get("borderWidth") ?? 1,
            style: formData.get("borderStyle") ?? "solid",
            color: formData.get("borderColor") ?? "#cccccc",
          }),
          color: formData.get("color") ?? "",
          "name-color": formData.get("nameColor") ?? "",
          opacity: formData.get("opacity") ?? "",
          "border-radius": `${Math.max(0, Number.parseInt(String(formData.get("borderRadius") ?? 0), 10) || 0)}px`,
          "font-size": `${Math.max(8, Number.parseInt(String(formData.get("fontSize") ?? 12), 10) || 12)}px`,
          "font-weight": formData.get("fontWeight") ?? "normal",
          "text-align": formData.get("textAlign") ?? "left",
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

    // Border sub-options only show when the border is enabled.
    const borderToggle = inspector.querySelector('[name="borderEnabled"]');
    const borderOptions = inspector.querySelector(".bmap-border-options");
    borderToggle?.addEventListener("change", () => {
      if (borderOptions) borderOptions.hidden = !borderToggle.checked;
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

    inspector.querySelector('[data-action="quick-generate"]').addEventListener("click", (event) => {
      requestQuickGenerate(getNodeById(node.id) ?? node, event.currentTarget);
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
          ${colorFieldHtml({ label: "Color", name: "color", value: String(connector.styles?.color ?? "#1677ff"), fallback: "#1677ff" })}
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
    // Applying an inspector edit re-renders the whole scene, which rebuilds the
    // inspector and would otherwise reset its scroll to the top mid-edit. Capture
    // and restore the scroll position so the user keeps their place.
    const prevInspectorScroll = container.querySelector(".bmap-inspector-body")?.scrollTop ?? 0;
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
    const penBtn = makeControlButton("🖊️", isEditingEnabled() ? "Switch to read-only mode" : "Switch to editing mode", () => {
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

      const textAlign = getBmapTextAlign(node);

      const header = document.createElement("div");
      header.className = "bmap-node-header";
      const nameEl = document.createElement("span");
      nameEl.className = "bmap-node-name";
      nameEl.textContent = node.name || node.id;
      nameEl.style.textAlign = textAlign;
      if (node.styles?.["name-color"]) {
        nameEl.style.color = String(node.styles["name-color"]);
      }
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
      textEl.style.textAlign = textAlign;
      // Render simple markdown (bold/italic/code/lists) so node bodies are
      // formatted in the preview, mirroring the rest of the app.
      if (node.text) {
        textEl.innerHTML = renderMarkdown(node.text);
      }
      contentEl.append(textEl);

      nodeEl.append(contentEl);
      nodesLayer.append(nodeEl);
    });

    canvas.append(inner, controls);
    stage.append(canvas);
    workspace.append(stage, buildInspector());
    root.append(toolbar, workspace);
    container.append(root);

    if (prevInspectorScroll) {
      const newBody = container.querySelector(".bmap-inspector-body");
      if (newBody) {
        newBody.scrollTop = prevInspectorScroll;
      }
    }

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
        // A freshly opened diagram defaults to read-only (view) mode so the
        // preview pane is not in edit mode until the user opts in via the pen.
        interactionMode = "readonly";
      }
      sourceText = String(sourceOrOptions.source ?? "");
    }
    ast = normalizeBmapAst(parseBmap(sourceText));
    ensureSelectionStillExists();
    renderScene();
  }

  return { render };
}

export { createBmapView, renderBmapToSvg };
