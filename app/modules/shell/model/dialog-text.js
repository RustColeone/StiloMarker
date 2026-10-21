// A dialog asked with only its text ("Delete welcome.md?", or "Restore it to
// Monday's snapshot? Its text now is replaced."): its first sentence is the
// title, the rest the message. A first sentence too long for a title stays
// the message, under a plain question. Pure, so it runs in Node tests.
const MAX_TITLE = 90;

export function splitQuestion(text, fallback = "Are you sure?") {
  const value = String(text ?? "").trim();
  // The first ? ! or . that ends a sentence (followed by a space or the end:
  // "welcome.md" has a dot inside a name, not an end).
  const match = /^([\s\S]+?[?!.])(?:\s+([\s\S]*))?$/.exec(value);
  const title = match ? match[1] : value;
  if (!value || title.length > MAX_TITLE) return { title: fallback, message: value };
  return { title, message: (match?.[2] ?? "").trim() };
}
