// The URL album, an extension: a file of named image links. It uses only the
// core's public extension points:
//   File types      its type comes from ../extension.json (both ends read it)
//   Workspace       parts: each entry is listed under its album, opened,
//                   renamed, moved and copied on its own, and dropped into
//                   Markdown as an image
//   Editor          a preview (the table, or one entry), source highlighting
//                   and the formatting toolbar's Entry button
//   Shell           the dialog that asks for a new entry
// Nothing in the core names it; remove this folder and the app runs without it.
import { defineModule } from "../../../app/kernel/index.js";
import { albumParts, nextEntryName, parseAlbum } from "./model/album.js";
import { highlightAlbumLine } from "./adapters/highlight.js";
import { renderAlbumPreview } from "./adapters/preview.js";

const TYPE = "urldb";
export const ENTRY_SNIPPET = `[Entry Name]
url = https://
description = Description
`;

export default defineModule({
  name: "url-album",
  level: 6,
  uses: ["shell", "file-types", "workspace", "editor"],
  owns: { names: ["file type .urldb"], data: ["extensions/url-album/extension.json"] },
  start(ctx) {
    const shell = ctx.use("shell");
    const types = ctx.use("file-types");
    const workspace = ctx.use("workspace");
    const editor = ctx.use("editor");
    const isAlbum = (name) => types.is(name, TYPE);

    async function askForEntry(file) {
      const values = await shell.form({
        eyebrow: "URL Album", title: "New Album Entry",
        message: "Add a named image link to this URL album.",
        fields: [
          { name: "name", label: "Name", value: nextEntryName(file.content), placeholder: "Reference Image 1" },
          { name: "url", label: "URL", type: "url", value: "https://example.com/image.jpg", placeholder: "https://example.com/image.jpg" },
          { name: "description", label: "Description", multiline: true, placeholder: "Optional description" }
        ]
      });
      if (!values) return null;
      if (!values.name) {
        shell.notify("An album entry needs a name.");
        return null;
      }
      if (!/^(https?:\/\/|data:)/i.test(values.url)) {
        shell.notify("An album entry needs a link that starts with http://, https:// or data:.");
        return null;
      }
      return values;
    }

    workspace.parts.add({ id: TYPE, ...albumParts, add: { label: "Add Album Entry", run: askForEntry } });
    editor.previews.add({
      id: TYPE, matches: (file) => isAlbum(file.name), cacheable: false,
      render: (target, project, file, tools) => renderAlbumPreview(target, parseAlbum(file.content), tools.part)
    });
    editor.highlighters.add({ id: TYPE, line: highlightAlbumLine });
    editor.toolbars.add({ id: TYPE, groups: [[
      { id: "urldb-entry", html: "Entry", title: "Insert entry", action: { kind: "block", snippet: ENTRY_SNIPPET, caret: 1 } }
    ]] });

    if (globalThis.document) {
      const style = document.createElement("link");
      style.rel = "stylesheet";
      style.href = new URL("./album.css", import.meta.url).href;
      document.head.append(style);
    }
    return {};
  }
});
