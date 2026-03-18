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
  return restoreHtmlFragments(escapeHtml(tokenized)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, href) => {
      const resolvedHref = options.resolveUrl ? options.resolveUrl(href) : href;
      return `<img src="${escapeAttribute(resolvedHref)}" alt="${alt}">`;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const resolvedHref = options.resolveUrl ? options.resolveUrl(href) : href;
      return `<a href="${escapeAttribute(resolvedHref)}" target="_blank" rel="noreferrer">${label}</a>`;
    }), fragments);
}

function renderMarkdown(markdown, options = {}) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let listBuffer = [];

  function flushList() {
    if (listBuffer.length > 0) {
      output.push(`<ul>${listBuffer.join("")}</ul>`);
      listBuffer = [];
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      flushList();
      if (inCodeBlock) {
        output.push(`<pre><code>${codeBuffer.join("\n")}</code></pre>`);
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
      output.push(`<h${level}>${renderInline(line.slice(level + 1), options)}</h${level}>`);
      continue;
    }

    if (/^-\s+/.test(line)) {
      listBuffer.push(`<li>${renderInline(line.slice(2), options)}</li>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushList();
      output.push(`<blockquote>${renderInline(line.replace(/^>\s?/, ""), options)}</blockquote>`);
      continue;
    }

    flushList();
    output.push(`<p>${renderInline(line, options)}</p>`);
  }

  flushList();

  if (inCodeBlock) {
    output.push(`<pre><code>${codeBuffer.join("\n")}</code></pre>`);
  }

  return output.join("\n");
}

export { renderMarkdown };