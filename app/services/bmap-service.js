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

/**
 * Parse a nested property object from a string.
 * Handles both comma-separated inline form ({x: 120, y: 80}) and multi-line form.
 * @param {string} text
 * @returns {Record<string, string>}
 */
function parseNestedObject(text) {
  const normalized = text.trim();
  const result = {};
  // Use line-split for multi-line, comma-split for single-line without newlines
  const segments = normalized.includes("\n")
    ? normalized.split("\n")
    : normalized.split(",");
  for (const seg of segments) {
    const colonIdx = seg.indexOf(":");
    if (colonIdx < 0) continue;
    const key = seg.slice(0, colonIdx).trim();
    const val = seg.slice(colonIdx + 1).trim();
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
      // Simple string value until end of line
      const valStart = i;
      while (i < normalized.length && normalized[i] !== "\n") i++;
      if (key) props[key] = normalized.slice(valStart, i).trim();
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
      nodes.push({
        id: String(props.id ?? `node-${nodes.length + 1}`).trim(),
        name: String(props.name ?? "").trim(),
        text: String(props.text ?? "").trim(),
        shape: String(props.shape ?? "rect").trim(),
        pos: {
          x: Number(props.pos?.x ?? 0) || 0,
          y: Number(props.pos?.y ?? 0) || 0,
        },
        file: props.file ? String(props.file).trim() : null,
        styles: typeof props.styles === "object" ? props.styles : {},
      });
    } else if (blockType === "connect") {
      connectors.push({
        from: String(props.from ?? "").trim(),
        to: String(props.to ?? "").trim(),
        styles: {
          mode: String(props.styles?.mode ?? "bezier").trim(),
          arrow: String(props.styles?.arrow ?? "end").trim(),
          dashed: String(props.styles?.dashed ?? "false").trim() === "true",
          thickness: Number(props.styles?.thickness ?? 2) || 2,
          color: String(props.styles?.color ?? "#888888").trim(),
        },
      });
    }

    // Advance past this block so we don't re-enter it
    blockPattern.lastIndex = i;
  }

  return { nodes, connectors, parseErrors };
}

/**
 * Serialize an AST back to canonical .bmap text.
 * @param {{ nodes: BmapNode[], connectors: BmapConnector[] }} ast
 * @returns {string}
 */
function serializeBmap({ nodes, connectors }) {
  const parts = [];

  for (const node of nodes) {
    const lines = [".node {", `  id: ${node.id}`];
    if (node.name) lines.push(`  name: ${node.name}`);
    if (node.text) lines.push(`  text: ${node.text}`);
    lines.push(`  shape: ${node.shape ?? "rect"}`);
    lines.push(`  pos: {x: ${node.pos?.x ?? 0}, y: ${node.pos?.y ?? 0}}`);
    if (node.file) lines.push(`  file: ${node.file}`);
    const styleEntries = Object.entries(node.styles ?? {});
    if (styleEntries.length > 0) {
      lines.push("  styles: {");
      for (const [k, v] of styleEntries) lines.push(`    ${k}: ${v}`);
      lines.push("  }");
    }
    lines.push("}");
    parts.push(lines.join("\n"));
  }

  for (const conn of connectors) {
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

export { parseBmap, serializeBmap, createDefaultBmap, isBmapFileName };
