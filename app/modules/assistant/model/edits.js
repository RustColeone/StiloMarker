// How an edit_file proposal reads in its review card: each edit as the text
// that goes and the text that comes. Pure (strings in, HTML out).

const escape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function editsLabel(edits) {
  return `${edits.length} edit${edits.length === 1 ? "" : "s"}`;
}

export function editsHtml(edits) {
  return `<ol class="proposal-edits">${edits.map((edit) => `<li class="proposal-edit">`
    + `<del class="proposal-edit-find">${escape(edit.find)}</del>`
    + (edit.replace ? `<ins class="proposal-edit-replace">${escape(edit.replace)}</ins>` : `<span class="proposal-edit-gone">(removed)</span>`)
    + `</li>`).join("")}</ol>`;
}
