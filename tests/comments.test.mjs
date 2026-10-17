import test from "node:test";
import assert from "node:assert/strict";

import { reanchor, saveComment, withComment } from "../app/modules/comments/index.js";

test("a comment follows its line by the line's own text, to the nearest match", () => {
  const comments = [{ id: "a", line: 1, anchorText: "two" }, { id: "b", line: 3, anchorText: "" }, { id: "c", line: 0, anchorText: "one" }];
  const moves = reanchor(comments, "new\none\ntwo\nthree\ntwo");
  assert.deepEqual(moves, [{ id: "a", line: 2, anchorText: "two" }, { id: "c", line: 1, anchorText: "one" }]);
  assert.equal(comments[1].line, 3, "a blank anchor stays where it was");
  assert.deepEqual(reanchor([{ id: "x", line: 0, anchorText: "gone" }], "other"), [], "no match: it stays");
});

test("a saved comment replaces its old copy in line order", () => {
  const list = [{ id: "a", line: 1 }, { id: "b", line: 5 }];
  assert.deepEqual(withComment(list, { id: "b", line: 0 }).map((c) => c.id), ["b", "a"]);
  assert.deepEqual(withComment(list, { id: "c", line: 3 }).map((c) => c.id), ["a", "c", "b"]);
});

test("saving a comment sends the project and the comment with the token", async () => {
  const realFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url: new URL(url), init }; return new Response(JSON.stringify({ comment: { id: "c" } }), { headers: { "content-type": "application/json" } }); };
  try {
    await saveComment("https://notes.example", "t1", "red", "Novel", { file: "a.md", line: 2, text: "hi" });
    assert.equal(sent.url.pathname, "/api/comments");
    assert.equal(sent.url.searchParams.get("token"), "t1");
    assert.deepEqual(JSON.parse(sent.init.body), { team: "red", path: "Novel", file: "a.md", line: 2, text: "hi" });
  } finally {
    globalThis.fetch = realFetch;
  }
});
