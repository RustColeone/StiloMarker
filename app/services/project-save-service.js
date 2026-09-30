import { getPath } from "../domain/project-model.js";

export function snapshotProject(project) {
  const { handles, ...model } = project;
  return { ...structuredClone(model), ...(handles ? { handles: { ...handles } } : {}) };
}

// A successful write only confirms the exact path/content included in it.
export function savedFileIds(current, saved) {
  if (current.id !== saved.id || current.sourceMode !== saved.sourceMode
      || current.handles?.[current.rootId] !== saved.handles?.[saved.rootId]) return [];
  return Object.values(saved.nodes).filter((node) => node.kind === "file"
    && current.nodes[node.id]?.kind === "file"
    && current.nodes[node.id].content === node.content
    && getPath(current, node.id) === getPath(saved, node.id)).map((node) => node.id);
}

export function createProjectSaveQueue(write) {
  const roots = new WeakMap();
  return function save(project) {
    const snapshot = snapshotProject(project);
    const root = snapshot.handles?.[snapshot.rootId];
    if (!root) return Promise.reject(new Error("Workspace directory is unavailable"));
    let state = roots.get(root);
    if (!state) {
      state = { tail: Promise.resolve(), index: snapshot.sourceIndex ?? {} };
      roots.set(root, state);
    }
    const job = state.tail.catch(() => {}).then(async () => {
      snapshot.sourceIndex = state.index;
      try {
        await write(snapshot);
        state.index = snapshot.sourceIndex;
        project.sourceIndex = snapshot.sourceIndex;
        return true;
      } catch (error) {
        // Include partially created paths in the next attempt's cleanup list.
        const attempted = Object.values(snapshot.nodes).filter((n) => n.id !== snapshot.rootId)
          .map((n) => ({ path: getPath(snapshot, n.id), kind: n.kind }));
        state.index = Object.fromEntries([...Object.values(state.index), ...attempted]
          .map((entry) => [entry.path, entry]));
        throw error;
      }
    });
    state.tail = job;
    return job;
  };
}
