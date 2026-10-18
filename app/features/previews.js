// Previews of file types that are not the Editor's own: diagrams (.bmap,
// loaded on first use) and character sheets (a card over the sheet, and the
// author's notes folded away). Each is added to the Editor's previews
// extension point.
import { authorNotesHtml, parsePersona, personaAvatarHtml } from "../modules/characters/index.js";
import { getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isPersonaFileName } from "../modules/workspace/index.js";

// The diagram editor in the preview, created on first use.
let diagramView = null;

// Returns `app`, so it can wrap the shared values it is given.
export function registerPreviews(previews, app) {

  previews.add({
    id: "bmap", matches: (file) => isBmapFileName(file.name), cacheable: false,
    viewState: () => diagramView?.getView?.() ?? null, // the pan and zoom, remembered per file
    render(target, project, file) {
      if (!app.bmapViewModule) {
        target.innerHTML = `<div class="preview-loading">Loading diagram…</div>`;
        app.loadBmapView().then(() => {
          if (app.view.get().previewFileId === file.id) app.render(app.controller.getProject());
        }).catch((error) => {
          if (app.view.get().previewFileId !== file.id) return;
          target.innerHTML = `<div class="preview-loading">The diagram editor could not load. Check your connection, then reopen the file.</div>`;
          app.logDebug("error", "Diagram editor failed to load", error.message);
        });
        return { shouldTypeset: false, content: "" };
      }
      if (!diagramView) {
        diagramView = app.bmapViewModule.createBmapView({ container: target });
      }
      const basePath = getPath(project, file.id);
      diagramView.render({
        documentKey: file.id,
        source: file.content,
        initialView: app.getViewState(file.id)?.bmap ?? null,
        onOpenLinkedFile(filePath) {
          const baseSegments = basePath.split("/").filter(Boolean);
          baseSegments.pop();
          const resolvedPath = app.normalizePath([...baseSegments, filePath].join("/"));
          const nodeId = getNodeIdByPath(project, resolvedPath);
          if (nodeId) {
            app.openFileFromExplorer(nodeId);
          }
        },
        resolveFileContent(filePath) {
          const baseSegments = basePath.split("/").filter(Boolean);
          baseSegments.pop();
          const resolvedPath = app.normalizePath([...baseSegments, filePath].join("/"));
          const nodeId = getNodeIdByPath(project, resolvedPath);
          if (!nodeId) {
            return null;
          }
          const node = project.nodes[nodeId];
          return node?.kind === "file" ? (node.content ?? null) : null;
        },
        listProjectFiles() {
          return Object.values(project.nodes)
            .filter((node) => node?.kind === "file" && node.id !== file.id)
            .map((node) => {
              const path = getPath(project, node.id);
              return {
                fileId: node.id,
                kind: isImageFileName(node.name) ? "image" : "file",
                label: path,
                path: app.getRelativeProjectPath(basePath, path)
              };
            })
            .sort((left, right) => left.label.localeCompare(right.label));
        },
        resolveRelativeFilePath(targetFileId) {
          const targetNode = project.nodes[targetFileId];
          if (!targetNode || targetNode.kind !== "file" || targetNode.id === file.id) {
            return null;
          }
          return app.getRelativeProjectPath(basePath, getPath(project, targetNode.id));
        },
        onCommit(nextSource, detail) {
          app.updateFileContentFromPreview(file.id, nextSource, detail?.reason ?? "bmap preview edit");
        },
        generateScope: app.settings.bmapGenerateScope,
        autoPan: app.settings.bmapAutoPan,
        onQuickGenerate(request) {
          return app.quickGenerateBmapFile(file.id, request);
        },
        logDebug: app.logDebug,
      });
      return { shouldTypeset: false, content: "" };
    }
  });

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
