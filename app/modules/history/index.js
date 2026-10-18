// History (browser): snapshots of files (in this browser's own store, or on
// the server for a cloud workspace), backups of whole cloud workspaces, and
// comparing two versions of a text. The server's half is
// server/stilo/modules/history; their messages are protocol/history.contract.json.
// On the page (attach(port), adapters/surface.js): snapshots and the version
// label in the status bar, the preview's diff tab (an Editor pane view), the
// Snapshots and Workspace History dialogs.
//
// Static, for code from before the restructure:
//   local store:  createFileSnapshot, createFileSnapshots, listSnapshotPaths, listFileVersions,
//                 getVersionContent, deleteVersion, snapshotStorageBytes
//   server:       listServerSnapshotPaths, listServerSnapshotVersions, getServerSnapshotContent,
//                 createServerSnapshot, deleteServerSnapshot, listWorkspaceBackups,
//                 listWorkspaceBackupFiles, getWorkspaceBackupContent, createWorkspaceBackup
//   diffLines(oldText, newText) -> [{ type: "same" | "add" | "del", text, oldLine, newLine }]
//
// API (started by the kernel):
//   trash.open(team, { onChange })   the team's trash: deleted cloud projects, kept
//                                    for a number of days (restore, delete now)
//   trash.list(team)  trash.restore(team, id)  trash.remove(team, id)
//   attach(port) -> parts: snapshotStore(), createSnapshotNow(label), snapshotDirtyFiles(label),
//     ensureSnapshotsMigrated(), refreshSnapshotBaselines(), showFileDiff(path, versionId, createdAt),
//     openSnapshotsDialog(), openWorkspaceHistory(), renderVersionLabel()...   parts() -> the same
import { defineModule } from "../../kernel/index.js";
import { forgetOldSnapshots } from "./adapters/local-store.js";
import { createTrash } from "./adapters/trash.js";
import { createSurface } from "./adapters/surface.js";

export * from "./adapters/api.js";
export { createFileSnapshot, createFileSnapshots, deleteVersion, getVersionContent, listFileVersions, listSnapshotPaths,
  snapshotStorageBytes } from "./adapters/local-store.js";
export { diffLines } from "./model/diff.js";

export default defineModule({
  name: "history",
  level: 4,
  uses: ["shell", "file-types", "identity", "workspace", "editor", "sync"],
  owns: { data: ["the browser's snapshot store"], rules: ["line diff"],
    elements: ["the trash dialog", "the Snapshots dialog", "the Workspace History dialog", "the diff tab", "the version in the status bar"] },
  start(ctx) {
    forgetOldSnapshots();
    let parts = null;
    function attach(port) {
      if (parts) throw new Error("history: already attached");
      parts = createSurface({ port, shell: ctx.use("shell"), workspace: ctx.use("workspace"), editor: ctx.use("editor"), sync: ctx.use("sync") });
      return parts;
    }
    return { trash: createTrash({ shell: ctx.use("shell"), identity: ctx.use("identity") }), attach, parts: () => parts };
  }
});
