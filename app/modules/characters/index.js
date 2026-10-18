// Characters: what a character file is, what a character knows (its sheet
// without the author's notes), and what it may read (never a Plans folder or
// a *.plan.md file). The server's half is server/stilo/modules/characters.
//
// API (also as static exports, for code from before the restructure):
//   parsePersona(content, path) -> { name, handle, avatar, color, temperature,
//                                    body, sheet, notes, notesMode }
//   splitAuthorNotes(body)  withoutAuthorNotes(content)  notesMode(header)
//   hiddenFromCharacters(path)  personaSummary(body)  findMentions(text, members)
//   personaHandle(path)  personaTemplate(name)  personaFileName(name) …
//   projectSnapshot(project)  contextFiles(project, { contextPaths }): what a
//   request to a model carries from the project (model/request.js)
import { defineModule } from "../../kernel/index.js";
import * as persona from "./model/persona.js";
import { contextFiles, projectSnapshot } from "./model/request.js";

export * from "./model/persona.js";
export { contextFiles, projectSnapshot } from "./model/request.js";

export default defineModule({
  name: "characters",
  level: 3,
  uses: ["file-types", "workspace"],
  owns: { rules: ["character sheet", "author's notes", "hidden from characters"] },
  start() {
    return { ...persona, projectSnapshot, contextFiles };
  }
});
