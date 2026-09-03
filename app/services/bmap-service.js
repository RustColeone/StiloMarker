/**
 * bmap-service.js
 * Parser and serializer for the .bmap brainstorm diagram format.
 *
 * File format: CSS-like blocks
 *   .node { id: X  name: Y  pos: {x: N, y: N}  shape: rect|circle  file: path  styles: { ... } }
 *   .connect { from: nodeId.side.N  to: nodeId.side.N  styles: { mode: bezier|straight  arrow: end|start|both|none  dashed: true|false  thickness: N  color: #hex } }
 *
 * Snap side indices: 0=top, 1=right, 2=bottom, 3=left
 */

const BMAP_DEFAULT_RECT_WIDTH = 220;
const BMAP_DEFAULT_RECT_HEIGHT = 90;
const BMAP_DEFAULT_CIRCLE_SIZE = 160;

const DEFAULT_NODE_STYLES = {
  rect: {
    background: "#fffbe6",
    border: "1px solid #e8b339",
    "border-radius": "8px",
    width: String(BMAP_DEFAULT_RECT_WIDTH),
    height: String(BMAP_DEFAULT_RECT_HEIGHT)
  },
  circle: {
    background: "#f0fff4",
    border: "1px solid #3dba72",
    width: String(BMAP_DEFAULT_CIRCLE_SIZE),
    height: String(BMAP_DEFAULT_CIRCLE_SIZE)
  }
};

const DEFAULT_CONNECTOR_STYLES = {
  mode: "bezier",
  arrow: "end",
  dashed: false,
  thickness: 2,
  color: "#1677ff"
};

function toBmapInteger(value, fallback = 0, minimum = Number.NEGATIVE_INFINITY) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, parsed);
}

function coerceBmapShape(shape) {
  return String(shape ?? "rect").trim().toLowerCase() === "circle" ? "circle" : "rect";
}

function normalizeBmapStyles(styles) {
  const next = {};
  for (const [key, value] of Object.entries(styles ?? {})) {
    if (value == null) {
      continue;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
      continue;
    }
    next[key] = trimmed;
  }
  return next;
}

function getBmapNodeDimensions(node) {
  const shape = coerceBmapShape(node?.shape);
  const defaultWidth = shape === "circle" ? BMAP_DEFAULT_CIRCLE_SIZE : BMAP_DEFAULT_RECT_WIDTH;
  const defaultHeight = shape === "circle" ? defaultWidth : BMAP_DEFAULT_RECT_HEIGHT;
  const width = toBmapInteger(node?.styles?.width, defaultWidth, 1);
  const height = toBmapInteger(node?.styles?.height, defaultHeight, 1);
  return { width, height };
}

function cloneBmapAst(ast) {
  return {
    nodes: (ast?.nodes ?? []).map((node) => ({
      ...node,
      pos: { ...node.pos },
      styles: { ...(node.styles ?? {}) }
    })),
    connectors: (ast?.connectors ?? []).map((connector) => ({
      ...connector,
      styles: { ...(connector.styles ?? {}) }
    })),
    parseErrors: [...(ast?.parseErrors ?? [])]
  };
}

function createBmapNode({ id, name = "", text = "", shape = "rect", pos = { x: 0, y: 0 }, file = null, styles = {} }) {
  const nextShape = coerceBmapShape(shape);
  return {
    id: String(id ?? "").trim(),
    name: String(name ?? "").trim(),
    text: String(text ?? "").trim(),
    shape: nextShape,
    pos: {
      x: toBmapInteger(pos?.x, 0),
      y: toBmapInteger(pos?.y, 0)
    },
    file: file ? String(file).trim() : null,
    styles: {
      ...DEFAULT_NODE_STYLES[nextShape],
      ...normalizeBmapStyles(styles)
    }
  };
}

function createBmapConnector({ from = "", to = "", styles = {} }) {
  return {
    from: String(from ?? "").trim(),
    to: String(to ?? "").trim(),
    styles: {
      ...DEFAULT_CONNECTOR_STYLES,
      ...styles,
      dashed: String(styles?.dashed ?? DEFAULT_CONNECTOR_STYLES.dashed).trim() === "true" || styles?.dashed === true,
      thickness: toBmapInteger(styles?.thickness, DEFAULT_CONNECTOR_STYLES.thickness, 1),
      color: String(styles?.color ?? DEFAULT_CONNECTOR_STYLES.color).trim(),
      mode: String(styles?.mode ?? DEFAULT_CONNECTOR_STYLES.mode).trim(),
      arrow: String(styles?.arrow ?? DEFAULT_CONNECTOR_STYLES.arrow).trim()
    }
  };
}

function normalizeBmapAst(ast) {
  return {
    nodes: (ast?.nodes ?? []).map((node) => createBmapNode(node)),
    connectors: (ast?.connectors ?? []).map((connector) => createBmapConnector(connector)),
    parseErrors: [...(ast?.parseErrors ?? [])]
  };
}

/**
 * Parse a nested property object from a string.
 * Handles both comma-separated inline form ({x: 120, y: 80}) and multi-line form.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseNestedObject(text) {
  const normalized = text.trim();
  const result = {};
  // Split into "key: value" segments. Values may contain spaces (e.g. a CSS
  // "border: 1px solid #hex"), which is why a bare space is NOT a delimiter.
  let segments;
  if (normalized.includes("\n")) {
    // Canonical multi-line form: one entry per line.
    segments = normalized.split("\n");
  } else if (normalized.includes(";")) {
    // HTML/CSS-style delimiter (preferred for single-line): unambiguous — values
    // keep their spaces and commas (rgba(…), font stacks).
    segments = normalized.split(";");
  } else {
    // Bare single line, no explicit delimiter ("a: 1 b: 2 3 c: 4" or the pos
    // form "x: 1, y: 2"): split at each "<key>:" boundary so space- or
    // comma-separated entries with spaced values still parse. The `(?!\/\/)`
    // spares "http://…" style values from being treated as a key boundary.
    segments = [];
    const boundary = /[A-Za-z_][\w-]*\s*:(?!\/\/)/g;
    const starts = [];
    let m;
    while ((m = boundary.exec(normalized)) !== null) starts.push(m.index);
    for (let k = 0; k < starts.length; k++) {
      const end = k + 1 < starts.length ? starts[k + 1] : normalized.length;
      segments.push(normalized.slice(starts[k], end));
    }
  }
  for (const seg of segments) {
    const s = seg.trim();
    const colonIdx = s.indexOf(":");
    if (colonIdx < 0) continue;
    const key = s.slice(0, colonIdx).trim();
    // Strip any trailing entry delimiter the split left behind (", " / "; ").
    const val = s.slice(colonIdx + 1).trim().replace(/[;,]+\s*$/, "").trim();
    if (key) result[key] = val;
  }
  return result;
}

/**
 * Parse flat key-value pairs from block content.
 * Values may be simple strings (until end of line) or nested { } objects.
 * @param {string} text
 * @returns {Record<string, string | Record<string, string>>}
 */
function parseBlockProperties(text) {
  const props = {};
  const normalized = text.replace(/\r\n/g, "\n").trim();
  let i = 0;

  while (i < normalized.length) {
    // Skip whitespace
    while (i < normalized.length && /[ \t\n]/.test(normalized[i])) i++;
    if (i >= normalized.length) break;

    // Read key up to ':'
    const keyStart = i;
    while (i < normalized.length && normalized[i] !== ":" && normalized[i] !== "\n" && normalized[i] !== "}") i++;
    if (normalized[i] !== ":") {
      i++;
      continue;
    }
    const key = normalized.slice(keyStart, i).trim();
    i++; // skip ':'

    // Skip inline spaces
    while (i < normalized.length && normalized[i] === " ") i++;

    if (normalized[i] === "{") {
      // Find matching closing brace
      let depth = 1;
      let j = i + 1;
      while (j < normalized.length && depth > 0) {
        if (normalized[j] === "{") depth++;
        else if (normalized[j] === "}") depth--;
        j++;
      }
      const inner = normalized.slice(i + 1, j - 1);
      props[key] = parseNestedObject(inner);
      i = j;
    } else {
      // Simple string value until end of line; \n in source becomes real newline
      const valStart = i;
      while (i < normalized.length && normalized[i] !== "\n") i++;
      if (key) props[key] = normalized.slice(valStart, i).trim().replace(/\\n/g, "\n");
    }
  }

  return props;
}

/**
 * Parse .bmap source text into an AST.
 * @param {string} source
 * @returns {{ nodes: BmapNode[], connectors: BmapConnector[], parseErrors: string[] }}
 */
function parseBmap(source) {
  const content = String(source ?? "").replace(/\r\n/g, "\n");
  const nodes = [];
  const connectors = [];
  const parseErrors = [];

  // Match top-level .node { or .connect { blocks
  const blockPattern = /\.(node|connect)\s*\{/g;
  let match;

  while ((match = blockPattern.exec(content)) !== null) {
    const blockType = match[1];
    const bodyStart = match.index + match[0].length;

    // Find matching closing brace
    let depth = 1;
    let i = bodyStart;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }

    if (depth !== 0) {
      parseErrors.push(`Unclosed block at position ${match.index}`);
      break;
    }

    const blockBody = content.slice(bodyStart, i - 1);
    const props = parseBlockProperties(blockBody);

    if (blockType === "node") {
      nodes.push(createBmapNode({
        id: String(props.id ?? `node-${nodes.length + 1}`).trim(),
        name: props.name,
        text: props.text,
        shape: props.shape,
        pos: {
          x: props.pos?.x ?? 0,
          y: props.pos?.y ?? 0,
        },
        file: props.file ? String(props.file).trim() : null,
        styles: typeof props.styles === "object" ? props.styles : {},
      }));
    } else if (blockType === "connect") {
      connectors.push(createBmapConnector({
        from: props.from,
        to: props.to,
        styles: props.styles ?? {},
      }));
    }

    // Advance past this block so we don't re-enter it
    blockPattern.lastIndex = i;
  }
  return normalizeBmapAst({ nodes, connectors, parseErrors });
}

/**
 * Serialize an AST back to canonical .bmap text.
 * @param {{ nodes: BmapNode[], connectors: BmapConnector[] }} ast
 * @returns {string}
 */
function serializeBmap({ nodes, connectors }) {
  const normalized = normalizeBmapAst({ nodes, connectors, parseErrors: [] });
  const parts = [];

  for (const node of normalized.nodes) {
    const { width, height } = getBmapNodeDimensions(node);
    const styleEntries = Object.entries({
      ...normalizeBmapStyles(node.styles),
      width: String(width),
      height: String(height)
    });
    const lines = [".node {", `  id: ${node.id}`];
    if (node.name) lines.push(`  name: ${node.name.replace(/\n/g, "\\n")}`);
    if (node.text) lines.push(`  text: ${node.text.replace(/\n/g, "\\n")}`);
    lines.push(`  shape: ${node.shape ?? "rect"}`);
    lines.push(`  pos: {x: ${node.pos?.x ?? 0}, y: ${node.pos?.y ?? 0}}`);
    if (node.file) lines.push(`  file: ${node.file}`);
    if (styleEntries.length > 0) {
      lines.push("  styles: {");
      for (const [k, v] of styleEntries) lines.push(`    ${k}: ${v}`);
      lines.push("  }");
    }
    lines.push("}");
    parts.push(lines.join("\n"));
  }

  for (const conn of normalized.connectors) {
    const s = conn.styles ?? {};
    const lines = [
      ".connect {",
      `  from: ${conn.from}`,
      `  to: ${conn.to}`,
      "  styles: {",
      `    mode: ${s.mode ?? "bezier"}`,
      `    arrow: ${s.arrow ?? "end"}`,
      `    dashed: ${s.dashed ? "true" : "false"}`,
      `    thickness: ${s.thickness ?? 2}`,
      `    color: ${s.color ?? "#888888"}`,
      "  }",
      "}",
    ];
    parts.push(lines.join("\n"));
  }

  return parts.join("\n\n");
}

/**
 * Returns a starter .bmap file content.
 * @returns {string}
 */
function createDefaultBmap() {
  return `.node {
  id: node-1
  name: Start Here
  text: Your first idea
  shape: rect
  pos: {x: 60, y: 80}
  styles: {
    background: #fffbe6
    border: 1px solid #e8b339
    border-radius: 8px
    width: 220px
    height: 90px
  }
}

.node {
  id: node-2
  name: Next Step
  text: Build on the idea
  shape: rect
  pos: {x: 380, y: 80}
  styles: {
    background: #e6f4ff
    border: 1px solid #1677ff
    border-radius: 8px
    width: 220px
    height: 90px
  }
}

.connect {
  from: node-1.side.1
  to: node-2.side.3
  styles: {
    mode: bezier
    arrow: end
    dashed: false
    thickness: 2
    color: #1677ff
  }
}`;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isBmapFileName(name) {
  return name.toLowerCase().endsWith(".bmap");
}

export {
  BMAP_DEFAULT_CIRCLE_SIZE,
  BMAP_DEFAULT_RECT_HEIGHT,
  BMAP_DEFAULT_RECT_WIDTH,
  cloneBmapAst,
  createBmapConnector,
  createBmapNode,
  createDefaultBmap,
  getBmapNodeDimensions,
  isBmapFileName,
  normalizeBmapAst,
  parseBmap,
  serializeBmap,
};
