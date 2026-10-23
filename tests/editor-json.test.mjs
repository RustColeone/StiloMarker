// JSON files (editor/model/json.js): a line's colours (a key, a string, a
// number, true / false / null, punctuation; what isn't JSON left plain),
// whether a text is valid (formatted when it is; its line and column when
// not, however deeply nested), and a value in a few words. The page: data-table-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { checkJson, describeJson, errorAt, highlightJsonLine } from "../app/modules/editor/model/json.js";

const tools = { escape: (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;"), blank: (line) => `<div class="editor-line">${line}</div>` };
const spans = (html) => [...html.matchAll(/<span class="token-json-(\w+)">([^<]*)<\/span>/g)].map(([, kind, text]) => `${kind}:${text}`);

test("json: a line's colours", () => {
  assert.deepEqual(spans(highlightJsonLine('  "name": "a \\"q\\" <b>", "n": -1.5e3,', tools)),
    ["key:\"name\"", "punctuation::", "string:\"a \\\"q\\\" &lt;b>\"", "punctuation:,", "key:\"n\"", "punctuation::", "number:-1.5e3", "punctuation:,"]);
  assert.deepEqual(spans(highlightJsonLine("[true, false, null]", tools)),
    ["punctuation:[", "literal:true", "punctuation:,", "literal:false", "punctuation:,", "literal:null", "punctuation:]"]);
  assert.equal(highlightJsonLine("   ", tools), '<div class="editor-line">   </div>', "a blank line: the editor's own");
  assert.ok(highlightJsonLine("// not json <x>", tools).includes("// not json &lt;x>"), "the rest escaped, plain");
  assert.deepEqual(spans(highlightJsonLine('"open', tools)), ["string:\"open"], "an unclosed string runs to the line's end");
});

test("json: valid (formatted), or where it is not", () => {
  const ok = checkJson('{"a":[1,2],"b":null}');
  assert.equal(ok.ok, true);
  assert.equal(ok.formatted, '{\n  "a": [\n    1,\n    2\n  ],\n  "b": null\n}');
  const bad = checkJson('{\n  "a": 1,\n  "b": \n}\n');
  assert.equal(bad.ok, false);
  assert.deepEqual([bad.line, bad.column], [4, 1], bad.message);
  assert.match(bad.message, /unexpected “}”/);
  assert.deepEqual(checkJson('{"a": [1, 2'), { ok: false, message: checkJson('{"a": [1, 2').message, line: 1, column: 12 });
  assert.match(checkJson('{"a": [1, 2').message, /ends too soon/);
  assert.equal(checkJson("").ok, false);
});

test("json: where a text stops being JSON", () => {
  for (const good of ['{"a": [1, -2.5e3, true, false, null, "x\\n\\u00e9"]}', "[]", "{}", ' "s" ', "0"]) assert.equal(errorAt(good), -1, good);
  assert.equal(errorAt("[1, 2,]"), 6, "a trailing comma");
  assert.equal(errorAt('{"a" 1}'), 5, "a missing colon");
  assert.equal(errorAt("[01]"), 2, "a leading zero");
  assert.equal(errorAt('"tab\there"'), 4, "a raw control character in a string");
  assert.equal(errorAt('"\\q"'), 2, "a bad escape");
  assert.equal(errorAt("[1] x"), 4, "something after the value");
  assert.equal(errorAt("{'a': 1}"), 1, "single quotes");
  assert.equal(errorAt('{"a": {"b": [1, {"c": 2}]}, "d": []}'), -1, "nested");
  assert.equal(errorAt('{"a": {"b": [1, {"c": 2]}}'), 23, "a list closing an object");
  assert.equal(errorAt("{,}"), 1);
});

test("json: no nesting is too deep to find where it stops", () => {
  const deep = `${"[".repeat(200000)}1${"]".repeat(199999)}`;
  assert.equal(errorAt(deep), deep.length, "one ] short: it ends too soon");
  assert.equal(checkJson(deep).message, "the text ends too soon");
  assert.equal(errorAt(`${"[".repeat(200000)}${"]".repeat(200000)}`), -1);
});

test("json: a value in a few words", () => {
  assert.equal(describeJson({ a: 1, b: 2 }), "an object with 2 keys");
  assert.equal(describeJson(Array.from({ length: 20000 })), "a list of 20,000 items");
  assert.equal(describeJson([1]), "a list of 1 item");
  assert.equal(describeJson(null), "null");
  assert.equal(describeJson("x"), "a string");
});
