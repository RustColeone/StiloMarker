// The browser's half of spec/characters/reply-request.cases.json (the
// server's is persona-chat.test.py): a character's reply as a model is asked
// for it, for a reply this browser writes with the user's own endpoint.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReplyRequest } from "../app/modules/characters/index.js";

const table = JSON.parse(readFileSync(new URL("../spec/characters/reply-request.cases.json", import.meta.url), "utf8"));

for (const entry of table.cases) {
  test(`a character's request, as the server builds it: ${entry.name}`, () => {
    const input = { messages: entry.messages, contextFiles: entry.contextFiles, projectName: entry.projectName,
      project: structuredClone(entry.project), persona: entry.persona, cast: entry.cast, model: entry.model };
    if ("error" in entry) {
      assert.throws(() => buildReplyRequest(input), (error) => error.message === entry.error);
      return;
    }
    const { payload, usedPaths } = buildReplyRequest(input);
    assert.deepEqual(payload, entry.payload);
    assert.deepEqual(usedPaths, entry.usedPaths);
  });
}
