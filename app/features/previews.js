// The character sheet's preview (a card over the sheet, and the author's notes
// folded away), added to the Editor's previews extension point. Diagrams'
// is the diagram extension's (extensions/bmap-diagram).
import { authorNotesHtml, parsePersona, personaAvatarHtml } from "../modules/characters/index.js";
import { getPath, isPersonaFileName } from "../modules/workspace/index.js";

// Returns `app`, so it can wrap the shared values it is given.
export function registerPreviews(previews, app) {

  // A character sheet previews as a card (avatar, name, @handle) over its body,
  // instead of showing the raw header lines as text.
  previews.add({
    id: "persona", matches: (file) => isPersonaFileName(file.name), cacheable: true,
    render(target, project, file, tools) {
      const persona = parsePersona(file.content, getPath(project, file.id));
      const card = `<div class="persona-card" style="--persona-color:${app.escapeHtmlAttribute(persona.color)}">
          ${personaAvatarHtml(persona, app.personaAvatarSrc(project, file.id, persona.avatar), "persona-avatar persona-card-avatar")}
          <div class="persona-card-text"><div class="persona-card-name">${app.escapeHtmlAttribute(persona.name)}</div>
            <div class="persona-card-meta">@${app.escapeHtmlAttribute(persona.handle)} · Character for Chats</div></div>
        </div>`;
      target.innerHTML = card + authorNotesHtml(persona) + tools.markdownHtml(project, file, persona.sheet);
      return { shouldTypeset: true, content: file.content };
    },
    printHtml: (project, file, tools) => tools.markdownHtml(project, file, file.content)
  });
  return app;
}
