// The one way to change a file's text. Every writer (typing aside, which the
// editor already sends as patches) calls write(): the agent's Keep and Drop,
// preview edits, restores, URL album edits. A text file's change always
// leaves as a text patch, so it merges with other people's typing instead of
// overwriting it; an image is binary and is replaced whole.
//
// `base` is the text the writer started from. When the file has changed
// since (someone typed, another edit landed), the change is placed into the
// file as it is now, piece by piece; a piece that cannot be placed exactly
// makes the whole write stale and nothing changes.
import { applyHunks, diffHunks, placeHunks } from "../model/hunks.js";
import { buildTextPatch } from "../model/text-patch.js";

export class StaleWriteError extends Error {
  constructor(path) {
    super(`${path} changed in a way this edit can no longer fit; nothing was changed`);
    this.name = "StaleWriteError";
    this.path = path;
  }
}

// read(path) -> { content } | null       the project's file (from the module)
// ports.commit(path, previous, next, source)   update the text and send the patch
// ports.replace(operation, source)           replace a binary file whole
export function createWriter({ types, emit, read }) {
  let ports = null;

  function attach(implementation) {
    for (const name of ["commit", "replace"]) {
      if (typeof implementation?.[name] !== "function") throw new Error(`workspace ports need ${name}()`);
    }
    ports = implementation;
  }

  // Resolves to { changed, text }. Throws StaleWriteError, or a plain Error
  // when the file does not exist.
  async function write(path, text, { base, source = "app" } = {}) {
    if (!ports) throw new Error("The workspace is not ready yet");
    const file = read(path);
    if (!file) throw new Error(`No file at ${path}`);
    const current = file.content ?? "";
    if (types.isImage(path)) {
      if (text === current) return { changed: false, text: current };
      await ports.replace({ type: "update-file", path, content: text }, source);
      emit("written", { path, source });
      return { changed: true, text };
    }
    const from = base ?? current;
    let next = text;
    if (from !== current) {
      const placed = placeHunks(diffHunks(from, text), from, current);
      if (!placed) throw new StaleWriteError(path);
      next = applyHunks(current, placed);
    }
    if (next === current) return { changed: false, text: current };
    await ports.commit(path, current, next, source);
    emit("written", { path, source });
    return { changed: true, text: next };
  }

  // Would this write still fit? (For a review card, before anyone presses Keep.)
  function fits(path, text, base) {
    const file = read(path);
    if (!file) return false;
    const current = file.content ?? "";
    return base === undefined || base === current || placeHunks(diffHunks(base, text), base, current) !== null;
  }

  function patchOperation(path, text, baseRevision) {
    const file = read(path);
    if (!file) throw new Error(`No file at ${path}`);
    return buildTextPatch(path, file.content ?? "", text, baseRevision);
  }

  // An operation as it should travel: a whole-file text update becomes a
  // patch against the file as it is now (null when nothing changes); an
  // image's update and every other operation pass through unchanged.
  function asPatch(operation, baseRevision) {
    if (operation.type !== "update-file" || types.isImage(operation.path)) return operation;
    return patchOperation(operation.path, operation.content, baseRevision);
  }

  return { attach, write, fits, patchOperation, asPatch };
}
