// Origin Private File System (OPFS) backing for local-mode projects.
//
// OPFS gives every origin a persistent, sandboxed directory tree that survives
// reloads. Its handles implement the same FileSystemDirectoryHandle /
// FileSystemFileHandle API as window.showDirectoryPicker(), so we reuse the same
// walk-and-flush code path as OS folders (buildProjectFromDirectoryHandle /
// saveProjectToHandles). A local project is simply an OPFS directory that
// contains a manifest.json marker; plain directories are just folders. This
// mirrors the server's layout (folders + projects detected by a meta file) so a
// single File-Browser can later drive both sides.

import { ROOT_ID } from "../domain/project-model.js";
import { buildProjectFromDirectoryHandle, saveProjectToHandles } from "./fs-access-service.js";

const MANIFEST_NAME = "manifest.json";

function supportsOpfs() {
  return typeof navigator !== "undefined"
    && !!navigator.storage
    && typeof navigator.storage.getDirectory === "function";
}

function getOpfsRoot() {
  return navigator.storage.getDirectory();
}

function splitPath(path) {
  return String(path || "").split("/").filter(Boolean);
}

function sanitizeName(name) {
  const clean = String(name || "").trim().replace(/[\\/]+/g, "-");
  if (!clean || clean === "." || clean === "..") {
    throw new Error("Please provide a valid name.");
  }
  return clean;
}

async function getDirectoryHandleAtPath(rootHandle, path, create = false) {
  let handle = rootHandle;
  for (const segment of splitPath(path)) {
    handle = await handle.getDirectoryHandle(segment, { create });
  }
  return handle;
}

async function hasEntry(dirHandle, name) {
  try {
    await dirHandle.getFileHandle(name, { create: false });
    return true;
  } catch {
    try {
      await dirHandle.getDirectoryHandle(name, { create: false });
      return true;
    } catch {
      return false;
    }
  }
}

async function isProjectDir(dirHandle) {
  try {
    await dirHandle.getFileHandle(MANIFEST_NAME, { create: false });
    return true;
  } catch {
    return false;
  }
}

// List one OPFS directory as browser entries: directories become "project" (has
// manifest.json) or "folder"; loose files are surfaced too (the manifest marker
// itself is hidden). Shaped to match the server browser's entry contract.
async function listOpfsDir(path = "") {
  const root = await getOpfsRoot();
  const dir = await getDirectoryHandleAtPath(root, path, false);
  const entries = [];
  for await (const entry of dir.values()) {
    const childPath = path ? `${path}/${entry.name}` : entry.name;
    if (entry.kind === "directory") {
      const project = await isProjectDir(entry);
      let modified = 0;
      if (project) {
        try {
          const manifest = await (await entry.getFileHandle(MANIFEST_NAME)).getFile();
          modified = Math.floor(manifest.lastModified / 1000);
        } catch { /* leave unset */ }
      }
      entries.push({ name: entry.name, kind: project ? "project" : "folder", path: childPath, modified });
    } else if (entry.name !== MANIFEST_NAME) {
      let modified = 0;
      try {
        modified = Math.floor((await entry.getFile()).lastModified / 1000);
      } catch { /* leave unset */ }
      entries.push({ name: entry.name, kind: "file", path: childPath, modified });
    }
  }
  entries.sort((left, right) => {
    const rank = (kind) => (kind === "folder" ? 0 : kind === "project" ? 1 : 2);
    if (rank(left.kind) !== rank(right.kind)) {
      return rank(left.kind) - rank(right.kind);
    }
    return left.name.localeCompare(right.name);
  });
  return { path, entries };
}

async function mkdirOpfs(path, name) {
  const clean = sanitizeName(name);
  const root = await getOpfsRoot();
  const parent = await getDirectoryHandleAtPath(root, path, true);
  if (await hasEntry(parent, clean)) {
    throw new Error(`"${clean}" already exists here.`);
  }
  await parent.getDirectoryHandle(clean, { create: true });
  return { path: path ? `${path}/${clean}` : clean };
}

async function writeFile(dirHandle, name, contents) {
  const handle = await dirHandle.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(contents);
  await writer.close();
}

async function writeManifest(dirHandle, name) {
  await writeFile(dirHandle, MANIFEST_NAME, JSON.stringify({
    kind: "project",
    name,
    createdAt: new Date().toISOString()
  }, null, 2));
}

// Pick a non-colliding directory name under parent, appending -2, -3, ... .
async function uniqueDirName(parent, base) {
  let candidate = base;
  let counter = 2;
  while (await hasEntry(parent, candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

async function createProjectOpfs(path, name) {
  const clean = sanitizeName(name);
  const root = await getOpfsRoot();
  const parent = await getDirectoryHandleAtPath(root, path, true);
  if (await hasEntry(parent, clean)) {
    throw new Error(`"${clean}" already exists here.`);
  }
  const dir = await parent.getDirectoryHandle(clean, { create: true });
  await writeManifest(dir, clean);
  await writeFile(dir, "welcome.md", `# ${clean}\n\nWelcome to your new local workspace.\n`);
  return { path: path ? `${path}/${clean}` : clean };
}

async function openProjectOpfs(path) {
  const root = await getOpfsRoot();
  const dir = await getDirectoryHandleAtPath(root, path, false);
  const segments = splitPath(path);
  const name = segments[segments.length - 1] || dir.name || "Workspace";
  const project = await buildProjectFromDirectoryHandle(dir, name, "opfs");
  project.localPath = path;
  return project;
}

// Boot restore: resolve the directory handle for a previously-opened OPFS project
// (no permission prompt for OPFS). The caller re-attaches it to the *live*
// project so subsequent saves flow straight back to the same directory; the
// persisted sourceIndex is kept as-is because it reflects the last on-disk
// layout, which is exactly what saveProjectToHandles needs to diff deletions.
async function getOpfsDirectoryHandle(path) {
  const root = await getOpfsRoot();
  return getDirectoryHandleAtPath(root, path, false);
}

function saveProjectOpfs(project) {
  return saveProjectToHandles(project);
}

// One-off importer (keeps the old "Open Local Directory" capability): copy a real
// OS folder's supported files into a fresh OPFS project, then reopen it from OPFS
// so it becomes a normal, persistent local project (no live link back to disk).
async function importOsFolderIntoOpfs(basePath = "") {
  if (typeof window.showDirectoryPicker !== "function") {
    throw new Error("Folder import is only available in Chromium-based browsers.");
  }
  const osHandle = await window.showDirectoryPicker();
  const base = sanitizeName(osHandle.name || "Imported");
  const project = await buildProjectFromDirectoryHandle(osHandle, base, "opfs");

  const root = await getOpfsRoot();
  const parent = await getDirectoryHandleAtPath(root, basePath, true);
  const finalName = await uniqueDirName(parent, base);
  const dir = await parent.getDirectoryHandle(finalName, { create: true });
  await writeManifest(dir, finalName);

  // Re-root the freshly-walked project onto the new OPFS directory and force a
  // full write (empty sourceIndex ⇒ every file is (re)created there).
  project.name = finalName;
  project.nodes[ROOT_ID].name = finalName;
  project.sourceMode = "opfs";
  project.handles = { [ROOT_ID]: dir };
  project.sourceIndex = {};
  await saveProjectToHandles(project);

  const path = basePath ? `${basePath}/${finalName}` : finalName;
  return openProjectOpfs(path);
}

// Delete a local (OPFS) folder or project by path. Resolves the parent handle
// and removes the leaf entry recursively so a whole project tree goes at once.
async function deleteOpfsEntry(path) {
  const segments = splitPath(path);
  if (segments.length === 0) {
    throw new Error("Nothing to delete.");
  }
  const name = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");
  const root = await getOpfsRoot();
  const parent = await getDirectoryHandleAtPath(root, parentPath, false);
  await parent.removeEntry(name, { recursive: true });
}

// Read a local project into a portable, JSON-clean project model (text inline,
// images as data: URLs) so it can be copied/moved to any provider. Handles and
// the on-disk source index are stripped — the destination re-roots its own.
async function exportProjectModelOpfs(path) {
  const project = await openProjectOpfs(path);
  const segments = splitPath(path);
  const name = segments[segments.length - 1] || project.name || "Workspace";
  const model = {
    id: project.id,
    name: project.name,
    sourceMode: "memory",
    rootId: project.rootId,
    activeFileId: project.activeFileId ?? null,
    nodes: project.nodes
  };
  return { name, project: model };
}

// Write a portable project model into a NEW local project directory under
// destPath (name is uniquified). The model is re-rooted onto the fresh handle
// and fully flushed (empty source index ⇒ every file is created).
async function importProjectModelOpfs(destPath, name, project) {
  const clean = sanitizeName(name);
  const root = await getOpfsRoot();
  const parent = await getDirectoryHandleAtPath(root, destPath, true);
  const finalName = await uniqueDirName(parent, clean);
  const dir = await parent.getDirectoryHandle(finalName, { create: true });
  await writeManifest(dir, finalName);
  const rootId = project.rootId ?? ROOT_ID;
  const nodes = JSON.parse(JSON.stringify(project.nodes ?? {}));
  // saveProjectToHandles walks the tree via listVisibleNodes, which only
  // descends folders whose `expanded` flag is set. A portable model may carry
  // collapsed folders, so force every folder open to flush the whole tree.
  for (const node of Object.values(nodes)) {
    if (node && node.kind === "folder") node.expanded = true;
  }
  const model = {
    id: project.id ?? `project-${finalName}`,
    name: finalName,
    sourceMode: "opfs",
    rootId,
    activeFileId: project.activeFileId ?? null,
    nodes,
    handles: { [rootId]: dir, [ROOT_ID]: dir },
    sourceIndex: {}
  };
  if (model.nodes[rootId]) model.nodes[rootId].name = finalName;
  await saveProjectToHandles(model);
  const path = destPath ? `${destPath}/${finalName}` : finalName;
  return { path, name: finalName };
}

export {
  supportsOpfs,
  listOpfsDir,
  mkdirOpfs,
  createProjectOpfs,
  openProjectOpfs,
  getOpfsDirectoryHandle,
  saveProjectOpfs,
  importOsFolderIntoOpfs,
  deleteOpfsEntry,
  exportProjectModelOpfs,
  importProjectModelOpfs
};
