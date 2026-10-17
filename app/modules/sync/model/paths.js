// A project as the sync runtime compares it: its folders and files by path
// (the root's name left out), what travels to the server, and which files hold
// typing the server has not confirmed. Pure.

// { folders: [{ path, parentPath, name }], files: [{ id, path, parentPath, name, content }] }
export function flattenProjectPaths(project) {
  const folders = [];
  const files = [];
  if (!project?.nodes) return { folders, files };
  const walk = (nodeId, parentPath) => {
    for (const childId of project.nodes[nodeId]?.children ?? []) {
      const child = project.nodes[childId];
      if (!child) continue;
      const path = parentPath ? `${parentPath}/${child.name}` : child.name;
      if (child.kind === "folder") {
        folders.push({ path, parentPath, name: child.name });
        walk(childId, path);
      } else if (child.kind === "file") {
        files.push({ id: child.id, path, parentPath, name: child.name, content: child.content ?? "" });
      }
    }
  };
  walk(project.rootId, "");
  return { folders, files };
}

// The project as it travels: no local file handles or index, never "filesystem".
export function sanitizeProjectForSync(project) {
  const syncProject = structuredClone(project);
  delete syncProject.handles;
  delete syncProject.sourceIndex;
  if (syncProject.sourceMode === "filesystem") syncProject.sourceMode = "memory";
  return syncProject;
}

export function fingerprintProject(project) {
  return JSON.stringify(sanitizeProjectForSync(project));
}

// Path -> text of every text file with typing the server has not confirmed
// (`pending(path)`), or marked dirty. A pull must never silently drop these.
export function unsyncedFiles(project, pending, isImage) {
  const out = new Map();
  for (const file of flattenProjectPaths(project).files) {
    const node = project.nodes[file.id];
    if ((node.dirty || pending(file.path)) && !isImage(file.name)) out.set(file.path, file.content);
  }
  return out;
}
