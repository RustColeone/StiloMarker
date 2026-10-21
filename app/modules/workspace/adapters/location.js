// Where the open project lives, as far as other modules need to know: a key
// naming it (a shared session's, else the project's own id), whether it is
// shared and whether this tab may only read it, which files the server has
// confirmed, the address an image's bytes are served from (in a cloud
// workspace kept on disk, the server's; otherwise the file's own data), and
// which of this browser's copies a project newly opened in this tab is saved
// as (copyKey: a shared workspace's content never goes into this browser's
// own workspace's copy). Sync says (configure), since it knows the
// connection; until then the project is this browser's.
import { getNodeIdByPath, getPath, isImageFileName } from "../model/project.js";
import { normalizePath } from "../model/paths.js";
import { localKey } from "./browser-copy.js";

export function createLocation() {
  let where = {
    key: (project) => project?.id ?? "local",
    assetSrc: (project, node) => (typeof node?.content === "string" ? node.content : ""),
    shared: () => false,              // a shared workspace (Sync's)
    readOnly: () => false,            // this tab may only read it
    confirmed: (project, ids) => ids, // the files the server has confirmed (all, when not shared)
    assetsKey: () => "",              // what images' addresses depend on (the connection's token)
    copyKey: (project) => localKey(project), // the copy a project newly opened here is saved as
    ownsCopy: () => true              // this window keeps the copy (not when another window on it does)
  };
  const assetSrc = (project, node) => (node ? where.assetSrc(project, node) : "");
  return Object.freeze({
    configure(next) { where = { ...where, ...next }; },
    key: (project) => where.key(project),
    shared: () => where.shared(),
    readOnly: () => where.readOnly(),
    confirmed: (project, ids) => where.confirmed(project, ids),
    assetsKey: () => where.assetsKey(),
    copyKey: (project) => where.copyKey(project),
    ownsCopy: () => where.ownsCopy(),
    assetSrc,
    // A link written in a file (relative to it) to the image it names, as an address;
    // anything else (a web address, an anchor, a missing file) is left as written.
    resolveAsset(project, fromNodeId, url) {
      const trimmed = String(url ?? "").trim();
      if (!trimmed || /^(https?:\/\/|data:|blob:|#|\/)/i.test(trimmed)) return trimmed;
      const baseSegments = (fromNodeId ? getPath(project, fromNodeId) : "").split("/").filter(Boolean);
      baseSegments.pop();
      const nodeId = getNodeIdByPath(project, normalizePath([...baseSegments, trimmed].join("/")));
      const node = nodeId ? project.nodes[nodeId] : null;
      return node?.kind === "file" && isImageFileName(node.name) ? assetSrc(project, node) : trimmed;
    }
  });
}
