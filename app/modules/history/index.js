// History (browser): snapshots of files (in this browser's own store, or on
// the server for a cloud workspace), backups of whole cloud workspaces, and
// comparing two versions of a text. The server's half is
// server/stilo/modules/history; their messages are protocol/history.contract.json.
// The dialogs that show them are still in app/features (snapshots.js,
// snapshots-dialog.js, workspace-history.js) and call these.
//
// Static, for code from before the restructure:
//   local store:  createFileSnapshot, createFileSnapshots, listSnapshotPaths, listFileVersions,
//                 getVersionContent, deleteVersion, snapshotStorageBytes
//   server:       listServerSnapshotPaths, listServerSnapshotVersions, getServerSnapshotContent,
//                 createServerSnapshot, deleteServerSnapshot, listWorkspaceBackups,
//                 listWorkspaceBackupFiles, getWorkspaceBackupContent, createWorkspaceBackup
//   diffLines(oldText, newText) -> [{ type: "same" | "add" | "del", text, oldLine, newLine }]
import { defineModule } from "../../kernel/index.js";
import { forgetOldSnapshots } from "./adapters/local-store.js";

export * from "./adapters/api.js";
export { createFileSnapshot, createFileSnapshots, deleteVersion, getVersionContent, listFileVersions, listSnapshotPaths,
  snapshotStorageBytes } from "./adapters/local-store.js";
export { diffLines } from "./model/diff.js";

export default defineModule({
  name: "history",
  level: 4,
  uses: ["shell", "file-types"],
  owns: { data: ["the browser's snapshot store"], rules: ["line diff"] },
  start() {
    forgetOldSnapshots();
    return {};
  }
});
