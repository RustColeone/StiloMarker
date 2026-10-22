// Source highlighting for a table, one line at a time (the Editor's
// `highlighters` extension point; `escape` and `blank` are its helpers):
// each column its own colour, so a value's column shows in the text. A line
// knows nothing of the file's name, so its delimiter is guessed from it (a tab,
// else a semicolon with no comma, else a comma); a quoted value that runs
// over lines colours as it starts.
const COLOURS = 6;

export function highlightTableLine(rawLine, { escape, blank }) {
  if (!rawLine.trim()) return blank(rawLine);
  const delimiter = rawLine.includes("\t") ? "\t" : rawLine.includes(";") && !rawLine.includes(",") ? ";" : ",";
  const out = [];
  let column = 0;
  let start = 0;
  let quoted = false;
  const field = (end) => {
    if (end > start) out.push(`<span class="token-table-col${column % COLOURS}">${escape(rawLine.slice(start, end))}</span>`);
  };
  for (let i = 0; i < rawLine.length; i += 1) {
    const char = rawLine[i];
    if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) {
      field(i);
      out.push(`<span class="token-table-delimiter">${escape(char)}</span>`);
      column += 1;
      start = i + 1;
    }
  }
  field(rawLine.length);
  return `<div class="editor-line">${out.join("")}</div>`;
}
