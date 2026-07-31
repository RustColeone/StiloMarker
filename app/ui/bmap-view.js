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

/**
 * Parse a connector endpoint string. Three forms:
 *   "nodeId.side.N"  → anchored to a node side
 *   "@x,y"           → a dangling endpoint pinned at a free coordinate
 *   "nodeId"         → anchored to side 0 (legacy/loose)
 * A dangling endpoint is only ever produced by copy/paste; it lets a connector
 * survive with one (or both) ends detached so the user can re-attach it.
 */
function parseEndpoint(rawValue) {
  const value = String(rawValue ?? "").trim();
  if (value.startsWith("@")) {
    const [rawX, rawY] = value.slice(1).split(",");
    const x = Number.parseFloat(rawX);
    const y = Number.parseFloat(rawY);
    return { dangling: true, point: { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 } };
  }
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

function formatPointEndpoint(point) {
  return `@${Math.round(point?.x ?? 0)},${Math.round(point?.y ?? 0)}`;
}

/** Resolve an endpoint to a world point (and its side, when node-anchored). */
function resolveEndpointPoint(endpoint, nodeMap) {
  if (endpoint.dangling) {
    return { point: endpoint.point, side: null };
  }
  const node = nodeMap.get(endpoint.nodeId);
  if (!node) {
    return null;
  }
  return { point: getSnapPoint(node, endpoint.sideIndex), side: endpoint.sideIndex };
}

/** Closest node side (0..3) to a world point — used when dropping a dragged
 *  connector endpoint anywhere on a node rather than exactly on a snap dot. */
function nearestSide(node, point) {
  let best = 0;
  let bestDistance = Infinity;
  for (let sideIndex = 0; sideIndex < 4; sideIndex += 1) {
    const snap = getSnapPoint(node, sideIndex);
    const distance = Math.hypot(snap.x - point.x, snap.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = sideIndex;
    }
  }
  return best;
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
  const fromResolved = resolveEndpointPoint(fromEndpoint, nodeMap);
  if (!fromResolved) {
    return null;
  }
  const fromPoint = fromResolved.point;
  const styleMode = String(connector.styles?.mode ?? "bezier").trim();

  if (previewPointer) {
    const fromSide = fromResolved.side ?? inferTargetSide(previewPointer, fromPoint);
    const toSide = inferTargetSide(fromPoint, previewPointer);
    return styleMode === "straight"
      ? buildStraightPath(fromPoint, previewPointer)
      : buildBezierPath(fromPoint, fromSide, previewPointer, toSide);
  }

  const toEndpoint = parseEndpoint(connector.to);
  const toResolved = resolveEndpointPoint(toEndpoint, nodeMap);
  if (!toResolved) {
    return null;
  }
  const toPoint = toResolved.point;

  // Dangling ends have no side, so infer one from the opposite point to keep the
  // bezier curving sensibly.
  const fromSide = fromResolved.side ?? inferTargetSide(toPoint, fromPoint);
  const toSide = toResolved.side ?? inferTargetSide(fromPoint, toPoint);
  return styleMode === "straight"
    ? buildStraightPath(fromPoint, toPoint)
    : buildBezierPath(fromPoint, fromSide, toPoint, toSide);
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
  // Connector bezier paths can bulge past the node rects (e.g. two right-sides of
  // vertically stacked nodes). Include every path coordinate in the bounds so the
  // export never crops a drifting connector. A bezier stays within the convex hull
  // of its control points, so the raw path coords are a safe over-approximation.
  const connectorPaths = [];
  for (const connector of connectors) {
    const pathData = buildConnectorPath(connector, nodeMap);
    connectorPaths.push({ connector, pathData });
    if (!pathData) {
      continue;
    }
    const nums = pathData.match(/-?\d+(?:\.\d+)?/g) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = Number(nums[i]);
      const y = Number(nums[i + 1]);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
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

  for (const { connector, pathData } of connectorPaths) {
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
function colorFieldHtml({ label, name, value, fallback = "#000000", mixed = false }) {
  const hex = toHexColor(value, fallback);
  // A <div> (not <label>) so only the picker itself opens the color dialog —
  // clicking the caption text must not trigger it. The picker carries the form
  // name and doubles as the live swatch preview; its change event bubbles to the
  // form, which re-submits. When `mixed` is set (a multi-selection where the
  // chosen nodes disagree), a small badge flags it; picking still applies to all.
  return `
    <div class="bmap-field bmap-color-field">
      <span>${escapeHtml(label)}${mixed ? ' <span class="bmap-mixed-badge">mixed</span>' : ""}</span>
      <span class="bmap-color-control">
        <input type="color" name="${name}" class="bmap-color-swatch" value="${hex}" aria-label="${escapeHtml(label)}">
      </span>
    </div>`;
}

/** Common value of `getter` across items, or null when they disagree. */
function commonFieldValue(items, getter) {
  if (!items.length) {
    return null;
  }
  const first = getter(items[0]);
  return items.every((item) => getter(item) === first) ? first : null;
}

/** A text/number field for the multi-edit inspector. A null value (the items
 *  disagree) renders as an empty input with a "—" placeholder; leaving it empty
 *  on change means "no change". */
function multiTextFieldHtml(label, name, value, { type = "text", min, step } = {}) {
  const attrs = [`name="${name}"`, `type="${type}"`, 'autocomplete="off"'];
  if (min != null) attrs.push(`min="${min}"`);
  if (step != null) attrs.push(`step="${step}"`);
  if (value == null) {
    attrs.push('value=""', 'placeholder="—"');
  } else {
    attrs.push(`value="${escapeHtml(String(value))}"`);
  }
  return `<label class="bmap-field"><span>${escapeHtml(label)}</span><input ${attrs.join(" ")}></label>`;
}

/** A select for the multi-edit inspector. A null value prepends a selected "—"
 *  sentinel option whose empty value means "no change". */
function multiSelectFieldHtml(label, name, options, value) {
  const opts = [];
  if (value == null) {
    opts.push('<option value="" selected>—</option>');
  }
  for (const [optionValue, optionLabel] of options) {
    opts.push(`<option value="${escapeHtml(optionValue)}"${value === optionValue ? " selected" : ""}>${escapeHtml(optionLabel)}</option>`);
  }
  return `<label class="bmap-field"><span>${escapeHtml(label)}</span><select name="${name}">${opts.join("")}</select></label>`;
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
  // Multi-selection: an array of { type:"node", id } | { type:"connector", index }.
  // The last item is treated as the "primary" for single-element edit panels.
  let selection = [];
  let nodeClipboard = null; // { nodes: [...snapshots], connectors: [...endpoint-snapshots] }
  let pastePreview = null; // { nodes, connectors, anchor: {x,y}, pointerWorld: {x,y} } while a paste is pending placement
  let pastePreviewListeners = null; // { pointermove, pointerdown, contextmenu, keydown } while pending
  let clickSuppressed = false; // swallow the click that trails a drag-move
  let history = [];
  let historyIndex = -1;
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
    autoPan: true,
    logDebug: null,
    ...defaultOptions,
  };

  let canvasEl = null;
  let innerEl = null;
  let rootEl = null; // the .bmap-editor wrapper for the current render
  let viewActive = false; // the bmap was the last thing the user pointer-interacted with
  let lastPointerClient = null; // last pointer position over the canvas, for paste seeding
  let rightDragPanned = false; // a right-drag became a pan, so suppress its context menu
  let keyboardBound = false; // document-level keydown handler attached once
  let contextMenuEl = null; // the floating right-click menu, portaled to <body>
  let toastTimer = null;

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
      cancelPastePreview();
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

  function isNodeSelected(id) {
    return selection.some((item) => item.type === "node" && item.id === id);
  }

  function isConnectorSelected(index) {
    return selection.some((item) => item.type === "connector" && item.index === index);
  }

  function selectionNodes() {
    return selection
      .filter((item) => item.type === "node")
      .map((item) => getNodeById(item.id))
      .filter(Boolean);
  }

  function selectionConnectors() {
    return selection
      .filter((item) => item.type === "connector")
      .map((item) => ({ index: item.index, connector: ast.connectors[item.index] }))
      .filter((entry) => entry.connector);
  }

  // Single-element accessors: only resolve when the selection is exactly one of
  // that kind, so the rich single-element inspectors stay for solo selections.
  function getSelectedNode() {
    return selection.length === 1 && selection[0].type === "node"
      ? getNodeById(selection[0].id)
      : null;
  }

  function getSelectedConnector() {
    return selection.length === 1 && selection[0].type === "connector"
      ? ast.connectors[selection[0].index] ?? null
      : null;
  }

  function ensureSelectionStillExists() {
    selection = selection.filter((item) =>
      item.type === "node" ? Boolean(getNodeById(item.id)) : Boolean(ast.connectors[item.index]));
  }

  function pushHistory(src) {
    if (history[historyIndex] === src) {
      return;
    }
    history = history.slice(0, historyIndex + 1);
    history.push(src);
    historyIndex = history.length - 1;
    if (history.length > 200) {
      history.shift();
      historyIndex -= 1;
    }
  }

  function applyHistory(delta) {
    const nextIndex = historyIndex + delta;
    if (nextIndex < 0 || nextIndex >= history.length) {
      return;
    }
    historyIndex = nextIndex;
    const src = history[historyIndex];
    sourceText = src;
    ast = normalizeBmapAst(parseBmap(src));
    selection = [];
    renderScene();
    activeOptions.onCommit?.(src, { reason: delta < 0 ? "bmap:undo" : "bmap:redo", selection: null });
  }

  function commitAst(reason) {
    const nextSource = serializeBmap(ast);
    if (nextSource === sourceText) {
      return;
    }
    sourceText = nextSource;
    pushHistory(nextSource);
    activeOptions.onCommit?.(nextSource, { reason, selection: selection[selection.length - 1] ?? null });
  }

  function setSelection(nextSelection) {
    selection = nextSelection ? [nextSelection] : [];
    renderScene();
  }

  function toggleSelectionItem(item) {
    const present = item.type === "node" ? isNodeSelected(item.id) : isConnectorSelected(item.index);
    if (present) {
      selection = selection.filter((entry) =>
        item.type === "node"
          ? !(entry.type === "node" && entry.id === item.id)
          : !(entry.type === "connector" && entry.index === item.index));
    } else {
      selection = [...selection, item];
    }
    renderScene();
  }

  function updateSelectedNodes(mutate, reason) {
    const nodes = selectionNodes();
    if (!nodes.length) {
      return;
    }
    for (const node of nodes) {
      const index = ast.nodes.findIndex((candidate) => candidate.id === node.id);
      if (index >= 0) {
        ast.nodes[index] = mutate(node);
      }
    }
    renderScene();
    commitAst(reason ?? "bmap:multi-edit-node");
  }

  function updateSelectedConnectors(mutate, reason) {
    const entries = selectionConnectors();
    if (!entries.length) {
      return;
    }
    for (const { index, connector } of entries) {
      ast.connectors[index] = mutate(connector);
    }
    renderScene();
    commitAst(reason ?? "bmap:multi-edit-connector");
  }

  // Snapshot one endpoint for the clipboard. Endpoints anchored to a copied node
  // are recorded as a node reference (so the pair stays connected on paste);
  // every other endpoint is frozen to its current coordinate and becomes a
  // dangling end on paste.
  function snapshotEndpoint(rawEndpoint, copiedNodeIds, nodeMap) {
    const endpoint = parseEndpoint(rawEndpoint);
    if (endpoint.dangling) {
      return { kind: "point", point: { ...endpoint.point } };
    }
    if (copiedNodeIds.has(endpoint.nodeId)) {
      return { kind: "node", id: endpoint.nodeId, side: endpoint.sideIndex };
    }
    const node = nodeMap.get(endpoint.nodeId);
    if (node) {
      return { kind: "point", point: getSnapPoint(node, endpoint.sideIndex) };
    }
    return { kind: "point", point: { x: 0, y: 0 } };
  }

  function materializeEndpoint(snapshot, idMap, delta) {
    if (snapshot.kind === "node" && idMap.has(snapshot.id)) {
      return formatEndpoint(idMap.get(snapshot.id), snapshot.side);
    }
    const point = snapshot.point ?? { x: 0, y: 0 };
    return formatPointEndpoint({ x: point.x + delta.x, y: point.y + delta.y });
  }

  function copySelectionToClipboard() {
    const nodes = selectionNodes();
    const connectorEntries = selectionConnectors();
    if (nodes.length === 0 && connectorEntries.length === 0) {
      return;
    }
    const copiedNodeIds = new Set(nodes.map((node) => node.id));
    const nodeMap = new Map(ast.nodes.map((node) => [node.id, node]));
    nodeClipboard = {
      nodes: nodes.map((node) => JSON.parse(JSON.stringify(node))),
      connectors: connectorEntries.map(({ connector }) => ({
        styles: { ...connector.styles },
        from: snapshotEndpoint(connector.from, copiedNodeIds, nodeMap),
        to: snapshotEndpoint(connector.to, copiedNodeIds, nodeMap),
      })),
    };
  }

  function cutSelectionToClipboard() {
    if (!isEditingEnabled() || selection.length === 0) {
      return;
    }
    copySelectionToClipboard();
    deleteSelected();
  }

  // Ctrl+V doesn't drop the clipboard immediately: it shows a translucent
  // "ghost" of the copied nodes/connectors that follows the pointer until the
  // user left-clicks to place it (or right-clicks / Escapes to cancel), so
  // they always see exactly what they're about to paste before it lands.
  function clipboardAnchorPoint() {
    const clipNodes = nodeClipboard?.nodes ?? [];
    if (clipNodes.length > 0) {
      return {
        x: Math.min(...clipNodes.map((node) => node.pos?.x ?? 0)),
        y: Math.min(...clipNodes.map((node) => node.pos?.y ?? 0)),
      };
    }
    const points = (nodeClipboard?.connectors ?? [])
      .flatMap((clip) => [clip.from, clip.to])
      .filter((endpoint) => endpoint.kind === "point")
      .map((endpoint) => endpoint.point);
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
    };
  }

  function beginPastePreview() {
    const clipNodes = nodeClipboard?.nodes ?? [];
    const clipConnectors = nodeClipboard?.connectors ?? [];
    if (!isEditingEnabled() || (clipNodes.length === 0 && clipConnectors.length === 0)) {
      return;
    }
    cancelPastePreview();
    // Pasting clears the current selection: the highlighted originals are no
    // longer the focus once the ghost is in the user's hands. Without this a
    // Ctrl+C immediately followed by Ctrl+V looks like nothing happened, since
    // the still-highlighted source masks the freshly spawned ghost.
    if (selection.length) {
      selection = [];
      renderScene();
    }
    // Start the ghost under the pointer (where the user is looking) when we know
    // where that is; otherwise fall back to the middle of the viewport.
    const startWorld = lastPointerClient
      ? clientToWorld(lastPointerClient.x, lastPointerClient.y)
      : getViewportCenterWorld();
    pastePreview = {
      nodes: clipNodes,
      connectors: clipConnectors,
      anchor: clipboardAnchorPoint(),
      pointerWorld: startWorld,
    };
    canvasEl?.classList.add("is-pasting");
    attachPastePreviewListeners();
    renderPasteGhost();
  }

  function pastePreviewDelta() {
    return {
      x: pastePreview.pointerWorld.x - pastePreview.anchor.x,
      y: pastePreview.pointerWorld.y - pastePreview.anchor.y,
    };
  }

  // The final, grid-snapped position a pasted node will land at for a given drag
  // delta. Shared by the ghost preview and the real commit so what the user sees
  // following the cursor is exactly what gets placed.
  function pasteNodePosition(snapshot, delta) {
    return {
      x: snapValue((snapshot.pos?.x ?? 0) + delta.x, snapStep),
      y: snapValue((snapshot.pos?.y ?? 0) + delta.y, snapStep),
    };
  }

  function attachPastePreviewListeners() {
    const handlePointerMove = (event) => {
      pastePreview.pointerWorld = clientToWorld(event.clientX, event.clientY);
      renderPasteGhost();
    };
    const handlePointerDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 2) {
        // Right-click cancels the paste. Swallow the contextmenu event that
        // trails it so we don't also pop the right-click menu.
        rightDragPanned = true;
        cancelPastePreview();
        canvasEl?.focus({ preventScroll: true });
        viewActive = true;
        return;
      }
      if (event.button === 0) {
        pastePreview.pointerWorld = clientToWorld(event.clientX, event.clientY);
        commitPastePreview();
      }
    };
    const handleContextMenu = (event) => {
      event.preventDefault();
    };
    const handleKeydown = (event) => {
      // While the ghost is in the user's hands the paste is modal: Escape, Delete
      // and Backspace all dismiss it (the floating "new" thing disappears), and
      // we swallow the keys so they can't fall through to deleteSelected() and
      // touch the real diagram. A second Ctrl+V just restarts the paste.
      if (event.key === "Escape" || event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        cancelPastePreview();
        canvasEl?.focus({ preventScroll: true });
        viewActive = true;
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        event.stopPropagation();
        beginPastePreview();
      }
    };
    pastePreviewListeners = {
      pointermove: handlePointerMove,
      pointerdown: handlePointerDown,
      contextmenu: handleContextMenu,
      keydown: handleKeydown,
    };
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("contextmenu", handleContextMenu, true);
    document.addEventListener("keydown", handleKeydown, true);
  }

  function detachPastePreviewListeners() {
    if (!pastePreviewListeners) {
      return;
    }
    document.removeEventListener("pointermove", pastePreviewListeners.pointermove);
    document.removeEventListener("pointerdown", pastePreviewListeners.pointerdown, true);
    document.removeEventListener("contextmenu", pastePreviewListeners.contextmenu, true);
    document.removeEventListener("keydown", pastePreviewListeners.keydown, true);
    pastePreviewListeners = null;
  }

  function clearPasteGhost() {
    canvasEl?.querySelectorAll(".bmap-paste-ghost").forEach((el) => el.remove());
  }

  function renderPasteGhost() {
    clearPasteGhost();
    if (!pastePreview || !canvasEl) {
      return;
    }
    const nodesLayer = canvasEl.querySelector(".bmap-nodes-layer");
    if (!nodesLayer) {
      return;
    }
    const delta = pastePreviewDelta();
    const ghostNodes = pastePreview.nodes.map((snapshot) => ({
      ...snapshot,
      pos: pasteNodePosition(snapshot, delta),
    }));
    const ghostNodeMap = new Map(ghostNodes.map((node) => [node.id, node]));
    const ghostIdentityMap = new Map(ghostNodes.map((node) => [node.id, node.id]));

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("bmap-paste-ghost", "bmap-paste-ghost-svg");
    svg.setAttribute("overflow", "visible");
    svg.setAttribute("width", "1");
    svg.setAttribute("height", "1");
    for (const clip of pastePreview.connectors) {
      const connector = createBmapConnector({
        from: materializeEndpoint(clip.from, ghostIdentityMap, delta),
        to: materializeEndpoint(clip.to, ghostIdentityMap, delta),
        styles: { ...clip.styles },
      });
      const pathData = buildConnectorPath(connector, ghostNodeMap);
      if (!pathData) {
        continue;
      }
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", connector.styles?.color || "var(--accent)");
      path.setAttribute("stroke-width", String(connector.styles?.thickness ?? 2));
      path.classList.add("bmap-paste-ghost-path");
      svg.append(path);
    }
    nodesLayer.append(svg);

    for (const node of ghostNodes) {
      const { width, height } = getBmapNodeDimensions(node);
      const el = document.createElement("div");
      el.className = `bmap-paste-ghost bmap-node bmap-node-${node.shape === "circle" ? "circle" : "rect"} bmap-paste-ghost-node`;
      el.style.left = `${node.pos.x}px`;
      el.style.top = `${node.pos.y}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      for (const [key, value] of Object.entries(node.styles ?? {})) {
        if (key === "width" || key === "height") {
          continue;
        }
        if (SAFE_STYLE_PROPS.has(key)) {
          el.style.setProperty(key, String(value));
        }
      }
      if (node.shape === "circle") {
        el.style.borderRadius = "50%";
      }
      const nameEl = document.createElement("div");
      nameEl.className = "bmap-node-name";
      nameEl.textContent = node.name || node.id;
      el.append(nameEl);
      nodesLayer.append(el);
    }
  }

  function commitPastePreview() {
    if (!pastePreview) {
      return;
    }
    const { nodes: clipNodes, connectors: clipConnectors } = pastePreview;
    const delta = pastePreviewDelta();
    const existingIds = new Set(ast.nodes.map((node) => node.id));
    const idMap = new Map();
    const nextSelection = [];

    for (const snapshot of clipNodes) {
      // Strip any existing "-copy"/"-copy-N" suffix so repeated pastes stay
      // "a-copy", "a-copy-2", "a-copy-3" … instead of "a-copy-copy-copy".
      const baseId = String(snapshot.id).replace(/-copy(-\d+)?$/, "");
      let newId = `${baseId}-copy`;
      let counter = 2;
      while (existingIds.has(newId)) {
        newId = `${baseId}-copy-${counter++}`;
      }
      existingIds.add(newId);
      idMap.set(snapshot.id, newId);
      const newNode = createBmapNode({
        ...snapshot,
        id: newId,
        pos: pasteNodePosition(snapshot, delta),
      });
      ast.nodes.push(newNode);
      nextSelection.push({ type: "node", id: newId });
    }

    for (const clip of clipConnectors) {
      const connector = createBmapConnector({
        from: materializeEndpoint(clip.from, idMap, delta),
        to: materializeEndpoint(clip.to, idMap, delta),
        styles: { ...clip.styles },
      });
      ast.connectors.push(connector);
      nextSelection.push({ type: "connector", index: ast.connectors.length - 1 });
    }

    detachPastePreviewListeners();
    clearPasteGhost();
    pastePreview = null;
    selection = nextSelection;
    // The commit fires from a capture-phase pointerdown whose preventDefault
    // stops the canvas from taking focus, and the browser still fires a trailing
    // click that would otherwise re-select whatever is under the cursor (often
    // the original node) — leaving the wrong thing "selected" and, because focus
    // never landed back on the canvas, the keyboard dead until the context menu
    // re-focuses it. Swallow that click and re-assert focus/active ourselves.
    suppressTrailingClick();
    renderScene();
    canvasEl?.focus({ preventScroll: true });
    viewActive = true;
    commitAst("bmap:paste-selection");
  }

  // Neutralize the single click that trails a pointerdown-driven action (paste
  // commit). Mirrors the drag-then-click suppression used for node moves.
  function suppressTrailingClick() {
    const cleanup = () => {
      document.removeEventListener("click", handler, true);
      window.clearTimeout(timer);
    };
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cleanup();
    };
    const timer = window.setTimeout(cleanup, 350);
    document.addEventListener("click", handler, true);
  }

  function cancelPastePreview() {
    detachPastePreviewListeners();
    clearPasteGhost();
    pastePreview = null;
    canvasEl?.classList.remove("is-pasting");
  }

  // Small transient toast (e.g. "Copied") anchored to the top of the canvas. It
  // lives on <body> so a re-render of the canvas mid-fade can't tear it out.
  function showBmapToast(message) {
    document.querySelectorAll(".bmap-toast").forEach((el) => el.remove());
    if (!canvasEl) {
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    const toast = document.createElement("div");
    toast.className = "bmap-toast";
    toast.textContent = message;
    toast.style.left = `${rect.left + (rect.width / 2)}px`;
    toast.style.top = `${rect.top + 14}px`;
    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 200);
    }, 1100);
  }

  function hideContextMenu() {
    contextMenuEl?.remove();
    contextMenuEl = null;
  }

  // Right-click menu. Built fresh each open so item enabled-state reflects the
  // current selection / clipboard / history. Lands on <body> (position: fixed)
  // so it survives the canvas re-renders its actions trigger.
  function showContextMenu(clientX, clientY) {
    hideContextMenu();
    const editing = isEditingEnabled();
    const hasSelection = selection.length > 0;
    const hasClipboard = (nodeClipboard?.nodes?.length ?? 0) > 0
      || (nodeClipboard?.connectors?.length ?? 0) > 0;
    const hasContent = ast.nodes.length > 0 || ast.connectors.length > 0;
    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;

    const items = [
      { label: "Copy", disabled: !hasSelection, run: () => { copySelectionToClipboard(); showBmapToast("Copied"); } },
      { label: "Cut", disabled: !editing || !hasSelection, run: () => { cutSelectionToClipboard(); showBmapToast("Cut"); } },
      { label: "Paste", disabled: !editing || !hasClipboard, run: () => beginPastePreview() },
      { separator: true },
      { label: "Delete", disabled: !editing || !hasSelection, danger: true, run: () => deleteSelected() },
      { separator: true },
      { label: "Select All", disabled: !hasContent, run: () => selectAll() },
      { separator: true },
      { label: "Undo", disabled: !editing || !canUndo, run: () => applyHistory(-1) },
      { label: "Redo", disabled: !editing || !canRedo, run: () => applyHistory(1) },
    ];

    const menu = document.createElement("div");
    menu.className = "bmap-context-menu";
    for (const item of items) {
      if (item.separator) {
        const hr = document.createElement("div");
        hr.className = "bmap-context-sep";
        menu.append(hr);
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.disabled = Boolean(item.disabled);
      if (item.danger) {
        button.classList.add("bmap-context-danger");
      }
      button.addEventListener("click", () => {
        hideContextMenu();
        item.run();
      });
      menu.append(button);
    }

    // Off-screen measure, then clamp so the menu stays inside the viewport.
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.visibility = "hidden";
    document.body.append(menu);
    const menuRect = menu.getBoundingClientRect();
    const x = Math.min(clientX, window.innerWidth - menuRect.width - 4);
    const y = Math.min(clientY, window.innerHeight - menuRect.height - 4);
    menu.style.left = `${Math.max(4, x)}px`;
    menu.style.top = `${Math.max(4, y)}px`;
    menu.style.visibility = "";
    contextMenuEl = menu;
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
    selection = [{ type: "node", id: node.id }];
    renderScene();
    commitAst("bmap:add-node");
  }

  function deleteSelected() {
    if (!isEditingEnabled() || selection.length === 0) {
      return;
    }
    const nodeIds = new Set(selection.filter((item) => item.type === "node").map((item) => item.id));
    const connectorIndices = new Set(selection.filter((item) => item.type === "connector").map((item) => item.index));
    if (nodeIds.size === 0 && connectorIndices.size === 0) {
      return;
    }
    // Drop directly-selected connectors plus any connector touching a deleted node.
    ast.connectors = ast.connectors.filter((connector, index) => {
      if (connectorIndices.has(index)) {
        return false;
      }
      const from = parseEndpoint(connector.from);
      const to = parseEndpoint(connector.to);
      return !nodeIds.has(from.nodeId) && !nodeIds.has(to.nodeId);
    });
    ast.nodes = ast.nodes.filter((node) => !nodeIds.has(node.id));
    selection = [];
    renderScene();
    commitAst("bmap:delete-selection");
  }

  function selectAll() {
    // Allowed in read-only mode too: it only highlights, it does not edit.
    selection = [
      ...ast.nodes.map((node) => ({ type: "node", id: node.id })),
      ...ast.connectors.map((_, index) => ({ type: "connector", index })),
    ];
    renderScene();
  }

  function handleCanvasKeydown(event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (mod && key === "z") {
      if (!isEditingEnabled()) {
        return;
      }
      consume();
      applyHistory(event.shiftKey ? 1 : -1);
      return;
    }
    if (mod && key === "y") {
      if (!isEditingEnabled()) {
        return;
      }
      consume();
      applyHistory(1);
      return;
    }
    if (mod && key === "a") {
      consume();
      selectAll();
      return;
    }
    if (mod && key === "c") {
      consume();
      if (selection.length) {
        copySelectionToClipboard();
        showBmapToast("Copied");
      }
      return;
    }
    if (mod && key === "x") {
      consume();
      if (isEditingEnabled() && selection.length) {
        cutSelectionToClipboard();
        showBmapToast("Cut");
      }
      return;
    }
    if (mod && key === "v") {
      consume();
      beginPastePreview();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (selection.length) {
        consume();
        deleteSelected();
      }
    }
  }

  // A single document-level keydown listener (attached once) so the bmap's
  // shortcuts fire whenever this view holds focus — regardless of which inner
  // element (canvas, a control/toolbar button, the inspector chrome) the focus
  // landed on. Scoping to "focus is somewhere inside our root" keeps it from
  // clashing with the editor pane's own Ctrl+A / Ctrl+Z on the other side.
  function handleDocumentKeydown(event) {
    if (!rootEl || !rootEl.isConnected) {
      return;
    }
    const active = document.activeElement;
    const focusInView = rootEl.contains(active);
    // Selecting a node in edit mode starts a drag that re-renders the canvas; the
    // browser then fires its trailing click on a replaced ancestor and focus can
    // fall back to <body>. In that case (focus is "loose" and the bmap was the
    // last thing the user touched) we still own the keyboard. We do NOT claim it
    // when focus sits on a real element elsewhere (e.g. the editor pane), so the
    // other side's own Ctrl+A / Ctrl+Z keep working.
    const focusIsLoose = active == null || active === document.body;
    if (!focusInView && !(viewActive && focusIsLoose)) {
      return;
    }
    // Never hijack typing inside the inspector's inputs/textareas.
    if (typeof event.target?.closest === "function" && event.target.closest("form")) {
      return;
    }
    handleCanvasKeydown(event);
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
    if (gesture?.rectEl) {
      gesture.rectEl.remove();
    }
    canvasEl?.classList.remove("is-panning");
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
      const dx = event.clientX - gesture.startClient.x;
      const dy = event.clientY - gesture.startClient.y;
      // A right-drag that actually moves is a pan; remember that so the trailing
      // contextmenu event opens nothing (vs. a stationary right-click → menu).
      if (gesture.fromButton === 2 && (Math.abs(dx) + Math.abs(dy)) > 4) {
        rightDragPanned = true;
      }
      pan = {
        x: gesture.startPan.x + dx,
        y: gesture.startPan.y + dy,
      };
      applyViewportTransform();
      return;
    }

    if (gesture.kind === "move-node") {
      const deltaX = (event.clientX - gesture.startClient.x) / zoom;
      const deltaY = (event.clientY - gesture.startClient.y) / zoom;
      for (const [id, startPos] of gesture.startPositions) {
        const node = getNodeById(id);
        if (!node) {
          continue;
        }
        node.pos.x = snapValue(startPos.x + deltaX, snapStep);
        node.pos.y = snapValue(startPos.y + deltaY, snapStep);
      }
      renderScene();
      return;
    }

    if (gesture.kind === "marquee") {
      const canvasRect = canvasEl.getBoundingClientRect();
      const curX = event.clientX - canvasRect.left;
      const curY = event.clientY - canvasRect.top;
      gesture.rectEl.style.left = `${Math.min(curX, gesture.startScreen.x)}px`;
      gesture.rectEl.style.top = `${Math.min(curY, gesture.startScreen.y)}px`;
      gesture.rectEl.style.width = `${Math.abs(curX - gesture.startScreen.x)}px`;
      gesture.rectEl.style.height = `${Math.abs(curY - gesture.startScreen.y)}px`;
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
      return;
    }

    if (gesture.kind === "drag-endpoint") {
      const connector = ast.connectors[gesture.connectorIndex];
      if (!connector) {
        return;
      }
      // Follow the cursor as a free coordinate; it snaps to a node side on drop.
      connector[gesture.end] = formatPointEndpoint(clientToWorld(event.clientX, event.clientY));
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
      const movedDistance = Math.abs(finishedGesture.startClient.x - event.clientX)
        + Math.abs(finishedGesture.startClient.y - event.clientY);
      if (movedDistance > 3) {
        // Swallow the click that the browser fires after this drag so it does
        // not collapse a multi-selection back down to the single dragged node.
        clickSuppressed = true;
        window.setTimeout(() => { clickSuppressed = false; }, 0);
      }
      renderScene();
      commitAst("bmap:move-node");
      return;
    }

    if (finishedGesture.kind === "marquee") {
      const endWorld = clientToWorld(event.clientX, event.clientY);
      const minX = Math.min(finishedGesture.startWorld.x, endWorld.x);
      const maxX = Math.max(finishedGesture.startWorld.x, endWorld.x);
      const minY = Math.min(finishedGesture.startWorld.y, endWorld.y);
      const maxY = Math.max(finishedGesture.startWorld.y, endWorld.y);
      const movedDistance = Math.abs(finishedGesture.startClient.x - event.clientX)
        + Math.abs(finishedGesture.startClient.y - event.clientY);

      // A negligible drag is just a click on empty space: clear the selection
      // (unless the user was Ctrl-adding, in which case leave it untouched).
      if (movedDistance < 4) {
        if (!finishedGesture.additive) {
          selection = [];
          renderScene();
        }
        return;
      }

      const hitNodeIds = new Set();
      for (const node of ast.nodes) {
        const rect = getNodeRect(node);
        const intersects = rect.x < maxX && rect.x + rect.width > minX
          && rect.y < maxY && rect.y + rect.height > minY;
        if (intersects) {
          hitNodeIds.add(node.id);
        }
      }

      const nextSelection = [...finishedGesture.baseSelection];
      const pushUnique = (item) => {
        const duplicate = nextSelection.some((entry) =>
          item.type === "node"
            ? (entry.type === "node" && entry.id === item.id)
            : (entry.type === "connector" && entry.index === item.index));
        if (!duplicate) {
          nextSelection.push(item);
        }
      };
      for (const id of hitNodeIds) {
        pushUnique({ type: "node", id });
      }
      // A connector is captured when both of its endpoints are inside the box.
      // A dangling endpoint counts when its free coordinate falls inside.
      const endpointInside = (rawEndpoint) => {
        const endpoint = parseEndpoint(rawEndpoint);
        if (endpoint.dangling) {
          return endpoint.point.x >= minX && endpoint.point.x <= maxX
            && endpoint.point.y >= minY && endpoint.point.y <= maxY;
        }
        return hitNodeIds.has(endpoint.nodeId);
      };
      ast.connectors.forEach((connector, index) => {
        if (endpointInside(connector.from) && endpointInside(connector.to)) {
          pushUnique({ type: "connector", index });
        }
      });

      selection = nextSelection;
      renderScene();
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
          selection = [{ type: "connector", index: ast.connectors.length - 1 }];
          renderScene();
          commitAst("bmap:add-connector");
          return;
        }
      }
      renderScene();
      return;
    }

    if (finishedGesture.kind === "drag-endpoint") {
      const connector = ast.connectors[finishedGesture.connectorIndex];
      if (connector) {
        // Dropping on a node side (exact snap dot, or anywhere on the node →
        // nearest side) re-attaches the end; dropping elsewhere leaves it
        // dangling at the new coordinate.
        const snapEl = event.target.closest?.(".bmap-snap[data-node-id][data-side-index]");
        const nodeElTarget = event.target.closest?.(".bmap-node[data-node-id]");
        if (snapEl) {
          connector[finishedGesture.end] = formatEndpoint(snapEl.dataset.nodeId, normalizeSideIndex(snapEl.dataset.sideIndex));
        } else if (nodeElTarget) {
          const node = getNodeById(nodeElTarget.dataset.nodeId);
          if (node) {
            connector[finishedGesture.end] = formatEndpoint(node.id, nearestSide(node, clientToWorld(event.clientX, event.clientY)));
          } else {
            connector[finishedGesture.end] = formatPointEndpoint(clientToWorld(event.clientX, event.clientY));
          }
        } else {
          connector[finishedGesture.end] = formatPointEndpoint(clientToWorld(event.clientX, event.clientY));
        }
        renderScene();
        commitAst("bmap:reconnect-endpoint");
      }
    }
  }

  function handlePointerCancel() {
    stopGesture(true);
  }

  function startPan(event) {
    startGesture({
      kind: "pan",
      fromButton: event.button,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { ...pan }
    });
    // Show the grabbing hand for the duration of the pan. :active is unreliable
    // for right/middle buttons, so the class is toggled explicitly here.
    canvasEl?.classList.add("is-panning");
  }

  function startNodeDrag(nodeId, event) {
    if (!isEditingEnabled()) {
      return;
    }
    const node = getNodeById(nodeId);
    if (!node) {
      return;
    }
    // Dragging a node that isn't part of the current selection makes it the sole
    // selection; dragging one that is part of a multi-selection moves them all.
    if (!isNodeSelected(nodeId)) {
      selection = [{ type: "node", id: nodeId }];
    }
    const movingNodes = selectionNodes();
    const startPositions = new Map(movingNodes.map((item) => [item.id, { ...item.pos }]));
    startGesture({
      kind: "move-node",
      startClient: { x: event.clientX, y: event.clientY },
      startPositions
    });
    renderScene();
  }

  function startMarquee(event) {
    const additive = event.ctrlKey || event.metaKey;
    const canvasRect = canvasEl.getBoundingClientRect();
    const rectEl = document.createElement("div");
    rectEl.className = "bmap-marquee";
    canvasEl.append(rectEl);
    startGesture({
      kind: "marquee",
      startClient: { x: event.clientX, y: event.clientY },
      startWorld: clientToWorld(event.clientX, event.clientY),
      startScreen: { x: event.clientX - canvasRect.left, y: event.clientY - canvasRect.top },
      additive,
      baseSelection: additive ? [...selection] : [],
      rectEl,
    });
  }

  function startNodeResize(nodeId, edge, event) {
    if (!isEditingEnabled()) {
      return;
    }
    const node = getNodeById(nodeId);
    if (!node) {
      return;
    }
    selection = [{ type: "node", id: nodeId }];
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
    selection = [{ type: "node", id: nodeId }];
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

  // Drag a dangling connector end (a free coordinate) to re-attach it to a node.
  function startEndpointDrag(connectorIndex, end, event) {
    if (!isEditingEnabled()) {
      return;
    }
    selection = [{ type: "connector", index: connectorIndex }];
    startGesture({
      kind: "drag-endpoint",
      connectorIndex,
      end,
      startClient: { x: event.clientX, y: event.clientY }
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
      makeToolbarButton("Delete", "Delete selected node or connector", deleteSelected, selection.length === 0 || !isEditingEnabled()),
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
    const nodeCount = selection.filter((item) => item.type === "node").length;
    const connectorCount = selection.filter((item) => item.type === "connector").length;
    if (selection.length === 0) {
      status.textContent = `Snap ${snapStep}\u00D7${snapStep}`;
    } else if (selection.length === 1 && nodeCount === 1) {
      status.textContent = `Selected node: ${selection[0].id}`;
    } else if (selection.length === 1 && connectorCount === 1) {
      status.textContent = `Selected connector ${selection[0].index + 1}`;
    } else {
      const parts = [];
      if (nodeCount) parts.push(`${nodeCount} node${nodeCount === 1 ? "" : "s"}`);
      if (connectorCount) parts.push(`${connectorCount} connector${connectorCount === 1 ? "" : "s"}`);
      status.textContent = `Selected ${parts.join(" + ")}`;
    }

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
        const fromLabel = from.dangling ? "(unattached)" : from.nodeId;
        const toLabel = to.dangling ? "(unattached)" : to.nodeId;
        lines.push(`- ${fromLabel} -> ${toLabel}`);
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
      <form class="bmap-inspector-form" novalidate autocomplete="off">
        <fieldset class="bmap-inspector-fieldset"${isReadOnly ? " disabled" : ""}>
        <label class="bmap-field">
          <span>Name</span>
          <input name="name" type="text" autocomplete="off" value="${escapeHtml(node.name)}">
        </label>
        <label class="bmap-field">
          <span>Text</span>
          <textarea name="text" rows="4" autocomplete="off">${escapeHtml(node.text)}</textarea>
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
          <button type="button" data-action="set-origin" class="bmap-secondary-btn" title="Shift every node so this one sits at (0,0)">Set as Origin</button>
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
      selection = [{ type: "node", id: nextNode.id }];
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

    inspector.querySelector('[data-action="set-origin"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        setNodeAsOrigin(node.id);
      }
    });

    return inspector;
  }

  // Make a node's coordinate the new origin: shift every node (and every dangling
  // connector endpoint) by that node's position so the chosen node lands at
  // (0,0). Node-attached endpoints follow their nodes automatically.
  function setNodeAsOrigin(nodeId) {
    const origin = getNodeById(nodeId);
    if (!origin) {
      return;
    }
    const dx = origin.pos.x;
    const dy = origin.pos.y;
    if (dx === 0 && dy === 0) {
      return;
    }
    for (const node of ast.nodes) {
      node.pos = { x: node.pos.x - dx, y: node.pos.y - dy };
    }
    for (const connector of ast.connectors) {
      for (const end of ["from", "to"]) {
        const endpoint = parseEndpoint(connector[end]);
        if (endpoint.dangling) {
          connector[end] = formatPointEndpoint({ x: endpoint.point.x - dx, y: endpoint.point.y - dy });
        }
      }
    }
    renderScene();
    commitAst("bmap:set-origin");
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
      <form class="bmap-inspector-form" novalidate autocomplete="off">
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
      selection = [{ type: "connector", index }];
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

  function buildMultiNodeInspector(nodes) {
    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    const common = (getter) => commonFieldValue(nodes, getter);
    const name = common((node) => node.name);
    const text = common((node) => node.text);
    const shape = common((node) => node.shape);
    const background = common((node) => getNodeStyleValue(node, "background", ""));
    const color = common((node) => getNodeStyleValue(node, "color", ""));
    const nameColor = common((node) => getNodeStyleValue(node, "name-color", ""));
    const opacity = common((node) => getNodeStyleValue(node, "opacity", ""));
    const borderColor = common((node) => parseBmapBorder(getNodeStyleValue(node, "border", ""), "").color);
    const borderWidth = common((node) => parseBmapBorder(getNodeStyleValue(node, "border", ""), "").width);
    const borderStyle = common((node) => parseBmapBorder(getNodeStyleValue(node, "border", ""), "").style);
    const radius = common((node) => getPixelStyleValue(node, "border-radius", 8));
    const fontSize = common((node) => getPixelStyleValue(node, "font-size", 12));
    const fontWeight = common((node) => getNodeStyleValue(node, "font-weight", "normal"));
    const textAlign = common((node) => getBmapTextAlign(node));
    const width = common((node) => getBmapNodeDimensions(node).width);
    const height = common((node) => getBmapNodeDimensions(node).height);

    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>${nodes.length} Nodes</h3>
        <div class="subtle-label">Multi-edit</div>
      </div>
      <div class="bmap-inspector-note">Changing a field updates every selected node. Fields that differ show “—”.</div>
      <form class="bmap-inspector-form" novalidate autocomplete="off">
        <fieldset class="bmap-inspector-fieldset">
          ${multiTextFieldHtml("Name", "name", name)}
          <label class="bmap-field"><span>Text</span><textarea name="text" rows="3" autocomplete="off" placeholder="${text == null ? "—" : ""}">${text == null ? "" : escapeHtml(text)}</textarea></label>
          <div class="bmap-field-row">
            ${multiSelectFieldHtml("Shape", "shape", [["rect", "Rectangle"], ["circle", "Oval"]], shape)}
            ${multiSelectFieldHtml("Text align", "textAlign", [["left", "Left"], ["center", "Center"], ["right", "Right"]], textAlign)}
          </div>
          <div class="bmap-field-row">
            ${colorFieldHtml({ label: "Background", name: "background", value: background, fallback: "#fffbe6", mixed: background == null })}
            ${colorFieldHtml({ label: "Text color", name: "color", value: color, fallback: BMAP_DEFAULT_INK, mixed: color == null })}
          </div>
          <div class="bmap-field-row">
            ${colorFieldHtml({ label: "Name color", name: "nameColor", value: nameColor, fallback: BMAP_DEFAULT_INK, mixed: nameColor == null })}
            ${multiTextFieldHtml("Opacity", "opacity", opacity, { type: "number", min: 0, step: 0.1 })}
          </div>
          <div class="bmap-field-row">
            ${colorFieldHtml({ label: "Border color", name: "borderColor", value: borderColor, fallback: "#cccccc", mixed: borderColor == null })}
            ${multiSelectFieldHtml("Border style", "borderStyle", [["solid", "Solid"], ["dashed", "Dashed"], ["dotted", "Dotted"], ["none", "None"]], borderStyle)}
          </div>
          <div class="bmap-field-row">
            ${multiTextFieldHtml("Border width", "borderWidth", borderWidth, { type: "number", min: 1, step: 1 })}
            ${multiTextFieldHtml("Radius", "borderRadius", radius, { type: "number", min: 0, step: 1 })}
          </div>
          <div class="bmap-field-row">
            ${multiTextFieldHtml("Font size", "fontSize", fontSize, { type: "number", min: 8, step: 1 })}
            ${multiSelectFieldHtml("Font weight", "fontWeight", [["normal", "Normal"], ["600", "600"], ["bold", "Bold"]], fontWeight)}
          </div>
          <div class="bmap-field-row">
            ${multiTextFieldHtml("Width", "width", width, { type: "number", min: snapStep, step: snapStep })}
            ${multiTextFieldHtml("Height", "height", height, { type: "number", min: snapStep, step: snapStep })}
          </div>
          <div class="bmap-inspector-actions">
            <button type="button" data-action="delete" class="bmap-danger-btn">Delete ${nodes.length} Nodes</button>
          </div>
        </fieldset>
      </form>
    `;

    const form = inspector.querySelector("form");
    form.addEventListener("submit", (event) => event.preventDefault());
    form.addEventListener("change", (event) => {
      const field = event.target?.name;
      if (!field || !isEditingEnabled()) {
        return;
      }
      applyMultiNodeField(field, new FormData(form).get(field));
    });
    inspector.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        deleteSelected();
      }
    });
    return inspector;
  }

  // Apply a single changed field to every selected node. An empty value means
  // the user left a "differs" field untouched, so it is a no-op.
  function applyMultiNodeField(field, rawValue) {
    const value = rawValue == null ? "" : String(rawValue);
    const recomposeBorder = (node, part) => {
      const current = parseBmapBorder(getNodeStyleValue(node, "border", ""), "#cccccc");
      const next = { ...current, ...part };
      return composeBmapBorder({
        enabled: next.style !== "none" && next.width > 0,
        width: next.width || 1,
        style: next.style === "none" ? "none" : next.style,
        color: next.color,
      });
    };
    const withStyle = (node, key, styleValue) =>
      createBmapNode({ ...node, styles: { ...node.styles, [key]: styleValue } });

    switch (field) {
      case "name":
        updateSelectedNodes((node) => createBmapNode({ ...node, name: value }));
        break;
      case "text":
        updateSelectedNodes((node) => createBmapNode({ ...node, text: value }));
        break;
      case "shape":
        if (value) updateSelectedNodes((node) => createBmapNode({ ...node, shape: value }));
        break;
      case "background":
        updateSelectedNodes((node) => withStyle(node, "background", value));
        break;
      case "color":
        updateSelectedNodes((node) => withStyle(node, "color", value));
        break;
      case "nameColor":
        updateSelectedNodes((node) => withStyle(node, "name-color", value));
        break;
      case "opacity":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "opacity", value));
        break;
      case "borderColor":
        updateSelectedNodes((node) => withStyle(node, "border", recomposeBorder(node, { color: value })));
        break;
      case "borderStyle":
        if (value) updateSelectedNodes((node) => withStyle(node, "border", recomposeBorder(node, { style: value })));
        break;
      case "borderWidth":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "border", recomposeBorder(node, { width: Math.max(1, Number.parseInt(value, 10) || 1) })));
        break;
      case "borderRadius":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "border-radius", `${Math.max(0, Number.parseInt(value, 10) || 0)}px`));
        break;
      case "fontSize":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "font-size", `${Math.max(8, Number.parseInt(value, 10) || 12)}px`));
        break;
      case "fontWeight":
        if (value) updateSelectedNodes((node) => withStyle(node, "font-weight", value));
        break;
      case "textAlign":
        if (value) updateSelectedNodes((node) => withStyle(node, "text-align", value));
        break;
      case "width":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "width", String(snapSizeValue(value, snapStep))));
        break;
      case "height":
        if (value !== "") updateSelectedNodes((node) => withStyle(node, "height", String(snapSizeValue(value, snapStep))));
        break;
      default:
        break;
    }
  }

  function buildMultiConnectorInspector(entries) {
    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    const connectors = entries.map((entry) => entry.connector);
    const common = (getter) => commonFieldValue(connectors, getter);
    const mode = common((connector) => connector.styles?.mode ?? "bezier");
    const arrow = common((connector) => connector.styles?.arrow ?? "end");
    const thickness = common((connector) => Number.parseInt(String(connector.styles?.thickness ?? 2), 10) || 2);
    const colorValue = common((connector) => String(connector.styles?.color ?? "#1677ff"));
    const dashedCommon = common((connector) => Boolean(connector.styles?.dashed));

    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>${entries.length} Connectors</h3>
        <div class="subtle-label">Multi-edit</div>
      </div>
      <div class="bmap-inspector-note">Changing a field updates every selected connector. Fields that differ show “—”.</div>
      <form class="bmap-inspector-form" novalidate autocomplete="off">
        <fieldset class="bmap-inspector-fieldset">
          <div class="bmap-field-row">
            ${multiSelectFieldHtml("Mode", "mode", [["bezier", "Bezier"], ["straight", "Straight"]], mode)}
            ${multiSelectFieldHtml("Arrow", "arrow", [["end", "End"], ["start", "Start"], ["both", "Both"], ["none", "None"]], arrow)}
          </div>
          <div class="bmap-field-row">
            ${multiTextFieldHtml("Thickness", "thickness", thickness, { type: "number", min: 1, step: 1 })}
            ${colorFieldHtml({ label: "Color", name: "color", value: colorValue, fallback: "#1677ff", mixed: colorValue == null })}
          </div>
          <label class="bmap-field bmap-checkbox-field">
            <input name="dashed" type="checkbox"${dashedCommon ? " checked" : ""}>
            <span>Dashed${dashedCommon == null ? ' <span class="bmap-mixed-badge">mixed</span>' : ""}</span>
          </label>
          <div class="bmap-inspector-actions">
            <button type="button" data-action="delete" class="bmap-danger-btn">Delete ${entries.length} Connectors</button>
          </div>
        </fieldset>
      </form>
    `;

    const form = inspector.querySelector("form");
    form.addEventListener("submit", (event) => event.preventDefault());
    form.addEventListener("change", (event) => {
      const field = event.target?.name;
      if (!field || !isEditingEnabled()) {
        return;
      }
      const formData = new FormData(form);
      const raw = formData.get(field);
      const value = raw == null ? "" : String(raw);
      if (field === "dashed") {
        const checked = event.target.checked;
        updateSelectedConnectors((connector) => createBmapConnector({ ...connector, styles: { ...connector.styles, dashed: checked } }));
        return;
      }
      if (value === "") {
        return;
      }
      const styleKey = field;
      updateSelectedConnectors((connector) => createBmapConnector({ ...connector, styles: { ...connector.styles, [styleKey]: value } }));
    });
    inspector.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        deleteSelected();
      }
    });
    return inspector;
  }

  function buildMultiMixedInspector(nodes, entries) {
    const inspector = document.createElement("aside");
    inspector.className = "bmap-inspector";
    inspector.innerHTML = `
      <div class="bmap-inspector-header">
        <h3>${nodes.length + entries.length} Items</h3>
        <div class="subtle-label">${nodes.length} nodes · ${entries.length} connectors</div>
      </div>
      <div class="bmap-inspector-empty">
        <p>A mix of nodes and connectors is selected. Select only nodes or only connectors to edit their shared properties.</p>
      </div>
      <div class="bmap-inspector-actions">
        <button type="button" data-action="delete" class="bmap-danger-btn">Delete Selection</button>
      </div>
    `;
    inspector.querySelector('[data-action="delete"]').addEventListener("click", () => {
      if (isEditingEnabled()) {
        deleteSelected();
      }
    });
    return inspector;
  }

  function buildInspector() {
    let inspector;
    const nodes = selectionNodes();
    const connectors = selectionConnectors();
    if (selection.length === 0) {
      inspector = buildEmptyInspector();
    } else if (selection.length === 1 && nodes.length === 1) {
      inspector = buildNodeInspector(nodes[0]);
    } else if (selection.length === 1 && connectors.length === 1) {
      inspector = buildConnectorInspector(connectors[0].connector, connectors[0].index);
    } else if (connectors.length === 0) {
      inspector = buildMultiNodeInspector(nodes);
    } else if (nodes.length === 0) {
      inspector = buildMultiConnectorInspector(connectors);
    } else {
      inspector = buildMultiMixedInspector(nodes, connectors);
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
    // The canvas is replaced on every render; if focus was anywhere inside this
    // view (the canvas, a control/toolbar button, etc.), pull it back onto the
    // rebuilt canvas afterwards so keyboard shortcuts keep firing consistently
    // (e.g. toggling edit mode via the pen, then immediately Ctrl+A / Delete).
    const hadFocusInView = rootEl != null && rootEl.contains(document.activeElement);
    container.replaceChildren();

    const root = document.createElement("div");
    root.className = "bmap-editor";
    rootEl = root;
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
      if (isConnectorSelected(index)) {
        visiblePath.classList.add("is-selected");
      }

      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.setAttribute("d", pathData);
      hitPath.setAttribute("fill", "none");
      hitPath.setAttribute("stroke", "transparent");
      hitPath.setAttribute("stroke-width", String(Math.max(thickness + 10, 14)));
      hitPath.classList.add("bmap-connector-hit");
      hitPath.dataset.connectorIndex = String(index);
      hitPath.addEventListener("click", (event) => {
        event.stopPropagation();
        canvasEl?.focus({ preventScroll: true });
        if (event.ctrlKey || event.metaKey) {
          toggleSelectionItem({ type: "connector", index });
        } else {
          setSelection({ type: "connector", index });
        }
      });

      svg.append(visiblePath, hitPath);

      // A dangling endpoint (from copy/paste) gets a draggable handle so it can
      // be re-attached to a node side. The handle lives in world space.
      const addDanglingHandle = (point, end) => {
        const handle = document.createElement("div");
        handle.className = "bmap-dangling-handle";
        handle.style.left = `${point.x}px`;
        handle.style.top = `${point.y}px`;
        handle.title = "Drag onto a node to connect";
        // Non-interactive while a gesture is in flight so it can't shadow the
        // node/snap being dropped onto (it sits above nodes in the z-order).
        const interactive = isEditingEnabled() && !gesture;
        if (interactive) {
          handle.addEventListener("pointerdown", (downEvent) => {
            if (downEvent.button !== 0) {
              return;
            }
            downEvent.preventDefault();
            downEvent.stopPropagation();
            canvasEl?.focus({ preventScroll: true });
            startEndpointDrag(index, end, downEvent);
          });
        } else {
          handle.classList.add("is-static");
        }
        nodesLayer.append(handle);
      };
      const fromEndpoint = parseEndpoint(connector.from);
      const toEndpoint = parseEndpoint(connector.to);
      if (fromEndpoint.dangling) {
        addDanglingHandle(fromEndpoint.point, "from");
      }
      if (toEndpoint.dangling) {
        addDanglingHandle(toEndpoint.point, "to");
      }
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
      if (isNodeSelected(node.id)) {
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
        // Focus the canvas (in any mode) so keyboard shortcuts target the editor.
        canvasEl?.focus({ preventScroll: true });
        // Ignore the click the browser fires right after a drag-move.
        if (clickSuppressed) {
          clickSuppressed = false;
          return;
        }
        if (event.ctrlKey || event.metaKey) {
          toggleSelectionItem({ type: "node", id: node.id });
        } else {
          setSelection({ type: "node", id: node.id });
        }
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
        // Ctrl/Cmd-click toggles selection (handled on click); don't start a drag.
        if (event.ctrlKey || event.metaKey) {
          return;
        }
        event.stopPropagation();
        canvasEl?.focus({ preventScroll: true });
        startNodeDrag(node.id, event);
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
        selection = [{ type: "node", id: node.id }];
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

    if (hadFocusInView) {
      canvas.focus({ preventScroll: true });
    }

    // Bind the keyboard handler once, at the document level, so shortcuts work no
    // matter which inner element holds focus (and survive canvas re-renders).
    if (!keyboardBound) {
      keyboardBound = true;
      document.addEventListener("keydown", handleDocumentKeydown);
      // Track which widget the user last pointer-touched (so keyboard shortcuts
      // keep targeting the bmap even when its re-render dropped focus to <body>),
      // and dismiss the right-click menu on any outside click.
      document.addEventListener("pointerdown", (event) => {
        const inMenu = contextMenuEl != null && contextMenuEl.contains(event.target);
        if (contextMenuEl && !inMenu) {
          hideContextMenu();
        }
        // A click on our own context menu shouldn't flip the bmap to "inactive".
        if (!inMenu) {
          viewActive = rootEl != null && rootEl.contains(event.target);
        }
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && contextMenuEl) {
          hideContextMenu();
        }
      }, true);
    }

    const isEmptyCanvasTarget = (target) =>
      target === canvas || target === inner || target === svg || target === nodesLayer;

    // Track the pointer over the canvas so a paste can spawn its ghost right
    // under the cursor, and so the context menu / pan know where we are.
    canvas.addEventListener("pointermove", (event) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
    });

    canvas.addEventListener("pointerdown", (event) => {
      lastPointerClient = { x: event.clientX, y: event.clientY };
      hideContextMenu();
      if (!isEmptyCanvasTarget(event.target)) {
        return;
      }
      // Controls are identical in both modes: right/middle-drag pans, left-drag
      // draws a marquee selection rectangle. Read-only mode still selects (for
      // highlighting); it just can't edit what's selected.
      if (event.button === 1 || event.button === 2) {
        event.preventDefault();
        rightDragPanned = false;
        startPan(event);
        return;
      }
      if (event.button !== 0) {
        return;
      }
      canvas.focus({ preventScroll: true });
      startMarquee(event);
    });

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      // A right-button drag means the user was panning, not asking for a menu.
      if (rightDragPanned) {
        rightDragPanned = false;
        return;
      }
      canvas.focus({ preventScroll: true });
      // Right-clicking an element selects it (unless it is already part of the
      // selection), so the menu's actions target what is under the cursor.
      const nodeElTarget = event.target.closest?.(".bmap-node[data-node-id]");
      const connectorHit = event.target.closest?.(".bmap-connector-hit[data-connector-index]");
      if (nodeElTarget) {
        const id = nodeElTarget.dataset.nodeId;
        if (!isNodeSelected(id)) {
          setSelection({ type: "node", id });
        }
      } else if (connectorHit) {
        const index = Number.parseInt(connectorHit.dataset.connectorIndex, 10);
        if (Number.isInteger(index) && !isConnectorSelected(index)) {
          setSelection({ type: "connector", index });
        }
      }
      showContextMenu(event.clientX, event.clientY);
    });

    canvas.addEventListener("wheel", (event) => {
      hideContextMenu();
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
    let documentChanged = false;
    if (typeof sourceOrOptions === "string") {
      setActiveOptions(defaultOptions);
      sourceText = sourceOrOptions;
    } else {
      setActiveOptions(sourceOrOptions);
      const nextDocumentKey = sourceOrOptions.documentKey ?? null;
      if (nextDocumentKey !== currentDocumentKey) {
        currentDocumentKey = nextDocumentKey;
        documentChanged = true;
        selection = [];
        connectPreview = null;
        stopGesture(false);
        cancelPastePreview();
        pan = { x: 40, y: 40 };
        zoom = 1;
        setPopupHidden();
        // A freshly opened diagram defaults to read-only (view) mode so the
        // preview pane is not in edit mode until the user opts in via the pen.
        interactionMode = "readonly";
      }
      sourceText = String(sourceOrOptions.source ?? "");
    }
    // Seed the undo history on document open; record external source edits too so
    // Ctrl+Z still works after the raw text was changed elsewhere.
    if (documentChanged || historyIndex < 0) {
      history = [sourceText];
      historyIndex = 0;
    } else {
      pushHistory(sourceText);
    }
    ast = normalizeBmapAst(parseBmap(sourceText));
    ensureSelectionStillExists();
    renderScene();
    if (documentChanged) {
      maybeAutoPanToContent();
    }
  }

  // On opening a diagram whose nodes all sit far from the origin, the default
  // top-left view would look empty. If nothing is in view, pan to the node
  // nearest the origin and centre it (opt-out via the autoPan option).
  function maybeAutoPanToContent() {
    if (!activeOptions.autoPan || ast.nodes.length === 0 || !canvasEl) {
      return;
    }
    const rect = canvasEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const topLeft = clientToWorld(rect.left, rect.top);
    const bottomRight = clientToWorld(rect.right, rect.bottom);
    const anyVisible = ast.nodes.some((node) => {
      const r = getNodeRect(node);
      return r.x < bottomRight.x && r.x + r.width > topLeft.x
        && r.y < bottomRight.y && r.y + r.height > topLeft.y;
    });
    if (anyVisible) {
      return;
    }
    let best = null;
    let bestDistance = Infinity;
    for (const node of ast.nodes) {
      const r = getNodeRect(node);
      const cx = r.x + (r.width / 2);
      const cy = r.y + (r.height / 2);
      const distance = (cx * cx) + (cy * cy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { cx, cy };
      }
    }
    if (best) {
      pan = { x: (rect.width / 2) - (best.cx * zoom), y: (rect.height / 2) - (best.cy * zoom) };
      applyViewportTransform();
    }
  }

  return { render };
}

export { createBmapView, renderBmapToSvg };
