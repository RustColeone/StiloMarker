// Mermaid source, without the page: highlighting one line at a time (the
// Editor's `highlighters`; `escape` and `blank` are its helpers), the
// formatting toolbar's snippets, and a new file's first diagram.

// A diagram's first word, the words inside diagrams, links ("-->", "->>",
// "-.->", "==>", "--x"), quoted text and edge labels ("|yes|").
const DIAGRAMS = ["flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "stateDiagram-v2", "erDiagram",
  "gantt", "pie", "journey", "mindmap", "timeline", "gitGraph", "quadrantChart", "requirementDiagram", "C4Context",
  "sankey-beta", "xychart-beta", "block-beta", "packet-beta", "architecture-beta", "kanban"];
const KEYWORDS = ["subgraph", "end", "direction", "participant", "actor", "note", "loop", "alt", "else", "opt", "par", "and",
  "critical", "break", "rect", "activate", "deactivate", "title", "section", "class", "classDef", "style", "linkStyle",
  "state", "autonumber", "dateFormat", "axisFormat", "over", "as", "TB", "TD", "BT", "LR", "RL"];
const words = (list) => list.map((word) => word.replace(/[-]/g, "\\-")).join("|");
const TOKENS = new RegExp([
  `(?<string>"[^"]*")`,
  `(?<label>\\|[^|\\n]*\\|)`,
  `(?<link><?(?:-{2,}|={2,}|-\\.+-?|~{3})(?:>>|>|x|o|\\))?|->>|-\\)|-x)`,
  `(?<diagram>(?<![\\w-])(?:${words(DIAGRAMS)})(?![\\w-]))`,
  `(?<keyword>(?<![\\w-])(?:${words(KEYWORDS)})(?![\\w-]))`
].join("|"), "g");

export function highlightMermaidLine(rawLine, { escape, blank }) {
  if (!rawLine.trim()) return blank(rawLine);
  if (rawLine.trimStart().startsWith("%%")) return `<div class="editor-line"><span class="token-mermaid-comment">${escape(rawLine)}</span></div>`;
  let html = "";
  let last = 0;
  for (const match of rawLine.matchAll(TOKENS)) {
    const kind = Object.keys(match.groups).find((name) => match.groups[name] !== undefined);
    html += `${escape(rawLine.slice(last, match.index))}<span class="token-mermaid-${kind}">${escape(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return `<div class="editor-line">${html}${escape(rawLine.slice(last))}</div>`;
}

// The formatting toolbar's diagrams to start from.
export const SNIPPETS = [
  { id: "mermaid-flowchart", html: "Flowchart", title: "Insert a flowchart",
    snippet: "flowchart LR\n    A[Start] --> B{Choice}\n    B -->|Yes| C[Done]\n    B -->|No| D[Try again]\n" },
  { id: "mermaid-sequence", html: "Sequence", title: "Insert a sequence diagram",
    snippet: "sequenceDiagram\n    participant A as Alice\n    participant B as Bob\n    A->>B: Hello\n    B-->>A: Hi!\n" },
  { id: "mermaid-mindmap", html: "Mind map", title: "Insert a mind map",
    snippet: "mindmap\n  root((Topic))\n    Idea\n      Detail\n    Another idea\n" }
];

export const STARTER = "flowchart LR\n    A[Start] --> B[Done]\n";
