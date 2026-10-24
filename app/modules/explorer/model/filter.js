// The explorer's name search (the box above the tree): the rows a query
// leaves, in the tree's order. Pure.
import { ROOT_ID, getNode, getPath } from "../../workspace/index.js";

const fold = (text) => String(text ?? "").normalize("NFKC").toLowerCase();

// Rows ({ node, depth, path, open }) for the files and folders whose name
// holds the query (any case), and the folders holding them, shown open while
// it lasts (their own open or closed state is left as it was). An empty query
// leaves the tree as it is: null.
export function rowsMatching(project, query) {
  const wanted = fold(query).trim();
  if (!wanted) return null;
  const rows = [];
  const walk = (id, depth) => {
    let found = false;
    for (const childId of getNode(project, id).children ?? []) {
      const child = project.nodes[childId];
      if (!child) continue;
      const at = rows.length;
      const row = { node: child, depth, path: getPath(project, childId), open: false };
      rows.push(row);
      row.open = child.kind === "folder" && walk(childId, depth + 1);
      if (row.open || fold(child.name).includes(wanted)) found = true;
      else rows.splice(at); // neither it nor anything in it
    }
    return found;
  };
  walk(ROOT_ID, 0);
  return rows;
}

// The first file a query leaves (Enter opens it), or null.
export const firstFileMatching = (project, query) => rowsMatching(project, query)?.find((row) => row.node.kind === "file" && fold(row.node.name).includes(fold(query).trim()))?.node ?? null;
