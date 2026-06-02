import { ROOT_ID, addFile, addFolder, createProject, findChildByName, isImageFileName } from "../domain/project-model.js";
import { bytesToDataUrl, getMimeTypeForFileName } from "./file-content-service.js";

async function fetchTemplateEntry(path) {
  const response = await fetch(`./Template/${path}`);
  if (!response.ok) {
    throw new Error(`Template entry not found: ${path}`);
  }

  if (isImageFileName(path)) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytesToDataUrl(bytes, getMimeTypeForFileName(path));
  }

  return response.text();
}

function ensureFolderPath(project, segments) {
  let nextProject = project;
  let parentId = ROOT_ID;

  segments.forEach((segment) => {
    const existing = findChildByName(nextProject, parentId, segment);
    if (existing?.kind === "folder") {
      parentId = existing.id;
      return;
    }
    nextProject = addFolder(nextProject, parentId, segment);
    parentId = findChildByName(nextProject, parentId, segment)?.id ?? parentId;
  });

  return { project: nextProject, parentId };
}

async function loadTemplateProject() {
  const response = await fetch("./Template/template-manifest.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Template manifest could not be loaded.");
  }

  const manifest = await response.json();
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  let project = createProject(manifest.projectName || "STILO MARKER");

  for (const entryPath of entries) {
    const segments = String(entryPath).split("/").filter(Boolean);
    const fileName = segments.pop();
    if (!fileName) {
      continue;
    }
    const folderState = ensureFolderPath(project, segments);
    project = folderState.project;
    const content = await fetchTemplateEntry(entryPath);
    project = addFile(project, folderState.parentId, fileName, content);
  }

  const firstFile = Object.values(project.nodes).find((node) => node.kind === "file");
  project.activeFileId = firstFile?.id ?? null;
  return project;
}

export { loadTemplateProject };