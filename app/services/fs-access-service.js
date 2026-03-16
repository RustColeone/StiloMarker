import { ROOT_ID, addFile, addFolder, createProject, getNode, getPath, isImageFileName, listVisibleNodes } from "../domain/project-model.js";
import { bytesToDataUrl, dataUrlToBlob, decodeTextBytes, getExportBytes, getMimeTypeForFileName, readFileAsProjectContent } from "./file-content-service.js";
import { extractZipEntries } from "./zip-service.js";

function findChildByName(project, parentId, name, kind) {
  const parent = getNode(project, parentId);
  return parent.children
    .map((childId) => project.nodes[childId])
    .find((child) => child && child.kind === kind && child.name === name);
}

function ensureFolderPath(project, folderNames) {
  let currentProject = project;
  let parentId = ROOT_ID;

  folderNames.forEach((folderName) => {
    const existing = findChildByName(currentProject, parentId, folderName, "folder");
    if (existing) {
      parentId = existing.id;
      return;
    }
    currentProject = addFolder(currentProject, parentId, folderName);
    const created = findChildByName(currentProject, parentId, folderName, "folder");
    parentId = created.id;
  });

  return { project: currentProject, parentId };
}

function supportsDirectoryAccess() {
  return typeof window.showDirectoryPicker === "function";
}

function buildSourceIndex(project) {
  const index = {};
  listVisibleNodes(project).forEach(({ node, path }) => {
    index[node.id] = { path, kind: node.kind };
  });
  return index;
}

function getPathDepth(path) {
  return path.split("/").filter(Boolean).length;
}

function hasDeletedFolderAncestor(entry, deletedFolderPaths) {
  return deletedFolderPaths.some((folderPath) => entry.path.startsWith(`${folderPath}/`));
}

async function getDirectoryHandleAtPath(rootHandle, folderPath, create = false) {
  const segments = folderPath.split("/").filter(Boolean);
  let handle = rootHandle;

  for (const segment of segments) {
    handle = await handle.getDirectoryHandle(segment, { create });
  }

  return handle;
}

async function removeEntryAtPath(rootHandle, entry) {
  const segments = entry.path.split("/").filter(Boolean);
  const name = segments.pop();
  const parentHandle = await getDirectoryHandleAtPath(rootHandle, segments.join("/"), false);
  await parentHandle.removeEntry(name, { recursive: entry.kind === "folder" });
}

async function ensureReadWritePermission(handle) {
  const options = { mode: "readwrite" };
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }
  return (await handle.requestPermission(options)) === "granted";
}

async function importDirectory() {
  const directoryHandle = await window.showDirectoryPicker();
  const granted = await ensureReadWritePermission(directoryHandle);
  if (!granted) {
    throw new Error("Directory permission was not granted.");
  }

  let project = createProject(directoryHandle.name || "Directory");
  project.sourceMode = "filesystem";
  project.handles = { [ROOT_ID]: directoryHandle };

  async function walk(folderHandle, parentId) {
    for await (const entry of folderHandle.values()) {
      if (entry.kind === "directory") {
        project = addFolder(project, parentId, entry.name);
        const folderNode = Object.values(project.nodes).find(
          (node) => node.parentId === parentId && node.kind === "folder" && node.name === entry.name
        );
        project.handles[folderNode.id] = entry;
        await walk(entry, folderNode.id);
      }

      if (entry.kind === "file" && /\.(md|mtree|urldb|png|jpe?g|gif|svg|webp|bmp)$/i.test(entry.name)) {
        const file = await entry.getFile();
        project = addFile(project, parentId, entry.name, await readFileAsProjectContent(file, entry.name));
        const fileNode = Object.values(project.nodes).find(
          (node) => node.parentId === parentId && node.kind === "file" && node.name === entry.name
        );
        project.handles[fileNode.id] = entry;
      }
    }
  }

  await walk(directoryHandle, ROOT_ID);
  const firstFile = listVisibleNodes(project).find((row) => row.node.kind === "file")?.node;
  if (firstFile) {
    project.activeFileId = firstFile.id;
  }
  project.sourceIndex = buildSourceIndex(project);

  return project;
}

async function saveProjectToHandles(project) {
  if (project.sourceMode !== "filesystem" || !project.handles) {
    return false;
  }

  const rootHandle = project.handles[ROOT_ID];
  const previousSourceIndex = project.sourceIndex ?? {};
  const currentRows = listVisibleNodes(project);
  const currentSourceIndex = buildSourceIndex(project);
  const deletedEntries = Object.entries(previousSourceIndex)
    .filter(([nodeId, entry]) => currentSourceIndex[nodeId]?.path !== entry.path)
    .map(([, entry]) => entry);

  const deletedFolderPaths = deletedEntries
    .filter((entry) => entry.kind === "folder")
    .map((entry) => entry.path)
    .sort((left, right) => getPathDepth(right) - getPathDepth(left));

  const filteredDeletedEntries = deletedEntries
    .filter((entry) => entry.kind === "folder" || !hasDeletedFolderAncestor(entry, deletedFolderPaths))
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "file" ? -1 : 1;
      }
      return getPathDepth(right.path) - getPathDepth(left.path);
    });

  for (const entry of filteredDeletedEntries) {
    await removeEntryAtPath(rootHandle, entry);
  }

  project.handles = { [ROOT_ID]: rootHandle };

  const folderRows = currentRows.filter((row) => row.node.kind === "folder");

  for (const row of folderRows) {
    const folderNode = row.node;
    project.handles[folderNode.id] = await getDirectoryHandleAtPath(rootHandle, getPath(project, folderNode.id), true);
  }

  const rows = currentRows.filter((row) => row.node.kind === "file");

  for (const row of rows) {
    const fileNode = row.node;
    const parent = getNode(project, fileNode.parentId);
    const parentHandle = project.handles[parent.id] ?? rootHandle;
    const fileHandle = await parentHandle.getFileHandle(fileNode.name, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(isImageFileName(fileNode.name) ? dataUrlToBlob(fileNode.content) : fileNode.content);
    await writer.close();
    project.handles[fileNode.id] = fileHandle;
  }

  project.sourceIndex = currentSourceIndex;

  return true;
}

async function importSingleFile(file) {
  const content = await readFileAsProjectContent(file, file.name);
  let project = createProject("Imported File");
  project = addFile(project, ROOT_ID, file.name, content);
  project.sourceMode = "import-file";
  project.activeFileId = Object.values(project.nodes).find((node) => node.kind === "file")?.id ?? null;
  return project;
}

async function importZipArchive(file) {
  const zipEntries = await extractZipEntries(file);
  const supportedEntries = zipEntries.filter((entry) => /\.(md|mtree|urldb|png|jpe?g|gif|svg|webp|bmp)$/i.test(entry.path));

  if (supportedEntries.length === 0) {
    throw new Error("ZIP archive does not contain any supported markdown, mtree, urldb, or image files.");
  }

  const projectName = file.name.replace(/\.zip$/i, "") || "Imported Zip";
  let project = createProject(projectName);
  project.sourceMode = "import-zip";

  for (const entry of supportedEntries) {
    const segments = entry.path.split("/").filter(Boolean);
    const fileName = segments.pop();
    const folderState = ensureFolderPath(project, segments);
    project = folderState.project;
    const content = isImageFileName(fileName)
      ? bytesToDataUrl(entry.bytes, getMimeTypeForFileName(fileName))
      : decodeTextBytes(entry.bytes);
    project = addFile(project, folderState.parentId, fileName, content);
  }

  const firstFile = listVisibleNodes(project).find((row) => row.node.kind === "file")?.node;
  project.activeFileId = firstFile?.id ?? null;
  return project;
}

export { importDirectory, importSingleFile, importZipArchive, saveProjectToHandles, supportsDirectoryAccess };