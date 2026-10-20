// Finding a command by what is typed (the Log's command line). Every word
// typed must be found in the command's title, its id or its keywords: as the
// start of a word (best), anywhere in them, or failing that its letters in
// order ("rlw" finds Reload Window). Commands that need their caller's
// arguments (args: true) are never offered. Pure, so it runs in Node tests.
//
// commands: [{ id, title (text, or a function giving it), keywords?, keys?, enabled?, danger?, args? }]
// options:  recent: ids run lately (most recent first), first: ids offered
//           before the rest when nothing is typed
// returns:  [{ id, title, keys, enabled, danger }] best first

const titleOf = (command) => (typeof command.title === "function" ? String(command.title()) : command.title);
const wordsOf = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The letters of `word` appear in `text` in order.
function inOrder(text, word) {
  let at = 0;
  for (const letter of word) {
    at = text.indexOf(letter, at) + 1;
    if (!at) return false;
  }
  return true;
}

function scoreOf(command, title, typed) {
  if (!typed.length) return 1;
  const phrase = typed.join(" ");
  const name = title.toLowerCase();
  if (name === phrase) return 1000;
  const titleWords = wordsOf(title);
  const otherWords = [...wordsOf(command.id), ...(command.keywords ?? []).flatMap(wordsOf)];
  const texts = [name, command.id.toLowerCase(), ...(command.keywords ?? []).map((keyword) => keyword.toLowerCase())];
  let score = name.startsWith(phrase) ? 500 : 0;
  for (const word of typed) {
    if (titleWords.some((each) => each.startsWith(word))) score += 100;
    else if (otherWords.some((each) => each.startsWith(word))) score += 80;
    else if (texts.some((text) => text.includes(word))) score += 40;
    else if (inOrder(name.replaceAll(" ", ""), word)) score += 10;
    else return 0;
  }
  return score;
}

export function searchCommands(commands, query, { recent = [], first = [] } = {}) {
  const typed = wordsOf(String(query ?? ""));
  const place = (list, id) => { const index = list.indexOf(id); return index < 0 ? Infinity : index; };
  return commands
    .filter((command) => !command.args)
    .map((command) => {
      const title = titleOf(command);
      return { command, title, score: scoreOf(command, title, typed) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score
      || (typed.length ? 0 : place(first, a.command.id) - place(first, b.command.id))
      || place(recent, a.command.id) - place(recent, b.command.id)
      || a.title.localeCompare(b.title))
    .map(({ command, title }) => ({
      id: command.id, title, keys: [...(command.keys ?? [])],
      enabled: !command.enabled || Boolean(command.enabled()), danger: Boolean(command.danger)
    }));
}
