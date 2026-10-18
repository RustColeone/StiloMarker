// Whether this tab works on a shared workspace (a cloud project, a PIN
// session, hosting for guests) or on its own local project, and the local
// project kept aside while it is shared, so leaving can bring it back. One
// owner (Sync): everyone reads get(); only these named actions change it, and
// each change lands in the trace under its name (kernel createState).
//
//   workspaceMode    "synced" (shared) or "private" (local)
//   privateProject   the local project kept aside while shared, or null

export const LOCAL_MODE = { workspaceMode: "private", privateProject: null };

export function createMode(state) {
  const get = state.get;
  return Object.freeze({
    get,
    on: state.on,

    // Start working on a shared workspace. The local project shown now is
    // kept aside the first time; already shared, the kept one stays.
    share(currentProject) {
      const kept = get().workspaceMode === "private" ? currentProject : get().privateProject;
      state.set("share", { workspaceMode: "synced", privateProject: kept });
    },

    // Back to local work. Returns the kept project (or null): the caller shows
    // it again, or not (opening another local project, a deleted workspace).
    leave() {
      const kept = get().privateProject;
      state.set("leave", { workspaceMode: "private", privateProject: null });
      return kept;
    },

    // Stay shared, but never bring the kept project back (the shared one on
    // screen is what the user is working on).
    forgetKept() {
      state.set("forget the kept project", { privateProject: null });
    },

    // Undo a failed open: back to a state read with get() before it.
    restore(saved) {
      state.set("restore", { workspaceMode: saved.workspaceMode, privateProject: saved.privateProject });
    }
  });
}
