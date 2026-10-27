// Searching text (editor/model/search.js), which the find bar and Find in
// Files share: the pattern for a query and its options, the matches with
// their lines, a match's snippet, and replacing (a plain replacement taken as
// it is; a regular expression's $1 in its own context), one match replaced
// where it is (the find bar's Replace). Unicode-aware: a whole word in any
// script, an emoji one character; ^ and $ a line's. The page: search-files-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { findMatches, locate, replaceAt, replaceMatches, searchPattern, snippet } from "../app/modules/editor/model/search.js";

const texts = (text, matches) => matches.map(({ start, end }) => text.slice(start, end));

test("search: the pattern for a query and its options", () => {
  assert.deepEqual(searchPattern(""), { pattern: null });
  const text = "a.b axb A.B concat cat Cat";
  assert.deepEqual(texts(text, findMatches(text, searchPattern("a.b").pattern)), ["a.b", "A.B"], "plain: the dot is a dot; any case");
  assert.deepEqual(texts(text, findMatches(text, searchPattern("a.b", { caseSensitive: true }).pattern)), ["a.b"]);
  assert.deepEqual(texts(text, findMatches(text, searchPattern("cat", { wholeWord: true }).pattern)), ["cat", "Cat"], "not inside concat");
  assert.deepEqual(texts(text, findMatches(text, searchPattern("a.b", { regex: true }).pattern)), ["a.b", "axb", "A.B"]);
  assert.match(searchPattern("(", { regex: true }).error, /./, "not a regular expression: said");
  assert.equal(searchPattern("(", {}).error, undefined, "plain: any text");
});

test("search: matches, an empty match moving on, a limit", () => {
  const text = "xxxx";
  assert.equal(findMatches(text, searchPattern("(?=x)", { regex: true }).pattern).length, 4, "empty matches don't loop");
  assert.equal(findMatches("aaaaaaaaaa", searchPattern("a").pattern, 3).length, 3);
  assert.deepEqual(findMatches("abc", null), []);
});

test("search: each match's line and column, in one pass", () => {
  const text = "one cat\ntwo\ncat cat\n\nlast cat";
  const located = locate(text, findMatches(text, searchPattern("cat").pattern));
  assert.deepEqual(located.map(({ line, column }) => [line, column]), [[0, 4], [2, 0], [2, 4], [4, 5]]);
  const across = "a\nb\nc";
  assert.deepEqual(locate(across, findMatches(across, searchPattern("b\\nc", { regex: true }).pattern)).map((m) => m.line), [1], "a match over lines: its first");
});

test("search: a match's snippet: its line around it, cut with … where long", () => {
  const text = "first\n    indented lantern here\nlast";
  const [match] = locate(text, findMatches(text, searchPattern("lantern").pattern));
  assert.deepEqual(snippet(text, match), { before: "indented ", hit: "lantern", after: " here" });
  const long = `${"x".repeat(100)}NEEDLE${"y".repeat(200)}`;
  const [far] = locate(long, findMatches(long, searchPattern("needle").pattern));
  const cut = snippet(long, far, 10);
  assert.equal(cut.before, `…${"x".repeat(10)}`);
  assert.equal(cut.hit, "NEEDLE");
  assert.equal(cut.after, `${"y".repeat(20)}…`);
  // Little before the match, so it shows in the narrow list (it was cut off past 30 or so).
  const deep = "- Python 3.10+ if you want to run the collaboration backend";
  const [inside] = locate(deep, findMatches(deep, searchPattern("collaboration").pattern));
  assert.deepEqual(snippet(deep, inside), { before: "…want to run the ", hit: "collaboration", after: " backend" });
  const han ="第七回 灯笼在风中摇晃。她又点亮了灯笼。";
  const hits = locate(han, findMatches(han, searchPattern("灯笼").pattern));
  assert.equal(hits.length, 2);
  assert.equal(snippet(han, hits[1]).hit, "灯笼");
});

test("search: replacing: a plain replacement as it is, a regular expression's $1 in context", () => {
  assert.deepEqual(replaceMatches("cost 5 and 6", searchPattern("5").pattern, "$&$&"), { text: "cost $&$& and 6", count: 1 }, "plain: $ is a dollar");
  assert.deepEqual(replaceMatches("x=1, y=2", searchPattern("(\\w)=(\\d)", { regex: true }).pattern, "$2=$1", { regex: true }),
    { text: "1=x, 2=y", count: 2 });
  // Context outside the match still counts (a lookbehind).
  assert.deepEqual(replaceMatches("$5 and 5", searchPattern("(?<=\\$)5", { regex: true }).pattern, "9", { regex: true }),
    { text: "$9 and 5", count: 1 });
  assert.deepEqual(replaceMatches("Cat concat cat", searchPattern("cat", { wholeWord: true }).pattern, "dog"), { text: "dog concat dog", count: 2 });
  assert.deepEqual(replaceMatches("same", null, "x"), { text: "same", count: 0 });
});

test("search: a whole word in any script, ^ and $ a line's, an emoji one character", () => {
  const text = "café cafés übercafé über straße Straßen";
  assert.deepEqual(texts(text, findMatches(text, searchPattern("café", { wholeWord: true }).pattern)), ["café"], "not inside cafés or übercafé");
  assert.deepEqual(texts(text, findMatches(text, searchPattern("über", { wholeWord: true }).pattern)), ["über"]);
  assert.deepEqual(texts(text, findMatches(text, searchPattern("straße", { wholeWord: true }).pattern)), ["straße"]);
  assert.deepEqual(texts("-x- a-x-b", findMatches("-x- a-x-b", searchPattern("-x-", { wholeWord: true }).pattern)), ["-x-", "-x-"],
    "punctuation at its ends: only letters around it count");
  const lines = "one\ntwo\nthree";
  assert.deepEqual(texts(lines, findMatches(lines, searchPattern("^t\\w+$", { regex: true }).pattern)), ["two", "three"]);
  const emoji = "😀a😀";
  assert.deepEqual(findMatches(emoji, searchPattern("(?=)", { regex: true }).pattern).map((m) => m.start), [0, 2, 3, 5],
    "an empty match moves past a whole emoji");
  assert.deepEqual(texts(emoji, findMatches(emoji, searchPattern(".", { regex: true }).pattern)), ["😀", "a", "😀"]);
  // Written for the older rules (\- is no escape under Unicode's): read as they read it.
  assert.deepEqual(texts("a-b", findMatches("a-b", searchPattern("a\\-b", { regex: true }).pattern)), ["a-b"]);
  assert.match(searchPattern("a{", { regex: true, wholeWord: true }).pattern.source, /\\w/, "the older rules' whole word, ASCII's");
});

test("search: at most `limit` matches; as many means there may be more", () => {
  assert.equal(findMatches("aaaa", searchPattern("a").pattern, 0).length, 0);
  assert.equal(findMatches("aaaa", searchPattern("a").pattern, 4).length, 4);
});

test("search: one match replaced where it is, in its context", () => {
  const behind = searchPattern("(?<=\\$)5", { regex: true }).pattern;
  assert.deepEqual(replaceAt("$5 and 5", behind, 1, "9", { regex: true }), { text: "$9 and 5", end: 2 });
  assert.equal(replaceAt("$5 and 5", behind, 7, "9", { regex: true }), null, "the 5 without a $ before it is no match");
  assert.deepEqual(replaceAt("x=1, y=2", searchPattern("(\\w)=(\\d)", { regex: true }).pattern, 5, "$2=$1", { regex: true }),
    { text: "x=1, 2=y", end: 8 });
  assert.deepEqual(replaceAt("a cat", searchPattern("cat").pattern, 2, "$&!"), { text: "a $&!", end: 5 }, "plain: $ is a dollar");
  assert.equal(replaceAt("a dog", searchPattern("cat").pattern, 2, "x"), null, "no longer there");
  assert.deepEqual(replaceAt("one\ntwo", searchPattern("^two$", { regex: true }).pattern, 4, "2", { regex: true }), { text: "one\n2", end: 5 });
});
