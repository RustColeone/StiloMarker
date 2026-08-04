import { deserializeProject, serializeProject } from "../domain/project-model.js";

const PROJECT_KEY = "mdnotes.project.v1";

function loadProject() {
  try {
    const raw = globalThis.localStorage?.getItem(PROJECT_KEY);
    if (!raw) {
      return null;
    }
    const project = deserializeProject(raw);
    // An OS-picked "filesystem" directory can't be reopened without a fresh user
    // gesture, so it downgrades to an in-browser copy. An "opfs" project keeps its
    // mode: its directory is re-attachable on boot without any permission prompt.
    if (project.sourceMode === "filesystem") {
      project.sourceMode = "memory";
    }
    return project;
  } catch {
    return null;
  }
}

function saveProject(project) {
  // Live directory handles aren't JSON-serializable and are re-acquired at
  // runtime, so drop them before cloning rather than cloning then deleting.
  const { handles, ...rest } = project;
  const serializableProject = structuredClone(rest);
  globalThis.localStorage?.setItem(PROJECT_KEY, serializeProject(serializableProject));
}

export { loadProject, saveProject };