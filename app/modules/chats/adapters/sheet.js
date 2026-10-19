// The character sheet in the editor, for Chats' characters: its preview (a
// card over the sheet, and the author's notes folded away), through the
// Editor's previews extension point, and a new sheet's first content (the
// template), through the Explorer's newFiles.
import { authorNotesHtml, parsePersona, personaAvatarHtml, personaTemplate } from "../../characters/index.js";
import { escapeHtmlAttribute } from "../../editor/index.js";
import { getPath, isPersonaFileName } from "../../workspace/index.js";

export function addCharacterSheet({ editor, explorer, characters }) {
  // A character sheet previews as a card (avatar, name, @handle) over its body,
  // instead of showing the raw header lines as text.
  editor.previews.add({
    id: "persona", matches: (file) => isPersonaFileName(file.name), cacheable: true,
    render(target, project, file, tools) {
      const persona = parsePersona(file.content, getPath(project, file.id));
      const card = `<div class="persona-card" style="--persona-color:${escapeHtmlAttribute(persona.color)}">
          ${personaAvatarHtml(persona, characters.avatarSrc(project, file.id, persona.avatar), "persona-avatar persona-card-avatar")}
          <div class="persona-card-text"><div class="persona-card-name">${escapeHtmlAttribute(persona.name)}</div>
            <div class="persona-card-meta">@${escapeHtmlAttribute(persona.handle)} · Character for Chats</div></div>
        </div>`;
      target.innerHTML = card + authorNotesHtml(persona) + tools.markdownHtml(project, file, persona.sheet);
      return { shouldTypeset: true, content: file.content };
    },
    printHtml: (project, file, tools) => tools.markdownHtml(project, file, file.content)
  });
  // A new character sheet starts from the template.
  explorer.newFiles.add({ id: "persona", content(name) {
    const base = parsePersona("", name).name;
    return personaTemplate(/^new character( \d+)?$/i.test(base) ? "New Character" : base);
  } });
}
