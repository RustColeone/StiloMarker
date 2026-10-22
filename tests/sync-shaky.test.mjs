// A shaky connection (sync/model/shaky.js): drops close together are said,
// at most once in a while; drops far apart are not. The page:
// shaky-connection-browser.py.
import test from "node:test";
import assert from "node:assert/strict";
import { SHAKY_WITHIN, WARN_EVERY, noteDrop } from "../app/modules/sync/model/shaky.js";

const minutes = (n) => n * 60 * 1000;

test("shaky: the second drop within ten minutes is said; once in a while", () => {
  let state = noteDrop(undefined, minutes(0));
  assert.equal(state.warn, false, "one drop is not shaky");
  state = noteDrop(state, minutes(4));
  assert.equal(state.warn, true, "two in four minutes are");
  state = noteDrop(state, minutes(6));
  assert.equal(state.warn, false, "said once, not at every drop");
  state = noteDrop(state, minutes(4) + WARN_EVERY);
  assert.equal(state.warn, true, "said again after a while, when it still drops");
});

test("shaky: drops far apart are not", () => {
  let state = noteDrop(undefined, minutes(0));
  state = noteDrop(state, SHAKY_WITHIN + 1);
  assert.equal(state.warn, false);
  assert.deepEqual(state.drops, [SHAKY_WITHIN + 1], "older drops are forgotten");
});
