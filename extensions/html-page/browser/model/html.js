// HTML source, without the page: highlighting one line at a time (the
// Editor's `highlighters`; `escape` and `blank` are its helpers), the
// formatting toolbar's snippets, a new page's first content, and the relative
// image addresses a page names (the preview embeds those).

// A comment, a doctype, a tag's name (opening or closing), an attribute's
// name, a quoted value, an entity.
const TOKENS = /(?<comment><!--.*?(?:-->|$))|(?<doctype><!doctype[^>]*>)|(?<tag><\/?[a-z][\w:-]*|\/?>)|(?<attribute>[a-z_:][\w:.-]*(?==))|(?<string>"[^"]*"|'[^']*')|(?<entity>&[#\w]+;)/gi;

export function highlightHtmlLine(rawLine, { escape, blank }) {
  if (!rawLine.trim()) return blank(rawLine);
  let html = "";
  let last = 0;
  for (const match of rawLine.matchAll(TOKENS)) {
    const kind = Object.keys(match.groups).find((name) => match.groups[name] !== undefined);
    html += `${escape(rawLine.slice(last, match.index))}<span class="token-html-${kind}">${escape(match[0])}</span>`;
    last = match.index + match[0].length;
  }
  return `<div class="editor-line">${html}${escape(rawLine.slice(last))}</div>`;
}

// Whether an address is relative to the page (an image in the workspace).
export const isRelative = (url) => Boolean(url) && !/^([a-z][\w+.-]*:|\/\/|#|\/)/i.test(url.trim());

// The formatting toolbar's pieces to start from.
export const SNIPPETS = [
  { id: "html-section", html: "Section", title: "Insert a section",
    snippet: "<section>\n  <h2>Title</h2>\n  <p>Text.</p>\n</section>\n" },
  { id: "html-image", html: "Image", title: "Insert an image (a path in the workspace, or a web address)",
    snippet: "<img src=\"image.png\" alt=\"Description\">\n" },
  { id: "html-link", html: "Link", title: "Insert a link",
    snippet: "<a href=\"https://\">Link text</a>\n" }
];

export const STARTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New page</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
  </style>
</head>
<body>
  <h1>New page</h1>
  <p>Write here.</p>
</body>
</html>
`;
