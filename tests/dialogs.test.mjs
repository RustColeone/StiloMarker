// Shell's small dialogs asked with only their text: the first sentence is the
// title, the rest the message (model/dialog-text.js).
import test from "node:test";
import assert from "node:assert/strict";

import { splitQuestion } from "../app/modules/shell/model/dialog-text.js";

test("a question's first sentence is its title, the rest its message", () => {
  assert.deepEqual(splitQuestion("Delete welcome.md?"), { title: "Delete welcome.md?", message: "" }, "a dot inside a name is no end");
  assert.deepEqual(splitQuestion("Leave this group? You won't see its messages any more."),
    { title: "Leave this group?", message: "You won't see its messages any more." });
  assert.deepEqual(splitQuestion('Restore "a.md" to its 10/20/2026, 3:00 PM snapshot? Current content is replaced.\nKeep a copy first.'),
    { title: 'Restore "a.md" to its 10/20/2026, 3:00 PM snapshot?', message: "Current content is replaced.\nKeep a copy first." });
  assert.deepEqual(splitQuestion("Saved"), { title: "Saved", message: "" });
  assert.deepEqual(splitQuestion(""), { title: "Are you sure?", message: "" });
  const long = `${"word ".repeat(30)}end? More.`;
  assert.deepEqual(splitQuestion(long, "Notice"), { title: "Notice", message: long.trim() }, "too long for a title: all of it is the message");
});
