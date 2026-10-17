// Source-pane syntax highlighting for Markdown, .mtree and .bmap files, and
// for formats added to the `highlighters` extension point (app.highlighters:
// { id: format, line(rawLine, { escape, blank }) -> one `editor-line` div }),
// with a per-line memo so typing re-highlights only changed lines.
// main.js creates this on first use and passes its shared values in `app`.
import { builtinTypes } from "../../file-types/index.js";

export function createHighlighter(app) {
  function escapeEditorHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function applyInlineHighlighting(value) {
    return value
      .replace(/(`[^`]*`)/g, '<span class="token-inline-code">$1</span>')
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, text, href) => {
        const attrHref = href.replace(/"/g, '&quot;');
        return `<span class="token-link" data-href="${attrHref}">[${text}](${href})</span>`;
      })
      .replace(/(\*\*[^*]+\*\*)/g, '<span class="token-strong">$1</span>')
      .replace(/(^|[^*])(\*[^*]+\*)/g, '$1<span class="token-emphasis">$2</span>');
  }

  function renderWhitespaceOnlyEditorLine(rawLine) {
    if (rawLine.length === 0) {
      return '<div class="editor-line"></div>';
    }
    return `<div class="editor-line">${escapeEditorHtml(rawLine)}</div>`;
  }

  /** Highlight an mtree chain ("Parent -> Child", indentation, or a single name).
   *  Splits on the literal "->" arrows and tokenises each segment separately so we
   *  never run name-matching regexes over already-inserted span markup. */
  function highlightMtreeChain(chainPart) {
    const segments = chainPart.split("->");
    return segments
      .map((segment, index) => {
        const leading = segment.match(/^\s*/)[0];
        const trailing = segment.match(/\s*$/)[0];
        const core = segment.slice(leading.length, segment.length - trailing.length);
        let coreHtml = "";
        if (core === "...") {
          coreHtml = '<span class="token-mtree-continuation">...</span>';
        } else if (core) {
          coreHtml = `<span class="token-mtree-name">${escapeEditorHtml(core)}</span>`;
        }
        const arrow = index < segments.length - 1
          ? '<span class="token-mtree-chain-arrow">-&gt;</span>'
          : "";
        return `${escapeEditorHtml(leading)}${coreHtml}${escapeEditorHtml(trailing)}${arrow}`;
      })
      .join("");
  }

  function highlightMtreeLines(value) {
    const lines = value.replace(/\r\n/g, "\n").split("\n");

    return lines.map((rawLine) => {
      const escaped = escapeEditorHtml(rawLine);
      const trimmed = rawLine.trimStart();

      if (!trimmed) {
        return renderWhitespaceOnlyEditorLine(rawLine);
      }

      if (trimmed.startsWith("#")) {
        return `<div class="editor-line"><span class="token-mtree-comment">${escaped}</span></div>`;
      }

      if (/^\[[^\]]+\]$/.test(trimmed)) {
        const [, name] = trimmed.match(/^\[([^\]]+)\]$/);
        const indent = escapeEditorHtml(rawLine.slice(0, rawLine.indexOf("[")));
        return `<div class="editor-line">${indent}<span class="token-mtree-section-mark">[</span><span class="token-mtree-section-name">${escapeEditorHtml(name)}</span><span class="token-mtree-section-mark">]</span></div>`;
      }

      if (trimmed.startsWith("|")) {
        const indent = escapeEditorHtml(rawLine.slice(0, rawLine.indexOf("|")));
        return `<div class="editor-line">${indent}<span class="token-mtree-continuation">|</span><span class="token-mtree-description">${escapeEditorHtml(trimmed.slice(1))}</span></div>`;
      }

      const semicolonIndex = rawLine.indexOf(";");
      const chainPart = semicolonIndex >= 0 ? rawLine.slice(0, semicolonIndex) : rawLine;
      const descriptionPart = semicolonIndex >= 0 ? rawLine.slice(semicolonIndex + 1) : "";
      const chainHtml = highlightMtreeChain(chainPart);

      const descriptionHtml = semicolonIndex >= 0
        ? `<span class="token-mtree-section-mark">;</span><span class="token-mtree-description">${escapeEditorHtml(descriptionPart)}</span>`
        : "";

      return `<div class="editor-line">${chainHtml}${descriptionHtml}</div>`;
    });
  }

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
      parts.push(`<span class="token-color-swatch" style="background:${app.escapeHtmlAttribute(hex)}"></span><span class="token-bmap-color">${escapeEditorHtml(hex)}</span>`);
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

  function highlightBmapLines(value) {
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    return lines.map((rawLine) => {
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
    });
  }

  // One markdown source line → its editor HTML, given whether it starts inside a
  // ``` fence. Returns the fence state after it. Highlighting is otherwise
  // line-local, which is what lets renderEditorContent memoize it per line.
  function highlightMarkdownLine(rawLine, inFence) {
    const escaped = escapeEditorHtml(rawLine);
    const trimmed = rawLine.trimStart();

    if (!trimmed) {
      return { html: renderWhitespaceOnlyEditorLine(rawLine), inFence };
    }

    if (trimmed.startsWith("```")) {
      return { html: `<div class="editor-line"><span class="token-fence">${escaped}</span></div>`, inFence: !inFence };
    }

    if (inFence) {
      return { html: `<div class="editor-line"><span class="token-code-block">${escaped}</span></div>`, inFence };
    }

    if (/^\s*#{1,6}\s/.test(rawLine)) {
      const [, indent, hashes, space, text] = rawLine.match(/^(\s*)(#{1,6})(\s+)(.*)$/);
      return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-heading-mark">${escapeEditorHtml(hashes)}</span>${escapeEditorHtml(space)}<span class="token-heading-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`, inFence };
    }

    if (/^\s*-\s+/.test(rawLine)) {
      const [, indent, marker, text] = rawLine.match(/^(\s*)(-)\s+(.*)$/);
      return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-list-mark">${marker}</span> ${applyInlineHighlighting(escapeEditorHtml(text || ""))}</div>`, inFence };
    }

    if (/^\s*>\s?/.test(rawLine)) {
      const [, indent, marker, text] = rawLine.match(/^(\s*)(>)(\s?.*)$/);
      return { html: `<div class="editor-line">${escapeEditorHtml(indent)}<span class="token-quote-mark">${marker}</span><span class="token-quote-text">${applyInlineHighlighting(escapeEditorHtml(text || ""))}</span></div>`, inFence };
    }

    return { html: `<div class="editor-line">${applyInlineHighlighting(escaped)}</div>`, inFence };
  }

  function highlightMarkdownLines(value) {
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    let inFence = false;
    return lines.map((rawLine) => {
      const result = highlightMarkdownLine(rawLine, inFence);
      inFence = result.inFence;
      return result.html;
    });
  }

  function highlightMarkdownSource(value) {
    return highlightMarkdownLines(value).join("");
  }

  /** Re-render syntax-highlighted DOM from plain text and rebuild the gutter.
   *  Does NOT modify the selection — callers are responsible for restoring it. */
  // ── Incremental editor rendering ────────────────────────────────────────────
  // Every keystroke used to rebuild the whole editor (innerHTML of every line) and
  // then measure every line's height for the gutter. On a novel-length chapter
  // (~90k chars, ~2,400 lines) that discarded and re-laid-out ~18k nodes per key,
  // and every later layout read in the same task — scroll sync, caret, chat panel —
  // paid for a full-document relayout again: ~10 forced layouts per keystroke.
  //
  // Now each line's HTML is computed as before (whole text, so multi-line state
  // like ``` fences stays correct) but only DOM lines whose HTML actually changed
  // are replaced. Unchanged lines keep their element, their layout, and their
  // cached gutter height, so a keystroke re-lays-out one line instead of all.
  //
  // Correctness rests on knowing the DOM still matches the cache. Native edits
  // (and mobile keyboards, which can inject bare <div>s) mutate it behind our back,
  // so a line is reused only if it is the same element we rendered AND its text and
  // child count are still what we rendered. Anything else is re-rendered, and any
  // doubt — new file, different highlighter, stray text nodes, a count mismatch
  // afterwards — falls back to the old full rebuild.

  // The highlighter follows the file's format (File types module); anything
  // else highlights as Markdown.
  const HIGHLIGHTED_FORMATS = new Set(["mtree", "bmap"]);
  const added = (format) => app.highlighters?.get(format) ?? null;
  function editorHighlightKind(name) {
    const format = builtinTypes.formatOf(name ?? "");
    return HIGHLIGHTED_FORMATS.has(format) || added(format) ? format : "markdown";
  }

  const lineTools = { escape: escapeEditorHtml, blank: renderWhitespaceOnlyEditorLine };
  function highlightEditorLines(kind, normalized) {
    if (kind === "mtree") return highlightMtreeLines(normalized);
    if (kind === "bmap") return highlightBmapLines(normalized);
    const highlighter = added(kind);
    if (highlighter) return normalized.replace(/\r\n/g, "\n").split("\n").map((line) => highlighter.line(line, lineTools));
    return highlightMarkdownLines(normalized);
  }

  // Highlighted HTML per distinct source line. Re-highlighting every line on every
  // keystroke allocated tens of thousands of short-lived strings per key on a
  // long chapter, and the garbage collector's pauses (up to ~200ms) became most
  // of the typing latency. A line's HTML depends only on its text — plus, for
  // markdown, whether it starts inside a ``` fence — so it is computed once.
  const editorLineMemo = { kind: null, maps: [new Map(), new Map()] };

  function highlightEditorLinesMemo(kind, lines) {
    if (editorLineMemo.kind !== kind) {
      editorLineMemo.kind = kind;
      editorLineMemo.maps = [new Map(), new Map()];
    }
    const maps = editorLineMemo.maps;
    if (maps[0].size + maps[1].size > Math.max(20000, lines.length * 4)) {
      maps[0].clear();
      maps[1].clear();
    }
    const out = new Array(lines.length);
    if (kind === "markdown") {
      let inFence = false;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const map = maps[inFence ? 1 : 0];
        let hit = map.get(line);
        if (hit === undefined) {
          const result = highlightMarkdownLine(line, inFence);
          hit = { html: result.html, inFence: result.inFence, plain: null };
          map.set(line, hit);
        }
        out[i] = hit;
        inFence = hit.inFence;
      }
    } else {
      const map = maps[0];
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        let hit = map.get(line);
        if (hit === undefined) {
          // The other highlighters are stateless per line.
          hit = { html: highlightEditorLines(kind, line)[0], inFence: false, plain: null };
          map.set(line, hit);
        }
        out[i] = hit;
      }
    }
    return out;
  }

  return { editorHighlightKind, escapeEditorHtml, highlightEditorLinesMemo, highlightMarkdownSource };
}
