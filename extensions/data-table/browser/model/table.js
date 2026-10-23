// A delimited table (.csv, .tsv) as records of fields, and every edit the
// grid makes as a new text. Pure. Each record keeps where it sits in the
// text, so an edit rewrites only the records it touches: the rest of the file
// stays byte for byte as it was (diffs, merges with others' typing, and
// quoting the writer chose are all kept).
//
// parseTable(text, delimiter) -> { records: [{ start, end, next, fields: [{ value, quoted }] }],
//                                  newline, columns }
//   start..end is the record's text, end..next its line break.

export const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// The delimiter of a .tsv is a tab; a .csv's is a comma, unless its first
// line has semicolons and no commas (as some spreadsheets write it), quoted
// values aside.
export function delimiterFor(name, text = "") {
  if (/\.tsv$/i.test(name)) return "\t";
  const first = text.slice(0, text.search(/[\r\n]|$/)).replace(/"(?:[^"]|"")*"?/g, "");
  return first.includes(";") && !first.includes(",") ? ";" : ",";
}

export function parseTable(text, delimiter = ",") {
  const records = [];
  const length = text.length;
  let columns = 0;
  let i = 0;
  const breaks = { "\r\n": 0, "\n": 0, "\r": 0 };
  while (i < length) {
    const start = i;
    const fields = [];
    let lineDone = false;
    while (!lineDone) {
      let value = "";
      let quoted = false;
      if (text[i] === '"') {
        quoted = true;
        i += 1;
        let from = i;
        for (;;) {
          const close = text.indexOf('"', i);
          if (close === -1) { value += text.slice(from); i = length; break; }
          if (text[close + 1] === '"') { value += text.slice(from, close + 1); i = close + 2; from = i; continue; }
          value += text.slice(from, close);
          i = close + 1;
          break;
        }
      }
      // Up to the delimiter or the line's end (after a closing quote: kept as it is).
      const from = i;
      while (i < length && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") i += 1;
      value += text.slice(from, i);
      fields.push({ value, quoted });
      if (i < length && text[i] === delimiter) { i += 1; continue; }
      lineDone = true;
    }
    const end = i;
    if (text[i] === "\r" && text[i + 1] === "\n") { i += 2; breaks["\r\n"] += 1; }
    else if (text[i] === "\n" || text[i] === "\r") { breaks[text[i]] += 1; i += 1; }
    records.push({ start, end, next: i, fields });
    if (fields.length > columns) columns = fields.length;
  }
  // New rows end as most of the file's lines do (\r\n, \n, or an old Mac's \r).
  const newline = Object.keys(breaks).reduce((best, kind) => (breaks[kind] > breaks[best] ? kind : best), "\n");
  return { records, newline, columns, delimiter };
}

const valueAt = (record, column) => record?.fields[column]?.value ?? "";

export function cell(table, row, column) {
  return valueAt(table.records[row], column);
}

// A field as written: quoted when it was, or when it has to be.
export function formatField(value, delimiter, quoted = false) {
  const text = String(value ?? "");
  if (quoted || text.includes(delimiter) || text.includes('"') || /[\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function formatRecord(fields, delimiter) {
  return fields.map((field) => formatField(field.value, delimiter, field.quoted)).join(delimiter);
}

const blankRow = (columns) => Array.from({ length: Math.max(1, columns) }, () => ({ value: "", quoted: false }));

// The text with records changed: `edits` maps a record's index to its new
// fields (null: the record removed); `inserts` maps an index to rows put
// before that record (the record count: after the last).
export function rebuild(text, table, { edits = new Map(), inserts = new Map() } = {}) {
  const { records, delimiter, newline } = table;
  const out = [];
  let at = 0;
  const rows = (index) => (inserts.get(index) ?? []).map((fields) => formatRecord(fields, delimiter));
  records.forEach((record, index) => {
    const before = rows(index);
    if (before.length) {
      out.push(text.slice(at, record.start), before.join(newline), newline);
      at = record.start;
    }
    if (!edits.has(index)) return;
    const fields = edits.get(index);
    out.push(text.slice(at, record.start));
    if (fields === null) {
      at = record.next;
    } else {
      out.push(formatRecord(fields, delimiter));
      at = record.end;
    }
  });
  out.push(text.slice(at));
  const after = rows(records.length);
  if (after.length) {
    const body = out.join("");
    const ended = body === "" || /[\r\n]$/.test(body);
    // A file that ended with a line break still does; one that didn't, still doesn't.
    return `${body}${ended ? "" : newline}${after.join(newline)}${ended ? newline : ""}`;
  }
  return out.join("");
}

const fieldsOf = (table, row) => (table.records[row]?.fields ?? []).map((field) => ({ ...field }));

// Cells set from a block of values (one row: [values]) whose top left is at
// row, column; rows past the last are added, short rows padded.
export function setCells(text, table, row, column, block) {
  const edits = new Map();
  const added = [];
  const width = Math.max(table.columns, column + Math.max(0, ...block.map((values) => values.length)));
  block.forEach((values, offset) => {
    const index = row + offset;
    const fields = index < table.records.length ? fieldsOf(table, index) : blankRow(table.columns);
    values.forEach((value, step) => {
      while (fields.length <= column + step) fields.push({ value: "", quoted: false });
      fields[column + step] = { value, quoted: fields[column + step].quoted && value !== "" };
    });
    if (index < table.records.length) edits.set(index, fields);
    else added[index - table.records.length] = fields;
  });
  if (!added.length) return rebuild(text, table, { edits });
  // Rows between the last and the first one added stay blank.
  const tail = Array.from({ length: added.length }, (_, i) => added[i] ?? blankRow(width));
  return rebuild(text, table, { edits, inserts: new Map([[table.records.length, tail]]) });
}

export const setCell = (text, table, row, column, value) => setCells(text, table, row, column, [[value]]);

export function insertRows(text, table, at, count = 1) {
  const rows = Array.from({ length: count }, () => blankRow(table.columns));
  return rebuild(text, table, { inserts: new Map([[Math.min(at, table.records.length), rows]]) });
}

export function deleteRows(text, table, from, count = 1) {
  const edits = new Map();
  for (let row = from; row < Math.min(table.records.length, from + count); row += 1) edits.set(row, null);
  return rebuild(text, table, { edits });
}

// A blank line among rows stays blank when columns come or go (a table of
// nothing but blank lines is rows all the same).
const blankKept = (table) => (record) => record.start === record.end && table.records.some((other) => other.start !== other.end);

// Columns put in at `at` in every record long enough to have one there.
export function insertColumns(text, table, at, count = 1) {
  const edits = new Map();
  const blank = blankKept(table);
  table.records.forEach((record, row) => {
    if (record.fields.length < at || blank(record)) return;
    const fields = fieldsOf(table, row);
    fields.splice(at, 0, ...blankRow(count));
    edits.set(row, fields);
  });
  return rebuild(text, table, { edits });
}

export function deleteColumns(text, table, at, count = 1) {
  const edits = new Map();
  const blank = blankKept(table);
  table.records.forEach((record, row) => {
    if (record.fields.length <= at || blank(record)) return;
    const fields = fieldsOf(table, row);
    fields.splice(at, count);
    edits.set(row, fields.length ? fields : blankRow(1));
  });
  return rebuild(text, table, { edits });
}

// The numbers in a block of cells: { cells (not empty), count (numbers), sum, mean, min, max }.
export function statsOf(table, { top = 0, bottom = table.records.length - 1, left = 0, right = table.columns - 1 } = {}) {
  let cells = 0, count = 0, sum = 0, min = Infinity, max = -Infinity;
  for (let row = Math.max(0, top); row <= Math.min(bottom, table.records.length - 1); row += 1) {
    const fields = table.records[row].fields;
    for (let column = left; column <= Math.min(right, fields.length - 1); column += 1) {
      const value = fields[column].value.trim();
      if (!value) continue;
      cells += 1;
      if (!NUMBER.test(value)) continue;
      const number = Number(value);
      count += 1;
      sum += number;
      if (number < min) min = number;
      if (number > max) max = number;
    }
  }
  return { cells, count, sum, mean: count ? sum / count : null, min: count ? min : null, max: count ? max : null };
}

// Does the first record name the columns? Its cells are words, and below it
// some column holds numbers.
export function looksLikeHeader(table) {
  const [first, ...rest] = table.records;
  if (!first || !rest.length) return false;
  const filled = first.fields.map((field) => field.value.trim()).filter(Boolean);
  if (!filled.length || filled.some((value) => NUMBER.test(value))) return false;
  return rest.slice(0, 20).some((record) => record.fields.some((field) => NUMBER.test(field.value.trim())));
}

// A block of cells as tab-separated text (for the clipboard), and back. As
// spreadsheets copy: quoted only where a value holds a tab or a line break
// (or starts with a quote), every row ending with a line break (so a last row
// of empty cells is a row).
const clipField = (value) => (/[\t\r\n]/.test(value) || value.startsWith('"') ? `"${value.replaceAll('"', '""')}"` : value);

export function blockText(table, { top, bottom, left, right }) {
  const lines = [];
  for (let row = top; row <= bottom; row += 1) {
    const values = [];
    for (let column = left; column <= right; column += 1) values.push(clipField(cell(table, row, column)));
    lines.push(`${values.join("\t")}\n`);
  }
  return lines.join("");
}

// Tab-separated, as spreadsheets copy: a line without tabs is one cell; the
// line break after the last row ends it (one more after it is an empty row).
export function parseBlock(text) {
  return parseTable(text, "\t").records.map((record) => record.fields.map((field) => field.value));
}

// Column names: A..Z, AA..
export function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
