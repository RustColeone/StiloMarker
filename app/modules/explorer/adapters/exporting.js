// Exporting a file as itself, or a folder (or the project) as a ZIP.
// Part of the Explorer module: `app` is its shared context (surface.js).
import { isImageFileName, dataUrlToBlob, getExportBytes, getMimeTypeForFileName, createZip, downloadBlob } from "../../workspace/index.js";

export function createExporting(app) {
  function collectFileEntries(project, nodeId) {
    const node = project.nodes[nodeId];
    if (!node) {
      return [];
    }

    if (node.kind === "file") {
      return [{ path: node.name, bytes: getExportBytes(node.name, node.content) }];
    }

    const entries = [];
    function walk(currentId, prefix = "") {
      const current = project.nodes[currentId];
      if (current.kind === "file") {
        entries.push({ path: `${prefix}${current.name}`, bytes: getExportBytes(current.name, current.content) });
        return;
      }
      current.children.forEach((childId) => {
        const child = project.nodes[childId];
        const nextPrefix = child.kind === "folder" ? `${prefix}${child.name}/` : prefix;
        walk(childId, nextPrefix);
      });
    }
    walk(nodeId, nodeId === project.rootId ? "" : `${node.name}/`);
    return entries;
  }

  function exportNode(nodeId) {
    const project = app.controller.getProject();
    const node = project.nodes[nodeId] ?? project.nodes[project.rootId];
    if (node.kind === "file") {
      const blob = isImageFileName(node.name)
        ? dataUrlToBlob(node.content)
        : new Blob([node.content], { type: getMimeTypeForFileName(node.name) });
      downloadBlob(blob, node.name);
      return;
    }
    downloadBlob(createZip(collectFileEntries(project, node.id)), `${node.name || project.name}.zip`);
  }

  return { collectFileEntries, exportNode };
}
