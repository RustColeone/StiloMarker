// The open project, held in memory: changes go through it, and listeners hear
// about each one. No input or output; saving it is someone else's job. It
// also says which of this browser's copies the project is saved as
// (copyKey()): the one it opened with; a replace names its own, or keeps the
// key when the project stays the same one (same id), or asks keyOf(next).
import {
  ROOT_ID,
  applySyncOperation,
  addFile,
  addFolder,
  createProject,
  getNode,
  markFileSaved,
  markFilesSaved,
  moveNode,
  removeNodeRecursive,
  renameNode,
  setActiveFile,
  toggleFolder,
  updateFileContent
} from "../model/project.js";

function seedDefaultProject() {
  let project = createProject("Workspace");
  project = addFile(project, ROOT_ID, "welcome.md", "# MDNotes\n\nCreate files from the explorer or open a local directory in Chromium.");
  project = setActiveFile(project, Object.values(project.nodes).find((node) => node.kind === "file")?.id);
  return project;
}

function createProjectController(initialProject = seedDefaultProject(), { copyKey: initialKey = null, keyOf = (next) => `local:${next?.id}` } = {}) {
  let project = initialProject;
  let copyKey = initialKey ?? keyOf(initialProject);
  const listeners = new Set();

  function emit() {
    listeners.forEach((listener) => listener(project));
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(project);
    return () => listeners.delete(listener);
  }

  function apply(mutator) {
    project = mutator(project);
    emit();
    return project;
  }

  return {
    subscribe,
    getProject() {
      return project;
    },
    copyKey: () => copyKey,
    replaceProject(nextProject, { copyKey: key = null } = {}) {
      copyKey = key ?? (nextProject?.id === project?.id ? copyKey : keyOf(nextProject));
      project = nextProject;
      emit();
    },
    applySyncOperation(operation) {
      return apply((current) => applySyncOperation(current, operation));
    },
    createFolder(parentId, name) {
      return apply((current) => addFolder(current, parentId, name));
    },
    createFile(parentId, name, content = "") {
      return apply((current) => addFile(current, parentId, name, content));
    },
    rename(nodeId, name) {
      return apply((current) => renameNode(current, nodeId, name));
    },
    remove(nodeId) {
      return apply((current) => removeNodeRecursive(current, nodeId));
    },
    move(nodeId, targetParentId, targetIndex = null) {
      return apply((current) => moveNode(current, nodeId, targetParentId, targetIndex));
    },
    setActiveFile(fileId) {
      return apply((current) => setActiveFile(current, fileId));
    },
    toggleFolder(nodeId) {
      return apply((current) => toggleFolder(current, nodeId));
    },
    updateContent(fileId, content) {
      return apply((current) => updateFileContent(current, fileId, content));
    },
    // countEdits=false when a server hosts this workspace: the host owns the
    // session counters so every peer shows the same S.E.N, and a local bump
    // would only drift until the next state push overwrote it.
    markSaved(fileId, countEdits = true) {
      return apply((current) => markFileSaved(current, fileId, countEdits));
    },
    markManySaved(fileIds, countEdits = true) {
      return apply((current) => markFilesSaved(current, fileIds, countEdits));
    },
    getActiveFile() {
      return project.activeFileId ? getNode(project, project.activeFileId) : null;
    }
  };
}

export { createProjectController, seedDefaultProject };