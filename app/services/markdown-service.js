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

function collectReferenceDefinitions(lines) {
  const contentLines = [];
  const references = new Map();
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      contentLines.push(rawLine);
      continue;
    }

    if (!inCodeBlock) {
      const definition = parseReferenceDefinition(line);
      if (definition) {
        references.set(definition.key, definition);
        continue;
      }
    }

    contentLines.push(rawLine);
  }

  return { contentLines, references };
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
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
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
  const rendered = parseInlineElements(codeTokenized, options.references)
    .map((token) => renderInlineElement(token, options))
    .join("");
  return restoreHtmlFragments(restoreTokens(rendered, "__MDNOTES_CODE_", codeFragments), fragments);
}

function extractMarkdownLinks(markdown) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const { contentLines, references } = collectReferenceDefinitions(lines);
  const links = [];
  let inCodeBlock = false;

  for (const rawLine of contentLines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock || isBlockHtmlLine(line)) {
      continue;
    }

    parseInlineElements(line, references).forEach((token) => {
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

function renderMarkdown(markdown, options = {}) {
  const { contentLines, references } = collectReferenceDefinitions(String(markdown ?? "").replace(/\r\n/g, "\n").split("\n"));
  const lines = contentLines;
  const output = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let listBuffer = [];

  const renderOptions = {
    ...options,
    references
  };

  function flushList() {
    if (listBuffer.length > 0) {
      output.push(`<ul>${listBuffer.join("")}</ul>`);
      listBuffer = [];
    }
  }

  function renderCodeBlock(code) {
    return `<div class="md-code-block"><button class="md-code-copy-button" type="button" data-copy-code="true" aria-label="Copy code block">Copy</button><pre><code>${code}</code></pre></div>`;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushList();
      if (inCodeBlock) {
        output.push(renderCodeBlock(codeBuffer.join("\n")));
        inCodeBlock = false;
        codeBuffer = [];
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(escapeHtml(rawLine));
      continue;
    }

    if (!line) {
      flushList();
      continue;
    }

    if (isBlockHtmlLine(line)) {
      flushList();
      output.push(rawLine);
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = line.match(/^#+/)[0].length;
      output.push(`<h${level}>${renderInline(line.slice(level + 1), renderOptions)}</h${level}>`);
      continue;
    }

    if (/^-\s+/.test(line)) {
      listBuffer.push(`<li>${renderInline(line.slice(2), renderOptions)}</li>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushList();
      output.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""), renderOptions)}</blockquote>`);
      continue;
    }

    flushList();
    output.push(`<p>${renderInline(line, renderOptions)}</p>`);
  }

  flushList();

  if (inCodeBlock) {
    output.push(renderCodeBlock(codeBuffer.join("\n")));
  }

  return output.join("\n");
}

export { collectMarkdownReferences, extractMarkdownLinks, parseMarkdownInlineElements, renderMarkdown };