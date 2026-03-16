import { deserializeProject, serializeProject } from "../domain/project-model.js";

const PROJECT_KEY = "mdnotes.project.v1";

function loadProject() {
  try {
    const raw = globalThis.localStorage?.getItem(PROJECT_KEY);
    if (!raw) {
      return null;
    }
    const project = deserializeProject(raw);
    if (project.sourceMode === "filesystem") {
      project.sourceMode = "memory";
    }
    return project;
  } catch {
    return null;
  }
}

function saveProject(project) {
  const serializableProject = structuredClone(project);
  delete serializableProject.handles;
  globalThis.localStorage?.setItem(PROJECT_KEY, serializeProject(serializableProject));
}

export { loadProject, saveProject };