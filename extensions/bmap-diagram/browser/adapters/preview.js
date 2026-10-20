// The diagram in the preview pane: the diagram editor (view.js, loaded the
// first time a diagram is shown), its links to other files, edits written
// back to the file, and Quick Generate from a node.
import { getRelativeProjectPath, normalizePath } from "../../../../app/modules/editor/index.js";
import { getNodeIdByPath, getPath, isImageFileName } from "../../../../app/modules/workspace/index.js";

export function addDiagramPreview({ editor, shell, workspace, isDiagram, generate, log }) {
  let viewModule = null, loading = null, diagramView = null;
  const secondViews = new WeakMap(); // a group's second preview -> its diagram editor
  const load = () => (loading ??= import("./view.js")
    .then((module) => (viewModule = module))
    .catch((error) => { loading = null; throw error; }));

  editor.previews.add({
    id: "bmap", matches: (file) => isDiagram(file.name), cacheable: false,
    showOnOpen: true, // the diagram editor is how a diagram is used
    viewState: () => diagramView?.getView?.() ?? null, // the pan and zoom, remembered per file
    render(target, project, file, tools) {
      if (!viewModule) {
        target.innerHTML = `<div class="preview-loading">Loading diagram…</div>`;
        load().then(() => {
          if (editor.view.get().previewFileId === file.id) shell.render(workspace.project().getProject());
        }).catch((error) => {
          if (editor.view.get().previewFileId !== file.id) return;
          target.innerHTML = `<div class="preview-loading">The diagram editor could not load. Check your connection, then reopen the file.</div>`;
          log("error", "Diagram editor failed to load", error.message);
        });
        return { shouldTypeset: false, content: "" };
      }
      // The preview's editor (its pan and zoom remembered per file), or a second preview's own.
      if (tools?.secondary && !secondViews.has(target)) secondViews.set(target, viewModule.createBmapView({ container: target }));
      const view = tools?.secondary ? secondViews.get(target) : (diagramView ??= viewModule.createBmapView({ container: target }));
      const basePath = getPath(project, file.id);
      const resolve = (filePath) => {
        const baseSegments = basePath.split("/").filter(Boolean);
        baseSegments.pop();
        return getNodeIdByPath(project, normalizePath([...baseSegments, filePath].join("/")));
      };
      const parts = editor.parts();
      view.render({
        documentKey: file.id,
        source: file.content,
        initialView: tools?.secondary ? null : parts.getViewState(file.id)?.bmap ?? null,
        onOpenLinkedFile(filePath) {
          const nodeId = resolve(filePath);
          if (nodeId) parts.openFileFromExplorer(nodeId);
        },
        resolveFileContent(filePath) {
          const node = project.nodes[resolve(filePath)];
          return node?.kind === "file" ? (node.content ?? null) : null;
        },
        listProjectFiles() {
          return Object.values(project.nodes)
            .filter((node) => node?.kind === "file" && node.id !== file.id)
            .map((node) => {
              const path = getPath(project, node.id);
              return { fileId: node.id, kind: isImageFileName(node.name) ? "image" : "file", label: path, path: getRelativeProjectPath(basePath, path) };
            })
            .sort((left, right) => left.label.localeCompare(right.label));
        },
        resolveRelativeFilePath(targetFileId) {
          const targetNode = project.nodes[targetFileId];
          if (!targetNode || targetNode.kind !== "file" || targetNode.id === file.id) return null;
          return getRelativeProjectPath(basePath, getPath(project, targetNode.id));
        },
        onCommit(nextSource, detail) {
          parts.updateFileContentFromPreview(file.id, nextSource, detail?.reason ?? "bmap preview edit");
        },
        generateScope: shell.settings.bmapGenerateScope,
        autoPan: shell.settings.bmapAutoPan,
        onQuickGenerate: (request) => generate(file.id, request),
        logDebug: log
      });
      // Its drags are its own: the phone's swipes leave the editor alone.
      target.querySelector(".bmap-editor")?.setAttribute("data-own-gestures", "");
      return { shouldTypeset: false, content: "" };
    }
  });
  return { load };
}
