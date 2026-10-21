// What this tab did while it was away from a cloud workspace (offline, or
// reconnecting), put together with what others did meanwhile, file by file,
// once it is back:
//   1. renames, moves and folders made away are made again where they still
//      fit; a deletion only of what nobody changed meanwhile;
//   2. the server's copy is read again (paths as they are now);
//   3. a file only this tab changed gets its edit; one both changed is merged
//      line by line where that is sure (model/merge.js); one that cannot be,
//      or that was removed meanwhile, keeps this tab's text in Snapshots;
//   4. files made away are made.
// Text is based on the revision the copy was read at (the server places a
// patch over the patches since). The base of a file is its text when the
// server last had all of it (Sync notes it at the first unconfirmed edit);
// with the workspace unchanged since this tab was last in step (the server
// still at `inStepAt`), the server's text is the base. Pure, but for the
// calls it is given.
import { mergeText } from "../model/merge.js";
import { flattenProjectPaths } from "../model/paths.js";

const parentOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1);
const pathOf = (op) => [op.parentPath, op.name].filter(Boolean).join("/");

// A refusal (the server's 4xx) is that file's or change's; anything else
// (the connection) ends the merge, and the reconnect tries again.
const refused = (error) => Number.isFinite(Number(error?.status)) && Number(error.status) >= 400 && Number(error.status) < 500;

// fetchState() -> the server's { project, revision }; local: this tab's
// project; unsynced: Map path -> text of files with edits the server has not
// had; bases: Map path -> base text; ops: the structural changes made away,
// in order (a deleted file's carries `had`, its text then); inStepAt: the
// revision this tab was last in step with (unknown: NaN); push(operation)
// -> Promise; buildTextPatch.
// Returns { merged: Set of paths taken care of, kept: Map path -> text (for
// Snapshots), skipped: [changes that no longer fit] }.
export async function mergeOffline({ fetchState, local, unsynced, bases = new Map(), ops = [], inStepAt = Number.NaN, push, buildTextPatch, isImage = () => false }) {
  const merged = new Set(), kept = new Map(), skipped = [];
  let snapshot = await fetchState();
  const unchanged = Number(snapshot.revision) === Number(inStepAt);
  const read = (state) => {
    const tree = flattenProjectPaths(state.project);
    return { files: new Map(tree.files.map((file) => [file.path, file.content])), folders: new Set(tree.folders.map((folder) => folder.path)) };
  };
  let server = read(snapshot);

  // 1. The structural changes made away, in order.
  const folder = async (path) => {
    if (!path || server.folders.has(path)) return;
    await folder(parentOf(path));
    await push({ type: "create-folder", parentPath: parentOf(path), name: nameOf(path) });
    server.folders.add(path);
  };
  let changedPlaces = false;
  for (const op of ops) {
    try {
      if (op.type === "create-folder") { await folder(pathOf(op)); changedPlaces = true; continue; }
      if (op.type === "rename-node" || op.type === "move-node") { await push(op); changedPlaces = true; continue; }
      if (op.type === "delete-node") {
        // Only what nobody changed meanwhile: the file as it was when deleted
        // here, or anything at all with the workspace unchanged.
        const theirs = server.files.get(op.path);
        if (unchanged || (op.had !== undefined && theirs === op.had)) { await push({ type: op.type, path: op.path }); changedPlaces = true; }
        else skipped.push(op);
      }
    } catch (error) {
      if (!refused(error)) throw error;
      skipped.push(op);
    }
  }

  // 2. Paths as they are now.
  if (changedPlaces) {
    snapshot = await fetchState();
    server = read(snapshot);
  }
  const revision = Number(snapshot.revision);

  // 3. Text. Files made away: those the log names, and (the workspace
  // unchanged) any this tab has that the server does not.
  const localFiles = flattenProjectPaths(local).files;
  const madeAway = new Set(ops.filter((op) => op.type === "create-file").map(pathOf));
  if (unchanged) for (const file of localFiles) if (!server.files.has(file.path)) madeAway.add(file.path);
  const toCreate = [];
  for (const file of localFiles) {
    if (isImage(file.name)) continue;
    const { path, content: text } = file;
    const theirs = server.files.get(path);
    if (theirs === undefined) {
      if (madeAway.has(path)) toCreate.push(file);
      else if (unsynced.has(path)) kept.set(path, text); // edited here, removed or moved there
      continue;
    }
    if (!unsynced.has(path)) continue; // not changed here: the server's stands
    if (theirs === text) { merged.add(path); continue; }
    const base = unchanged && !changedPlaces ? theirs : bases.get(path);
    const result = base === undefined ? null : mergeText(base, text, theirs);
    if (result === null) { kept.set(path, text); continue; }
    try {
      if (result !== theirs) await push(buildTextPatch(path, theirs, result, revision));
      merged.add(path);
    } catch (error) {
      if (!refused(error)) throw error;
      kept.set(path, text); // someone changed it while this ran: kept
    }
  }

  // 4. Files made away (their folders first).
  for (const file of toCreate) {
    try {
      await folder(parentOf(file.path));
      await push({ type: "create-file", parentPath: parentOf(file.path), name: file.name, content: file.content });
      merged.add(file.path);
    } catch (error) {
      if (!refused(error)) throw error;
      kept.set(file.path, file.content);
    }
  }
  return { merged, kept, skipped };
}
