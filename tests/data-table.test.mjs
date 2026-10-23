// A delimited table (extensions/data-table/browser/model/table.js): records
// read as written (quotes, a quote doubled, a line break inside quotes, CRLF,
// a .tsv's tabs, a semicolon .csv), every grid edit as a new text that
// leaves the records it doesn't touch byte for byte, the numbers in a block,
// whether the first row names the columns, and the clipboard's form. A
// delimiter guessed past quoted values; new rows end as the file's lines do
// (\r\n, \n or \r); a blank line among rows stays blank as columns come or
// go; a last row of empty cells copies and pastes as a row. The page: data-table-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { blockText, cell, columnName, delimiterFor, deleteColumns, deleteRows, insertColumns, insertRows, looksLikeHeader,
  parseBlock, parseTable, setCell, setCells, statsOf } from "../extensions/data-table/browser/model/table.js";

const values = (table) => table.records.map((record) => record.fields.map((field) => field.value));

test("table: records read as written", () => {
  const text = 'name,note,n\n"Smith, J","said ""hi""",3\n"two\nlines",,4.5\r\nlast,x';
  const table = parseTable(text, ",");
  assert.deepEqual(values(table), [["name", "note", "n"], ["Smith, J", 'said "hi"', "3"], ["two\nlines", "", "4.5"], ["last", "x"]]);
  assert.equal(table.columns, 3);
  assert.equal(text.slice(table.records[1].start, table.records[1].end), '"Smith, J","said ""hi""",3');
  assert.equal(table.records[1].fields[0].quoted, true);
  assert.deepEqual(values(parseTable("a\tb,c\n1\t2\n", "\t")), [["a", "b,c"], ["1", "2"]]);
  assert.deepEqual(values(parseTable("", ",")), []);
  assert.deepEqual(values(parseTable("a\n\nb\n", ",")), [["a"], [""], ["b"]], "a blank line is a record");
  assert.equal(parseTable("a\r\nb\r\n", ",").newline, "\r\n");
  assert.deepEqual(values(parseTable('"open,quote\nnever closed', ",")), [["open,quote\nnever closed"]], "an unclosed quote runs to the end");
  assert.equal(delimiterFor("x.tsv"), "\t");
  assert.equal(delimiterFor("x.CSV", "a;b;c\n1;2;3"), ";");
  assert.equal(delimiterFor("x.csv", "a,b;c\n"), ",");
  assert.equal(delimiterFor("x.csv", '"Smith, J";2;3\n'), ";", "a comma inside quotes is a value's");
  assert.equal(delimiterFor("x.csv", '"a;b",c\n'), ",");
  assert.equal(delimiterFor("x.csv", "a;b\rc;d"), ";", "an old Mac's line break ends the first line too");
});

test("table: new rows end as the file's lines do", () => {
  assert.equal(parseTable("a,b\rc,d\r", ",").newline, "\r");
  assert.equal(insertRows("a,b\rc,d\r", parseTable("a,b\rc,d\r", ","), 2), "a,b\rc,d\r,\r");
  assert.equal(parseTable("a\r\nb\nc\r\n", ",").newline, "\r\n", "most of them");
  assert.equal(parseTable("a", ",").newline, "\n", "none at all: \\n");
});

test("table: a blank line among rows stays blank as columns come or go", () => {
  const text = "a,b\n\nc,d\n";
  const table = parseTable(text, ",");
  assert.equal(insertColumns(text, table, 1), "a,,b\n\nc,,d\n");
  assert.equal(deleteColumns(text, table, 0), "b\n\nd\n");
  assert.equal(insertColumns("\n\n", parseTable("\n\n", ","), 1), ",\n,\n", "only blank lines: rows all the same");
});

test("table: a cell set rewrites its record only; quoting as needed or as it was", () => {
  const text = 'a,b,c\r\n1,"keep ""me""",3\r\n4,5,6\r\n';
  const table = parseTable(text, ",");
  assert.equal(setCell(text, table, 2, 1, "x,y"), 'a,b,c\r\n1,"keep ""me""",3\r\n4,"x,y",6\r\n');
  assert.equal(setCell(text, table, 1, 1, "plain"), 'a,b,c\r\n1,"plain",3\r\n4,5,6\r\n', "a quoted field stays quoted");
  assert.equal(setCell(text, table, 0, 4, "e"), 'a,b,c,,e\r\n1,"keep ""me""",3\r\n4,5,6\r\n', "past the row's end: padded");
  assert.equal(setCell(text, table, 4, 0, "new"), 'a,b,c\r\n1,"keep ""me""",3\r\n4,5,6\r\n,,\r\nnew,,\r\n', "past the last row: rows added");
  assert.equal(setCell("a,b", parseTable("a,b", ","), 1, 1, "z"), "a,b\n,z", "no line break at the end: still none");
  assert.equal(setCell("", parseTable("", ","), 0, 0, "first"), "first\n");
  assert.equal(setCell("a\tb\n", parseTable("a\tb\n", "\t"), 0, 0, "tab\there"), '"tab\there"\tb\n');
});

test("table: rows and columns added and removed", () => {
  const text = "h1,h2\n1,2\n3,4\n";
  const table = parseTable(text, ",");
  assert.equal(insertRows(text, table, 1), "h1,h2\n,\n1,2\n3,4\n");
  assert.equal(insertRows(text, table, 3, 2), "h1,h2\n1,2\n3,4\n,\n,\n");
  assert.equal(deleteRows(text, table, 1), "h1,h2\n3,4\n");
  assert.equal(deleteRows(text, table, 1, 5), "h1,h2\n");
  assert.equal(deleteRows("a\nb", parseTable("a\nb", ","), 1), "a\n");
  assert.equal(insertColumns(text, table, 1), "h1,,h2\n1,,2\n3,,4\n");
  assert.equal(insertColumns(text, table, 2, 2), "h1,h2,,\n1,2,,\n3,4,,\n");
  assert.equal(deleteColumns(text, table, 0), "h2\n2\n4\n");
  assert.equal(deleteColumns(text, table, 0, 2), ",\n,\n,\n".replaceAll(",", ""), "every column gone: blank rows");
  assert.equal(deleteColumns("a\nb,c\n", parseTable("a\nb,c\n", ","), 1), "a\nb\n", "a short row left as it is");
});

test("table: a pasted block, and the clipboard's form", () => {
  const text = "a,b,c\n1,2,3\n";
  const table = parseTable(text, ",");
  assert.equal(setCells(text, table, 1, 1, [["x", "y"], ["p", "q"]]), "a,b,c\n1,x,y\n,p,q\n");
  assert.equal(blockText(table, { top: 0, bottom: 1, left: 1, right: 2 }), "b\tc\n2\t3\n");
  assert.deepEqual(parseBlock("b\tc\r\n2\t3\r\n"), [["b", "c"], ["2", "3"]]);
  assert.deepEqual(parseBlock("Hello, world"), [["Hello, world"]], "a line without tabs is one cell");
  assert.deepEqual(parseBlock('"two\nlines"\tx'), [["two\nlines", "x"]]);
  const quoted = parseTable('said "hi",two\nlines,"""q"\n'.replace("two\nlines", '"two\nlines"'), ",");
  assert.equal(blockText(quoted, { top: 0, bottom: 0, left: 0, right: 2 }), 'said "hi"\t"two\nlines"\t"""q"\n', "quoted only where it must be");
  assert.deepEqual(parseBlock(blockText(quoted, { top: 0, bottom: 0, left: 0, right: 2 })), [['said "hi"', "two\nlines", '"q']], "and back");
  const emptyLast = parseTable("x\n\n", ",");
  assert.deepEqual(parseBlock(blockText(emptyLast, { top: 0, bottom: 1, left: 0, right: 0 })), [["x"], [""]], "a last row of empty cells is a row");
});

test("table: the numbers in a block; a header row; column names", () => {
  const table = parseTable("t,v,label\n0,1.5,a\n1,-2,b\n2,1e1,\n3, 4 ,n/a\n", ",");
  assert.deepEqual(statsOf(table, { top: 1, left: 1, right: 1 }), { cells: 4, count: 4, sum: 13.5, mean: 3.375, min: -2, max: 10 });
  assert.deepEqual(statsOf(table, { top: 1, left: 2, right: 2 }), { cells: 3, count: 0, sum: 0, mean: null, min: null, max: null });
  assert.equal(statsOf(table, { top: 1 }).count, 8);
  assert.equal(looksLikeHeader(table), true);
  assert.equal(looksLikeHeader(parseTable("1,2\n3,4\n", ",")), false);
  assert.equal(looksLikeHeader(parseTable("a,b\nc,d\n", ",")), false, "words below too: can't tell, so no");
  assert.deepEqual([0, 25, 26, 27, 701, 702].map(columnName), ["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  assert.equal(cell(table, 9, 9), "");
});

// Loose on purpose (a loaded machine is slow): it catches a quadratic slip, which would take minutes.
test("table: 20,000 rows read and edited in time", () => {
  const lines = ["step,t,x,y,z"];
  for (let i = 0; i < 20000; i += 1) lines.push(`${i},${(i * 0.01).toFixed(2)},${Math.sin(i)},${Math.cos(i)},${i % 7}`);
  const text = `${lines.join("\n")}\n`;
  let started = performance.now();
  const table = parseTable(text, ",");
  const parsed = performance.now() - started;
  assert.equal(table.records.length, 20001);
  started = performance.now();
  const next = setCell(text, table, 15000, 4, "99");
  const edited = performance.now() - started;
  assert.equal(next.length, text.length + 1);
  assert.ok(parsed < 5000 && edited < 5000, `parsed in ${parsed.toFixed(0)} ms, edited in ${edited.toFixed(0)} ms`);
});
