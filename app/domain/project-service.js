import {
  ROOT_ID,
  applySyncOperation,
  addFile,
  addFolder,
  createProject,
  getNode,
  markFileSaved,
  removeNodeRecursive,
  renameNode,
  setActiveFile,
  toggleFolder,
  updateFileContent
} from "./project-model.js";

function seedDefaultProject() {
  let project = createProject("Workspace");
  project = addFile(project, ROOT_ID, "welcome.md", "# MDNotes\n\nCreate files from the explorer or open a local directory in Chromium.");
  project = setActiveFile(project, Object.values(project.nodes).find((node) => node.kind === "file")?.id);
  return project;
}

function createProjectController(initialProject = seedDefaultProject()) {
  let project = initialProject;
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
    replaceProject(nextProject) {
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
    setActiveFile(fileId) {
      return apply((current) => setActiveFile(current, fileId));
    },
    toggleFolder(nodeId) {
      return apply((current) => toggleFolder(current, nodeId));
    },
    updateContent(fileId, content) {
      return apply((current) => updateFileContent(current, fileId, content));
    },
    markSaved(fileId) {
      return apply((current) => markFileSaved(current, fileId));
    },
    getActiveFile() {
      return project.activeFileId ? getNode(project, project.activeFileId) : null;
    }
  };
}

export { createProjectController, seedDefaultProject };