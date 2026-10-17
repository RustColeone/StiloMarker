// Previews of file types that are not the Editor's own: URL albums (the table,
// or one entry), diagrams (.bmap, loaded on first use) and character sheets (a
// card over the sheet, and the author's notes folded away). Each is added to
// the Editor's previews extension point. The URL album moves into an
// extension in step 8.
import { authorNotesHtml, parsePersona, personaAvatarHtml } from "../modules/characters/index.js";
import { getNodeIdByPath, getPath, isBmapFileName, isImageFileName, isPersonaFileName, isUrlDbFileName } from "../modules/workspace/index.js";

// Returns `app`, so it can wrap the shared values it is given.
export function registerPreviews(previews, app) {

  function renderUrlDbTable(target, file) {
    const entries = app.getUrlDbEntries(file.content);
    const frame = document.createElement("div");
    frame.className = "urldb-preview";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "editor-readonly-note";
      empty.textContent = "No valid bookmark entries yet. Add sections like [Name] and url = https://...";
      frame.append(empty);
      target.append(frame);
      return { shouldTypeset: false, content: "" };
    }

    const table = document.createElement("table");
    table.className = "urldb-table";
    table.innerHTML = "<thead><tr><th>Preview</th><th>Name</th><th>URL</th><th>Description</th></tr></thead>";
    const body = document.createElement("tbody");

    entries.forEach((entry) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td><img src="${app.escapeHtmlAttribute(entry.url)}" alt="${app.escapeHtmlAttribute(entry.name)}"></td><td>${app.escapeEditorHtml(entry.name)}</td><td><a href="${app.escapeHtmlAttribute(entry.url)}" target="_blank" rel="noreferrer">${app.escapeEditorHtml(entry.url)}</a></td><td>${app.escapeEditorHtml(entry.description || "")}</td>`;
      body.append(row);
    });

    table.append(body);
    frame.append(table);
    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  function renderUrlDbEntryPreview(target, file, entryId) {
    const entry = app.getUrlDbEntryById(file.content, entryId);
    if (!entry) {
      app.previewUrlDbEntry = null;
      return renderUrlDbTable(target, file);
    }

    const frame = document.createElement("div");
    frame.className = "asset-preview remote-asset-preview";

    const image = document.createElement("img");
    image.src = entry.url;
    image.alt = entry.name;
    frame.append(image);

    const meta = document.createElement("div");
    meta.className = "remote-asset-meta";
    meta.innerHTML = `<strong>${app.escapeEditorHtml(entry.name)}</strong><span>${app.escapeEditorHtml(entry.description || entry.url)}</span>`;
    frame.append(meta);

    target.append(frame);
    return { shouldTypeset: false, content: "" };
  }

  previews.add({
    id: "urldb", matches: (file) => isUrlDbFileName(file.name), cacheable: false,
    render(target, project, file) {
      if (app.previewUrlDbEntry && app.previewFileId === file.id) return renderUrlDbEntryPreview(target, file, app.previewUrlDbEntry);
      return renderUrlDbTable(target, file);
    }
  });

  previews.add({
    id: "bmap", matches: (file) => isBmapFileName(file.name), cacheable: false,
    render(target, project, file) {
      if (!app.bmapViewModule) {
        target.innerHTML = `<div class="preview-loading">Loading diagram…</div>`;
        app.loadBmapView().then(() => {
          if (app.previewFileId === file.id) app.render(app.controller.getProject());
        }).catch((error) => {
          if (app.previewFileId !== file.id) return;
          target.innerHTML = `<div class="preview-loading">The diagram editor could not load. Check your connection, then reopen the file.</div>`;
          app.logDebug("error", "Diagram editor failed to load", error.message);
        });
        return { shouldTypeset: false, content: "" };
      }
      if (!app.previewBmapView) {
        app.previewBmapView = app.bmapViewModule.createBmapView({ container: target });
      }
      const basePath = getPath(project, file.id);
      app.previewBmapView.render({
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
