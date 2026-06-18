// Adaptive, data-driven formatting toolbar for the source editor.
//
// Each editor format declares its toolbar buttons as plain data (TOOLBAR_SPECS).
// A generic interpreter in main.js maps each button's declarative `action` onto
// the existing editor insert primitives, so no format-specific insertion logic
// lives here — this module stays pure (no DOM access at import time) and is
// unit-testable in isolation.
//
// Action kinds:
//   { kind: "wrap",  before, after, placeholder }  inline wrap around selection
//   { kind: "prefix", prefix }                     line-oriented prefix
//   { kind: "prefix", numbered: true }             numbered list prefix
//   { kind: "block",  snippet, caret }             multi-line block insert
//   { kind: "table" }                              opens the table grid-picker

import { isBmapFileName, isTextFileName, isUrlDbFileName } from "../domain/project-model.js";

/** Map a file name to its toolbar format, or null when no toolbar applies. */
function getEditorToolbarFormat(fileName) {
  const name = String(fileName ?? "");
  if (!isTextFileName(name)) return null;
  if (isBmapFileName(name)) return "bmap";
  if (isUrlDbFileName(name)) return "urldb";
  if (name.toLowerCase().endsWith(".mtree")) return "mtree";
  if (name.toLowerCase().endsWith(".md")) return "markdown";
  return null;
}

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

const MTREE_NOTE_SNIPPET = `[Node Name]
Note: Description
`;

const URLDB_ENTRY_SNIPPET = `[Entry Name]
url = https://
description = Description
`;

// Button groups per format. Groups are separated by a divider when rendered.
const TOOLBAR_SPECS = {
  markdown: [
    [
      { id: "md-bold", html: "<strong>B</strong>", title: "Bold (Ctrl+B)", action: { kind: "wrap", before: "**", after: "**", placeholder: "bold text" } },
      { id: "md-italic", html: "<em>I</em>", title: "Italic (Ctrl+I)", action: { kind: "wrap", before: "*", after: "*", placeholder: "italic text" } },
      { id: "md-strike", html: "<s>S</s>", title: "Strikethrough", action: { kind: "wrap", before: "~~", after: "~~", placeholder: "strikethrough" } },
      { id: "md-code", html: "&lt;&gt;", title: "Inline code", action: { kind: "wrap", before: "`", after: "`", placeholder: "code" } }
    ],
    [
      { id: "md-heading", html: "H", title: "Heading", action: { kind: "prefix", prefix: "## " } },
      { id: "md-ul", html: "&bull;&nbsp;", title: "Bullet list", action: { kind: "prefix", prefix: "- " } },
      { id: "md-ol", html: "1.", title: "Numbered list", action: { kind: "prefix", numbered: true } },
      { id: "md-quote", html: "&ldquo;", title: "Blockquote", action: { kind: "prefix", prefix: "> " } },
      { id: "md-task", html: "&#9745;", title: "Task list", action: { kind: "prefix", prefix: "- [ ] " } }
    ],
    [
      { id: "md-link", html: "&#128279;", title: "Link", action: { kind: "wrap", before: "[", after: "](url)", placeholder: "link text" } },
      { id: "md-image", html: "&#128247;", title: "Image", action: { kind: "wrap", before: "![", after: "](url)", placeholder: "alt text" } },
      { id: "md-table", html: "Table", title: "Insert table", action: { kind: "table" } },
      { id: "md-codeblock", html: "Code", title: "Code block", action: { kind: "block", snippet: "```\n\n```\n", caret: 4 } },
      { id: "md-hr", html: "&horbar;", title: "Horizontal rule", action: { kind: "block", snippet: "---\n" } }
    ]
  ],
  bmap: [
    [
      { id: "bmap-node-rect", html: "Node&nbsp;&#9645;", title: "Insert rectangle node", action: { kind: "block", snippet: BMAP_NODE_RECT_SNIPPET, caret: 14 } },
      { id: "bmap-node-circle", html: "Node&nbsp;&#9711;", title: "Insert circle node", action: { kind: "block", snippet: BMAP_NODE_CIRCLE_SNIPPET, caret: 14 } },
      { id: "bmap-connect", html: "Connection", title: "Insert connection", action: { kind: "block", snippet: BMAP_CONNECT_SNIPPET } }
    ]
  ],
  mtree: [
    [
      { id: "mtree-node", html: "Node", title: "Insert node", action: { kind: "block", snippet: "Node Name\n" } },
      { id: "mtree-child", html: "Child", title: "Insert child (one level deeper than the current line)", action: { kind: "mtree-child", text: "Child Name" } },
      { id: "mtree-chain", html: "A&rarr;B", title: "Insert chain", action: { kind: "block", snippet: "Parent -> Child\n" } },
      { id: "mtree-note", html: "Note", title: "Insert note block", action: { kind: "block", snippet: MTREE_NOTE_SNIPPET } }
    ]
  ],
  urldb: [
    [
      { id: "urldb-entry", html: "Entry", title: "Insert entry", action: { kind: "block", snippet: URLDB_ENTRY_SNIPPET, caret: 1 } }
    ]
  ]
};

/** Build a Markdown-pipe or HTML table string for the given dimensions. */
function buildTableSnippet({ rows, cols, kind = "markdown" }) {
  const rowCount = Math.max(1, Math.floor(rows));
  const colCount = Math.max(1, Math.floor(cols));

  if (kind === "html") {
    const lines = ["<table>", "  <thead>", "    <tr>"];
    for (let c = 0; c < colCount; c += 1) lines.push(`      <th>Column ${c + 1}</th>`);
    lines.push("    </tr>", "  </thead>", "  <tbody>");
    for (let r = 0; r < rowCount; r += 1) {
      lines.push("    <tr>");
      for (let c = 0; c < colCount; c += 1) lines.push("      <td>Cell</td>");
      lines.push("    </tr>");
    }
    lines.push("  </tbody>", "</table>", "");
    return lines.join("\n");
  }

  const header = `| ${Array.from({ length: colCount }, (_, c) => `Column ${c + 1}`).join(" | ")} |`;
  const separator = `| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`;
  const bodyRows = Array.from(
    { length: rowCount },
    () => `| ${Array.from({ length: colCount }, () => "Cell").join(" | ")} |`
  );
  return `${[header, separator, ...bodyRows].join("\n")}\n`;
}

/**
 * Render a format's toolbar buttons into `container`. The caller owns the action
 * dispatch via `onAction(action, buttonEl)`. Returns the rendered format so the
 * caller can cache it and skip rebuilds when the format is unchanged.
 */
function renderEditorFormatToolbar(container, format, { onAction } = {}) {
  container.replaceChildren();
  const groups = TOOLBAR_SPECS[format] ?? [];

  groups.forEach((group, groupIndex) => {
    if (groupIndex > 0) {
      const separator = document.createElement("span");
      separator.className = "format-toolbar-sep";
      separator.setAttribute("aria-hidden", "true");
      container.append(separator);
    }
    group.forEach((button) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "format-toolbar-btn";
      element.dataset.toolbarButtonId = button.id;
      element.title = button.title;
      element.innerHTML = button.html;
      element.addEventListener("mousedown", (event) => {
        // preventDefault keeps the editor selection intact while clicking.
        event.preventDefault();
        onAction?.(button.action, element);
      });
      container.append(element);
    });
  });

  return format;
}

export { TOOLBAR_SPECS, buildTableSnippet, getEditorToolbarFormat, renderEditorFormatToolbar };
