function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function preserveHtmlFragments(value) {
  const fragments = [];
  const tokenized = value.replace(/<!--(?:[\s\S]*?)-->|<\/?[A-Za-z][^>]*?>/g, (fragment) => {
    const token = `__MDNOTES_HTML_${fragments.length}__`;
    fragments.push(fragment);
    return token;
  });

  return { tokenized, fragments };
}

function restoreHtmlFragments(value, fragments) {
  return value.replace(/__MDNOTES_HTML_(\d+)__/g, (_, index) => fragments[Number(index)] ?? "");
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeReferenceLabel(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function restoreTokens(value, tokenPrefix, fragments) {
  return value.replace(new RegExp(`${tokenPrefix}(\\d+)__`, "g"), (_, index) => fragments[Number(index)] ?? "");
}

function findClosingDelimiter(value, startIndex, openChar, closeChar) {
  let depth = 0;
  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function parseLinkTarget(rawTarget) {
  const target = String(rawTarget ?? "").trim();
  if (!target) {
    return null;
  }

  let href = "";
  let rest = "";
  const isAngle = target.startsWith("<");

  if (target.startsWith("<")) {
    const endIndex = target.indexOf(">");
    if (endIndex <= 0) {
      return null;
    }
    href = target.slice(1, endIndex).trim();
    rest = target.slice(endIndex + 1).trim();
  } else {
    let splitIndex = target.length;
    let parenDepth = 0;
    for (let index = 0; index < target.length; index += 1) {
      const char = target[index];
      if (char === "\\") {
        index += 1;
        continue;
      }
      if (char === "(") {
        parenDepth += 1;
        continue;
      }
      if (char === ")" && parenDepth > 0) {
        parenDepth -= 1;
        continue;
      }
      if (/\s/.test(char) && parenDepth === 0) {
        splitIndex = index;
        break;
      }
    }
    href = target.slice(0, splitIndex).trim();
    rest = target.slice(splitIndex).trim();
  }

  if (!href) {
    return null;
  }

  let title = null;
  if (rest) {
    const titleMatch = rest.match(/^(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\((.*)\))$/);
    if (titleMatch) {
      title = titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? null;
    } else if (!isAngle) {
      // The text after the first space isn't a valid title, so this is a plain
      // destination that just contains spaces — e.g. an image named
      // "new diagram 1.png". Keep the whole thing as the href (lenient vs. strict
      // CommonMark, which would require <...> or %20). The editor hover-preview
      // already resolves such paths, so the rendered preview should match.
      href = target.trim();
    }
  }

  return {
    href,
    title: title ? title.replace(/\\(["'()\\])/g, "$1") : null
  };
}

function parseReferenceDefinition(line) {
  const match = String(line ?? "").match(/^\s{0,3}\[([^\]]+)\]:\s*(.+)$/);
  if (!match) {
    return null;
  }

  const label = match[1];
  const parsedTarget = parseLinkTarget(match[2]);
  if (!parsedTarget) {
    return null;
  }

  return {
    key: normalizeReferenceLabel(label),
    label,
    href: parsedTarget.href,
    title: parsedTarget.title
  };
}

// A footnote's text: "[^label]: text" on a line of its own.
const FOOTNOTE = /^\s{0,3}\[\^([^\]\s]+)\]:\s+(.*)$/;

function collectReferenceDefinitions(lines) {
  const contentLines = [];
  const references = new Map();
  const footnotes = new Map();
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (FENCE.test(line)) {
      inCodeBlock = !inCodeBlock;
      contentLines.push(rawLine);
      continue;
    }

    if (!inCodeBlock) {
      const footnote = FOOTNOTE.exec(line);
      if (footnote) {
        footnotes.set(footnote[1], footnote[2]);
        continue;
      }
      const definition = parseReferenceDefinition(line);
      if (definition) {
        references.set(definition.key, definition);
        continue;
      }
    }

    contentLines.push(rawLine);
  }

  return { contentLines, references, footnotes };
}

function collectMarkdownReferences(markdown) {
  return collectReferenceDefinitions(String(markdown ?? "").replace(/\r\n/g, "\n").split("\n")).references;
}

function resolveReferenceLink(references, label) {
  if (!(references instanceof Map)) {
    return null;
  }
  return references.get(normalizeReferenceLabel(label)) ?? null;
}

function parseInlineElements(value, references) {
  const parts = [];
  let cursor = 0;

  function pushText(text) {
    if (!text) {
      return;
    }
    parts.push({ type: "text", value: text });
  }

  while (cursor < value.length) {
    const nextImageIndex = value.indexOf("![", cursor);
    const nextLinkIndex = value.indexOf("[", cursor);
    const nextIndex = [nextImageIndex, nextLinkIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    if (nextIndex === undefined) {
      pushText(value.slice(cursor));
      break;
    }

    pushText(value.slice(cursor, nextIndex));

    const isImage = value.startsWith("![", nextIndex);
    const labelStart = isImage ? nextIndex + 1 : nextIndex;
    const labelEnd = findClosingDelimiter(value, labelStart, "[", "]");
    if (labelEnd < 0) {
      pushText(value.slice(nextIndex, nextIndex + (isImage ? 2 : 1)));
      cursor = nextIndex + (isImage ? 2 : 1);
      continue;
    }

    const label = value.slice(labelStart + 1, labelEnd);
    const nextChar = value[labelEnd + 1] ?? "";

    if (nextChar === "(") {
      const targetEnd = findClosingDelimiter(value, labelEnd + 1, "(", ")");
      if (targetEnd > labelEnd + 1) {
        const parsedTarget = parseLinkTarget(value.slice(labelEnd + 2, targetEnd));
        if (parsedTarget?.href) {
          parts.push({
            type: isImage ? "image" : "link",
            source: value.slice(nextIndex, targetEnd + 1),
            label,
            href: parsedTarget.href,
            title: parsedTarget.title
          });
          cursor = targetEnd + 1;
          continue;
        }
      }
    }

    if (nextChar === "[") {
      const refEnd = findClosingDelimiter(value, labelEnd + 1, "[", "]");
      if (refEnd > labelEnd + 1) {
        const refLabel = value.slice(labelEnd + 2, refEnd) || label;
        const reference = resolveReferenceLink(references, refLabel);
        if (reference) {
          parts.push({
            type: isImage ? "image" : "link",
            source: value.slice(nextIndex, refEnd + 1),
            label,
            href: reference.href,
            title: reference.title,
            referenceLabel: refLabel
          });
          cursor = refEnd + 1;
          continue;
        }
      }
    } else if (!isImage) {
      const reference = resolveReferenceLink(references, label);
      if (reference) {
        parts.push({
          type: "link",
          source: value.slice(nextIndex, labelEnd + 1),
          label,
          href: reference.href,
          title: reference.title,
          referenceLabel: label
        });
        cursor = labelEnd + 1;
        continue;
      }
    }

    pushText(value.slice(nextIndex, labelEnd + 1));
    cursor = labelEnd + 1;
  }

  return parts;
}

function parseMarkdownInlineElements(value, references) {
  return parseInlineElements(String(value ?? ""), references);
}

function renderTextFormatting(value) {
  return escapeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

function serializeHtmlAttributes(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([key, value]) => value === true ? key : `${key}="${escapeAttribute(value)}"`)
    .join(" ");
}

function resolveRenderedLink(token, options = {}) {
  const resolved = options.resolveLink
    ? options.resolveLink(token)
    : options.resolveUrl
      ? options.resolveUrl(token.href)
      : token.href;

  if (resolved && typeof resolved === "object") {
    return {
      href: String(resolved.href ?? token.href),
      title: resolved.title ?? token.title ?? null,
      external: Boolean(resolved.external),
      attributes: resolved.attributes ?? {}
    };
  }

  const href = String(resolved ?? token.href);
  return {
    href,
    title: token.title ?? null,
    external: /^(https?:\/\/|mailto:|data:|blob:)/i.test(href),
    attributes: {}
  };
}

function renderInlineElement(token, options = {}) {
  if (token.type === "text") {
    return renderTextFormatting(token.value);
  }

  const resolved = resolveRenderedLink(token, options);
  if (token.type === "image") {
    const titleAttr = resolved.title ? ` title="${escapeAttribute(resolved.title)}"` : "";
    return `<img src="${escapeAttribute(resolved.href)}" alt="${escapeAttribute(token.label)}"${titleAttr}>`;
  }

  const attributes = {
    href: resolved.href,
    ...resolved.attributes
  };
  if (resolved.title) {
    attributes.title = resolved.title;
  }
  if (resolved.external) {
    attributes.target = "_blank";
    attributes.rel = "noreferrer";
  }
  const attributeText = serializeHtmlAttributes(attributes);
  return `<a ${attributeText}>${renderTextFormatting(token.label)}</a>`;
}

function isBlockHtmlLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  return /^<!--(?:[\s\S]*?)-->$/.test(trimmed)
    || /^<(?:!doctype|html|head|body|article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|header|hr|main|menu|nav|ol|p|pre|section|table|thead|tbody|tfoot|tr|td|th|ul|li|h[1-6])(?:\s[^>]*)?>/i.test(trimmed)
    || /^<\/(?:article|aside|blockquote|details|dialog|div|dl|fieldset|figcaption|figure|footer|form|header|main|menu|nav|ol|p|pre|section|table|thead|tbody|tfoot|tr|td|th|ul|li|h[1-6])>$/i.test(trimmed);
}

function renderInline(value, options = {}) {
  const { tokenized, fragments } = preserveHtmlFragments(value);
  const codeFragments = [];
  const codeTokenized = tokenized.replace(/`([^`]+)`/g, (_, code) => {
    const token = `__MDNOTES_CODE_${codeFragments.length}__`;
    codeFragments.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  // A footnote's mark: its number, its text on hover (the notes are listed at the end).
  const notes = options.footnotes;
  const noteFragments = [];
  const noteTokenized = notes ? codeTokenized.replace(/\[\^([^\]\s]+)\]/g, (whole, label) => {
    if (!notes.texts.has(label)) return whole;
    if (!notes.order.includes(label)) notes.order.push(label);
    const token = `__MDNOTES_NOTE_${noteFragments.length}__`;
    noteFragments.push(`<sup class="footnote-ref" title="${escapeAttribute(notes.texts.get(label))}">${notes.order.indexOf(label) + 1}</sup>`);
    return token;
  }) : codeTokenized;
  const rendered = parseInlineElements(noteTokenized, options.references)
    .map((token) => renderInlineElement(token, options))
    .join("");
  return restoreHtmlFragments(restoreTokens(restoreTokens(rendered, "__MDNOTES_NOTE_", noteFragments), "__MDNOTES_CODE_", codeFragments), fragments);
}

function extractMarkdownLinks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const { contentLines, references } = collectReferenceDefinitions(lines);
  const links = [];
  let inCodeBlock = false;

  for (const rawLine of contentLines) {
    const line = rawLine.trimEnd();

    if (FENCE.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock || isBlockHtmlLine(line)) {
      continue;
    }

    // A code span shows its text as written, as the preview does: a link
    // written inside one (`[a](b.md)`, how to write a link) is no link.
    const outsideCode = line.replace(/`([^`]+)`/g, (_, code) => code.replace(/[[\]()<>]/g, " "));
    parseInlineElements(outsideCode, references).forEach((token) => {
      if (token.type === "link") {
        links.push({
          label: token.label.trim() || token.href,
          href: token.href,
          title: token.title ?? null,
          referenceLabel: token.referenceLabel ?? null
        });
      }
    });
  }

  return links;
}

// ── GFM pipe tables ──────────────────────────────────────────────────────────

/** Split a table row into trimmed cells, honouring escaped pipes and dropping
 *  the optional leading/trailing pipe. */
function splitTableCells(row) {
  const trimmed = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

/** A delimiter row is `---`/`:--`/`:-:`/`--:` cells separated by pipes. */
function isTableDelimiterRow(row) {
  const cells = splitTableCells(row);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTableAlignment(cell) {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

function renderTableBlock(headerLine, delimiterLine, bodyLines, renderOptions) {
  const headers = splitTableCells(headerLine);
  const alignments = splitTableCells(delimiterLine).map(parseTableAlignment);
  const cellAttr = (columnIndex) => {
    const alignment = alignments[columnIndex];
    return alignment ? ` style="text-align:${alignment}"` : "";
  };

  const headHtml = `<thead><tr>${headers
    .map((header, columnIndex) => `<th${cellAttr(columnIndex)}>${renderInline(header, renderOptions)}</th>`)
    .join("")}</tr></thead>`;

  const rowsHtml = bodyLines
    .map((line) => {
      const cells = splitTableCells(line);
      const cellsHtml = headers
        .map((_, columnIndex) => `<td${cellAttr(columnIndex)}>${renderInline(cells[columnIndex] ?? "", renderOptions)}</td>`)
        .join("");
      return `<tr>${cellsHtml}</tr>`;
    })
    .join("");

  const bodyHtml = rowsHtml ? `<tbody>${rowsHtml}</tbody>` : "";
  return `<table>${headHtml}${bodyHtml}</table>`;
}

// ---- Lists. An item is "-", "*" or "+" (bulleted) or "1." / "1)" (numbered,
// from its first number), then a space and its text; "[ ]" or "[x]" first
// makes it a task. Deeper items belong to the item above them; a line
// indented under an item continues its text; a blank line between items
// keeps the list going. A line of three or more -, * or _ is a rule.
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const FENCE = /^ {0,3}```/;
const TASK = /^\[( |x|X)\]\s+/;

const indentWidth = (indent) => indent.replace(/\t/g, "    ").length;

function listItemOf(line) {
  const match = LIST_ITEM.exec(line);
  if (!match || RULE.test(line)) return null;
  const [, indent, marker, text] = match;
  const ordered = /\d/.test(marker);
  return { indent: indentWidth(indent), ordered, start: ordered ? Number.parseInt(marker, 10) : 1, text };
}

// The list starting at lines[index]: { html, next } (the first line after it).
function renderListBlock(lines, index, renderOptions) {
  const items = [];
  let at = index;
  while (at < lines.length) {
    const line = lines[at].trimEnd();
    const item = listItemOf(line);
    if (item) { items.push(item); at += 1; continue; }
    if (line && !FENCE.test(line) && items.length && indentWidth(/^\s*/.exec(line)[0]) > items.at(-1).indent) {
      items.at(-1).text += ` ${line.trim()}`;
      at += 1;
      continue;
    }
    if (!line) {
      let ahead = at + 1;
      while (ahead < lines.length && !lines[ahead].trim()) ahead += 1;
      if (ahead < lines.length && listItemOf(lines[ahead].trimEnd())) { at = ahead; continue; }
    }
    break;
  }
  const root = { children: [] };
  const stack = [{ indent: -1, list: null }];
  const open = (item) => {
    const parent = stack.at(-1).list?.items.at(-1) ?? root;
    const list = { ordered: item.ordered, start: item.start, items: [] };
    parent.children.push(list);
    stack.push({ indent: item.indent, list });
  };
  for (const item of items) {
    while (stack.length > 1 && stack.at(-1).indent > item.indent) stack.pop();
    if (stack.at(-1).indent < item.indent) open(item);
    else if (stack.at(-1).list.ordered !== item.ordered) { stack.pop(); open(item); }
    stack.at(-1).list.items.push({ text: item.text, children: [] });
  }
  const draw = (list) => {
    const tag = list.ordered ? "ol" : "ul";
    const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : "";
    const tasks = list.items.some((entry) => TASK.test(entry.text));
    const body = list.items.map((entry) => {
      const box = TASK.exec(entry.text);
      const text = box ? entry.text.slice(box[0].length) : entry.text;
      const check = box ? `<input type="checkbox" disabled${box[1] === " " ? "" : " checked"}> ` : "";
      return `<li${box ? ' class="task-item"' : ""}>${check}${renderInline(text, renderOptions)}${entry.children.map(draw).join("")}</li>`;
    }).join("");
    return `<${tag}${start}${tasks ? ' class="task-list"' : ""}>${body}</${tag}>`;
  };
  return { html: root.children.map(draw).join(""), next: at };
}

function renderMarkdown(markdown, options = {}) {
  const { contentLines, references, footnotes } = collectReferenceDefinitions(String(markdown ?? "").replace(/\r\n/g, "\n").split("\n"));
  const lines = contentLines;
  const output = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let codeLanguage = ""; // the fence's info string's first word (```mermaid), for codeBlocks
  let codeIndent = 0; // the opening fence's indent, taken off its lines

  const renderOptions = {
    ...options,
    references,
    footnotes: footnotes.size ? { texts: footnotes, order: [] } : null
  };

  function renderCodeBlock(code, language = "") {
    const lang = language ? ` data-lang="${escapeHtml(language)}"` : "";
    return `<div class="md-code-block"${lang}><button class="md-code-copy-button" type="button" data-copy-code="true" aria-label="Copy code block">Copy</button><pre><code>${code}</code></pre></div>`;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();

    // A fence may be indented up to three spaces (under a list item).
    if (FENCE.test(line)) {
      if (inCodeBlock) {
        output.push(renderCodeBlock(codeBuffer.join("\n"), codeLanguage));
        inCodeBlock = false;
        codeBuffer = [];
      } else {
        inCodeBlock = true;
        codeIndent = /^ */.exec(line)[0].length;
        codeLanguage = (/^ {0,3}```\s*([\w+.-]+)/.exec(line)?.[1] ?? "").toLowerCase();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(escapeHtml(rawLine.replace(new RegExp(`^ {0,${codeIndent}}`), "")));
      continue;
    }

    if (!line) {
      continue;
    }

    // GFM pipe table: a header row with pipes followed by a delimiter row.
    if (
      line.includes("|") &&
      !isBlockHtmlLine(line) &&
      index + 1 < lines.length &&
      isTableDelimiterRow(lines[index + 1].trimEnd())
    ) {
      const bodyLines = [];
      let bodyIndex = index + 2;
      while (bodyIndex < lines.length) {
        const bodyLine = lines[bodyIndex].trimEnd();
        if (!bodyLine || !bodyLine.includes("|") || bodyLine.startsWith("```")) {
          break;
        }
        bodyLines.push(bodyLine);
        bodyIndex += 1;
      }
      output.push(renderTableBlock(line, lines[index + 1].trimEnd(), bodyLines, renderOptions));
      index = bodyIndex - 1;
      continue;
    }

    if (isBlockHtmlLine(line)) {
      output.push(rawLine);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      const level = line.match(/^#+/)[0].length;
      output.push(`<h${level}>${renderInline(line.slice(level + 1), renderOptions)}</h${level}>`);
      continue;
    }

    if (RULE.test(line)) {
      output.push("<hr>");
      continue;
    }

    if (listItemOf(line)) {
      const list = renderListBlock(lines, index, renderOptions);
      output.push(list.html);
      index = list.next - 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      output.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""), renderOptions)}</blockquote>`);
      continue;
    }

    output.push(`<p>${renderInline(line, renderOptions)}</p>`);
  }

  if (inCodeBlock) {
    output.push(renderCodeBlock(codeBuffer.join("\n")));
  }

  // The notes the text refers to, numbered in the order first referred to.
  const referred = renderOptions.footnotes?.order ?? [];
  if (referred.length) {
    const noteOptions = { ...renderOptions, footnotes: null };
    output.push(`<section class="footnotes"><ol>${referred.map((label) => `<li>${renderInline(footnotes.get(label), noteOptions)}</li>`).join("")}</ol></section>`);
  }

  return output.join("\n");
}

export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown };