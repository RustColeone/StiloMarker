// What type a file name has, and what follows from it. Pure: a table of type
// entries goes in, answers come out. The server has the same rules in
// server/stilo/modules/file_types/model.py; spec/file-types/type-of.cases.json
// keeps the two in step (docs/ARCHITECTURE.md, rule 6).
//
// An entry: { id, label, kind: "text" | "image", format, extensions: { ".ext": mime },
//             icon, filters: [], expandable?, create?: { label, name, order } }
// `reserved`: names no file or folder may have at a workspace's top (any case).

// A name as a disk that ignores case and Unicode look-alikes may read it
// (NFKC, lower case with ß as ss, trailing dots and spaces dropped as Windows
// does); the server's file_types/model.py folds the same way.
export const foldName = (name) => String(name ?? "").normalize("NFKC").toLowerCase().replaceAll("ß", "ss").normalize("NFKC").replace(/[. ]+$/, "");

export function createTypeTable(entries, reserved = []) {
  const list = () => (typeof entries === "function" ? entries() : entries);
  const kept = new Set(reserved.map(foldName));

  // The entry and extension that match a name: the longest extension wins.
  function find(name) {
    const lower = String(name ?? "").toLowerCase();
    let best = null;
    for (const entry of list()) {
      for (const extension of Object.keys(entry.extensions)) {
        if (lower.endsWith(extension) && lower.length > extension.length && (!best || extension.length > best.extension.length)) {
          best = { entry, extension };
        }
      }
    }
    return best;
  }

  const typeOf = (name) => find(name)?.entry ?? null;
  // The extension that belongs to the name's type; for an unknown name, the
  // text from its last dot (so renames keep whatever was there).
  function extensionOf(name) {
    const hit = find(name);
    if (hit) return String(name).slice(-hit.extension.length).toLowerCase();
    const text = String(name ?? "");
    const dot = text.lastIndexOf(".");
    return dot > 0 ? text.slice(dot).toLowerCase() : "";
  }

  return Object.freeze({
    typeOf,
    extensionOf,
    baseName: (name) => {
      const extension = extensionOf(name);
      return extension ? String(name).slice(0, -extension.length) : String(name ?? "");
    },
    isKnown: (name) => typeOf(name) !== null,
    isText: (name) => typeOf(name)?.kind === "text",
    isImage: (name) => typeOf(name)?.kind === "image",
    is: (name, id) => typeOf(name)?.id === id,
    formatOf: (name) => typeOf(name)?.format ?? null,
    mimeOf: (name) => {
      const hit = find(name);
      return hit ? hit.entry.extensions[hit.extension] : "application/octet-stream";
    },
    extensionsOf: (id) => Object.keys(list().find((entry) => entry.id === id)?.extensions ?? {}),
    // For <input type="file" accept=…> and messages that list what is allowed.
    accept: () => list().flatMap((entry) => Object.keys(entry.extensions)).join(","),
    describe: () => list().flatMap((entry) => Object.keys(entry.extensions)).join(", "),
    creatable: () => list().filter((entry) => entry.create)
      .sort((a, b) => a.create.order - b.create.order),
    isReserved: (name) => kept.has(foldName(name)),
    reserved: () => [...reserved],
    all: () => [...list()]
  });
}
