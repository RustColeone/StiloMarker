// Paths inside a project, as links between notes spell them (Workspace's; the Editor re-exports them).

// "a/./b/../c" -> "a/c"
export function normalizePath(path) {
  const nextSegments = [];
  path.split("/").forEach((segment) => {
    if (!segment || segment === ".") return;
    if (segment === "..") {
      nextSegments.pop();
      return;
    }
    nextSegments.push(segment);
  });
  return nextSegments.join("/");
}

// The link from the file at fromPath to toPath ("./" when it is the same folder's root).
export function getRelativePath(fromPath, toPath) {
  const fromSegments = fromPath.split("/").filter(Boolean);
  fromSegments.pop();
  const toSegments = toPath.split("/").filter(Boolean);
  let sharedIndex = 0;
  while (sharedIndex < fromSegments.length && sharedIndex < toSegments.length && fromSegments[sharedIndex] === toSegments[sharedIndex]) {
    sharedIndex += 1;
  }
  const upSegments = Array.from({ length: fromSegments.length - sharedIndex }, () => "..");
  const relative = [...upSegments, ...toSegments.slice(sharedIndex)].join("/");
  return relative || "./";
}

// The same, but a file next to itself is named by its file name.
export function getRelativeProjectPath(fromFilePath, toFilePath) {
  const fromSegments = fromFilePath.split("/").filter(Boolean);
  const toSegments = toFilePath.split("/").filter(Boolean);
  fromSegments.pop();
  while (fromSegments.length > 0 && toSegments.length > 0 && fromSegments[0] === toSegments[0]) {
    fromSegments.shift();
    toSegments.shift();
  }
  const relative = [...fromSegments.map(() => ".."), ...toSegments].join("/");
  return relative || toFilePath.split("/").filter(Boolean).pop() || "";
}
