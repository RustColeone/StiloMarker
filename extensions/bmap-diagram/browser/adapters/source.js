// Diagrams in the source editor, through the Editor's extension points:
// highlighting (highlighters), the formatting toolbar's buttons (toolbars)
// and autocomplete of blocks, properties and values (completions).
import { escapeHtmlAttribute } from "../../../../app/modules/editor/index.js";

// ── Highlighting ──
function createLineHighlighter(escapeEditorHtml, renderWhitespaceOnlyEditorLine) {
  function highlightBmapValue(rawVal) {
    const trimmed = rawVal.trim();
    if (!trimmed) return "";

    // Opening brace for styles: { sub-block
    if (trimmed === "{") {
      return `<span class="token-bmap-brace">${escapeEditorHtml(rawVal)}</span>`;
    }

    // Inline object: {x: 120, y: 80}
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const leading = escapeEditorHtml(rawVal.slice(0, rawVal.indexOf("{")));
      const inner = trimmed.slice(1, -1);
      const highlightedInner = inner.replace(/([a-zA-Z]\w*)(\s*:\s*)(-?\d+\.?\d*)/g, (m, k, sep, v) =>
        `<span class="token-bmap-style-key">${escapeEditorHtml(k)}</span><span class="token-bmap-sep">${escapeEditorHtml(sep)}</span><span class="token-bmap-number">${escapeEditorHtml(v)}</span>`
      );
      return `${leading}<span class="token-bmap-brace">{</span>${highlightedInner}<span class="token-bmap-brace">}</span>`;
    }

    // Keywords
    const BMAP_KEYWORDS = new Set(["rect", "circle", "bezier", "straight", "end", "start", "both", "none", "true", "false"]);
    if (BMAP_KEYWORDS.has(trimmed)) {
      return `<span class="token-bmap-keyword">${escapeEditorHtml(rawVal)}</span>`;
    }

    // Connector endpoint: nodeId.side.N
    const endpointMatch = trimmed.match(/^(\S+?)\.side\.([0-3])$/);
    if (endpointMatch) {
      const [, nodeId, idx] = endpointMatch;
      const leading = escapeEditorHtml(rawVal.slice(0, rawVal.indexOf(nodeId)));
      return `${leading}<span class="token-bmap-endpoint-node">${escapeEditorHtml(nodeId)}</span><span class="token-bmap-sep">.side.</span><span class="token-bmap-endpoint-side">${escapeEditorHtml(idx)}</span>`;
    }

    // Scan for hex color values (may appear mid-string, e.g., "1px solid #aaa")
    const colorPattern = /#([0-9a-fA-F]{3,8})\b/g;
    const parts = [];
    let lastIdx = 0;
    let m;
    while ((m = colorPattern.exec(rawVal)) !== null) {
      if (m.index > lastIdx) {
        parts.push(`<span class="token-bmap-value">${escapeEditorHtml(rawVal.slice(lastIdx, m.index))}</span>`);
      }
      const hex = m[0];
      parts.push(`<span class="token-color-swatch" style="background:${escapeHtmlAttribute(hex)}"></span><span class="token-bmap-color">${escapeEditorHtml(hex)}</span>`);
      lastIdx = m.index + hex.length;
    }
    if (parts.length > 0) {
      if (lastIdx < rawVal.length) {
        parts.push(`<span class="token-bmap-value">${escapeEditorHtml(rawVal.slice(lastIdx))}</span>`);
      }
      return parts.join("");
    }

    // Plain number (with optional unit)
    if (/^\s*-?\d+(\.\d+)?(px|em|rem|%|pt)?\s*$/.test(rawVal)) {
      return `<span class="token-bmap-number">${escapeEditorHtml(rawVal)}</span>`;
    }

    return `<span class="token-bmap-value">${escapeEditorHtml(rawVal)}</span>`;
  }


  return (rawLine) => {
      const trimmed = rawLine.trimStart();
      const indent = escapeEditorHtml(rawLine.slice(0, rawLine.length - trimmed.length));

      if (!trimmed) return renderWhitespaceOnlyEditorLine(rawLine);

      // Comment
      if (trimmed.startsWith("//")) {
        return `<div class="editor-line"><span class="token-bmap-comment">${escapeEditorHtml(rawLine)}</span></div>`;
      }

      // Block opener: .node { or .connect {
      const blockOpenMatch = trimmed.match(/^(\.(node|connect))(\s*\{.*)$/);
      if (blockOpenMatch) {
        const [, selector, , rest] = blockOpenMatch;
        return `<div class="editor-line">${indent}<span class="token-bmap-selector">${escapeEditorHtml(selector)}</span><span class="token-bmap-brace">${escapeEditorHtml(rest)}</span></div>`;
      }

      // Closing brace
      if (trimmed === "}") {
        return `<div class="editor-line">${indent}<span class="token-bmap-brace">}</span></div>`;
      }

      // Key: value line
      const kvMatch = trimmed.match(/^([a-zA-Z][\w-]*)(\s*:\s*)(.*)$/);
      if (kvMatch) {
        const [, key, sep, val] = kvMatch;
        return `<div class="editor-line">${indent}<span class="token-bmap-key">${escapeEditorHtml(key)}</span><span class="token-bmap-sep">${escapeEditorHtml(sep)}</span>${highlightBmapValue(val)}</div>`;
      }

      return `<div class="editor-line">${escapeEditorHtml(rawLine)}</div>`;
  };
}

let highlightLine = null;
export const highlighter = {
  // A line's HTML depends only on its text (the Editor memoizes it per line).
  line: (rawLine, { escape, blank }) => (highlightLine ??= createLineHighlighter(escape, blank))(rawLine)
};

// ── The formatting toolbar ──
const BMAP_NODE_RECT_SNIPPET = `.node {
  id: node-id
  name: Node Name
  text: Description
  shape: rect
  pos: {x: 60, y: 60}
}
`;

const BMAP_NODE_CIRCLE_SNIPPET = `.node {
  id: node-id
  name: Node Name
  text: Description
  shape: circle
  pos: {x: 60, y: 60}
}
`;

const BMAP_CONNECT_SNIPPET = `.connect {
  from: node-a.side.1
  to: node-b.side.3
  styles: {
    mode: bezier
    arrow: end
  }
}
`;

export const toolbarGroups = [
  [
    { id: "bmap-node-rect", html: "Node&nbsp;&#9645;", title: "Insert rectangle node", action: { kind: "block", snippet: BMAP_NODE_RECT_SNIPPET, caret: 14 } },
    { id: "bmap-node-circle", html: "Node&nbsp;&#9711;", title: "Insert circle node", action: { kind: "block", snippet: BMAP_NODE_CIRCLE_SNIPPET, caret: 14 } },
    { id: "bmap-connect", html: "Connection", title: "Insert connection", action: { kind: "block", snippet: BMAP_CONNECT_SNIPPET } }
  ]
];

// ── Autocomplete ──
function createCompletions() {

  /** Determine block depth and type at a given cursor position in a .bmap source. */
  function findBmapBlockContext(before) {
    let depth = 0;
    let currentBlockType = null;
    const re = /\.(node|connect)\s*\{|\{|\}/g;
    let m;
    while ((m = re.exec(before)) !== null) {
      if (m[1]) {
        if (depth === 0) currentBlockType = m[1];
        depth++;
      } else if (m[0] === "{") {
        depth++;
      } else {
        depth--;
        if (depth <= 0) { depth = 0; currentBlockType = null; }
      }
    }
    return { depth, blockType: currentBlockType, inStylesBlock: depth >= 2 };
  }

  /** Build an autocomplete context object for .bmap files. */
  function findBmapAutocompleteContext({ text: value, cursor, force }) {
    const before = value.slice(0, cursor);
    const lineStart = before.lastIndexOf("\n") + 1;
    const linePrefix = before.slice(lineStart);
    const trimmedPrefix = linePrefix.trimStart();
    const { depth, blockType, inStylesBlock } = findBmapBlockContext(before);

    // Inside styles sub-block (depth >= 2)
    if (inStylesBlock) {
      const styleKvMatch = linePrefix.match(/^\s*([\w-]+)\s*:\s*(\w*)$/);
      if (styleKvMatch) {
        const key = styleKvMatch[1].toLowerCase();
        const token = styleKvMatch[2];
        if (key === "mode")   return { kind: "bmap-mode-value",   token, start: cursor - token.length, end: cursor };
        if (key === "arrow")  return { kind: "bmap-arrow-value",  token, start: cursor - token.length, end: cursor };
        if (key === "dashed") return { kind: "bmap-dashed-value", token, start: cursor - token.length, end: cursor };
      }
      const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
      if (propKeyMatch && (propKeyMatch[1] || force)) {
        const token = propKeyMatch[1];
        return { kind: "bmap-style-prop", token, start: cursor - token.length, end: cursor };
      }
      return null;
    }

    // Inside a .node or .connect block (depth === 1)
    if (depth === 1 && blockType) {
      if (blockType === "connect") {
        const sideIdxMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.side\.(\d*)$/);
        if (sideIdxMatch) {
          const token = sideIdxMatch[2];
          return { kind: "bmap-side-index", token, start: cursor - token.length, end: cursor };
        }
        const sideKeyMatch = linePrefix.match(/^\s*(from|to)\s*:\s*\S+\.(\w*)$/);
        if (sideKeyMatch) {
          const token = sideKeyMatch[2];
          return { kind: "bmap-side-key", token, start: cursor - token.length, end: cursor };
        }
        const endpointMatch = linePrefix.match(/^\s*(from|to)\s*:\s*([A-Za-z0-9_-]*)$/);
        if (endpointMatch) {
          const token = endpointMatch[2];
          return { kind: "bmap-endpoint-node", token, start: cursor - token.length, end: cursor };
        }
      }
      const shapeMatch = linePrefix.match(/^\s*shape\s*:\s*(\w*)$/);
      if (shapeMatch) {
        const token = shapeMatch[1];
        return { kind: "bmap-shape-value", token, start: cursor - token.length, end: cursor };
      }
      if (blockType === "node") {
        const fileMatch = linePrefix.match(/^\s*file\s*:\s*(.*)$/);
        if (fileMatch) {
          const token = fileMatch[1];
          return { kind: "bmap-file-value", token, start: cursor - token.length, end: cursor };
        }
      }
      const propKeyMatch = linePrefix.match(/^\s*([\w-]*)$/);
      if (propKeyMatch && (propKeyMatch[1] || force)) {
        const token = propKeyMatch[1];
        const kind = blockType === "node" ? "bmap-node-prop" : "bmap-connect-prop";
        return { kind, token, start: cursor - token.length, end: cursor };
      }
      return null;
    }

    // Top level (depth === 0): suggest block types after a leading "."
    if (depth === 0) {
      const blockTypeMatch = linePrefix.match(/^\s*\.(\w*)$/);
      if (blockTypeMatch) {
        const token = blockTypeMatch[1];
        return { kind: "bmap-block-type", token, start: cursor - token.length, end: cursor };
      }
      if (force && !trimmedPrefix) {
        return { kind: "bmap-block-type", token: "", start: cursor, end: cursor };
      }
    }

    return null;
  }

  const BMAP_AUTOCOMPLETE_LABELS = {
    "bmap-block-type":    "Block type",
    "bmap-node-prop":     "Node properties",
    "bmap-connect-prop":  "Connect properties",
    "bmap-style-prop":    "Style properties",
    "bmap-shape-value":   "Shape",
    "bmap-mode-value":    "Connector mode",
    "bmap-arrow-value":   "Arrow style",
    "bmap-dashed-value":  "Dashed line",
    "bmap-side-key":      "Side segment",
    "bmap-side-index":    "Side — 0 top · 1 right · 2 bottom · 3 left",
    "bmap-endpoint-node": "Node ID",
    "bmap-file-value":    "Project files",
  };

  function getBmapAutocompleteItems(context, { file: activeFile, projectFiles }) {
    const token = context.token.toLowerCase();
    const filter = (items) =>
      items.filter((item) => !token || item.label.toLowerCase().startsWith(token) || item.insertText.toLowerCase().startsWith(token));

    switch (context.kind) {
      case "bmap-block-type":
        return filter([
          { label: "node",    detail: "Diagram node — id, name, pos, shape, file, styles", insertText: "node {\n  id: \n  name: \n  pos: {x: 0, y: 0}\n}" },
          { label: "connect", detail: "Connector between two nodes",                        insertText: "connect {\n  from: .side.1\n  to: .side.3\n}" },
        ]);

      case "bmap-node-prop":
        return filter([
          { label: "id:",     detail: "Unique node identifier",                        insertText: "id: " },
          { label: "name:",   detail: "Display label shown in the node header",        insertText: "name: " },
          { label: "text:",   detail: "Secondary description text in the node body",   insertText: "text: " },
          { label: "shape:",  detail: "Node shape: rect or circle",                    insertText: "shape: " },
          { label: "pos:",    detail: "Position as {x: N, y: N}",                      insertText: "pos: {x: 0, y: 0}" },
          { label: "file:",   detail: "Link to a project file (shown via ⊞ preview)", insertText: "file: " },
          { label: "styles:", detail: "CSS style overrides block",                     insertText: "styles: {\n  \n}" },
        ]);

      case "bmap-connect-prop":
        return filter([
          { label: "from:",   detail: "Source endpoint — nodeId.side.N", insertText: "from: " },
          { label: "to:",     detail: "Target endpoint — nodeId.side.N", insertText: "to: " },
          { label: "styles:", detail: "Connector appearance block",       insertText: "styles: {\n  \n}" },
        ]);

      case "bmap-style-prop":
        return filter([
          { label: "background:",   detail: "Fill color, e.g. #fff8dc",           insertText: "background: " },
          { label: "border:",       detail: "Border shorthand, e.g. 1px solid #aaa", insertText: "border: " },
          { label: "border-radius:", detail: "Corner radius",                      insertText: "border-radius: " },
          { label: "color:",        detail: "Text or stroke color",                insertText: "color: " },
          { label: "font-size:",    detail: "Font size, e.g. 12px",               insertText: "font-size: " },
          { label: "font-weight:",  detail: "Font weight: bold or normal",        insertText: "font-weight: " },
          { label: "width:",        detail: "Node width in px",                   insertText: "width: " },
          { label: "opacity:",      detail: "Opacity 0–1",                        insertText: "opacity: " },
          { label: "mode:",         detail: "bezier or straight",                 insertText: "mode: " },
          { label: "arrow:",        detail: "end, start, both, or none",          insertText: "arrow: " },
          { label: "dashed:",       detail: "true or false",                      insertText: "dashed: " },
          { label: "thickness:",    detail: "Stroke width in px",                 insertText: "thickness: " },
        ]);

      case "bmap-shape-value":
        return filter([
          { label: "rect",   detail: "Rounded rectangle (default)", insertText: "rect" },
          { label: "circle", detail: "Circle / oval",               insertText: "circle" },
        ]);

      case "bmap-mode-value":
        return filter([
          { label: "bezier",   detail: "Curved connector (default)", insertText: "bezier" },
          { label: "straight", detail: "Straight line connector",    insertText: "straight" },
        ]);

      case "bmap-arrow-value":
        return filter([
          { label: "end",   detail: "Arrow at destination (default)", insertText: "end" },
          { label: "start", detail: "Arrow at source",                insertText: "start" },
          { label: "both",  detail: "Arrows at both ends",            insertText: "both" },
          { label: "none",  detail: "No arrowheads",                  insertText: "none" },
        ]);

      case "bmap-dashed-value":
        return filter([
          { label: "false", detail: "Solid line (default)", insertText: "false" },
          { label: "true",  detail: "Dashed line",          insertText: "true" },
        ]);

      case "bmap-side-key":
        return [{ label: "side", detail: "Side segment — follow with .N (0=top 1=right 2=bottom 3=left)", insertText: "side" }];

      case "bmap-side-index":
        return filter([
          { label: "0", detail: "Top",    insertText: "0" },
          { label: "1", detail: "Right",  insertText: "1" },
          { label: "2", detail: "Bottom", insertText: "2" },
          { label: "3", detail: "Left",   insertText: "3" },
        ]);

      case "bmap-endpoint-node": {
        const content = activeFile?.content ?? "";
        const nodeIds = [...content.matchAll(/^\s*id\s*:\s*(\S+)/gm)].map((nm) => nm[1]);
        return filter(nodeIds.map((id) => ({
          label: id,
          detail: "Node ID — follow with .side.N",
          insertText: id,
        })));
      }

      case "bmap-file-value":
        return projectFiles("path")
          .filter((item) => !token || item.insertText.toLowerCase().includes(token) || item.label.toLowerCase().includes(token));

      default:
        return [];
    }
  }


  return {
    find: findBmapAutocompleteContext,
    items: getBmapAutocompleteItems,
    label: (context) => BMAP_AUTOCOMPLETE_LABELS[context.kind] ?? "bmap"
  };
}
export const completions = createCompletions();
