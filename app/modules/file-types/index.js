// File types: the one place that knows what each kind of file is (extension,
// text or image, label, MIME type, icon, how it is edited). Everything else
// asks here; the list itself lives in protocol/file-types.json, shared with
// the server.
//
// API (also on `builtinTypes`, which covers only the built-in types):
//   typeOf(name) -> entry | null      is(name, id)      isKnown / isText / isImage(name)
//   formatOf(name)  extensionOf(name)  baseName(name)  mimeOf(name)  extensionsOf(id)
//   accept()  describe()  creatable()  all()
//   isReserved(name)  reserved()       a name no file or folder may have at a
//                                       workspace's top (the server's own files there)
// Module API only:
//   add(entry) -> remove()             an extension point: a new file type
//   onChange(listener)
import { defineModule } from "../../kernel/index.js";
import BUILTIN from "./model/builtin-types.js";
import RESERVED from "./model/reserved-names.js";
import { createTypeTable } from "./model/types.js";
import { fillPage } from "./adapters/page.js";

// For code from before the restructure, which looks types up without the
// kernel. It never sees types added at run time; modules use the API.
export const builtinTypes = createTypeTable(BUILTIN, RESERVED);

const KINDS = new Set(["text", "image"]);

function checkEntry(entry) {
  if (typeof entry.label !== "string" || !entry.label) throw new Error(`file type ${entry.id} needs a label`);
  if (!KINDS.has(entry.kind)) throw new Error(`file type ${entry.id}: kind must be text or image`);
  if (typeof entry.format !== "string" || !entry.format) throw new Error(`file type ${entry.id} needs a format`);
  const extensions = Object.keys(entry.extensions ?? {});
  if (!extensions.length) throw new Error(`file type ${entry.id} needs at least one extension`);
  for (const extension of extensions) {
    if (!/^(\.[a-z0-9]+)+$/.test(extension)) throw new Error(`file type ${entry.id}: bad extension ${extension}`);
  }
}

export default defineModule({
  name: "file-types",
  level: 1,
  uses: [],
  owns: {
    names: ["file type .mtree", "file type .persona.skill", "image extension list"],
    registries: ["file types"],
    data: ["protocol/file-types.json"]
  },
  start(ctx) {
    const registry = ctx.registry({ validate: checkEntry });
    const table = createTypeTable(() => registry.all(), RESERVED);

    function add(entry) {
      for (const extension of Object.keys(entry.extensions ?? {})) {
        const owner = registry.all().find((other) => extension in other.extensions);
        if (owner) throw new Error(`${extension} already belongs to the ${owner.id} file type`);
      }
      return registry.add(entry);
    }

    for (const entry of BUILTIN) add(entry);
    if (globalThis.document) {
      fillPage(document, table);
      registry.onChange(() => fillPage(document, table));
    }
    return { ...table, add, onChange: registry.onChange };
  }
});
