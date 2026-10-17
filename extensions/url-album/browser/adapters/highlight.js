// Source highlighting for an album, one line at a time (the Editor's
// `highlighters` extension point; `escape` and `blank` are its helpers).
// The comment colour is the mind-map tree's, which the core's styles define.
export function highlightAlbumLine(rawLine, { escape, blank }) {
  const trimmed = rawLine.trimStart();
  if (!trimmed) return blank(rawLine);
  if (trimmed.startsWith("#")) return `<div class="editor-line"><span class="token-mtree-comment">${escape(rawLine)}</span></div>`;

  const section = trimmed.match(/^\[([^\]]+)\]$/);
  if (section) {
    const indent = escape(rawLine.slice(0, rawLine.indexOf("[")));
    return `<div class="editor-line">${indent}<span class="token-urldb-bracket">[</span><span class="token-urldb-name">${escape(section[1])}</span><span class="token-urldb-bracket">]</span></div>`;
  }

  const field = rawLine.match(/^(\s*)(url|description)(\s*=\s*)(.*)$/i);
  if (field) {
    const [, indent, key, separator, value] = field;
    const valueClass = key.toLowerCase() === "url" ? "token-link" : "token-urldb-description";
    return `<div class="editor-line">${escape(indent)}<span class="token-urldb-key">${escape(key)}</span><span class="token-urldb-separator">${escape(separator)}</span><span class="${valueClass}">${escape(value)}</span></div>`;
  }
  return `<div class="editor-line">${escape(rawLine)}</div>`;
}
