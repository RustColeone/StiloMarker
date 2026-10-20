import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import fileTypes, { builtinTypes } from "../app/modules/file-types/index.js";
import { startModules } from "../app/kernel/index.js";

// The browser's half of spec/file-types/type-of.cases.json (the server's is file-types.test.py).
const { cases } = JSON.parse(await readFile(new URL("../spec/file-types/type-of.cases.json", import.meta.url), "utf8"));

test("type lookups match the shared table", () => {
  for (const c of cases) {
    const t = builtinTypes;
    assert.deepEqual(
      { type: t.typeOf(c.name)?.id ?? null, extension: t.extensionOf(c.name), base: t.baseName(c.name), image: t.isImage(c.name), text: t.isText(c.name), format: t.formatOf(c.name) },
      { type: c.type, extension: c.extension, base: c.base, image: c.image, text: c.text, format: c.format }, c.name);
  }
});

test("MIME types, accept lists and the Create order come from the one list", () => {
  assert.equal(builtinTypes.mimeOf("a.JPG"), "image/jpeg");
  assert.equal(builtinTypes.mimeOf("a.unknown"), "application/octet-stream");
  assert.ok(builtinTypes.accept().split(",").includes(".persona.skill"));
  assert.deepEqual(builtinTypes.creatable().map((t) => t.id), ["md", "mtree", "urldb", "bmap", "persona", "mermaid"]);
});

test("the module lets a new type in, refuses a taken extension, and sees the new type at once", async () => {
  const { "file-types": types } = await startModules([fileTypes]);
  assert.equal(types.typeOf("song.abc"), null);
  const remove = types.add({ id: "abc", label: "ABC tune", kind: "text", format: "abc", extensions: { ".abc": "text/plain" }, icon: "is-file", filters: [] });
  assert.equal(types.typeOf("song.abc").id, "abc");
  assert.equal(builtinTypes.typeOf("song.abc"), null, "the static table covers the built-ins only");
  assert.throws(() => types.add({ id: "md2", label: "x", kind: "text", format: "markdown", extensions: { ".md": "text/plain" } }), /already belongs to the md/);
  assert.throws(() => types.add({ id: "bad", label: "x", kind: "video", format: "x", extensions: { ".x": "" } }), /kind/);
  remove();
  assert.equal(types.typeOf("song.abc"), null);
});
