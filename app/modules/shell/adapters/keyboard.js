// App-wide shortcuts: one keydown listener runs the command whose keys match.
// Shortcuts inside the editor belong to the editor, not here.
import { chordMatches, parseChord } from "../model/keys.js";

export function createKeyboard({ commands, run, report, doc = document }) {
  doc.addEventListener("keydown", (event) => {
    for (const command of commands.all()) {
      const keys = command.keys ?? [];
      if (keys.some((text) => chordMatches(parseChord(text), event))) {
        event.preventDefault();
        run(command.id).catch(report);
        return;
      }
    }
  });
}
