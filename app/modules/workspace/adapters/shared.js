// What modules on the same level share through Workspace (they may not call
// each other; both may use Workspace): the Editor shows and edits the project
// and Sync carries it to and from the server.
//
//   typed(path, previous, next)    the Editor's typing changed a file: announced as
//                                  "text-changed" (Sync sends the patch when shared)
//   applyRemote(clientId, op)      Sync's: someone else's change, announced before
//                                  ("remote-change": the Editor keeps the caret in
//                                  place) and after ("remote-applied")
//   replace(project, { keepView }) Sync's: the project replaced (a reload); announced
//                                  as "replacing" and "replaced" (the Editor keeps the view)
//   editing.configure({ shows(id), apply(next) })  the Editor: the file it shows whole,
//                                  and applying an edit to it as if typed (the write path)
//   presence                       carets: own (the Editor's) and others' (Sync's)
//
// The write path's two ports (service/writer.js) are answered here too: a text
// change goes through the editor when it shows the file (so it joins the undo
// history and is sent like typing), else into the project and announced; an
// image replaced whole is announced as "file-replaced" (Sync publishes it).
import { getNodeIdByPath } from "../model/project.js";

export function createShared({ store, events }) {
  let editing = { shows: () => false, apply: () => {} };

  function typed(path, previous, next, source = "typing") {
    events.emit("text-changed", { path, previous, next, source });
  }

  function applyRemote(clientId, operation) {
    events.emit("remote-change", { clientId, operation });
    store().applySyncOperation(operation);
    events.emit("remote-applied", { clientId, operation });
  }

  function replace(project, { keepView = false } = {}) {
    events.emit("replacing", { keepView });
    store().replaceProject(project);
    events.emit("replaced", { keepView });
  }

  const ports = {
    commit(path, previous, next, source) {
      const project = store().getProject();
      const id = getNodeIdByPath(project, path);
      if (!id) throw new Error(`No file at ${path}`);
      // An edit made in the preview is already shown there and never joins the editor's undo.
      if (source !== "preview" && editing.shows(id)) { editing.apply(next); return; }
      store().updateContent(id, next);
      typed(path, previous, next, source);
    },
    async replace(operation) {
      const id = getNodeIdByPath(store().getProject(), operation.path);
      if (!id) throw new Error(`No file at ${operation.path}`);
      store().updateContent(id, operation.content);
      events.emit("file-replaced", { operation });
    }
  };

  // Carets in the open project: this tab's (the Editor sets it as the selection
  // moves) and others' (Sync sets them as they arrive, drops those who left).
  let own = null;
  const presence = Object.freeze({
    setOwn(cursor) { own = cursor; events.emit("own-caret", cursor); },
    own: () => own,
    other(cursor) { events.emit("other-caret", cursor); },
    // Only these people are still here: their carets stay, the rest go.
    keep(clientIds) { events.emit("carets-kept", { clientIds }); }
  });

  return {
    typed, applyRemote, replace, ports, presence,
    editing: { configure(next) { editing = { ...editing, ...next }; } }
  };
}
