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
export { contextFiles, projectSnapshot, projectTree, serializeContext, walkProjectTree } from "./model/request.js";
export { buildReplyRequest, characterInstructions, personaTranscript } from "./model/reply-request.js";

export default defineModule({
  name: "characters",
  level: 3,
  uses: ["file-types", "workspace"],
  owns: { rules: ["character sheet", "author's notes", "hidden from characters"] },
  start(ctx) {
    const workspace = ctx.use("workspace");
    // A character's avatar as an address: a web or data address as written, else
    // the project image it names (relative to the sheet), or nothing.
    function avatarSrc(project, personaNodeId, avatar) {
      const value = String(avatar ?? "").trim();
      if (!value) return "";
      if (/^(https?:\/\/|data:image\/)/i.test(value)) return value;
      const resolved = workspace.location.resolveAsset(project, personaNodeId, value);
      return resolved && resolved !== value ? resolved : "";
    }
    return { ...persona, projectSnapshot, contextFiles, avatarSrc };
  }
});
