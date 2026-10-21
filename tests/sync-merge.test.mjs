// Edits made offline put together with others' on reconnect (sync/model/merge.js).
import test from "node:test";
import assert from "node:assert/strict";
import { lineChanges, mergeText } from "../app/modules/sync/model/merge.js";

const base = "# Title\n\nOne.\nTwo.\nThree.\nFour.\nFive.\n";

test("merging: changes to different lines are both kept", () => {
  const ours = base.replace("Two.", "Two, mine.");
  const theirs = base.replace("Five.", "Five, theirs.");
  assert.equal(mergeText(base, ours, theirs), base.replace("Two.", "Two, mine.").replace("Five.", "Five, theirs."));
});

test("merging: one side's lines added, the other's removed, elsewhere", () => {
  const ours = base.replace("One.\n", "One.\nOne and a half.\n");
  const theirs = base.replace("Four.\n", "");
  assert.equal(mergeText(base, ours, theirs), "# Title\n\nOne.\nOne and a half.\nTwo.\nThree.\nFive.\n");
});

test("merging: neighbouring lines changed by each side are both kept", () => {
  const ours = base.replace("Two.", "2.");
  const theirs = base.replace("Three.", "3.");
  assert.equal(mergeText(base, ours, theirs), base.replace("Two.", "2.").replace("Three.", "3."));
});

test("merging: the same change on both sides is taken once", () => {
  const both = base.replace("Three.", "Three!");
  assert.equal(mergeText(base, both, both), both);
  const ours = both.replace("One.", "1.");
  assert.equal(mergeText(base, ours, both), ours);
});

test("merging: one side unchanged takes the other", () => {
  const ours = base.replace("One.", "Uno.");
  assert.equal(mergeText(base, ours, base), ours);
  assert.equal(mergeText(base, base, ours), ours);
});

test("merging refuses what it would have to guess", () => {
  assert.equal(mergeText(base, base.replace("Two.", "Two, mine."), base.replace("Two.", "Two, theirs.")), null, "the same line changed differently");
  assert.equal(mergeText(base, base.replace("Two.\n", "Two.\nMine.\n"), base.replace("Two.\n", "Two.\nTheirs.\n")), null, "both insert at one point");
  assert.equal(mergeText(base, base.replace("Two.\n", "Mine.\nTwo.\n"), base.replace("Two.", "2.")), null, "an insertion at the edge of a changed line");
  assert.equal(mergeText(base, base.replace("Two.\nThree.", "Two-three."), base.replace("Three.", "3.")), null, "overlapping ranges");
});

test("merging: a long text with changes far apart; too many changes are refused, not stalled", () => {
  const big = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join("\n");
  const ours = big.replace("line 10\n", "line ten\n").replace("line 2990", "x");
  const theirs = big.replace("line 1500", "y").replace("line 20\n", "line twenty\n").replace("line 2980", "z");
  assert.equal(mergeText(big, ours, theirs, { maxEdits: 2 }), null);
  const merged = mergeText(big, ours, theirs);
  assert.ok(merged.includes("line ten") && merged.includes("\ny\n") && merged.includes("line twenty") && merged.includes("\nx") && merged.includes("\nz\n"));
});

test("merging: the line changes found rebuild the other text, for every small pair", () => {
  // Every pair of texts of up to five lines over three letters (Myers' way back included).
  const letters = ["a", "b", "c"];
  const texts = [];
  for (let length = 0; length <= 5; length += 1) {
    const walk = (prefix) => { if (prefix.length === length) { texts.push(prefix); return; } for (const letter of letters) walk([...prefix, letter]); };
    walk([]);
  }
  for (const a of texts) for (const b of texts) {
    const hunks = lineChanges(a, b);
    const out = [];
    let at = 0;
    for (const hunk of hunks) { out.push(...a.slice(at, hunk.start), ...hunk.lines); at = hunk.end; }
    out.push(...a.slice(at));
    assert.deepEqual(out, b, `${a.join("")} -> ${b.join("")}`);
    // As few changes as there must be: each hunk changes something.
    assert.ok(hunks.every((hunk) => hunk.end > hunk.start || hunk.lines.length));
  }
});
