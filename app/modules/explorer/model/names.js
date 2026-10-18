// Names for new and moved things in the explorer, and the text a file
// becomes when it is dropped into a note. Pure: moved from main.js.
import { builtinTypes } from "../../file-types/index.js";
import { getRelativePath } from "../../editor/index.js";
import { findChildByName, getPath, isImageFileName } from "../../workspace/index.js";

const numbered = (base, index, extension = "") => `${base} ${index}${extension}`;

// "new folder 1", "new folder 2"... the first one the folder does not have.
export function getNextDefaultFolderName(project, parentId) {
  let index = 1;
  while (findChildByName(project, parentId, numbered("new folder", index))) index += 1;
  return numbered("new folder", index);
}

// The same for a new file of a kind ("new note 1.md").
export function getNextDefaultFileName(project, parentId, kind) {
  const label = builtinTypes.creatable().find((type) => type.id === kind)?.create.name ?? "new file";
  const extension = builtinTypes.extensionsOf(kind)[0] ?? "";
  let index = 1;
  while (findChildByName(project, parentId, numbered(label, index, extension))) index += 1;
  return numbered(label, index, extension);
}

// "name-2.md", "name-3.md"... when the folder already has `name`.
export function suggestUniqueFileName(project, parentId, name) {
  const dotIndex = name.lastIndexOf(".");
  const baseName = dotIndex >= 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex >= 0 ? name.slice(dotIndex) : "";
  let candidate = name;
  let counter = 2;
  while (findChildByName(project, parentId, candidate)) {
    candidate = `${baseName}-${counter}${extension}`;
    counter += 1;
  }
  return candidate;
}

export function suggestUniqueFolderName(project, parentId, name) {
  let candidate = name;
  let counter = 2;
  while (findChildByName(project, parentId, candidate)) {
    candidate = `${name}-${counter}`;
    counter += 1;
  }
  return candidate;
}

// The extension a rename keeps ("" for folders and names without one), as the
// name spells it: a type's whole extension (".persona.skill"), else the last ".x".
export function fileExtensionOf(name) {
  const extension = builtinTypes.extensionOf(name);
  return extension ? String(name).slice(-extension.length) : "";
}

export function looksLikeUrl(value) {
  return /^(https?:\/\/|data:)/i.test(value.trim());
}

// A file name for a URL's last path segment.
export function inferNameFromUrl(value) {
  try {
    const url = new URL(value);
    const rawName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "").trim();
    return rawName || "remote-file";
  } catch {
    return "remote-file"; // not a URL: the generic name
  }
}

// What a file dropped into a note becomes: an image or a link, relative to the note.
export function createMarkdownReference(project, activeFile, targetFile) {
  const relativePath = getRelativePath(getPath(project, activeFile.id), getPath(project, targetFile.id));
  return isImageFileName(targetFile.name) ? `![${targetFile.name}](${relativePath})` : `[${targetFile.name}](${relativePath})`;
}
