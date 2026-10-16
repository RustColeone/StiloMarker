// Workspace: owns how files change. This first part of the module is the one
// write path; the project tree and operations move here in later steps
// (docs/ARCHITECTURE.md).
//
// API:
//   write(path, text, { base?, source? }) -> Promise<{ changed, text }>
//       Text files change by patches that merge with other people's edits;
//       images are replaced whole. With `base`, the change from base to text
//       is placed into the file as it is now. Throws StaleWriteError when it
//       no longer fits (nothing changes).
//   fits(path, text, base) -> boolean
//   patchOperation(path, text, baseRevision) -> a patch-file operation from the
//       file as it is now to `text`, or null when nothing changes (for writers
//       that chain operations on the server's confirmation, like a restore)
//   asPatch(operation, baseRevision) -> the operation as it should travel: a
//       text file's whole-file update becomes a patch (null if nothing changes)
//   isStale(error) -> boolean
//   events.on("written", ({ path, source }) => …)
//   attach(ports)   for code from before the restructure, which still holds
//                   the project: { read(path), commit(path, previous, next, source),
//                   replace(operation, source) }
import { defineModule } from "../../kernel/index.js";
import { createWriter, StaleWriteError } from "./service/writer.js";

// The text-patch rules, for code from before the restructure (the sync
// runtime) that builds and rebases patches itself. Pure.
export { applyTextPatch, buildTextPatch, transformTextPatch } from "./model/text-patch.js";

export default defineModule({
  name: "workspace",
  level: 2,
  uses: ["file-types"],
  owns: { events: ["written"], names: ["operation update-file", "operation patch-file"] },
  start(ctx) {
    const events = ctx.emitter();
    const writer = createWriter({ types: ctx.use("file-types"), emit: events.emit });
    return {
      write: writer.write,
      patchOperation: writer.patchOperation,
      asPatch: writer.asPatch,
      fits: writer.fits,
      attach: writer.attach,
      isStale: (error) => error instanceof StaleWriteError,
      events: { on: events.on }
    };
  }
});
