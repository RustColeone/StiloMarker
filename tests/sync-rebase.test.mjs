import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { transformTextPatch } from "../app/modules/sync/index.js";

// The browser's half of spec/sync/rebase.cases.json (the server's is sync.test.py).
const { cases } = JSON.parse(readFileSync(new URL("../spec/sync/rebase.cases.json", import.meta.url), "utf8"));

test("a text patch rebased over an earlier one lands where the server puts it", () => {
  for (const c of cases) {
    let got;
    try {
      const moved = transformTextPatch({ start: c.patch[0], end: c.patch[1] },
        { start: c.applied[0], end: c.applied[1], text: "x".repeat(c.inserted) });
      got = [moved.start, moved.end];
    } catch {
      got = "conflict";
    }
    assert.deepEqual(got, c.expect, c.name);
  }
});
